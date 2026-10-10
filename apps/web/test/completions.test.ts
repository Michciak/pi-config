import test from "node:test";
import assert from "node:assert/strict";
import {argumentQuery,fileReferenceQuery} from "../src/completions.js";

test("file completions preserve cursor ranges, spaces and subsequent text",()=>{
  const text="Check @[src/my file later";
  assert.deepEqual(fileReferenceQuery(text,19),{query:"src/my file",start:6,end:19});
  assert.equal(fileReferenceQuery("@[src/file]"),undefined);
  assert.equal(fileReferenceQuery("email@[file"),undefined);
  assert.equal(fileReferenceQuery("@[first\nsecond"),undefined);
});
test("native argument queries preserve the whole prefix without multiline completions",()=>{
  assert.deepEqual(argumentQuery("/goal pause "),{name:"goal",prefix:"pause ",end:12});
  assert.deepEqual(argumentQuery("/model "),{name:"model",prefix:"",end:7});
  assert.equal(argumentQuery("/goal"),undefined);
  assert.equal(argumentQuery("/goal text\ncontinued"),undefined);
});
