import test from "node:test";
import assert from "node:assert/strict";
import {StateStore} from "../src/store.js";
import {FirebaseNotifier} from "../src/firebase.js";
import {notificationCategory} from "../src/notification-policy.js";

test("foreground browser never suppresses phone questions or approvals; preferences persist", async()=>{
  const store=new StateStore(":memory:"); let sends=0;
  store.db.prepare("INSERT INTO devices VALUES(?,?,?,?,?,?)").run("device","test","key","fake-token","now","now");
  const notifier=new FirebaseNotifier(store,"unused",async message=>{sends++;assert.equal(message.android?.priority,"high");return {responses:[{success:true}],successCount:1,failureCount:0};});
  Object.assign(notifier,{app:{},state:"enabled"}); notifier.setForegroundClient("browser",true);
  for(const type of ["approval.created","user_question.created"]){const e=store.appendEvent(type,{});assert.equal((await notifier.send(String(e.seq))).successCount,1);}
  assert.equal(sends,2);
  notifier.savePreferences({questions:false});
  const e=store.appendEvent("user_question.created",{});
  assert.equal((await notifier.send(String(e.seq))).skipped,"disabled-by-preference");
  assert.equal(sends,2);assert.equal(new FirebaseNotifier(store,"unused").preferences().questions,false);
  assert.throws(()=>notifier.savePreferences({errors:"yes"}));assert.throws(()=>notifier.savePreferences({unknown:true}));
  const alert=store.appendEvent("notification.test",{category:"errors"});
  assert.equal((await notifier.send(String(alert.seq))).successCount,1);
  notifier.savePreferences({errors:false});assert.equal((await notifier.send(String(alert.seq))).attempted,false);
  const realTest=store.appendEvent("notification.test",{});assert.equal((await notifier.send(String(realTest.seq))).attempted,true);
  store.close();
});
test("phone policy separates errors, completion and engine changes",()=>{
  const event=(type:string,payload:any={})=>({type,payload,seq:1,timestamp:"now",serverId:"test"});
  assert.equal(notificationCategory(event("subagent.updated",{status:"error"})),"errors");
  assert.equal(notificationCategory(event("subagent.updated",{status:"running"})),undefined);
  assert.equal(notificationCategory(event("engine.status_changed",{status:"crashed"})),"errors");
  assert.equal(notificationCategory(event("pi.agent_settled")),"completed");
  assert.equal(notificationCategory(event("pi.message_end",{message:{stopReason:"error"}})),"errors");
});
