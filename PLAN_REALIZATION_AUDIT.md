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
| 8 llama services | **PARTIAL/IMPROVED** | Nowe extension `local-llama` zapewnia autostart Qwen przy `session_start` (z kontrolą bezpieczeństwa: blokada gdy GLM aktywny, podłoga wolnej pamięci 16 GiB, start tylko przez `systemctl --user`) i zatrzymuje usługę przy `session_shutdown` tylko gdy ten proces Pi ją uruchomił (zabezpieczenie przed wieloma sesjami Pi). Komendy `/qwen-ensure`, `/qwen-stop`, `/qwen-status`. Jednostki nadal disabled z wzajemnym `Conflicts=`; GLM nie był testowany równolegle z uwagi na OOM. |
| 9 interactive subagents | **PARTIAL/DONE CORE** | Pinned package, tmux, scoped agent models i live scout spawn/result działają. Nie testowano nested spawn ani wszystkich allowlistów. |
| 10 observational memory | **PARTIAL/DONE CORE** | Package pinned i OFF domyślnie. Realny test utworzył `INDEX.md`, `JOURNEY.md`, topic file oraz run artifacts; wznowienie tej samej sesji `/om:status` działało. Pełna compaction pozostaje osobnym testem. |
| 11 providers | **DONE** | Obecny zestaw (local-glm, local-qwen36, openrouter/auto, github-copilot, openai-codex, cursor) uznany za wystarczający. Nie planuje się dalszych providerów. |
| 12 MCP | **DONE MINIMAL** | Dodano stdio MCP server i Pi bridge; `config_status` oraz `provider_quota_status` zostały odkryte i wywołane z Pi. |
| 13 capability registry | **DONE STATIC** | `settings/model-capabilities.json` istnieje i jest używany przez router. |
| 14 quota/cost adapters | **DONE CORE** | `quota-check.mjs` ma live quota dla 3 providerów: OpenRouter (`/api/v1/credits`, remaining 0), OpenAI Codex (`x-codex-primary-used-percent` z nagłówków, plan plus, 0% zużycia), opencode-go (`GET /zen/go/v1/usage`, rolling 0% / weekly 2% / monthly 1%). Cursor: brak publicznego endpointu (tylko weryfikacja ręczna). Copilot: licencja wygasła (GitHub 401, `authValid=false`, modele wykluczane z routingu z auto-recovery po odnowieniu). Quota działa jako bramka (filtr), nie bonus scoringu — koszt preferencji w priority z `sync-models.mjs`. |
| 15 model router | **PARTIAL/IMPROVED** | Router ma live pipeline `collectRuntimeState() → route()`, dziedziczenie stanu providera dla modeli, auth/health/quota filtering oraz wpisy capabilities dla całego obecnego scope (14 modeli, w tym 3 opencode-go). Scope i capabilities są ładowane leniwie przy każdym wywołaniu (`router.mjs`, `routing/policy.ts`), więc `pi /reload` i edycja `enabledModels` stosują się automatycznie. Remote inference dla Codex/Cursor/opencode-go pozostaje `healthy: unknown` (brak stabilnego endpointu), więc system nie udaje pełnej weryfikacji. |
| 16 production structure | **PARTIAL** | Główna struktura istnieje; część upstream nadal jest lokalnym importem bez pełnego refactoru/normalizacji. |
| 17 health check | **PARTIAL/IMPROVED** | Local `/v1/models` i OpenRouter catalog są sprawdzane live; GitHub Copilot sprawdza token przez GitHub API. Codex/Cursor mają tylko auth/configuration check, ponieważ nie ma stabilnego generic health endpointu. Extension/subagent/memory state pozostają do pełnego smoke testu. |
| 18 GLM-5.3 | **NOT DONE** | Model zachowany, ale nie wykonano nowego compatibility testu. |

## Nowe punkty planu

