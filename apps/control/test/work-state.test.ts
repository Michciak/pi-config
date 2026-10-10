import test from "node:test";
import assert from "node:assert/strict";
import {currentWorkState,workBoundaryPrompt} from "../../../extensions/shared/work-state.ts";
test("goal and TODO clears supersede historical state in the current branch",()=>{
 const branch=[{type:"custom",customType:"goal-state",data:{goal:{status:"active",objective:"old"}}},{type:"message",message:{role:"toolResult",toolName:"todo",details:{tasks:[{id:"1",status:"completed"}]}}},{type:"custom",customType:"goal-state",data:{goal:null}},{type:"custom",customType:"remote-todo-state",data:{tasks:[],nextId:1}}];
 assert.deepEqual(currentWorkState(branch),{goal:null,tasks:[]});
 assert.match(workBoundaryPrompt(branch),/Goal mode is none/);assert.match(workBoundaryPrompt(branch),/Completed\/deleted\/cleared tasks are not unfinished/);
 branch.push({type:"message",message:{role:"toolResult",toolName:"todo",details:{tasks:[{id:"new",status:"pending"}]}}} as any);
 assert.match(workBoundaryPrompt(branch),/unresolved TODO ids: \["new"\]/);
});
