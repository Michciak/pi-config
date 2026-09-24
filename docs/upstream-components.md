# Upstream components

Source: `https://github.com/amosblomqvist/pi-config`
Pinned import commit: `f82da563ab05d66729492d64c7ed4e96db3663f3`
Imported: 2026-09-24

| Component | Local path | Dependencies | State |
|---|---|---|---|
| ask-user-question | `extensions/ask-user-question.ts` | Pi runtime | integrated |
| bash-guard | `extensions/bash-guard` | `shell-quote` | integrated |
| browser | `extensions/browser` | `playwright-core`, Chromium | integrated, opt-in |
| prompt-snippets | `extensions/prompt-snippets` | Pi runtime | integrated |
| web-fetch | `extensions/web-fetch` | readability, linkedom, turndown, unpdf | integrated |
| web-search | `extensions/web-search` | Google Custom Search credentials | integrated, unavailable without credentials |
| analyze-sessions | `skills/analyze-sessions` | Python 3 stdlib | integrated |
| pdf-reader | `skills/pdf-reader` | local venv, requirements.txt | integrated |
| web-debug | `skills/web-debug` | browser extension | integrated |
| youtube-transcript | `skills/youtube-transcript` | optional yt-dlp/ffmpeg | integrated, dependencies not assumed |

| interactive-subagents 3.7.2 | `extensions/interactive-subagents` | tmux | integrated, scout/worker use local Qwen; researcher uses scoped `openrouter/auto` |
| observational-memory 0.1.0 | `extensions/observational-memory` | local npm deps | integrated, default OFF, observer concurrency 1 |

Interactive-subagents source is pinned to `c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7`.
Local changes: package wrapper, scoped model overrides, local web-tool paths, and
agent-directory path correction. `tmux` 3.7c is installed; no service/autostart was added.

Observational-memory source is pinned to `78a1efcfdd46332253fb289724f05b26dfc7769e`.
Local configuration selects Qwen for observer/consolidator, concurrency 1, and keeps
its per-session `/om` gate OFF until a dedicated test session is started.
No upstream auth file is copied. Local modifications are limited to configuration,
provenance, and dependency isolation.
