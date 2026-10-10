import { expect, test, type Page } from "@playwright/test";

const now="2026-10-05T10:00:00.000Z";
test("RPC timeout is explained without exposing internal stderr",async({page})=>{
 await mockControl(page);await page.route('**/api/v1/sessions/session-1/commands',async route=>{
  if(route.request().postDataJSON().command!=="get_commands")return route.fallback();
  return route.fulfill({status:504,json:{code:"PI_RPC_TIMEOUT",error:"Pi nie odpowiedziało na odczyt w ciągu 30 sekund. Historia nie została usunięta."}});
 });
 await page.goto('/');await selectSession(page);
 await expect(page.locator('.error-banner')).toContainText('Pi nie odpowiedziało');
 await expect(page.locator('.error-banner')).not.toContainText('Internal server error');
});
test("history is fetched in pages and older messages remain reachable",async({page})=>{
 const mock=await mockControl(page);await page.route('**/api/v1/questions',route=>route.fulfill({json:[]}));
 await page.route('**/api/v1/sessions/session-1/commands',async route=>{
  const request=route.request().postDataJSON();if(request.command!=="get_messages_page")return route.fallback();
  const end=request.payload?.before??320,start=Math.max(0,end-160);
  return route.fulfill({json:{result:{start,end,total:320,messages:Array.from({length:end-start},(_,i)=>({role:"assistant",timestamp:i+start,content:[{type:"text",text:`History row ${start+i}`}]}))}}});
 });
 await page.goto('/');await selectSession(page);
 await expect(page.getByText('History row 319',{exact:true})).toBeVisible();
 await expect(page.getByText('History row 0',{exact:true})).toHaveCount(0);
 await page.locator('.history-more').click();
 await expect(page.getByText('History row 0',{exact:true})).toBeVisible();
 mock.emit({type:'pi.agent_settled',payload:{}});
 await expect(page.getByText('History row 0',{exact:true})).toBeVisible();
 expect(mock.commands.some(command=>command.command==="get_messages")).toBe(false);
});
test("goal and TODO clear require confirmation, use native commands and preserve draft",async({page})=>{
 const mock=await mockControl(page);await page.route('**/api/v1/questions',route=>route.fulfill({json:[]}));await page.goto('/');await selectSession(page);
 await page.locator('.composer textarea').fill('Mój szkic');
 if(test.info().project.name.startsWith('mobile'))await page.getByRole('button',{name:'Cockpit',exact:true}).click();
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Wyczyść TODO',exact:true}).click();
 expect(mock.commands.filter(command=>command.payload?.message==='/todos clear')).toHaveLength(0);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Wyczyść TODO',exact:true}).click();
 await expect.poll(()=>mock.commands.some(command=>command.payload?.message==='/todos clear')).toBe(true);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Wyczyść cel',exact:true}).click();
 await expect.poll(()=>mock.commands.some(command=>command.payload?.message==='/goal clear')).toBe(true);
 await expect(page.locator('.composer textarea')).toHaveValue('Mój szkic');
});
test("settlement during an in-flight state read triggers a fresh read and clears stale queue",async({page})=>{
 const mock=await mockControl(page);await page.goto('/');await selectSession(page);
 mock.emit({type:'pi.queue_update',payload:{steering:[],followUp:['old ACP output']}});
 await expect(page.locator('.queue-state')).toContainText('old ACP output');
 let reads=0;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/v1/sessions/session-1/commands',async route=>{
  if(route.request().postDataJSON().command!=='get_state')return route.fallback();
  reads++;if(reads===1){await gate;return route.fulfill({json:{result:{isStreaming:true,pendingMessageCount:1}}});}
  return route.fulfill({json:{result:{isStreaming:false,pendingMessageCount:0}}});
 });
 mock.emit({type:'pi.agent_start',payload:{}});await expect.poll(()=>reads).toBe(1);
 mock.emit({type:'pi.agent_settled',payload:{}});release();
 await expect.poll(()=>reads).toBeGreaterThanOrEqual(2);
 await expect(page.locator('.queue-state')).toHaveCount(0);
});
test("approval and decision cards remain themed and bounded with long content",async({page})=>{
  await mockControl(page);
  await page.route('**/api/v1/approvals',route=>route.fulfill({json:[{id:'approval',sessionId:'session-1',title:'Zatwierdź operację',message:'Szczegóły operacji '.repeat(90),status:'pending',createdAt:now}]}));
  await page.goto('/');await selectSession(page);
  await expect(page.locator('.interaction.approval')).toBeVisible();
  await expect(page.locator('.question-card')).toHaveCount(1);
  const geometry=await page.locator('.composer-interactions').evaluate(el=>{const r=el.getBoundingClientRect();return{height:r.height,limit:innerHeight*.4,overflow:el.scrollWidth>el.clientWidth};});
  expect(geometry.height).toBeLessThanOrEqual(geometry.limit+1);expect(geometry.overflow).toBe(false);
  await page.locator('.question-card').scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'Odpowiedz',exact:true})).toBeVisible();
  await page.screenshot({path:'/private/tmp/pi-interactions-'+test.info().project.name+'.png'});
});
test("overview is default, icon tabs fit one line, Git handles non-repository, settings are continuous",async({page})=>{
  await mockControl(page);
  await page.route('**/api/v1/git/status?**',route=>route.fulfill({json:{workspace:'/workspace',repository:false,branch:'',ahead:0,behind:0,files:[]}}));
  await page.route('**/api/v1/git/branches?**',route=>route.fulfill({json:{branches:[]}}));
  await page.goto('/');await selectSession(page);
  if(test.info().project.name.startsWith('mobile'))await page.getByRole('button',{name:'Cockpit',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Przegląd',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.overview-panel')).toContainText('Ship cockpit');
  await expect(page.locator('.overview-panel')).toContainText('Verify cockpit');
  await expect(page.locator('.goal-bar')).toHaveCount(0);
  const positions=await page.locator('.cockpit-tabs [role=tab]').evaluateAll(nodes=>nodes.map(el=>Math.round(el.getBoundingClientRect().top)));
  expect(new Set(positions).size).toBe(1);
  expect(await page.locator('.context-slot').evaluate(el=>getComputedStyle(el).padding)).toBe('0px');
  await page.getByRole('tab',{name:'Git',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Brak repozytorium',exact:true})).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await page.getByRole('tab',{name:'Ustawienia',exact:true}).click();
  const settings=page.getByRole('region',{name:'Ustawienia',exact:true});
  await expect(settings.getByLabel('Sekcja ustawień')).toHaveCount(0);
  await expect(settings.locator('.settings-category')).toHaveCount(5);
  await expect(page.locator('.app-header').getByRole('button',{name:'Ustawienia',exact:true})).toHaveCount(0);
});
test("phone notification switches save and survive reload in the integrated settings panel",async({page})=>{
  await mockControl(page);
  let preferences={approvals:true,questions:true,errors:true,engine:true,completed:false};let saves=0;
  await page.route('**/api/v1/status',route=>route.fulfill({json:{serverId:'test',engine:'running',sessions:[],protocolVersion:2,notifications:{state:'enabled',registeredDevices:1,pairedDevices:1,preferences}}}));
  await page.route('**/api/v1/settings/notifications',route=>{preferences=route.request().postDataJSON();saves++;return route.fulfill({json:preferences});});
  await page.goto('/');
  if(test.info().project.name.startsWith('mobile'))await page.getByRole('button',{name:'Cockpit',exact:true}).click();
  await page.getByRole('tab',{name:'Ustawienia',exact:true}).click();
  const panel=page.getByRole('region',{name:'Ustawienia',exact:true});
  await expect(panel.locator('.phone-preferences').getByRole('checkbox')).toHaveCount(5);
  await panel.getByRole('checkbox',{name:/^Błędy/}).uncheck();
  await expect.poll(()=>saves).toBe(1);expect(preferences.errors).toBe(false);
  await expect(panel.getByRole('checkbox',{name:/^Prośby o akceptację/})).toBeChecked();
  await page.reload();
  if(test.info().project.name.startsWith('mobile'))await page.getByRole('button',{name:'Cockpit',exact:true}).click();
  await page.getByRole('tab',{name:'Ustawienia',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:/^Błędy/})).not.toBeChecked();
});
async function mockControl(page:Page, localAdmin=true,saveDelay=0) {
  const session={id:"session-1",name:"Test session",workspace:"/workspace",status:"idle",createdAt:now,updatedAt:now};
  let content="original"; let saved=""; let terminal:any;
  const answers:any[]=[];
  const commands:any[]=[];
  let questions:any[]=[{id:"question",sessionId:session.id,source:{kind:"extension"},question:"Choose",mode:"single-select",options:[{id:"option:0",label:"Alpha",value:"alpha",index:1}],allowOther:false,status:"pending",answers:[],createdAt:now}];
  let eventConnections=0;
  let sendEvent:(event:any)=>void=()=>{throw new Error('Event socket not ready');};let eventSequence=0;
  await page.routeWebSocket("**/api/v1/events**",ws=>{eventConnections++;sendEvent=event=>ws.send(JSON.stringify({seq:++eventSequence,sessionId:'session-1',createdAt:now,...event}));});
  await page.routeWebSocket("**/api/v1/terminals/*/socket",ws=>{
    ws.send(JSON.stringify({type:"snapshot",data:"Pi terminal ready\r\n",terminal}));
    ws.onMessage(data=>{const packet=JSON.parse(String(data));if(packet.type==="input")ws.send(JSON.stringify({type:"data",data:packet.data}));});
  });
  await page.route("**/api/v1/**",async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    const json=(value:any,status=200)=>route.fulfill({json:value,status});
    if(path.endsWith("/capabilities"))return json({localAdmin,chat:true,workspaceRead:true,workspaceWrite:localAdmin,terminal:localAdmin,gitWrite:localAdmin,pluginsWrite:localAdmin,providersWrite:localAdmin});
    if(path==="/api/v1/status")return json({serverId:"test",control:"online",engine:"running",sessions:[session],firebase:"disabled",version:"test",protocolVersion:2,eventCursor:0});
    if(path==="/api/v1/config")return json({workspaceRoot:"/workspace"});
    if(path==="/api/v1/snippets"||path==="/api/v1/approvals"||path==="/api/v1/plugins")return json([]);
    if(path==="/api/v1/questions")return json(questions);
    if(path==="/api/v1/plugins/grants")return json({pending:[],paths:[],permissions:[],dom:[]});
    if(path==="/api/v1/plugins/attach")return json({attached:true});
    if(path==="/api/v1/questions/question/answer"){answers.push(request.postDataJSON().answers);questions=[];return json({});}
    if(path==="/api/v1/sessions/session-1/subagents")return json([]);
    if(path==="/api/v1/sessions/session-1/subagent-runs")return json([{id:"child",name:"Scout",model:"test/model",status:"error",messages:[{role:"assistant",content:[{type:"text",text:"Child output"}]}]}]);
    if(path==="/api/v1/sessions/session-1/extension-ui")return json({sessionId:session.id,statuses:{"cursor":"fast"},widgets:{"acp":["Cache ready"]},notices:[],updatedAt:now,todo:{items:[{id:"1",subject:"Verify cockpit",status:"in_progress"}],completed:0,total:1},goal:{id:"g",objective:"Ship cockpit",status:"paused",tokensUsed:120,tokenBudget:1000},workflows:[{id:"run-1",name:"Review",status:"paused",phase:"test",agents:2}]});
    if(path==="/api/v1/settings/pi/scope")return json({patterns:[],resolved:["test/model"],models:[{provider:"test",id:"model"}],catalogAvailable:true,diagnostics:[]});
    if(path==="/api/v1/sessions/session-1/commands"){
      commands.push(request.postDataJSON());
      const command=request.postDataJSON().command;
      if(command==="get_messages_page")return json({result:{start:0,total:2,messages:[{role:"user",timestamp:Date.now(),content:[{type:"text",text:"Hello Pi"}]},{role:"assistant",provider:"test",model:"model",content:[{type:"thinking",thinking:"Reasoning"},{type:"text",text:"Ready cockpit"}]}]}});
      if(command==="get_messages")return json({result:[{role:"user",timestamp:Date.now(),content:[{type:"text",text:"Hello Pi"}]},{role:"assistant",provider:"test",model:"model",content:[{type:"thinking",thinking:"Reasoning"},{type:"text",text:"Ready cockpit"}]}]});
      if(command==="get_state")return json({result:{model:{provider:"test",id:"model"},thinkingLevel:"medium"}});
      if(command==="get_available_models")return json({result:[{provider:"test",id:"model"}]});
      if(command==="get_available_thinking_levels")return json({result:["off","medium"]});
      if(command==="get_commands")return json({result:["acp","acp-cache","acp-rule","todos","goal","workflows","simplify","edit_undo","cursor"].map(name=>({name,source:"extension",description:name}))});
      return json({result:{}});
    }
    if(path==="/api/v1/workspace/tree")return json({path:".",entries:[{name:"notes.md",path:"notes.md",kind:"file",size:8}]});
    if(path==="/api/v1/workspace/document"){
      if(request.method()==="PUT"){content=request.postDataJSON().content;saved=content;if(saveDelay)await new Promise(resolve=>setTimeout(resolve,saveDelay));}
      return json({path:"notes.md",content,etag:'"v1"',size:content.length,readOnly:!localAdmin,encoding:"utf8",mtimeMs:1});
    }
    if(path==="/api/v1/git/status"||path==="/api/v1/git/action")return json({workspace:"/workspace",branch:"main",head:"abc",ahead:0,behind:0,files:[{path:"notes.md",index:" ",workingTree:"M"}]});
    if(path==="/api/v1/git/branches")return json({branches:["main"]});
    if(path==="/api/v1/git/diff")return json({diff:"-original\n+updated"});
    if(path==="/api/v1/extensions")return json([{name:"@schovest/pi-goal",source:"npm:@schovest/pi-goal",version:"0.2.0",description:"Goal"}]);
    if(path==="/api/v1/terminals"){
      if(request.method()==="POST"){terminal={id:"term-1",title:"workspace",cwd:"/workspace",rows:24,cols:80,status:"running"};return json(terminal);}
      return json(terminal?[terminal]:[]);
    }
    if(path==="/api/v1/terminals/term-1"&&request.method()==="DELETE"){terminal=undefined;return route.fulfill({status:204});}
    if(path==="/api/v1/directories")return json({path:"/workspace",parent:null,directories:[]});
    return json({error:"Unhandled "+path},404);
  });
  return {answers,commands,getSaved:()=>saved,getEventConnections:()=>eventConnections,emit:(event:any)=>sendEvent(event)};
}
async function selectSession(page:Page){if(test.info().project.name.startsWith("mobile"))await page.getByRole("button",{name:"Sesje",exact:true}).click();await page.locator(".session-row").filter({hasText:"Test session"}).click();await expect(page.getByRole("heading",{name:"Test session",exact:true})).toBeVisible();}

