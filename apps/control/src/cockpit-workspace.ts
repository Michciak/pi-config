import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, renameSync, rmSync, openSync, closeSync, readSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";

const TEXT_LIMIT = 2 * 1024 * 1024;
const UPLOAD_LIMIT = 100 * 1024 * 1024;
const HIDDEN = new Set([".git", "node_modules", "dist", "build", ".venv", ".gradle"]);

export function protectSecrets(path: string): void {
  if (/(^|\/)(\.env(?:\..*)?|auth\.json|models\.json|credentials(?:\.json)?|[^/]+\.(?:key|pem|p12))$/i.test(path)) {
    throw Object.assign(new Error("Credentials are not exposed by the workspace API"),{statusCode:403,code:"CREDENTIAL_FILE"});
  }
}

function rootPath(workspace: string): string {
  const root = realpathSync(workspace);
  if (!statSync(root).isDirectory()) throw new Error("Workspace must be a directory");
  return root;
}

export function insideWorkspace(workspace: string, requested: string, allowMissing = false): string {
  const root = rootPath(workspace);
  const raw = resolve(root, requested || ".");
  const candidate = allowMissing && !existsSync(raw) ? join(realpathSync(dirname(raw)), basename(raw)) : realpathSync(raw);
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("/")) throw Object.assign(new Error("Path escapes the workspace"), { statusCode: 400 });
  return candidate;
}

export function listWorkspace(workspace: string, requested = ".") {
  const root = rootPath(workspace);
  const path = insideWorkspace(root, requested);
  if (!statSync(path).isDirectory()) throw Object.assign(new Error("Path is not a directory"), { statusCode: 400 });
  const entries = readdirSync(path, { withFileTypes: true }).filter((entry) => !HIDDEN.has(entry.name)).slice(0, 1000).flatMap((entry) => {
    try {
      const target = insideWorkspace(root, join(relative(root, path), entry.name));
      protectSecrets(target);
      const stat = statSync(target);
      return [{ name: entry.name, path: relative(root, target) || ".", kind: stat.isDirectory() ? "directory" : "file", size: stat.size, mtimeMs: stat.mtimeMs }];
    } catch { return []; }
  });
  entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
  return { workspace: root, path: relative(root, path) || ".", entries, truncated: entries.length >= 1000 };
}

export async function searchWorkspace(workspace: string, query: string, contents=false) {
  const root = rootPath(workspace);
  const needle = query.trim().toLowerCase();
  if (!needle) return { results: [], truncated: false };
  const results: Array<{ name: string; path: string; kind: "file" | "directory"; line?:number; preview?:string }> = [];
  let visited = 0;
  const deadline = Date.now() + 4000;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 24 || visited >= 20_000 || results.length >= 50 || Date.now() > deadline) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (HIDDEN.has(entry.name)) continue;
      visited++;
      let target: string;
      try { target = insideWorkspace(root, relative(root, join(dir, entry.name))); } catch { continue; }
      const kind = entry.isDirectory() ? "directory" : "file";
      if (contents && entry.isFile()) {
        try {
          protectSecrets(target);
          if (statSync(target).size<=TEXT_LIMIT) {
            const bytes=await readFile(target);
            if (!bytes.includes(0)) {
              const lines=bytes.toString("utf8").split("\n");
              const index=lines.findIndex(line=>line.toLowerCase().includes(needle));
              if(index>=0) results.push({name:entry.name,path:relative(root,target),kind,line:index+1,preview:lines[index]?.slice(0,180)});
            }
          }
        } catch {}
      } else if (!contents && relative(root,target).toLowerCase().includes(needle)) {try{protectSecrets(target);results.push({ name: entry.name, path: relative(root, target), kind });}catch{}}
      if (entry.isDirectory()) await walk(target, depth + 1);
      if (visited >= 20_000 || results.length >= 50 || Date.now() > deadline) break;
    }
  };
  await walk(root, 0);
  return { results, truncated: visited >= 20_000 || results.length >= 50 || Date.now() > deadline };
}

