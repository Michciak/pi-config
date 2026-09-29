import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveScope} from '../src/pi-settings.js';
test('scope update preserves unrelated Pi configuration and rejects stale writes', async () => {
 const dir=mkdtempSync(join(tmpdir(),'pi-scope-'));
 const path=join(dir,'settings.json');
 writeFileSync(path,JSON.stringify({enabledModels:['cursor/auto'],theme:'existing',packages:['existing']}));
 await saveScope(dir,['openai-codex/*'],['cursor/auto'],dir);
 const actual=JSON.parse(readFileSync(path,'utf8'));
 assert.deepEqual(actual.enabledModels,['openai-codex/*']); assert.equal(actual.theme,'existing'); assert.deepEqual(actual.packages,['existing']);
 await assert.rejects(saveScope(dir,['cursor/*'],['cursor/auto'],dir),/changed elsewhere/);
 await assert.rejects(saveScope(dir,[42],['openai-codex/*'],dir),/Invalid/);
});
