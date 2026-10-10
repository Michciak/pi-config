import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

export function patchTodoRemote(source,replay) {
  const marker="/*pi-remote-todo-clear-v1*/";
  if(source.includes(marker)&&replay.includes(marker))return {source,replay};
  const command="handler: async (_args, ctx) => {";
  const restore='if (e.type !== "message") continue;';
  if(source.split(command).length!==2||replay.split(restore).length!==2)throw new Error("Unsupported TODO build: clear adapter not installed");
  source=source.replace(command,command+`
            ${marker}
            if(process.env.PI_WEB_SESSION_ID && _args.trim()==="clear") {
                const result=applyTaskMutation(getState(sid(ctx)),"clear",{});
                commitState(sid(ctx),result.state);
                pi.appendEntry("remote-todo-state",result.state);
                ctx.ui.notify("TODO wyczyszczone. Historia pozostaje zachowana.","info");
                return;
            }
  `);
  replay=replay.replace(restore,`${marker}
        const custom=entry as {type?:string;customType?:string;data?:unknown};
        if(process.env.PI_WEB_SESSION_ID && custom.type==="custom" && custom.customType==="remote-todo-state" && isTaskDetails(custom.data)) {
            result={tasks:custom.data.tasks.map(t=>({...t})),nextId:custom.data.nextId};
            continue;
        }
        ${restore}`);
  return {source,replay};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const root=process.argv[2],command=join(root,"todo.ts"),state=join(root,"state/replay.ts");
  const patched=patchTodoRemote(readFileSync(command,"utf8"),readFileSync(state,"utf8"));
  writeFileSync(command,patched.source);writeFileSync(state,patched.replay);
}
