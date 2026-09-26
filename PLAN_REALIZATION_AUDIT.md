# Audyt realizacji `PI_LOCAL_IMPLEMENTATION_PLAN.md`

Audyt: 2026-09-25. Stan repozytorium: `master`, clean.

## Weryfikacja runtime

| Element | Faktyczny stan | Weryfikacja |
|---|---|---|
| Pi | 0.87.1 | `pi --version` |
| llama.cpp | 0.4.1-dev, build 10964 | `llama-server --version` |
| tmux | 3.7c | `tmux -V` |
| default | `local-qwen36` + Qwen3.6 | `~/.pi/agent/settings.json` |
| scope | Qwen, GLM, `openrouter/auto`, github-copilot, openai-codex, cursor | `enabledModels` + `pi --list-models` |
| models symlink | poprawny | `readlink -f ~/.pi/agent/models.json` |
| Qwen endpoint | działa; deep inference PASS | `scripts/health-check.sh --deep` |
| GLM endpoint | zatrzymany | port 8080 HTTP 000 |
| Git | clean | `git status` |

## Etapy planu

| Etap | Ocena | Stan faktyczny |
|---|---|---|
| 0 audit/backup | **częściowo DONE** | Audyt, backup, symlink i status są; GLM nie był dostępny podczas bazowego audytu. |
| 1 Qwen default | **DONE** | Default i thinking level są ustawione; inference Pi działa. |
| 2 curated scope | **DONE** | Scope, exact IDs, katalog i capability registry są; router testuje granicę scope. |
| 3 provenance Amos | **DONE** | `docs/upstream-components.md`, przypięte SHA i lokalne modyfikacje. |
| 4 extensions | **PARTIAL** | Wszystkie komponenty są skopiowane i zależności zainstalowane; web-fetch działa, web-search poprawnie zgłasza brak credentials. Brakuje pełnych testów popup bash-guard, prompt-snippets i `/browser on` w interaktywnym UI. |
| 5 skills | **PARTIAL** | Skills są obecne; `analyze-sessions` cost report i `pdf-reader` na `/usr/share/doc/speexdsp/manual.pdf` działają. `yt-dlp` 2026.08.19 jest teraz w izolowanym venv; pełny transcript test na poprawnym URL pozostaje do wykonania. |
| 6 namespace compatibility | **PARTIAL** | Pi package smoke test działa; nie wykonano osobnego smoke testu każdego extension. |
| 7 failure/recovery | **PARTIAL** | Fixture kończy się 3/3 PASS bez zmian testów; pełny model-driven workflow nie został jednoznacznie ukończony. |
| 8 llama services | **PARTIAL** | Qwen działa manualnie. GLM załadował się na 8080, ale przy równoległym Qwen kernel OOM killer zatrzymał usługę; jednostki mają teraz wzajemny `Conflicts=` i pozostają disabled. |
| 9 interactive subagents | **PARTIAL/DONE CORE** | Pinned package, tmux, scoped agent models i live scout spawn/result działają. Nie testowano nested spawn ani wszystkich allowlistów. |
| 10 observational memory | **PARTIAL/DONE CORE** | Package pinned i OFF domyślnie. Realny test utworzył `INDEX.md`, `JOURNEY.md`, topic file oraz run artifacts; wznowienie tej samej sesji `/om:status` działało. Pełna compaction pozostaje osobnym testem. |
| 11 providers | **DONE** | Obecny zestaw (local-glm, local-qwen36, openrouter/auto, github-copilot, openai-codex, cursor) uznany za wystarczający. Nie planuje się dalszych providerów. |
| 12 MCP | **DONE MINIMAL** | Dodano stdio MCP server i Pi bridge; `config_status` oraz `provider_quota_status` zostały odkryte i wywołane z Pi. |
| 13 capability registry | **DONE STATIC** | `settings/model-capabilities.json` istnieje i jest używany przez router. |
| 14 quota/cost adapters | **PARTIAL** | Dodano adapter OpenRouter credits oraz status OpenAI Codex OAuth (`quotaKnown=false` bez publicznego endpointu); cost telemetry pozostaje niepełne. | | — **NOWY PUNKT** | Dodać `left information getter` dla każdego aktywnego providera (cursor, github-copilot, openai-codex, openrouter). Local pozostaje `hardware-bound`. Plan: rozszerzyć `scripts/quota-check.mjs`. |
| 15 model router | **PARTIAL** | Filtering/scoring, manual override, fallback limit i OpenRouter simple-task rule są przetestowane; brak pełnej integracji ze wszystkimi provider adapters. |
| 16 production structure | **PARTIAL** | Główna struktura istnieje; część upstream nadal jest lokalnym importem bez pełnego refactoru/normalizacji. |
| 17 health check | **PARTIAL** | Basic/deep health działają; nie sprawdzają jeszcze wszystkich wymaganych extension/subagent/memory states. |
| 18 GLM-5.3 | **NOT DONE** | Model zachowany, ale nie wykonano nowego compatibility testu. |

## Nowe punkty planu

| # | Temat | Opis |
|---|---|---|
| — **NOWY** | Quota left information getter | Dodać `left information getter` dla każdego aktywnego providera (cursor, github-copilot, openai-codex, openrouter). Local pozostaje `hardware-bound`. Plan: rozszerzyć `scripts/quota-check.mjs`. |
| — **NOWY** | Hyperland window opener | Przerobić wszystkie extension i konfigurację, żeby zamiast z tmux-pane korzystała z otwierania nowego okna w natywnym Hyperland. Obecnie `createSurface()` używa `tmux split-window`. Należy zastąpić `hyprctl dispatch` lub odpowiednim API Hyprland. Hyprland 0.56.2 jest dostępny, `hyprctl` działa, środowisko Wayland. |
| — **NOWY** | Naprawić hiperlinki w Pi | Hiperlinki OSC 8 nie działają w obecnej konfiguracji. Pi obsługuje `terminal.hyperlinks: boolean | "auto"` z domyślną wartością `"auto"`. Należy sprawdzić detekcję, czy nie jest zablokowana przez multiplexer/proxy terminala, i wymusić `terminal.hyperlinks: true` w `~/.pi/agent/settings.json` jeśli automatyczny wykrywanie nie działa. |

## Nowe wdrożenia po audycie

- Minimalny MCP stdio server + Pi bridge: `config_status` i `provider_quota_status`.
- OpenRouter credits quota jest odczytywane; bieżące remaining: `0`.
- OpenAI Codex OAuth przez `/login` przeszedł inference; quota pozostaje jawnie nieznane.
- Realny memory test utworzył durable memory i został wznowiony przez `/om:status`.

## Wniosek

Plan **nie jest w całości zrealizowany**. Fundament lokalny, scope, Qwen,
subagenci, podstawowy router i diagnostyka działają. Do pełnej realizacji
pozostają: quota left getter (nowy), Hyperland window opener (nowy), hiperlinki Pi (nowy), pełne testy memory i
skills, GLM fallback, cost telemetry oraz GLM-5.3 compatibility test.
