import {readFile} from "node:fs/promises";
import {statSync,realpathSync} from "node:fs";
import {relative} from "node:path";
import {detectSupportedImageMimeTypeFromFile} from "@earendil-works/pi-coding-agent";
import {insideWorkspace,protectSecrets} from "./cockpit-workspace.js";

export async function attachPromptFiles(workspace:string,message:string) {
  const images:Array<{type:"image";mimeType:string;data:string}>=[];
  const blocks:string[]=[]; const paths=new Set<string>(); let fenced=false;
  for(const line of message.split("\n")) {
    if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;continue;}
    if(!fenced)for(const match of line.matchAll(/(?:^|\s)@\[([^\]\n]+)\]/g))paths.add(match[1]!);
  }
  if(paths.size>16)throw Object.assign(new Error("At most 16 file attachments are allowed"),{statusCode:413});
  let total=0;
  for(const requested of paths) {
    const path=insideWorkspace(workspace,requested);protectSecrets(path);
    const stat=statSync(path);
    if(!stat.isFile())throw Object.assign(new Error("Attachment must be a file"),{statusCode:400});
    if(stat.size>2*1024*1024||(total+=stat.size)>4*1024*1024)throw Object.assign(new Error("Attachments exceed the 2 MiB/file or 4 MiB total limit"),{statusCode:413});
    const bytes=await readFile(path);
    const name=relative(realpathSync(workspace),path).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");
    const mime=await detectSupportedImageMimeTypeFromFile(path);
    if(mime){images.push({type:"image",mimeType:mime,data:bytes.toString("base64")});blocks.push(`<file name="${name}"></file>`);}
    else {
      if(bytes.includes(0))throw Object.assign(new Error("Binary attachment is not a supported image or text file"),{statusCode:415});
      blocks.push(`<file name="${name}">\n${bytes.toString("utf8")}\n</file>`);
    }
  }
  return {message:blocks.length?blocks.join("\n")+"\n\n"+message:message,images};
}