test("compact chrome keeps bottom model controls, quota and composer inside the viewport",async({page})=>{
  if(!test.info().project.name.startsWith("mobile"))await page.setViewportSize({width:1180,height:786});
  const mock=await mockControl(page);
  await page.route("**/api/v1/questions",route=>route.fulfill({json:[]}));
  await page.route("**/api/v1/sessions/session-1/extension-ui",route=>route.fulfill({json:{sessionId:"session-1",statuses:{},widgets:{"remote-metrics":[JSON.stringify({context:{tokens:199738,contextWindow:1048576},quota:{provider:"opencode-go",state:"available",buckets:{rolling:{percent:82}}}})]},notices:[],updatedAt:now}}));
  await page.route("**/api/v1/sessions/session-1/subagent-runs",route=>route.fulfill({json:Array.from({length:16},(_,i)=>({id:`child-${i}`,name:`Scout ${i}`,model:"test/a-long-model-identifier",status:"completed",messages:[]}))}));
  await page.goto("/");await selectSession(page);
  await expect(page.getByRole("button",{name:"Quota: Go 82%",exact:true})).toBeVisible();
  await expect(page.locator(".composer").getByRole("button",{name:"Wybierz model",exact:true})).toBeVisible();
  await expect(page.locator(".conversation-head").getByRole("button",{name:"Wybierz model",exact:true})).toHaveCount(0);
  const dimensions=await page.evaluate(()=>{
    const rect=(s:string)=>document.querySelector(s)!.getBoundingClientRect();
    return {header:rect(".conversation-head").height,tabs:rect(".chat-tabs").height,composer:rect(".composer").height,footer:rect(".composer-footer").height,input:rect(".composer-input").height,status:rect(".composer-status").height,bottom:rect(".composer").bottom,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  expect(dimensions.header).toBeLessThanOrEqual(40);expect(dimensions.tabs).toBeLessThanOrEqual(35);
  expect(dimensions.composer,JSON.stringify(dimensions)).toBeLessThanOrEqual(140);expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.viewport);expect(dimensions.overflow).toBe(false);
  const input=page.getByRole("textbox",{name:"Wiadomość do Pi",exact:true});
  await input.fill(Array(20).fill("Multiline message").join("\n"));
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(160);
  await page.getByRole("button",{name:"Wyślij wiadomość",exact:true}).click();
  await expect(input).toHaveValue("");expect((await input.boundingBox())!.height).toBeLessThanOrEqual(52);
  await page.getByRole("button",{name:"Quota: Go 82%",exact:true}).click();
  await expect.poll(()=>mock.commands.some(c=>c.command==="prompt"&&c.payload.message==="/quota")).toBe(true);
});

test("StrictMode startup retains only one event WebSocket",async({page})=>{
  const mock=await mockControl(page);await page.goto("/");await selectSession(page);
  await expect(page.getByText("Ready cockpit",{exact:true})).toBeVisible();
  expect(mock.getEventConnections()).toBe(1);
});

test("service icons, session-only Git and inline usage warnings",async({page})=>{
  await mockControl(page);await page.route('**/api/v1/questions',route=>route.fulfill({json:[]}));
  await page.route('**/api/v1/sessions/session-1/extension-ui',route=>route.fulfill({json:{sessionId:'session-1',statuses:{},widgets:{'remote-metrics':[JSON.stringify({context:{tokens:85,contextWindow:100},quota:{provider:'opencode-go',state:'available',buckets:{weekly:{percent:96}}}})]},notices:[],updatedAt:now}}));
  await page.goto('/');
  if(test.info().project.name.startsWith('mobile'))await page.getByRole('button',{name:'Cockpit',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Git',exact:true})).toBeDisabled();
  await selectSession(page);
  const header=page.locator('.app-header');
  for(const name of ['Pi reload','Control restart','Stop Pi']) {
    const control=header.getByRole('button',{name,exact:true});
    await expect(control.locator('svg')).toHaveCount(1);await expect(control).toHaveText('');
    await expect(control).toHaveAttribute('title',/\S/);
  }
  await expect(page.locator('.composer-footer .context-usage')).toHaveAttribute('data-severity','warning');
  await expect(page.locator('.composer-footer .quota-status')).toHaveAttribute('data-severity','critical');
  await expect(page.locator('.context-usage')).toHaveAttribute('title',/85%.*zbliżasz/);
  await expect(page.locator('.quota-status')).toHaveAttribute('aria-description',/limit prawie wyczerpany/);
  expect(await page.locator('.context-usage').evaluate(el=>getComputedStyle(el).color)).not.toBe(await page.locator('.quota-status').evaluate(el=>getComputedStyle(el).color));
  if(!test.info().project.name.startsWith('mobile')){
    await page.setViewportSize({width:1686,height:1189});
    const model=await page.getByRole('button',{name:'Wybierz model',exact:true}).boundingBox(),quota=await page.locator('.quota-status').boundingBox();
    expect(Math.abs(model!.y+model!.height/2-quota!.y-quota!.height/2)).toBeLessThan(3);
  }
});

test("resized composer and terminal controls stay inside short viewports",async({page})=>{
  await mockControl(page);await page.route('**/api/v1/questions',route=>route.fulfill({json:[]}));await page.goto('/');await selectSession(page);
  const mobile=test.info().project.name.startsWith('mobile');
  const sizes=mobile?[{width:412,height:700},{width:384,height:640}]:[{width:1686,height:1189},{width:1180,height:786},{width:1180,height:640}];
  const grip=page.getByRole('separator',{name:'Wysokość pola wiadomości'});
  for(let i=0;i<16;i++)await grip.press('ArrowUp');
  const fits=async()=>{
    await expect.poll(()=>page.evaluate(()=>{
      const dock=document.querySelector('.terminal-dock')!.getBoundingClientRect(),composer=document.querySelector('.composer')!.getBoundingClientRect(),status=document.querySelector('.composer-status')!.getBoundingClientRect();
      const header=document.querySelector('.terminal-dock > header')!.getBoundingClientRect();
      return {dock:dock.bottom<=innerHeight+1,composer:composer.bottom<=dock.top+1,status:status.bottom<=composer.bottom+1,buttons:[...document.querySelectorAll('.terminal-dock > header button')].every(el=>{const b=el.getBoundingClientRect();const r=document.createRange();r.selectNodeContents(el);const t=r.getBoundingClientRect();return b.top>=header.top&&b.bottom<=header.bottom&&t.bottom<=header.bottom;}),width:document.documentElement.scrollWidth<=innerWidth};
    })).toEqual({dock:true,composer:true,status:true,buttons:true,width:true});
  };
  for(const size of sizes){await page.setViewportSize(size);await fits();}
  await page.getByLabel('Nowy terminal').click();await expect(page.locator('.xterm-host')).toBeVisible();
  for(const size of sizes){await page.setViewportSize(size);await fits();}
  await page.getByLabel('Zamknij terminal workspace').click();await fits();
});

test("keyboard completion selection stays visible and does not scroll the transcript",async({page})=>{
  await mockControl(page);await page.route('**/api/v1/questions',route=>route.fulfill({json:[]}));
  await page.route('**/api/v1/sessions/session-1/commands',async(route)=>{
    if(route.request().postDataJSON().command==='get_commands')return route.fulfill({json:{result:Array.from({length:40},(_,i)=>({name:`fixture-${String(i).padStart(2,'0')}`,description:'Command '+i,source:'extension'}))}});
    await route.fallback();
  });
  await page.goto('/');await selectSession(page);
  const input=page.getByRole('textbox',{name:'Wiadomość do Pi',exact:true});await input.fill('/');
  const list=page.getByRole('listbox',{name:'Podpowiedzi Pi'});await expect(list).toBeVisible();
  const transcript=await page.locator('.messages').evaluate(e=>e.scrollTop);
  for(let i=0;i<18;i++)await input.press('ArrowDown');
  const visibility=await list.evaluate(e=>{const row=e.querySelector('[aria-selected="true"]')!.getBoundingClientRect(),bounds=e.getBoundingClientRect();return {top:row.top,bottom:row.bottom,start:bounds.top,end:bounds.bottom,scroll:e.scrollTop};});
  expect(visibility.scroll).toBeGreaterThan(0);expect(visibility.top).toBeGreaterThanOrEqual(visibility.start);expect(visibility.bottom).toBeLessThanOrEqual(visibility.end);
  expect(await page.locator('.messages').evaluate(e=>e.scrollTop)).toBe(transcript);
  for(let i=0;i<18;i++)await input.press('ArrowUp');
  await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected','true');
  await input.press('Tab');await expect(input).toHaveValue('/fixture-00 ');
});

test("workspace panels share navigation and header service controls dispatch correctly",async({page})=>{
  const mock=await mockControl(page);await page.route('**/api/v1/questions',route=>route.fulfill({json:[]}));
  let engine='running',restarts=0;
  await page.route('**/api/v1/status',route=>route.fulfill({json:{serverId:'test',control:'online',engine,sessions:[{id:'session-1',name:'Test session',workspace:'/workspace',status:'idle',createdAt:now,updatedAt:now}],firebase:'disabled',protocolVersion:2,eventCursor:0}}));
  await page.route('**/api/v1/engine/*',route=>{engine=route.request().url().endsWith('/stop')?'stopped':'running';return route.fulfill({json:{status:engine}});});
  await page.route('**/api/v1/control/restart',route=>{restarts++;return route.fulfill({json:{restarting:true,engineWillStart:true}});});
  await page.goto('/');await selectSession(page);
  await expect(page.locator('.app-header').getByRole('button',{name:'Powiadomienia',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Pi reload',exact:true}).click();await expect.poll(()=>mock.commands.some(c=>c.command==='reload_extensions')).toBe(true);
  await page.getByRole('button',{name:'Stop Pi',exact:true}).click();await expect(page.getByRole('button',{name:'Start Pi',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Start Pi',exact:true}).click();await expect(page.getByRole('button',{name:'Stop Pi',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Control restart',exact:true}).click();await expect.poll(()=>restarts).toBe(1);
  if(test.info().project.name.startsWith('mobile'))await page.getByRole('button',{name:'Cockpit',exact:true}).click();
  const tabs=page.getByRole('tablist',{name:'Panele workspace'});await tabs.getByRole('tab',{name:'Ustawienia',exact:true}).click();
  await expect(page.getByRole('region',{name:'Ustawienia',exact:true})).toBeVisible();
  const width=await page.evaluate(()=>({panel:document.querySelector('.settings-panel')!.getBoundingClientRect().width,title:document.querySelector('.settings-panel .selection-title')!.getBoundingClientRect().width}));
  expect(Math.abs(width.panel-width.title)).toBeLessThan(2);
  await tabs.getByRole('tab',{name:'Modele',exact:true}).click();await expect(page.getByRole('region',{name:'Wybierz model',exact:true})).toBeVisible();
  await tabs.getByRole('tab',{name:'Git',exact:true}).click();await expect(page.getByLabel('Gałąź Git')).toHaveValue('main');
  expect((await page.getByLabel('Gałąź Git').boundingBox())!.height).toBeGreaterThanOrEqual(30);
});

test("integrated settings/model/tools preserve chat and dirty editor; compact Git and terminal",async({page})=>{
  await mockControl(page);await page.route('**/api/v1/questions',route=>route.fulfill({json:[]}));await page.goto("/");await selectSession(page);
  const child=page.locator('.chat-tab-shell').first();
  await expect(child.locator('.chat-tab-model')).toBeVisible();
  const tab=await child.locator('.chat-tab').boundingBox(),close=await child.locator('.chat-tab-hide').boundingBox();
  expect(Math.abs(tab!.y+tab!.height/2-close!.y-close!.height/2)).toBeLessThan(2);
  if(test.info().project.name.startsWith("mobile"))await page.getByRole("button",{name:"Cockpit",exact:true}).click();
  await page.getByRole("tab",{name:"Pliki",exact:true}).click();
  await page.getByRole("button",{name:/notes.md/}).click();await page.getByLabel("Edytor pliku").fill("unsaved");
  await page.getByRole("tab",{name:"Ustawienia",exact:true}).click();
  await expect(page.getByRole("region",{name:"Ustawienia",exact:true})).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Ustawienia",exact:true}).getByRole("button",{name:"Zamknij",exact:true})).toHaveCount(0);
  await page.getByRole("tab",{name:"Pliki",exact:true}).click();
  await expect(page.getByLabel("Edytor pliku")).toHaveValue("unsaved");
  if(test.info().project.name.startsWith("mobile"))await page.getByRole("button",{name:"Chat",exact:true}).click();
  await page.getByRole("button",{name:"Wybierz model",exact:true}).click();
  await expect(page.getByRole("region",{name:"Wybierz model",exact:true})).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Wybierz model",exact:true}).getByRole("button",{name:"Zamknij",exact:true})).toHaveCount(0);
  await page.getByRole("tab",{name:"Pliki",exact:true}).click();
  if(test.info().project.name.startsWith("mobile"))await page.getByRole("button",{name:"Chat",exact:true}).click();
  await page.getByRole("button",{name:/Narzędzia/}).click();
  await expect(page.locator('.auxiliary-slot .advanced')).toBeVisible();
  await expect(page.getByText("Bezpośredni bash",{exact:true})).toHaveCount(0);
  await expect(page.locator('.advanced-head').getByRole('button')).toHaveCount(0);
  if(test.info().project.name.startsWith("mobile"))await page.getByRole("button",{name:"Cockpit",exact:true}).click();
  page.once("dialog",dialog=>dialog.accept());await page.getByRole("tab",{name:"Git",exact:true}).click();
  const filename=await page.locator('.git-file-path').boundingBox(),stage=await page.getByLabel('Stage notes.md',{exact:true}).boundingBox();
  expect(filename!.width).toBeGreaterThan(100);expect(stage!.width).toBeLessThanOrEqual(26);
  const baseline=(await page.locator('.terminal-dock').boundingBox())!.height;
  await page.getByRole('button',{name:'Terminal · 0',exact:true}).click();
  expect((await page.locator('.terminal-dock').boundingBox())!.height).toBe(baseline);
  await page.getByLabel('Nowy terminal').click();await expect(page.locator('.xterm-host')).toBeVisible();
  const header=(await page.locator('.terminal-dock > header').boundingBox())!.height;
  await page.getByRole('button',{name:'Terminal · 1',exact:true}).click();
  expect((await page.locator('.terminal-dock').boundingBox())!.height).toBe(baseline);
  await page.getByRole('button',{name:'Terminal · 1',exact:true}).click();
  expect((await page.locator('.terminal-dock > header').boundingBox())!.height).toBe(header);
  await page.getByLabel('Zamknij terminal workspace').click();
});

test("native argument and file completions update from the active session",async({page})=>{
  const mock=await mockControl(page);await page.route('**/api/v1/questions',route=>route.fulfill({json:[]}));
  await page.route('**/api/v1/sessions/session-1/commands',async(route)=>{
    const body=route.request().postDataJSON();
    if(body.command==='get_completions')return route.fulfill({json:{result:{items:[{value:'pause',label:'pause',description:'Native goal option'}]}}});
    await route.fallback();
  });
  await page.goto('/');await selectSession(page);
  const input=page.getByRole('textbox',{name:'Wiadomość do Pi',exact:true});
  await input.fill('/goal p');await expect(page.getByRole('listbox',{name:'Podpowiedzi Pi'})).toContainText('Native goal option');
  await input.press('Tab');await expect(input).toHaveValue('/goal pause');
  await input.fill('Read @[');await expect(page.getByRole('listbox',{name:'Podpowiedzi Pi'})).toContainText('notes.md');
  await input.press('Tab');await expect(input).toHaveValue('Read @[notes.md] ');
  await page.getByRole('button',{name:'Wyślij wiadomość',exact:true}).click();
  await expect.poll(()=>mock.commands.some(c=>c.command==='prompt'&&c.payload.message==='Read @[notes.md] ')).toBe(true);
});

test("terminal transcript, question answers, search, subagent hide and native extension state",async({page})=>{
  const mock=await mockControl(page);await page.goto("/");await selectSession(page);
  await expect(page.locator(".terminal-transcript").first()).toBeVisible();
  await expect(page.getByText("Ready cockpit",{exact:true})).toBeVisible();
  await page.locator("#interaction-question").getByText("Alpha",{exact:false}).click();
  await page.locator("#interaction-question").getByRole("button",{name:"Odpowiedz"}).click();
  await expect.poll(()=>mock.answers.length).toBe(1);
  await page.getByLabel("Szukaj w rozmowie").fill("Hello");
  await expect(page.getByText("Ready cockpit",{exact:true})).toBeHidden();
  await page.getByLabel("Szukaj w rozmowie").fill("");
  await page.getByLabel("Ukryj chat subagenta Scout").click();
  await expect(page.getByRole("tab",{name:/Scout/})).toHaveCount(0);
  await page.getByText("Ukryte · 1").click();
  await page.getByRole("button",{name:/Scout.*Przywróć/}).click();
  await expect(page.getByRole("tab",{name:/Scout/})).toBeVisible();
  if(test.info().project.name.startsWith("mobile"))await page.getByRole("button",{name:"Cockpit",exact:true}).click();
  await page.getByRole("tab",{name:"Przegląd",exact:true}).click();
  await expect(page.getByText("Verify cockpit",{exact:true})).toBeVisible();
  await expect(page.getByText("Review",{exact:true})).toBeVisible();
  await page.screenshot({path:"/tmp/pi-cockpit-"+test.info().project.name+".png",fullPage:true});
});

test("typing during file save keeps dirty guard even when reverting to old content",async({page})=>{
  const mock=await mockControl(page,true,600);await page.goto("/");await selectSession(page);
  if(test.info().project.name.startsWith("mobile"))await page.getByRole("button",{name:"Cockpit",exact:true}).click();
  await page.getByRole("tab",{name:"Pliki",exact:true}).click();
  await page.getByRole("button",{name:/notes.md/}).click();await page.getByLabel("Edytor pliku").fill("new disk content");await page.getByRole("button",{name:"Zapisz",exact:true}).click();
  await expect.poll(mock.getSaved).toBe("new disk content");await page.getByLabel("Edytor pliku").fill("original");
  await expect(page.getByRole("button",{name:"Zapisz",exact:true})).toBeEnabled();await expect(page.getByLabel("Edytor pliku")).toHaveValue("original");
  page.once("dialog",dialog=>dialog.dismiss());await page.getByRole("tab",{name:"Git",exact:true}).click();await expect(page.getByLabel("Edytor pliku")).toBeVisible();
});

test("file editor save, dirty guard, Git diff and PTY tabs",async({page})=>{
  const mock=await mockControl(page);await page.goto("/");await selectSession(page);
  if(test.info().project.name.startsWith("mobile"))await page.getByRole("button",{name:"Cockpit",exact:true}).click();
  await page.getByRole("tab",{name:"Pliki",exact:true}).click();
  await page.getByRole("button",{name:/notes.md/}).click();
  await page.getByLabel("Edytor pliku").fill("updated");
  await page.getByRole("button",{name:"Zapisz",exact:true}).click();
  await expect.poll(mock.getSaved).toBe("updated");
  await page.getByLabel("Edytor pliku").fill("unsaved");
  page.once("dialog",dialog=>dialog.dismiss());
  await page.getByRole("tab",{name:"Git",exact:true}).click();
  await expect(page.getByLabel("Edytor pliku")).toBeVisible();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("tab",{name:"Git",exact:true}).click();
  await page.getByRole("button",{name:"Diff",exact:true}).click();
  await expect(page.locator(".git-output")).toContainText("+updated");
  await page.getByLabel("Nowy terminal").click();
  await expect(page.locator(".xterm-host")).toBeVisible();
  await page.getByLabel("Zamknij terminal workspace").click();
  await expect(page.locator(".xterm-host")).toHaveCount(0);
});

test("remote cockpit hides writes and terminal; mobile layout stays inside viewport",async({page})=>{
  await mockControl(page,false);await page.goto("/?interaction=question");
  await expect(page.getByRole("heading",{name:"Test session",exact:true})).toBeVisible();
  await expect(page.locator("#interaction-question")).toBeVisible();
  await expect(page.getByLabel("Nowy terminal")).toHaveCount(0);
  if(test.info().project.name.startsWith("mobile"))await page.getByRole("button",{name:"Cockpit",exact:true}).click();
  await page.getByRole("tab",{name:"Pliki",exact:true}).click();
  await page.getByRole("button",{name:/notes.md/}).click();
  await expect(page.getByLabel("Edytor pliku")).toHaveAttribute("readonly","");
  await expect(page.getByRole("button",{name:"Zapisz",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test("advanced plugin client bridge opens its view, dispatches actions, receives data and approves grants",async({page})=>{
  await mockControl(page);let received:any;let pending=true;
  const manifest={id:"fixture",name:"SDK fixture",version:"1",epoch:1,permissions:["ui"],enabled:true,client:"client/entry.mjs",preload:true,ui:[{id:"view",slot:"topbar.primary",kind:"view",label:"Open fixture",view:"plugin:fixture"},{id:"action",slot:"composer.actions",kind:"action",label:"SDK action",action:"fixture:action"}]};
  await page.route("**/api/v1/plugins",route=>route.fulfill({json:[manifest]}));
  await page.route("**/api/v1/questions",route=>route.fulfill({json:[]}));
  await page.route("**/api/v1/plugins/grants",route=>route.fulfill({json:{pending:pending?[{id:"grant",pluginId:"fixture",kind:"permission",request:{family:"net",hosts:["fixture.invalid"]}}]:[]}}));
  await page.route("**/api/v1/plugins/grants/grant",route=>{pending=false;return route.fulfill({json:{decided:true}});});
  await page.route("**/api/v1/plugins/fixture/message",route=>{received=route.request().postDataJSON();return route.fulfill({json:{sent:true}});});
  await page.route("**/plugins/fixture/client/entry.mjs?*",route=>route.fulfill({contentType:"text/javascript",body:`window.__piWebUiHost.onUiAction("fixture:action",()=>fetch("/api/v1/plugins/fixture/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:true})}));export default {mount(el,ctx){el.textContent="Mounted SDK fixture";return ctx.onData(data=>el.textContent="Data: "+data.text);}};`}));
  await page.goto("/");await selectSession(page);
  await expect(page.getByText("Plugin fixture prosi o uprawnienie",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Zezwól i zapamiętaj",exact:true}).click();await expect.poll(()=>pending).toBe(false);
  await expect(page.locator(".app-header").getByRole("button",{name:"Open fixture"})).toBeVisible();
  await page.getByRole("button",{name:"SDK action",exact:true}).click();await expect.poll(()=>received).toEqual({action:true});
  await page.getByRole("button",{name:"Open fixture",exact:true}).click();
  await expect(page.getByText("Mounted SDK fixture",{exact:true})).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent("pi-plugin-data",{detail:{pluginId:"fixture",payload:{text:"live update"}}})));
  await expect(page.getByText("Data: live update",{exact:true})).toBeVisible();
});
