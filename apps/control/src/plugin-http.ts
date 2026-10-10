import {request as httpRequest} from "node:http";
import type {FastifyRequest,FastifyReply} from "fastify";

export function proxyPlugin(request:FastifyRequest,reply:FastifyReply,hit:{host:string;port:number;prefix:string}) {
  const headers={...request.headers,host:`${hit.host}:${hit.port}`};delete headers.authorization;delete headers.cookie;
  const path=request.url.slice(hit.prefix.length)||"/";
  const upgrading=request.headers.upgrade?.toLowerCase()==="websocket";
  if(!upgrading){delete headers.connection;delete headers.upgrade;}
  reply.hijack();
  const upstream=httpRequest({hostname:hit.host,port:hit.port,path:path.startsWith("/")?path:"/"+path,method:request.method,headers,timeout:30000});
  upstream.once("response",response=>{reply.raw.writeHead(response.statusCode??502,response.headers);response.pipe(reply.raw);});
  upstream.once("upgrade",(response,socket,head)=>{
    const downstream=request.raw.socket;
    downstream.write(`HTTP/1.1 ${response.statusCode??101} Switching Protocols\r\n`+Object.entries(response.headers).map(([key,value])=>`${key}: ${Array.isArray(value)?value.join(","):value}\r\n`).join("")+"\r\n");
    if(head.length)downstream.write(head);
    socket.pipe(downstream);downstream.pipe(socket);
    downstream.once("close",()=>socket.destroy());socket.once("close",()=>downstream.destroy());
  });
  upstream.once("timeout",()=>upstream.destroy(new Error("Plugin proxy timeout")));
  upstream.once("error",()=>{if(!reply.raw.headersSent)reply.raw.writeHead(502);reply.raw.end("Plugin proxy unavailable");});
  request.raw.once("aborted",()=>upstream.destroy());
  // onRequest runs before body parsing; streaming avoids buffering uploads.
  request.raw.pipe(upstream);
}

export function pluginResponse(reply:FastifyReply) {
  return {get headersSent(){return reply.raw.headersSent;},status(code:number){reply.code(code);return this;},setHeader(name:string,value:string){reply.header(name,value);return this;},header(name:string,value:string){reply.header(name,value);return this;},type(value:string){reply.type(value);return this;},json(value:unknown){reply.send(value);return this;},send(value:unknown){reply.send(value);return this;},end(value?:string){reply.send(value);return this;}};
}
