import importlib.util
from pathlib import Path
import tempfile, subprocess, unittest, json, re
spec=importlib.util.spec_from_file_location('patch',Path(__file__).resolve().parents[1]/'scripts/patch-cursor-thinking.py')
patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)
class PatchTest(unittest.TestCase):
 def test_installed_sdk_grok_mapping(self):
  source=Path.home()/'.pi/agent/npm/node_modules/pi-cursor-sdk'
  if not source.exists(): self.skipTest('Installed Cursor SDK required')
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'dist').mkdir();(root/'shared').symlink_to(source/'shared');(root/'node_modules').symlink_to(source/'node_modules');(root/'package.json').write_text('{"type":"module"}')
   for path in (source/'dist').iterdir():
    if path.name!='model-discovery.js':(root/'dist'/path.name).symlink_to(path)
   original=(source/'dist/model-discovery.js').read_text();updated=patch.patch_text(original)
   self.assertEqual(patch.patch_text(updated),updated)
   # Isolate catalog mapping from credentials, caches and network adapters.
   updated=re.sub(r'import .*? from "\./[^"\n]+";', '', updated)
   updated='const loadContextWindowCache=()=>new Map(); const resolveCursorApiKey=()=>undefined;\n'+updated
   (root/'dist/model-discovery.js').write_text(updated)
   test="""
import assert from 'node:assert/strict';
import {__testUtils, buildCursorModelSelection} from './dist/model-discovery.js';
const items=[{id:'grok-4.7',name:'Grok',parameters:[{id:'reasoning_effort',values:['low','medium','high','xhigh'].map(value=>({value}))}]}];
const models=__testUtils.registerModelItems(items);
assert.ok(models.length);
for(const model of models){
 assert.equal(model.reasoning,true);
 assert.equal(model.thinkingLevelMap.high,'high');
 const selection=buildCursorModelSelection(model.id,'high');
 assert.ok(JSON.stringify(selection).includes('reasoning_effort'));
 assert.ok(JSON.stringify(selection).includes('high'));
}
console.log('Grok reasoning_effort mapping OK');
"""
   (root/'test.mjs').write_text(test)
   subprocess.run(['node',str(root/'test.mjs')],check=True,cwd=root)
 def test_unknown_source_rejected(self):
  with self.assertRaises(RuntimeError):patch.patch_text('changed upstream')
if __name__=='__main__':unittest.main()
