export function fileReferenceQuery(text:string,caret=text.length) {
  const before=text.slice(0,caret);
  const match=/(?:^|\s)@\[([^\]\n]*)$/.exec(before);
  if(!match)return;
  return {query:match[1]!,start:before.lastIndexOf("@["),end:caret};
}
export function argumentQuery(text:string,caret=text.length) {
  const match=/^\s*\/([^\s/]+)\s+([^\n]*)$/.exec(text.slice(0,caret));
  return match?{name:match[1]!,prefix:match[2]!,end:caret}:undefined;
}
