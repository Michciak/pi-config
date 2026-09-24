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

The upstream interactive-subagents and observational-memory directories are documented
stubs and are deliberately not loaded as final implementations.
No upstream auth file is copied. Local modifications are limited to configuration,
provenance, and dependency isolation.
