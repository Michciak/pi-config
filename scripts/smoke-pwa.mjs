// Production-only regression: offline shell, no API cache and explicit update banner.
import {createServer} from "node:http";
import {readFileSync,existsSync} from "node:fs";
import {resolve,join,extname} from "node:path";
import {chromium} from "@playwright/test";
import assert from "node:assert/strict";
import {WebSocketServer} from "ws";

const root=resolve(import.meta.dirname,"../.releases/latest/apps/web/dist");
let generation=1;
const server=createServer((request,response)=>{
  const path=new URL(request.url,"http://localhost").pathname;
  response.setHeader("cache-control","no-store");
  if(path.startsWith("/api/")){
    response.setHeader("content-type","application/json");
    const data=path.endsWith("/workspace/tree")?{path:".",entries:[]}:path.endsWith("/capabilities")?{localAdmin:false,chat:true,workspaceRead:true}:path.endsWith("/status")?{serverId:"fixture",control:"online",engine:"stopped",sessions:[],firebase:"disabled",protocolVersion:2,version:"fixture"}:path.endsWith("/config")?{workspaceRoot:"/fixture"}:path.endsWith("/private")?{private:"must-not-be-cached"}:[];
    response.end(JSON.stringify(data));return;
  }
  const file=resolve(root,"."+(path==="/"?"/index.html":path));
  if(!file.startsWith(root+"/")||!existsSync(file)){response.writeHead(404);response.end();return;}
  response.setHeader("content-type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".webmanifest":"application/manifest+json"})[extname(file)]||"application/octet-stream");
  const bytes=readFileSync(file);
  response.end(path==="/sw.js"?bytes.toString().replace(/const CACHE = [^;]+;/,`const CACHE = "pi-remote-shell-fixture-${generation}";`):bytes);
});
const sockets=new WebSocketServer({noServer:true});server.on("upgrade",(request,socket,head)=>sockets.handleUpgrade(request,socket,head,()=>{}));
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();const context=await browser.newContext({serviceWorkers:"allow"});const page=await context.newPage();
const cdp=await context.newCDPSession(page);await cdp.send("ServiceWorker.enable");cdp.on("ServiceWorker.workerErrorReported",packet=>console.error("Worker error:",packet.errorMessage));
page.on("pageerror",error=>console.error("Browser error:",error.message));
try{
  await page.goto(url);await page.getByText("Pi Remote",{exact:true}).waitFor();await page.waitForFunction(async()=>(await navigator.serviceWorker.getRegistration())?.active?.state==="activated",{},{timeout:15000});
  await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.evaluate(()=>fetch("/api/v1/private").then(response=>response.json()));
  const cached=await page.evaluate(async()=>{const urls=[];for(const name of await caches.keys())for(const request of await (await caches.open(name)).keys())urls.push(new URL(request.url).pathname);return urls;});
  assert.ok(cached.includes("/"));assert.ok(cached.some(path=>path.startsWith("/assets/")));assert.ok(!cached.some(path=>path.startsWith("/api/")));
  await context.setOffline(true);await page.reload({waitUntil:"domcontentloaded"});await page.getByText("Pi Remote",{exact:true}).waitFor();
  await context.setOffline(false);generation=2;
  await page.evaluate(()=>navigator.serviceWorker.getRegistration().then(registration=>registration.update()));
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);
  await page.locator(".update-banner").filter({hasText:"Dostępna jest nowa wersja"}).waitFor();
  console.log(JSON.stringify({ok:true,offlineShell:true,apiNeverCached:true,explicitUpdateBanner:true,cachedAssets:cached.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
