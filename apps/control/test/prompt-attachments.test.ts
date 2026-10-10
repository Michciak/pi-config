import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {attachPromptFiles} from "../src/prompt-attachments.js";
const temp=()=>mkdtempSync(join(tmpdir(),"pi-attachments-"));

test("attachments include file contents once, preserve prompt and ignore fenced examples",async()=>{
  const root=temp();writeFileSync(join(root,"my notes.txt"),"useful content");
  const prompt="Read @[my notes.txt] @[my notes.txt]\n```\n@[missing]\n```";
  const result=await attachPromptFiles(root,prompt);
  assert.equal(result.message,`<file name="my notes.txt">\nuseful content\n</file>\n\n${prompt}`);
  assert.deepEqual(result.images,[]);
});
test("attachments reject traversal, escaped symlinks, credentials, binary and oversized data",async()=>{
  const root=temp(),outside=temp();writeFileSync(join(outside,"secret.txt"),"outside");
  symlinkSync(join(outside,"secret.txt"),join(root,"escape"));
  writeFileSync(join(root,".env"),"credential");writeFileSync(join(root,"binary.dat"),Buffer.from([0,1,2]));
  writeFileSync(join(root,"big.txt"),Buffer.alloc(2*1024*1024+1,65));
  for(const path of ["../outside","escape",".env","missing"])await assert.rejects(attachPromptFiles(root,`@[${path}]`));
  await assert.rejects(attachPromptFiles(root,"@[binary.dat]"),{statusCode:415});
  await assert.rejects(attachPromptFiles(root,"@[big.txt]"),{statusCode:413});
  await assert.rejects(attachPromptFiles(root,Array.from({length:17},(_,i)=>`@[${i}]`).join(" ")),{statusCode:413});
});
test("image attachments use Pi's supported MIME detection and base64 content",async()=>{
  const root=temp();const image=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFf8AAAAASUVORK5CYII=","base64");
  writeFileSync(join(root,"pixel.png"),image);
  const result=await attachPromptFiles(root,"See @[pixel.png]");
  assert.deepEqual(result.images,[{type:"image",mimeType:"image/png",data:image.toString("base64")}]);
});
