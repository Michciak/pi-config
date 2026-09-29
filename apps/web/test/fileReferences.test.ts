import assert from "node:assert/strict";
import test from "node:test";
import { linkLocalReferences, localFilePath } from "../src/fileReferences.js";

test("links absolute, relative and inline-code file references", () => {
  const workspace = "/Users/me/Dropbox/NETRIX/project";
  const linked = linkLocalReferences("Open src/app.ts:12 and `README.md` or /Users/me/Dropbox/NETRIX/x.kt.", workspace);
  assert.match(linked, /file:\/\/\/Users\/me\/Dropbox\/NETRIX\/project\/src\/app\.ts/);
  assert.match(linked, /file:\/\/\/Users\/me\/Dropbox\/NETRIX\/project\/README\.md/);
  assert.match(linked, /file:\/\/\/Users\/me\/Dropbox\/NETRIX\/x\.kt/);
});

test("leaves URLs and fenced code unchanged and resolves link targets", () => {
  const workspace = "/Users/me/project";
  const source = "https://example.com/a.ts\n```ts\nsrc/no-link.ts\n```";
  assert.equal(linkLocalReferences(source, workspace), source);
  assert.equal(localFilePath("src/app.ts", workspace), "/Users/me/project/src/app.ts");
  assert.equal(localFilePath("https://example.com/x", workspace), null);
});

test("does not turn numbers and ordinary inline code into files", () => {
  const source = 'Version `0.2.149`, `hello`, 7.163 and `feat/voice-v1`';
  const linked = linkLocalReferences(source, '/work');
  assert.ok(!linked.includes('file:///work/0.2.149'));
  assert.ok(!linked.includes('file:///work/hello'));
  assert.ok(!linked.includes('file:///work/feat/voice-v1'));
  assert.equal(linkLocalReferences('state.Sprawdzam', '/work'), 'state.Sprawdzam');
  assert.ok(!linked.includes('file:///work/7.163'));
  assert.equal(localFilePath('', '/work'), null);
  assert.equal(localFilePath('#heading', '/work'), null);
  assert.doesNotThrow(() => localFilePath('/work/100%.txt'));
});
