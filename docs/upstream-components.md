# Upstream components

This repository is the local, versioned source for the selected Pi components.
The installed runtime under `~/.pi/agent` is kept compatible with existing user
state; secrets and runtime session files are intentionally excluded.

## Initial imports

| Component | Source | Revision/version | Local path |
|---|---|---|---|
| Selected Pi tools and skills | `https://github.com/amosblomqvist/pi-config` | `f82da563ab05d66729492d64c7ed4e96db3663f3` | `extensions/`, `skills/` when added |
| tmux interactive subagents | `https://github.com/amosblomqvist/pi-interactive-subagents` | package `3.7.2` | `extensions/interactive-subagents/` |

The global runtime was synchronized from this repository for the merged agent
profiles. Existing global extensions remain in place until each component is
tested through the package path; this avoids a broad runtime migration in one
step.
