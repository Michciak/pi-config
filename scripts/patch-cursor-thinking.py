#!/usr/bin/env python3
"""Compatibility fix for pi-cursor-sdk 0.3.10 reasoning_effort (Grok 4.7)."""
from pathlib import Path
import json
import shutil
import sys

def patch_text(text):
    if 'pi-remote: reasoning_effort compatibility' in text:
        return text
    replacements = {
        'const effortParameter = getParameter(item, "effort");': 'const effortParameter = getParameter(item, "effort") ?? getParameter(item, "reasoning_effort");',
        'effort: getParameter(item, "effort") !== undefined,': 'effort: getParameter(item, "effort") !== undefined || getParameter(item, "reasoning_effort") !== undefined,\n            reasoningEffort: getParameter(item, "reasoning_effort") !== undefined,',
        'setParam(params, "effort", mapped);': 'setParam(params, metadata.parameterIds.reasoningEffort ? "reasoning_effort" : "effort", mapped);',
    }
    for old,new in replacements.items():
        if text.count(old) != 1:
            raise RuntimeError('Unexpected Cursor SDK source; refusing to patch')
        text=text.replace(old,new)
    text=text.replace('effort: boolean;', 'effort: boolean;\n        reasoningEffort: boolean;')
    return '// pi-remote: reasoning_effort compatibility\n'+text

def apply(agent_dir, backup_root):
    package=agent_dir/'npm/node_modules/pi-cursor-sdk'
    if not (package/'package.json').exists(): return
    if json.loads((package/'package.json').read_text())['version'] != '0.3.10':
        print('Cursor thinking patch: skipped (version differs from 0.3.10)'); return
    changes=[]
    for name in ['src/model-discovery.ts','dist/model-discovery.js']:
        path=package/name; original=path.read_text(); updated=patch_text(original)
        if original != updated: changes.append((path,name,updated))
    for path,name,updated in changes:
        backup=backup_root/'cursor-sdk'/name; backup.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(path,backup); path.write_text(updated)
    print('Cursor reasoning_effort compatibility: installed' if changes else 'Cursor reasoning_effort compatibility: already installed')

if __name__=='__main__':
    apply(Path(sys.argv[1]),Path(sys.argv[2]))
