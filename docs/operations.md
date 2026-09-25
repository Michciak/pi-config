# Operations

## Start Pi with interactive subagents

```sh
tmux new -A -s pi
pi
```

Use `/subagents` to inspect available profiles. The merged profiles are
`scout`, `researcher`, `worker`, `coder`, `detective`, `fixer`, `inventor`,
`planner`, and `reviewer`.

## Checks

```sh
./scripts/health-check.sh
./scripts/sync-runtime.sh --check
python3 ./scripts/audit-model-scope.py
```

The model-scope audit must be run from a normal Warp session so Pi can read its
runtime locks and model catalog. It does not modify the scope.

## Synchronization

Use `./scripts/sync-runtime.sh --apply` only after reviewing its check output.
It synchronizes agent profiles and tmux configuration and creates a backup of
files it replaces. Authentication, model settings, model cache, and sessions
are outside its write set.

## Current policy

The selected Pi model remains the orchestrator. Local LLM servers are deferred.
The existing provider configuration and model scope remain authoritative until
a separate, reviewed scope change is committed.
