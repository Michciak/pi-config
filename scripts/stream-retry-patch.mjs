// Release-local compatibility fix for the exact transport failure emitted by Codex.
export function patchStreamRetry(source, version) {
  if (version !== "1.0.3") throw new Error("Stream retry patch requires Pi AI 1.0.3");
  const anchor = '    "stream ended before a terminal response event",';
  if (source.split(anchor).length !== 2) throw new Error("Stream retry anchor changed");
  return source.replace(anchor, anchor + '\n    "upstream stream ended before a completion event",');
}