| # | Temat | Opis |
|---|---|---|
| — **W TRAKCIE** | Quota left information getter | Dodano normalized getter dla wszystkich aktywnych providerów. OpenRouter zwraca realne credits; GitHub Copilot, OpenAI Codex i Cursor jawnie zwracają `quotaKnown=false`, bo nie mają stabilnego publicznego endpointu. Local pozostaje `hardware-bound`. |
| — **W TRAKCIE** | Hyperland window opener | Backend subagentów preferuje natywne okno Hyprland, uruchamiając osobną sesję tmux wewnątrz terminala (`hyprctl dispatch exec`); `PI_SUBAGENT_SURFACE=tmux` zachowuje fallback. Pełny live spawn w Hyprland pozostaje do walidacji. |
| — **DONE CONFIG** | Naprawić hiperlinki w Pi | Wymuszono `terminal.hyperlinks: true` w `~/.pi/agent/settings.json`; backup settings utworzono przed zmianą. Interaktywny test OSC 8 pozostaje do wykonania. |
| — **DONE CORE** | Naprawić model selection — quota | `quota-check.mjs` normalizuje OpenRouter, GitHub Copilot, OpenAI Codex, Cursor i local. Router odrzuca znane zero i nie traktuje nieznanego quota jako zero. Providerzy bez stabilnego publicznego quota endpointu pozostają jawnie `quotaKnown=false`. |
| — **DONE CORE** | Naprawić model selection — widoczność providerów | `model-capabilities.json` zawiera wszystkie 40 enabled modeli: Qwen, GLM, OpenRouter, 3 GitHub Copilot, 3 Codex, 2 Cursor i wszystkie 29 katalogowanych modeli opencode-go (priorytety niższe niż kuratorowane defaulty, więc Qwen pozostaje orchestratorem). Usunięto nieistniejące/stare Cursor IDs ze scope po weryfikacji przez `pi --list-models`. |
| — **PARTIAL/DONE CORE** | Naprawić model selection — health check remote | `runtime-state.mjs` sprawdza local endpoints, OpenRouter catalog i GitHub auth API. Codex/Cursor mają jawny `healthy: undefined` po auth-only check, bo brak stabilnego generic health endpointu. Router odrzuca `healthy:false`, ale nie blokuje providerów z uczciwie nieznanym health. |
| — **DONE CORE** | Naprawić model selection — integracja runtime | `scripts/route-model.mjs` realizuje `collectRuntimeState() → route(task, runtime)` i zapisuje niejawne telemetry. Extension `/route-model` oraz delegowanie subagentów korzystają z live policy; `PI_SUBAGENT_SURFACE` pozostaje niezależnym wyborem UI. |
| — **DONE CORE** | Naprawić model selection — testy | `router.test.mjs` ma 10/10 PASS, w tym provider-state inheritance, auth filtering, known exhausted quota vs unknown quota. `scripts/provider-smoke.mjs` potwierdza 11/11 enabled modeli w `pi --list-models`. Pełny inference smoke per provider nadal wymaga osobnego testu z realnym requestem. |

## Nowe wdrożenia po audycie

- Minimalny MCP stdio server + Pi bridge: `config_status` i `provider_quota_status`.
- OpenRouter credits quota jest odczytywane; bieżące remaining: `0`.
- OpenAI Codex OAuth przez `/login` przeszedł inference; quota pozostaje jawnie nieznane.
- Realny memory test utworzył durable memory i został wznowiony przez `/om:status`.

## Wniosek

Plan **nie jest w całości zrealizowany**. Fundament lokalny, scope, Qwen,
subagenci, podstawowy router i diagnostyka działają. Core model selection,
provider visibility, live runtime pipeline i routing tests są wykonane.
Pozostają: pełne quota/inference adapters dla providerów bez publicznych endpointów,
pełne cost telemetry, live smoke test Hyprland, interaktywne testy extension,
pełna compaction memory, GLM fallback oraz GLM-5.3 compatibility test.