export function readHex(workspace:string,requested:string) {
  const path=insideWorkspace(workspace,requested);protectSecrets(path);
  const stat=statSync(path);
  if(!stat.isFile())throw Object.assign(new Error("Not a file"),{statusCode:400});
  const buffer=Buffer.alloc(Math.min(stat.size,64*1024)),fd=openSync(path,"r");
  try {readSync(fd,buffer,0,buffer.length,0);}finally{closeSync(fd);}
  const lines=[];
  for(let offset=0;offset<buffer.length;offset+=16){const row=buffer.subarray(offset,offset+16);lines.push(offset.toString(16).padStart(8,"0")+"  "+[...row].map(byte=>byte.toString(16).padStart(2,"0")).join(" ").padEnd(47)+"  "+[...row].map(byte=>byte>=32&&byte<127?String.fromCharCode(byte):".").join(""));}
  return {path:relative(rootPath(workspace),path),size:stat.size,content:lines.join("\n"),truncated:stat.size>buffer.length};
}

function etag(buffer: Buffer, mtimeMs: number): string {
  return `"${createHash("sha256").update(buffer).update(String(mtimeMs)).digest("base64url")}"`;
}

export function readDocument(workspace: string, requested: string, readOnly: boolean) {
  const path = insideWorkspace(workspace, requested);
  protectSecrets(path);
  const stat = statSync(path);
  if (!stat.isFile()) throw Object.assign(new Error("Path is not a file"), { statusCode: 400 });
  if (stat.size > TEXT_LIMIT) throw Object.assign(new Error("File is larger than 2 MiB"), { statusCode: 413 });
  const content = readFileSync(path);
  if (content.includes(0)) throw Object.assign(new Error("Binary file cannot be edited as text"), { statusCode: 415 });
  return { path: relative(rootPath(workspace), path), content: content.toString("utf8"), encoding: "utf8" as const, etag: etag(content, stat.mtimeMs), mtimeMs: stat.mtimeMs, size: stat.size, readOnly };
}

export function writeDocument(workspace: string, requested: string, content: string, expectedEtag?: string) {
  const path = insideWorkspace(workspace, requested, true);
  protectSecrets(path);
  if (Buffer.byteLength(content) > TEXT_LIMIT) throw Object.assign(new Error("File is larger than 2 MiB"), { statusCode: 413 });
  if (existsSync(path)) {
    if (!expectedEtag) throw Object.assign(new Error("ETag is required to overwrite a file"), { statusCode: 428 });
    const stat = statSync(path); const current = readFileSync(path);
    if (etag(current, stat.mtimeMs) !== expectedEtag) throw Object.assign(new Error("File changed on disk"), { statusCode: 409, code: "FILE_CHANGED" });
  }
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, content, { mode: existsSync(path) ? statSync(path).mode : 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
  return readDocument(workspace, relative(rootPath(workspace), path), false);
}

export function uploadFile(workspace: string, directory: string, name: string, base64: string) {
  const safeName = basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 200);
  if (!safeName) throw Object.assign(new Error("Invalid file name"), { statusCode: 400 });
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > UPLOAD_LIMIT) throw Object.assign(new Error("Upload must be between 1 byte and 100 MiB"), { statusCode: 413 });
  const dir = insideWorkspace(workspace, directory || ".");
  if (!statSync(dir).isDirectory()) throw Object.assign(new Error("Upload target is not a directory"), { statusCode: 400 });
  const path = insideWorkspace(workspace, relative(rootPath(workspace), join(dir, safeName)), true);
  protectSecrets(path);
  try { writeFileSync(path, bytes, { mode: 0o600, flag: "wx" }); }
  catch (error: any) {
    if (error.code === "EEXIST") throw Object.assign(new Error("A file with this name already exists"), { statusCode: 409 });
    throw error;
  }
  return { path: relative(rootPath(workspace), path), size: bytes.length };
}
