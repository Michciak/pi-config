import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, renameSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {patchRpcAutocomplete} from "./rpc-autocomplete-patch.mjs";
import {patchStreamRetry} from "./stream-retry-patch.mjs";
import {patchRpcHistory} from "./rpc-history-patch.mjs";

const repo=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const version=new Date().toISOString().replace(/[:.]/g,"-");
const release=join(repo,".releases",version);
mkdirSync(release,{recursive:true});
for (const workspace of ["packages/protocol","packages/prompt-snippets","apps/control"]) {
  const target=join(release,workspace);
  mkdirSync(target,{recursive:true});
  cpSync(join(repo,workspace,"package.json"),join(target,"package.json"));
  execFileSync(join(repo,"node_modules/.bin/tsc"),["-p","tsconfig.json","--outDir",join(target,"dist")],{cwd:join(repo,workspace),stdio:"inherit"});
}
cpSync(join(repo,"apps/control/src/vendor/package.json"),join(release,"apps/control/dist/vendor/package.json"));
mkdirSync(join(release,"apps/web"),{recursive:true});
cpSync(join(repo,"apps/web/package.json"),join(release,"apps/web/package.json"));
execFileSync(join(repo,"node_modules/.bin/vite"),["build","--outDir",join(release,"apps/web/dist"),"--emptyOutDir"],{cwd:join(repo,"apps/web"),stdio:"inherit",env:{...process.env,PI_WEB_BUILD_VERSION:version}});
// A byte-distinct worker is needed for browsers to detect every release update.
const worker=join(release,"apps/web/dist/sw.js");
writeFileSync(worker,readFileSync(worker,"utf8").replace('pi-remote-shell-v2',`pi-remote-shell-${version}`));
writeFileSync(join(release,"apps/web/dist/shell-assets.json"),JSON.stringify(readdirSync(join(release,"apps/web/dist/assets")).filter(name=>!name.endsWith(".map")).map(name=>"/assets/"+name)));
cpSync(join(repo,"node_modules"),join(release,"node_modules"),{recursive:true,dereference:false});
const piPackage=join(release,"node_modules/@earendil-works/pi-coding-agent");
const rpcModule=join(piPackage,"dist/modes/rpc/rpc-mode.js");
writeFileSync(rpcModule,patchRpcAutocomplete(readFileSync(rpcModule,"utf8"),JSON.parse(readFileSync(join(piPackage,"package.json"),"utf8")).version));
writeFileSync(rpcModule,patchRpcHistory(readFileSync(rpcModule,"utf8"),"1.0.3"));
cpSync(join(repo,"scripts/rpc-history-patch.mjs"),join(piPackage,"dist/modes/rpc/remote-history.js"));
const aiPackage=join(release,"node_modules/@earendil-works/pi-ai");
const retryModule=join(aiPackage,"dist/utils/retry.js");
writeFileSync(retryModule,patchStreamRetry(readFileSync(retryModule,"utf8"),JSON.parse(readFileSync(join(aiPackage,"package.json"),"utf8")).version));
cpSync(join(repo,"package-lock.json"),join(release,"package-lock.json"));
writeFileSync(join(release,"release.json"),JSON.stringify({version,protocolVersion:2,upstream:"pi-web-ui@0.97.0"},null,2)+"\n");
const pointer=join(repo,".releases/latest.next");
symlinkSync(version,pointer);
renameSync(pointer,join(repo,".releases/latest"));
console.log("Release ready: "+release);
