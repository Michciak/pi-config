import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
const installedRuntime=join(homedir(),'.local/share/pi-runtime/0.87.1/node_modules/@earendil-works/pi-coding-agent');
// Match the installed Pi extension loader's supported package alias.
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='@earendil-works/pi-tui') return next(pathToFileURL(join(installedRuntime,'node_modules/@earendil-works/pi-tui/dist/index.js')).href,context);
 return next(specifier,context);
}});
const {default:fileLinks,linkFiles}=await import('../extensions/file-links.ts');
hooks.deregister();

const cwd=mkdtempSync(join(tmpdir(),'pi-links-'));
for(const file of ['main.cs','My File #1.cs','żółć.cs']) writeFileSync(join(cwd,file),'fixture');
process.on('exit',()=>rmSync(cwd,{recursive:true,force:true}));
const url=file=>pathToFileURL(join(cwd,file)).href;
test('inline code and line references link to existing files',()=>assert.equal(linkFiles('See `main.cs:42`.',cwd),'See [`main.cs:42`](<' + url('main.cs') + '>).'));
test('bare filenames preserve punctuation',()=>assert.equal(linkFiles('Changed main.cs.',cwd),'Changed [main.cs](<' + url('main.cs') + '>).'));
test('spaces and Unicode are URL encoded',()=>{
 assert.ok(linkFiles('`My File #1.cs`',cwd).includes(url('My File #1.cs')));
 assert.ok(linkFiles('żółć.cs',cwd).includes(url('żółć.cs')));
});
test('relative Markdown links become absolute and remain idempotent',()=>{
 const output=linkFiles('[entry](main.cs)',cwd);
 assert.equal(output,'[entry](<' + url('main.cs') + '>)');
 assert.equal(linkFiles(output,cwd),output);
});
test('web URLs, missing paths, images and commands are unchanged',()=>{
 const input='https://example.org/main.cs [web](https://example.org/main.cs) `missing.cs` ![image](main.cs) `cat main.cs`';
 assert.equal(linkFiles(input,cwd),input);
});
test('fenced and indented code is unchanged',()=>{
 const input='```cs\nmain.cs\n```\n    main.cs\n~~~\nmain.cs\n~~~';
 assert.equal(linkFiles(input,cwd),input);
});
test('extension transforms assistant display only, preserving messages',()=>{
 const events={};let transform;
 fileLinks({on:(event,fn)=>events[event]=fn,registerMarkdownTransformer:fn=>transform=fn});
 events.session_start({}, {cwd});
 assert.equal(transform('main.cs',{messageType:'user'}),'main.cs');
 assert.equal(transform('main.cs',{messageType:'assistant-thinking'}),'main.cs');
 assert.ok(transform('main.cs',{messageType:'assistant'}).includes('file://'));
 assert.match(events.before_agent_start({systemPrompt:'Original'},{cwd}).systemPrompt,/^Original/);
});
test('installed Pi loader registers transformer and renderer emits OSC 8',async()=>{
 const runtime=join(homedir(),'.local/share/pi-runtime/0.87.1/node_modules/@earendil-works/pi-coding-agent');
 const {loadExtensions}=await import(pathToFileURL(join(runtime,'dist/core/extensions/loader.js')));
 const loaded=await loadExtensions([join(import.meta.dirname,'../extensions/file-links.ts')],cwd);
 assert.deepEqual(loaded.errors,[]);
 assert.equal(typeof loaded.extensions[0].markdownTransformer,'function');
 const {Markdown,setCapabilityOverrides}=await import(pathToFileURL(join(runtime,'node_modules/@earendil-works/pi-tui/dist/index.js')));
 const identity=x=>x;
 const theme=Object.fromEntries(['heading','link','linkUrl','code','codeBlock','codeBlockBorder','quote','quoteBorder','hr','listBullet','bold','italic','strikethrough','underline'].map(k=>[k,identity]));
 setCapabilityOverrides({hyperlinks:true});
 try {
  const display=new Markdown(linkFiles('`main.cs`',cwd),0,0,theme).render(100).join('\n');
  assert.ok(display.includes('\x1b]8;;'+url('main.cs')));
  assert.ok(display.includes('main.cs'));
 } finally {setCapabilityOverrides({});}
});
