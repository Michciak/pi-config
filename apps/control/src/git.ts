import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
import { protectSecrets,insideWorkspace,readDocument } from "./cockpit-workspace.js";

const exec = promisify(execFile);

async function git(workspace: string, args: string[], allowFailure = false): Promise<string> {
  try {
    const { stdout } = await exec("git", ["--no-pager", "-C", realpathSync(workspace), ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return stdout;
  } catch (error: any) {
    if(args[0]==="diff"&&args.includes("--no-index")&&error.code===1)return String(error.stdout??"");
    if (allowFailure) return "";
    throw Object.assign(new Error(String(error?.stderr || error?.message || error).trim()), { statusCode: 400 });
  }
}

export async function gitSnapshot(workspace: string) {
  if (!(await isGitRepository(workspace))) return {workspace:realpathSync(workspace),repository:false,branch:"",ahead:0,behind:0,files:[]};
  const [branch, head, status, upstream] = await Promise.all([
    git(workspace, ["branch", "--show-current"], true), git(workspace, ["rev-parse", "--short", "HEAD"], true),
    git(workspace, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]), git(workspace, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], true),
  ]);
  const [behind = 0, ahead = 0] = upstream.trim().split(/\s+/).map(Number);
  const records = status.split("\0").filter(Boolean);
  const files = [];
  for (let i = 0; i < records.length; i++) {
    const line = records[i]!;
    files.push({ index: line[0] || " ", workingTree: line[1] || " ", path: line.slice(3) });
    if (/[RC]/.test(line.slice(0, 2))) i++;
  }
  return { workspace: realpathSync(workspace), repository:true, branch: branch.trim() || "(detached)", head: head.trim() || undefined, ahead, behind, files };
}

async function isGitRepository(workspace: string) {
  try { await git(workspace,["rev-parse","--git-dir"]); return true; }
  catch(error) { if (/not a git repository/i.test(String(error))) return false; throw error; }
}

export const gitActions = {
  diff: async (workspace: string, staged = false, path?: string) => {
    if (path) protectSecrets(path);
    if(path&&!staged&&!(await git(workspace,["ls-files","--error-unmatch","--",path],true)).trim()) {
      readDocument(workspace,path,true);
      return git(workspace,["diff","--no-ext-diff","--no-textconv","--no-index","--","/dev/null",insideWorkspace(workspace,path)]);
    }
    const paths=path?[`:(literal)${path}`]:[".",... [".env*","auth.json","models.json","credentials*","*.key","*.pem","*.p12"].map(name=>`:(glob,exclude)**/${name}`)];
    return git(workspace,["diff","--no-ext-diff","--no-textconv",...(staged?["--cached"]:[]),"--",...paths]);
  },
  log: (workspace: string) => git(workspace, ["log", "--graph", "--decorate", "--date=iso-strict", "--pretty=format:%h%x09%ad%x09%an%x09%s", "-n", "100"]),
  stage: (workspace: string, path: string) => git(workspace, ["add", "--", `:(literal)${path}`]),
  unstage: (workspace: string, path: string) => git(workspace, ["restore", "--staged", "--", `:(literal)${path}`]),
  commit: (workspace: string, message: string) => git(workspace, ["commit", "-m", message]),
  switchBranch: (workspace: string, branch: string) => {
    if (!branch || branch.startsWith("-") || /[\s\x00-\x1f]/.test(branch)) throw Object.assign(new Error("Invalid branch"), { statusCode: 400 });
    return git(workspace, ["switch", "--", branch]);
  },
  branches: async (workspace: string) => await isGitRepository(workspace) ? git(workspace, ["branch", "--format=%(refname:short)"]) : "",
  pull: (workspace: string) => git(workspace, ["pull", "--ff-only"]),
  push: (workspace: string) => git(workspace, ["push"]),
};
