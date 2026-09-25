#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
base=Path(__file__).resolve().parents[1]
settings=Path(os.environ.get('PI_SETTINGS', str(Path.home()/'.pi/agent/settings.json')))
registry=base/'settings/model-capabilities.json'
active=set(json.loads(settings.read_text()).get('enabledModels',[]))
models=json.loads(registry.read_text()).get('models',{})
missing=sorted(active-set(models)); extra=sorted(set(models)-active)
print(f'active scope: {len(active)}')
print(f'registry entries: {len(models)}')
if missing: print('MISSING:\n'+'\n'.join('  '+x for x in missing))
if extra: print('EXTRA:\n'+'\n'.join('  '+x for x in extra))
if not missing and not extra: print('OK: registry matches active scope')
if missing or extra: sys.exit(1)
