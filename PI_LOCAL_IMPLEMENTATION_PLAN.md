# Pi Local Environment — plan wdrożenia i handoff dla lokalnego agenta

**Stan planu:** 2026-09-24  
**Repo robocze:** `~/projects/pi-config`  
**Cel dokumentu:** umożliwić przeniesienie dalszej pracy do lokalnego środowiska Pi, które potrafi samodzielnie analizować repo, wprowadzać zmiany, testować je, commitować oraz kontynuować wdrożenie etapami.

---

## 0. Instrukcja dla lokalnego agenta

Ten dokument jest źródłem prawdy dla dalszej implementacji. Nie wykonuj wszystkich etapów naraz.

### Zasady wykonania

1. Najpierw przeczytaj cały dokument.
2. Przed każdą zmianą sprawdź aktualny stan repo i konfiguracji — nie zakładaj, że stan opisany tutaj jest nadal identyczny.
3. Realizuj **jeden etap naraz**.
4. Każdy etap musi zakończyć się testem, oceną kryteriów akceptacji, małym commitem Git i aktualizacją `IMPLEMENTATION_STATUS.md`.
5. Jeżeli kryteria akceptacji nie są spełnione: napraw etap; nie przechodź dalej; jeżeli nie da się naprawić bez decyzji użytkownika, zatrzymaj się i przedstaw diagnozę.
6. Nie zmieniaj działającego komponentu tylko po to, by „uporządkować” kod. Refaktoryzację wykonuj dopiero po funkcjonalnej integracji i testach.
7. Nie instaluj całego `amosblomqvist/pi-config` jako jednego configu. Jego autor zaleca kopiowanie wybranych elementów.
8. `enabledModels` / `/scoped-models` jest **twardą pulą dopuszczonych modeli**. Przyszły router nie może wybierać modeli spoza scope.
9. Nie usuwaj pobranych modeli tylko dlatego, że zajmują dużo miejsca. W szczególności **nie usuwaj GLM-5.3-Flash**.
10. Sekrety nigdy nie trafiają do repo Git.

### Zakres zmian dozwolonych bez dodatkowego pytania

Lokalny agent może samodzielnie:

- edytować `~/projects/pi-config`,
- tworzyć pliki dokumentacji, testów i skryptów w tym repo,
- instalować zależności npm wewnątrz repo lub skopiowanych rozszerzeń,
- tworzyć testowe repozytoria pod `~/projects/`,
- uruchamiać Pi, `llama-cli`, `llama-server`, testy, TypeScript/Node/Python,
- tworzyć branche i commity Git,
- modyfikować `~/.pi/agent/settings.json` i `~/.pi/agent/models.json` **tylko po wykonaniu kopii zapasowej i tylko zgodnie z etapem tego planu**,
- przeładowywać Pi przez `/reload`,
- zmieniać scope modeli.

### Zmiany wymagające zatrzymania i zgody użytkownika

Nie wykonuj autonomicznie:

- usuwania modeli z cache Hugging Face,
- usuwania lub nadpisywania GLM-5.3-Flash,
- zmiany lub ujawnienia sekretów,
- publikowania repo,
- pushowania do nieznanego remote,
- instalowania pakietów systemowych przez `sudo`,
- modyfikowania `/etc/llama-server`,
- usuwania istniejących providerów,
- włączania systemowych/user services na autostart,
- migracji na inny runtime LLM,
- trwałego usuwania działającego `local-glm`,
- automatycznego wysyłania danych projektu do usług zewnętrznych.

---

# 1. Cel końcowy

Zbudować Pi jako lokalne, rozszerzalne środowisko orchestration dla wielu LLM:

```text
                              Pi
                               │
                    curated model scope
                               │
                         model router
                               │
       ┌───────────────────────┼────────────────────────┐
       │                       │                        │
   local models           cloud providers         own endpoints
       │                       │                        │
 llama.cpp               OpenRouter/OpenAI       LightLLM / inne
 Qwen / GLM                  Cursor                    │
       │                       │                        │
       └───────────────────────┴────────────────────────┘
                               │
                    orchestration / agents
                               │
        ┌──────────────┬───────┼─────────┬─────────────┐
        │              │       │         │             │
      tools           MCP   subagents  skills      workflows
        │                        │
 browser/web/files           multisessions
        │                        │
        └────────────── memory / context
```

System docelowo ma spełniać następujące wymagania:

- wiele providerów i modeli,
- modele self-hosted,
- OpenRouter,
- OpenAI,
- Cursor,
- endpointy OpenAI-compatible / LightLLM,
- własne MCP,
- własne tools,
- subagenci i multisessions,
- własne agents,
- workflows/pipelines,
- pamięć długich sesji,
- ograniczona, kuratorowana pula modeli zamiast 700+ modeli,
- automatyczny router bazujący na jakości, zdolnościach, latency, koszcie, dostępnej quota, context window, tool calling, reasoning, vision i health,
- fallback i retry,
- możliwość ręcznego override modelu.

---

# 2. Znany stan początkowy

Przed rozpoczęciem agent musi ten stan zweryfikować.

## 2.1 Pi

Znany wcześniej stan:

```text
Pi: 0.84.4
instalacja: npm user-local
binary: ~/.local/lib/npm/bin/pi
```

Pi szybko się rozwija, więc wykonaj:

```fish
pi --version
which pi
node --version
npm --version
git --version
```

Jeżeli wersja Pi jest nowsza, sprawdź changelog/dokumentację przed adaptowaniem kodu.

## 2.2 Repo konfiguracji

```text
~/projects/pi-config
```

Znany checkpoint:

```text
6ef4c4c Add orchestrator toolchain test
```

Na początku:

```fish
cd ~/projects/pi-config
git status
git log --oneline -10
```

Repo musi być czyste przed rozpoczęciem zmian.

## 2.3 Struktura

Oczekiwany punkt wyjścia:

```text
pi-config/
├── extensions/
│   └── config-test.ts
├── settings/
│   └── models.json
├── agents/
├── skills/
├── prompts/
├── themes/
├── package.json
├── README.md
└── .gitignore
```

Pakiet jest już ładowany przez Pi jako lokalny package.

## 2.4 `config-test.ts`

Testowe extension udowodniło już:

- rejestrację command,
- custom tool calling,
- wieloetapową orchestrację,
- transfer wyników między tools,
- końcową weryfikację.

Znane testowe tools:

```text
orchestrator_lookup
orchestrator_test
orchestrator_verify
```

Nie traktować ich jako finalnej architektury. Są tymczasowym harness-em.

## 2.5 Providerzy

### OpenRouter

Status: działa.

Autoryzacja jest w `~/.pi/agent/auth.json`. Sekretu nie odczytywać do logów.

### Local GLM

Provider:

```text
local-glm
```

Model:

```text
ggml-org/GLM-4.7-Flash-GGUF:Q4_K
```

Znany endpoint:

```text
127.0.0.1:8080
```

Znany tryb serwera:

```text
--reasoning auto
--reasoning-preserve
--api-key-file /etc/llama-server/glm-api-key
```

Model był zweryfikowany jako szybki fallback.

### Local Qwen

Provider:

```text
local-qwen36
```

Model:

```text
unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M
```

Endpoint:

```text
127.0.0.1:8081
```

Model został zweryfikowany jako główny kandydat na lokalny orchestrator + inference.

Zmierzona praktyczna wydajność:

```text
~43–47 tok/s generation
~500 tok/s prompt processing przy dużym reuse/cache
```

Przeszedł reasoning, custom tool call, multi-step tool orchestration, chaining danych, verification, read/edit/read workflow, pracę z >20k tokenów kontekstu i stabilną pracę na baterii / power saving.

## 2.6 GLM-5.3-Flash

Model pozostaje pobrany i ma zostać zachowany.

Znany blocker:

```text
unknown model architecture: 'glm5next'
```

Nie kasować cache modelu.

Po aktualizacjach llama.cpp należy okresowo ponowić test kompatybilności.

---

# 3. Docelowe zasady architektury

## 3.1 Jedno repo jest źródłem konfiguracji

Źródłem zmian ma być:

```text
~/projects/pi-config
```

Nie tworzyć równoległej, ręcznie utrzymywanej konfiguracji w `~/.pi/agent/extensions` / `~/.pi/agent/skills`, jeżeli ten sam zasób może być częścią lokalnego package.

Wyjątek: sekrety i stan runtime.

## 3.2 `~/.pi/agent` przechowuje stan użytkownika

Przykłady:

```text
auth.json
settings.json
models.json -> symlink do repo
models-store.json
sessions/
trust.json
```

## 3.3 Sekrety są poza Git

Zakazane:

```text
API keys
tokens
cookies
passwords
private endpoint credentials
```

W repo mogą znajdować się nazwy env vars, pliki `.example`, ścieżki do secret files i instrukcje konfiguracji.

## 3.4 Model scope jest warstwą bezpieczeństwa

Pełny katalog może mieć 700+ modeli.

Architektura:

```text
all available models
        ↓
 enabledModels
 /scoped-models
        ↓
 curated pool
        ↓
 capability filter
        ↓
 router scoring
        ↓
 selected model
```

Router **nigdy** nie może samodzielnie rozszerzać scope.

## 3.5 Najpierw integracja, potem refactor

Elementy upstream należy najpierw uruchomić w minimalnie zmienionej formie, potem dopiero normalizować kod.

---

# 4. Etap 0 — audyt i punkt przywracania

## Cel

Uzyskać pewny snapshot aktualnego, działającego środowiska.

## Kroki

### 4.1 Stan repo

```fish
cd ~/projects/pi-config
git status
git log --oneline -10
```

Jeżeli dirty: zidentyfikuj zmiany; nie discarduj automatycznie; commituj tylko znany rezultat poprzednich prac.

### 4.2 Snapshot konfiguracji runtime

Utwórz katalog lokalny **poza repo Git**, np.:

```text
~/.local/state/pi-config-backup/
```

Zapisz kopie:

```text
~/.pi/agent/settings.json
~/.pi/agent/models.json
```

Nie kopiuj `auth.json` do repo. Jeśli robisz backup `auth.json`, zachowaj permission `0600` i trzymaj go poza repo.

### 4.3 Zweryfikuj symlink

```fish
readlink -f ~/.pi/agent/models.json
```

Powinien prowadzić do:

```text
~/projects/pi-config/settings/models.json
```

### 4.4 Health lokalnych endpointów

Zweryfikuj:

```text
8080 -> GLM
8081 -> Qwen
```

Bez klucza endpoint ma odpowiadać `401`. Z poprawnym kluczem `/v1/models` ma działać. Nie wypisuj klucza.

### 4.5 Dokument statusu

Dodaj `IMPLEMENTATION_STATUS.md` z bieżącą fazą, ostatnim checkpointem, providerami, blockerami i następnym działaniem.

## Kryteria akceptacji

- Git clean.
- Backup istnieje.
- `models.json` symlink poprawny.
- oba lokalne endpointy są jednoznacznie zidentyfikowane.
- brak sekretów w repo.

## Commit

```text
docs: add implementation status and local handoff baseline
```

---

# 5. Etap 1 — Qwen3.6 jako stabilny default

## Cel

Nowe sesje Pi mają startować na `local-qwen36`.

Znane wcześniej `Ctrl+S` nie zachowywało się poprawnie, dlatego ustawienie należy zweryfikować na poziomie JSON.

## Oczekiwane ustawienia

W `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "local-qwen36",
  "defaultModel": "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M",
  "defaultThinkingLevel": "medium"
}
```

Nie nadpisuj całego pliku. Modyfikuj tylko wymagane klucze.

Przykład bezpiecznej zmiany:

```fish
jq '
  .defaultProvider = "local-qwen36" |
  .defaultModel = "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M" |
  .defaultThinkingLevel = "medium"
' ~/.pi/agent/settings.json > ~/.pi/agent/settings.json.tmp

mv ~/.pi/agent/settings.json.tmp ~/.pi/agent/settings.json
```

## Test

Uruchom nową sesję `pi` bez `--model` i sprawdź footer/model.

## Kryteria akceptacji

- nowa sesja wybiera `local-qwen36`,
- GLM nadal jest dostępny przez `/model`,
- OpenRouter nadal jest dostępny,
- nie zmieniono `auth.json`.

---

# 6. Etap 2 — ograniczenie 700+ modeli

## Cel

Wprowadzić kuratorowaną pulę modeli przed subagentami i routerem.

Pi wykorzystuje `enabledModels` do startup selection i model cycling. `/scoped-models` zapisuje ten scope.

## 6.1 Minimalny scope startowy

Na początku użyj tylko modeli już zweryfikowanych:

```text
local-qwen36 / Qwen3.6-35B-A3B
local-glm / GLM-4.7-Flash
openrouter / auto
```

Następnie dołączaj remote modele świadomie.

## 6.2 Docelowy rozmiar

Nie 700. Docelowo `~10–30 modeli`.

Kategorie:

```text
2–3 local
2–4 premium reasoning
2–4 coding
2–4 fast/cheap
1–3 long-context
1–3 vision/multimodal
1–3 fallback
```

Jeden model może pełnić kilka ról.

## 6.3 Zasada exact IDs

Dla agentów/subagentów preferuj exact `provider/modelId` zamiast szerokich globów.

## 6.4 Implementacja

Można użyć `/scoped-models` lub edytować:

```json
{
  "enabledModels": [
    "local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M",
    "local-glm/ggml-org/GLM-4.7-Flash-GGUF:Q4_K",
    "openrouter/auto"
  ]
}
```

Przed zapisem zweryfikuj dokładny format identyfikatorów przez `pi --list-models`.

## 6.5 Inventory

Utwórz `settings/model-catalog.md`, a docelowo `settings/model-capabilities.json`.

Nie opisuj 700 modeli — tylko modele w scope.

Przykład:

```json
{
  "local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M": {
    "roles": ["orchestrator", "coding", "general"],
    "local": true,
    "reasoning": true,
    "toolCalling": true,
    "vision": true,
    "costClass": "local",
    "latencyClass": "fast-local",
    "verified": true
  }
}
```

## Kryteria akceptacji

- `Ctrl+P` / `/model` nie jest zalewane przypadkowymi modelami.
- wszystkie modele w scope są dostępne i autoryzowane.
- Qwen pozostaje default.
- przyszły router ma jednoznaczny allowlist.

## Commit

```text
config: define initial curated model scope
```

---

# 7. Etap 3 — przygotowanie integracji `amosblomqvist/pi-config`

## Cel

Włączyć wybrane narzędzia do naszego istniejącego package bez nadpisywania konfiguracji.

Upstream wyraźnie zaleca kopiowanie wybranych elementów, a nie instalację całego repo.

## 7.1 Elementy do rozważenia

### Extensions — priorytet A

```text
ask-user-question.ts
bash-guard/
web-fetch/
web-search/
prompt-snippets/
```

### Extensions — priorytet B

```text
browser/
```

### Opcjonalne UI

```text
custom-header.ts
```

### Skills

```text
analyze-sessions/
pdf-reader/
web-debug/
youtube-transcript/
```

### Nie kopiować stubów jako finalnej implementacji

```text
interactive-subagents/
observational-memory/
```

Te komponenty mają własne repozytoria/pakiety.

## 7.2 Zachowanie upstream provenance

Dodaj `docs/upstream-components.md`.

Dla każdego komponentu zapisuj:

```text
source repository
upstream commit SHA
copied path
local path
date imported
local modifications
dependency notes
```

## 7.3 Sugerowana metoda

Stwórz tymczasowy checkout upstream poza aktywnym configiem, np. `~/projects/vendor/pi-config-upstream`.

Nie klonuj go nad `~/.pi/agent`.

Kopiuj **po jednym komponencie**. Po każdym: `/reload` → test → commit.

---

# 8. Etap 4 — integracja tools Amosa po jednym komponencie

## 8.1 `ask-user-question`

Cel: kontrolowana możliwość zatrzymania się i zadania użytkownikowi pytania w UI.

Test: zadanie z celowo brakującym krytycznym wyborem. Model powinien zapytać zamiast zgadywać.

Acceptance: extension ładuje się, popup działa, brak konfliktu z `config-test.ts`.

Commit:

```text
extensions: integrate ask-user-question
```

## 8.2 `bash-guard`

Upstream ma lokalną zależność `shell-quote`.

Po skopiowaniu:

```fish
cd ~/projects/pi-config/extensions/bash-guard
npm install
```

Nie instaluj dependency globalnie.

Test: bezpieczne polecenie przechodzi; potencjalnie destrukcyjne polecenie w kontrolowanym katalogu testowym jest przechwycone; toggle działa.

Nie testuj na prawdziwych plikach użytkownika.

Commit:

```text
extensions: integrate bash guard
```

## 8.3 `web-fetch`

Upstream posiada lokalne zależności npm:

```text
@mozilla/readability
linkedom
turndown
unpdf
```

Po skopiowaniu:

```fish
cd ~/projects/pi-config/extensions/web-fetch
npm install
```

Test: pobierz zwykłą stronę HTML; sprawdź wynik markdown; sprawdź kontrolowany error niedostępnej strony.

Commit:

```text
extensions: integrate web fetch
```

## 8.4 `web-search`

Obecna implementacja upstream korzysta z Google Custom Search API.

Rozpoznawane env vars:

```text
GOOGLE_SEARCH_API_KEY
GOOGLE_API_KEY
GOOGLE_CSE_ID
GOOGLE_CUSTOM_SEARCH_ENGINE_ID
```

Może też czytać lokalne `auth.json` extension.

Preferuj env/secret management.

Nie commituj `extensions/web-search/auth.json`; dodaj go do `.gitignore`.

Test bez credentials: extension ma się załadować, a wywołanie zwrócić jasny błąd braku credentials.

Test z credentials wymaga użytkownika.

Jeśli credentials brak, status to `integrated / unavailable until credentials`; nie blokuje kolejnych etapów.

Commit:

```text
extensions: integrate web search
```

## 8.5 `prompt-snippets`

Test: aktywuj snippet, wykonaj wiadomość, potwierdź reset po wysłaniu.

Commit:

```text
extensions: integrate prompt snippets
```

## 8.6 `browser`

Upstream browser korzysta z Playwright i ma zależność `playwright-core`.

Po skopiowaniu:

```fish
cd ~/projects/pi-config/extensions/browser
npm install
npx playwright install chromium
```

Jeżeli Playwright wymaga dodatkowych bibliotek systemowych, zatrzymaj się przed `sudo` i poproś o zgodę.

Browser upstream jest domyślnie wyłączony.

Test: `/browser on` → bezpieczna strona testowa → DOM → screenshot → `/browser off`.

Acceptance: browser nie startuje automatycznie; po off nie zostają niekontrolowane procesy; screenshot i console/network inspection działają.

Commit:

```text
extensions: integrate browser tools
```

---

# 9. Etap 5 — skills Amosa

Integruj pojedynczo.

## 9.1 `analyze-sessions`

Wymaga Python 3, stdlib.

Test na istniejącej sesji: render, koszt/usage summary, prompt pattern analysis.

Nie modyfikować session files.

## 9.2 `pdf-reader`

Po skopiowaniu:

```fish
python3 -m venv ~/projects/pi-config/skills/pdf-reader/.venv
~/projects/pi-config/skills/pdf-reader/.venv/bin/pip install -r ~/projects/pi-config/skills/pdf-reader/requirements.txt
```

`.venv/` ma być ignorowane przez Git.

Test na lokalnym niewrażliwym PDF fixture.

## 9.3 `web-debug`

Integruj po działającym browser extension. Test na prostym lokalnym frontend fixture.

## 9.4 `youtube-transcript`

Python 3 jest wymagany. `yt-dlp` i `ffmpeg` są zależnościami systemowymi/optional upstream. Jeśli ich nie ma: zanotuj brak; nie instaluj przez `sudo` bez zgody.

---

# 10. Etap 6 — kompatybilność namespace Pi

Część kodu Amosa nadal importuje:

```text
@mariozechner/pi-coding-agent
@mariozechner/pi-tui
```

Aktualny loader `@earendil-works/pi` ma runtime aliases dla starych specifierów.

Wniosek:

- nie trzeba natychmiast przepisywać upstream code,
- trzeba wykonać runtime smoke test każdego extension,
- import namespace można znormalizować później w osobnym refactor commit.

Nie łącz import migration z funkcjonalną integracją.

---

# 11. Etap 7 — failure/recovery test głównego modelu

Przed subagentami dokończ test Qwen3.6.

## Cel

```text
diagnose
→ edit
→ run test
→ FAIL
→ inspect error
→ second edit
→ PASS
```

## Fixture

Stwórz osobne małe repo testowe. Warunki:

- istnieje prawdziwy test,
- pierwszy oczywisty fix nie powinien wystarczyć,
- testów nie wolno modyfikować,
- repo jest w Git, aby można było ocenić diff.

## Prompt

```text
Znajdź przyczynę nieprzechodzących testów.
Napraw kod produkcyjny.
Nie zmieniaj testów.
Uruchamiaj testy po zmianach.
Zakończ dopiero, gdy testy przechodzą.
```

## Acceptance

- model czyta kod i testy,
- uruchamia test,
- reaguje na failure,
- nie maskuje błędu,
- nie zmienia testu,
- finalny test PASS,
- diff minimalny.

---

# 12. Etap 8 — lokalne llama-server jako stabilne usługi

Dopiero po stabilizacji modeli.

Preferuj `systemd --user`, nie system-wide.

Usługi docelowe:

```text
llama-qwen36.service
llama-glm47.service
```

Nie muszą być od razu `enable`.

Najpierw manual start/stop, `Restart=on-failure`, logi w journal.

Laptop + bateria:

- nie autostartuj obu dużych modeli bez świadomej decyzji,
- rozważ tylko główny Qwen lub start on-demand,
- nie zmieniaj parametrów pamięci tylko dlatego, że model się mieści.

Acceptance: Pi restartuje się bez ręcznego przepisywania komend serwera; health endpoint działa; API key nadal wymagany; stop zwalnia model/pamięć.

---

# 13. Etap 9 — interactive subagents

Cel użytkownika obejmuje multisessions/subagents.

`amosblomqvist/pi-config` zawiera tylko stub; właściwa implementacja jest w osobnym repo `amosblomqvist/pi-interactive-subagents`.

Aktualna wersja Amosa jest tmux-only.

## 13.1 Warunek

```fish
tmux -V
```

Jeżeli tmux nie jest zainstalowany, poproś o zgodę przed instalacją systemową.

## 13.2 Instalacja

Nie pinuj automatycznie `main` jako trwałego dependency bez zapisania commit SHA.

Procedura:

1. sprawdź upstream,
2. wybierz konkretny commit/tag,
3. zainstaluj jako package,
4. zapisz dokładną wersję w dokumentacji.

## 13.3 Bardzo ważne — bundled agent models

Aktualne agent definitions upstream mogą wskazywać modele takie jak `openrouter/z-ai/glm-5.3`.

Nie używaj ich automatycznie.

Przy naszej architekturze:

- `scout` może używać szybkiego scoped modelu,
- `worker` powinien domyślnie korzystać z Qwen3.6 lub wybranego scoped coding modelu,
- `researcher` powinien korzystać tylko z modelu z działającym `web_search`/`web_fetch`,
- każdy model subagenta musi należeć do naszego curated scope.

## 13.4 Custom agents

Zacznij od:

```text
scout
researcher
worker
reviewer
```

Nie twórz kilkunastu agentów na początku.

Acceptance:

- main Pi potrafi spawnąć `scout`,
- subagent działa w oddzielnej sesji,
- subagent ma ścisły tool allowlist,
- wynik wraca do parent,
- parent może kontynuować pracę,
- model subagenta pochodzi ze scope,
- nested spawn nie tworzy nieograniczonej rekurencji.

---

# 14. Etap 10 — observational memory

Nie wdrażaj przed stabilnymi subagentami.

## Cel

Długie sesje i zachowanie decyzji bez niekontrolowanego wzrostu kontekstu.

## Procedura

1. sprawdź aktualną wersję repo/package,
2. sprawdź wymagania minimalnej wersji Pi,
3. zainstaluj pinned package,
4. uruchom początkowo **OFF**,
5. użyj manualnego `/om on` tylko w testowej sesji,
6. sprawdź tworzone `.memory/`,
7. sprawdź compaction,
8. sprawdź resume/tree.

## Modele observer/consolidator

Nie hardcoduj drogich remote modeli.

Najpierw eksperymentalnie:

```text
observer -> szybki model scoped
consolidator -> mocniejszy model scoped
```

Qwen lokalny może być kandydatem, ale trzeba zmierzyć wpływ równoległych procesów na RAM/GPU.

Observer concurrency zacznij od `1`, nie od `4`.

---

# 15. Etap 11 — pozostali providerzy

Realizować po ustabilizowaniu tools/subagents.

## 15.1 OpenAI

Cel: API auth + wybrane modele + tylko role potrzebne w curated pool.

Nie włączaj całego katalogu.

## 15.2 Cursor

To jest bardziej zmienny element.

Przed implementacją:

- wykonaj świeży research aktualnego sposobu integracji,
- sprawdź wspierany provider/extension/API flow,
- nie implementuj na podstawie starego poradnika.

## 15.3 LightLLM

Jeżeli endpoint jest OpenAI-compatible:

- dodaj podobnie do `local-*`,
- auth poza repo,
- health test,
- exact selected models.

## Acceptance provider layer

Każdy provider ma test:

```text
auth
health
model listing
one inference
tool calling if supported
reasoning behavior
quota visibility
```

---

# 16. Etap 12 — MCP

Nie instaluj wielu MCP jednocześnie.

Kolejność:

1. wybierz jeden adapter MCP,
2. uruchom jeden prosty server,
3. sprawdź discovery,
4. sprawdź tool call,
5. sprawdź permission/safety,
6. dopiero dodawaj kolejne.

MCP nie może omijać model scope ani guardrails.

---

# 17. Etap 13 — capability registry

Przed routerem trzeba znać właściwości modeli.

Plik:

```text
settings/model-capabilities.json
```

Przykład:

```json
{
  "provider/model": {
    "enabled": true,
    "verified": true,
    "local": false,
    "roles": ["coding", "reasoning"],
    "reasoning": true,
    "toolCalling": true,
    "vision": false,
    "contextClass": "large",
    "latencyClass": "medium",
    "costClass": "premium",
    "quotaSource": "provider",
    "priority": 50,
    "notes": ""
  }
}
```

Dynamiczne `remaining quota`, `provider health`, temporary price i rate limits mają pochodzić z runtime adapters, nie z pliku statycznego.

---

# 18. Etap 14 — quota i cost tracking

## Cel

Router musi odróżniać:

```text
model dostępny
model tani
model ma quota
model throttled
model lokalny
```

## Architektura

```text
provider adapter
      ↓
quota snapshot
      ↓
normalized runtime state
      ↓
router
```

Przykład:

```json
{
  "provider": "openrouter",
  "healthy": true,
  "quotaKnown": true,
  "quotaRemaining": 0.42,
  "rateLimitedUntil": null,
  "updatedAt": "..."
}
```

Nie zakładaj, że każdy provider udostępnia quota API. Jeśli quota jest nieznana, użyj `quotaKnown = false`.

---

# 19. Etap 15 — model router

To jest ostatni duży element, nie pierwszy.

## 19.1 Router input

```text
task type
required tools
required modality
context estimate
latency preference
cost preference
local-only flag
quality requirement
current health
quota
```

## 19.2 Dwuetapowy wybór

### Filter

Usuń modele:

- spoza `enabledModels`,
- bez auth,
- unhealthy,
- bez wymaganej modality,
- bez wymaganych tools/capabilities,
- ze zbyt małym context window,
- bez quota, jeśli quota jest znana jako wyczerpana.

### Score

Dopiero potem oceniaj:

```text
quality
latency
cost
quota headroom
local preference
role match
```

## 19.3 Hard rule

```text
enabledModels = security/availability boundary
router = preference policy
```

Router nie może ominąć scope.

## 19.4 User override

Jeżeli użytkownik ręcznie wybierze model przez `/model` lub `--model`, router nie może go natychmiast nadpisać bez jawnej polityki.

## 19.5 Fallback

Maksymalnie kilka kontrolowanych prób. Nie twórz pętli `A -> B -> A -> B`.

---

# 20. Etap 16 — produkcyjna struktura repo

Docelowo:

```text
pi-config/
├── extensions/
│   ├── diagnostics/
│   ├── routing/
│   ├── ask-user-question.ts
│   ├── bash-guard/
│   ├── browser/
│   ├── prompt-snippets/
│   ├── web-fetch/
│   └── web-search/
├── agents/
│   ├── scout.md
│   ├── researcher.md
│   ├── worker.md
│   └── reviewer.md
├── skills/
│   ├── analyze-sessions/
│   ├── pdf-reader/
│   ├── web-debug/
│   └── youtube-transcript/
├── settings/
│   ├── models.json
│   ├── model-capabilities.json
│   └── ...
├── scripts/
│   ├── health-check.*
│   ├── model-inventory.*
│   └── ...
├── docs/
│   ├── architecture.md
│   ├── upstream-components.md
│   ├── providers.md
│   └── operations.md
├── prompts/
├── themes/
├── IMPLEMENTATION_STATUS.md
├── package.json
└── README.md
```

`config-test.ts` po zakończeniu testów: usuń albo przekształć w `extensions/diagnostics/`.

---

# 21. Etap 17 — health check

Docelowy command np. `/config-health`.

Ma sprawdzać bez ujawniania sekretów:

```text
package loaded
settings readable
models.json readable
default model exists
enabledModels resolve
local qwen endpoint
local glm endpoint
openrouter auth configured
required extensions loaded
browser state
web search credential state
subagent package state
memory package state
```

Nie musi testować pełnej inferencji za każdym razem.

Można dodać osobny `/config-health --deep` dla realnych requestów.

---

# 22. Etap 18 — GLM-5.3 future test

GLM-5.3 pozostaje zachowany.

Po aktualizacji llama.cpp:

1. sprawdź build/version,
2. nie pobieraj modelu ponownie bez potrzeby,
3. uruchom loader test,
4. krótka generation,
5. Vulkan,
6. reasoning,
7. server,
8. Pi provider,
9. dopiero wtedy rozważ dodanie do `enabledModels`.

Jeżeli nadal `unknown model architecture: glm5next`, nie zmieniaj Pi configu.

---

# 23. Zasady Git

## Branch per większy etap

```text
work/amos-tools
work/subagents
work/router
```

## Małe commity

Dobre:

```text
extensions: integrate web fetch
extensions: add browser dependencies
config: define scoped model pool
agents: add local scout profile
router: add capability filtering
```

Złe:

```text
update everything
```

Przed commitem `git diff` + `git status`; po commicie `git status` ma być clean.

---

# 24. Test matrix

| Obszar | Test |
|---|---|
| Pi startup | start bez błędów |
| default model | Qwen3.6 |
| local Qwen | inference |
| local GLM | inference |
| reasoning | działa |
| read/edit | działa |
| bash | działa |
| bash guard | safe/risky controlled case |
| custom extension | `/config-test` lub następca |
| web fetch | fetch public page |
| web search | search lub expected missing-credentials |
| browser | on → navigate → screenshot → off |
| skill | discovery + one invocation |
| subagent | spawn + result |
| memory | on/status/off |
| model scope | tylko curated pool |
| Git | repo clean |

Po każdym komponencie test komponentu; pełna macierz na końcu fazy.

---

# 25. Bezpieczeństwo lokalnego autonomicznego agenta

Pi extensions działają z uprawnieniami procesu użytkownika. Nie ma automatycznej izolacji tylko dlatego, że tool jest extension.

Dlatego:

1. `bash-guard` jest ważny, ale nie zastępuje sandboxa.
2. Trzymaj pracę w repo Git.
3. Testy destrukcyjne tylko na fixtures/temp.
4. Nie odczytuj `.env`, auth files i prywatnych kluczy bez potrzeby.
5. Nie wklejaj sekretów do promptów.
6. Nie dawaj subagentom pełnego toolsetu.
7. `scout` powinien być read-only.
8. `researcher` nie potrzebuje `write/edit`.
9. `worker` dostaje zapis tylko gdy zadanie tego wymaga.
10. `reviewer` powinien być domyślnie read-only.
11. Wszystkie third-party extensions przejrzeć przed load.
12. Project trust traktować świadomie.

---

# 26. Priorytety wykonania

## P0 — teraz

- [ ] Etap 0: audit/backup/status
- [ ] Etap 1: potwierdzenie Qwen default
- [ ] Etap 2: initial model scope
- [ ] Etap 3: upstream provenance
- [ ] Etap 4: ask-user-question
- [ ] Etap 4: bash-guard
- [ ] Etap 4: web-fetch
- [ ] Etap 4: web-search
- [ ] Etap 4: prompt-snippets
- [ ] Etap 4: browser
- [ ] Etap 5: skills
- [ ] Etap 7: failure/recovery test

## P1 — po stabilizacji tools

- [ ] user services dla llama-server
- [ ] interactive subagents
- [ ] własne agent definitions
- [ ] observational memory
- [ ] OpenAI
- [ ] Cursor
- [ ] LightLLM
- [ ] MCP

## P2 — warstwa inteligencji systemu

- [ ] capability registry
- [ ] quota adapters
- [ ] cost adapters
- [ ] health state
- [ ] model router
- [ ] fallback/retry
- [ ] routing telemetry

## P3 — później

- [ ] GLM-5.3 po merge/fix `glm5next`
- [ ] optymalizacja MTP/speculative decoding
- [ ] automatyczne cache cleanup policy
- [ ] szersze workflow automation
- [ ] dodatkowe specialized agents

---

# 27. Kryteria końcowego sukcesu

Projekt można uznać za osiągnięty, kiedy:

1. Pi startuje bez ręcznego podawania modelu.
2. Qwen3.6 jest głównym lokalnym modelem.
3. GLM jest dostępnym fallbackiem.
4. Z 700+ modeli używana jest tylko kuratorowana pula.
5. Tools z `amosblomqvist/pi-config` są zintegrowane i przetestowane.
6. Web/browser tools działają lub jasno raportują brak credentials.
7. Subagenci mają ograniczone toolsets.
8. Agent potrafi wykonać `inspect → plan → change → test → fail → repair → pass`.
9. Pamięć sesji działa bez niekontrolowanego wzrostu context.
10. OpenRouter + OpenAI + Cursor + local + LightLLM są dostępne według faktycznych potrzeb.
11. MCP działa.
12. Router widzi tylko scoped models, uwzględnia capabilities, health i quota, respektuje ręczny override i ma kontrolowany fallback.
13. Każda większa część ma dokumentację i test.
14. Repo jest clean po zakończonych etapach.
15. Sekrety nie występują w historii Git.

---

# 28. Pierwsze zadanie dla lokalnego agenta

Po przeniesieniu tego dokumentu do `~/projects/pi-config` wykonaj tylko `Etap 0`.

Następnie przedstaw:

```text
- wykryta wersja Pi
- wykryta wersja llama.cpp
- git status
- aktualny defaultProvider/defaultModel
- aktualne enabledModels
- lista providerów z models.json
- stan endpointów 8080 i 8081
- obecne extensions/skills
- różnice względem stanu opisanego w tym dokumencie
```

Dopiero po tym rozpocznij Etap 1.

---

# 29. Zweryfikowane fakty z aktualnej dokumentacji/upstream — 2026-09-24

Przy dalszej implementacji ponownie sprawdzać źródła, ponieważ projekty rozwijają się szybko.

- Pi `enabledModels` ogranicza model scope używany do startup selection/model cycling.
- `/scoped-models` służy do zarządzania zapisanym scope modeli.
- Pi packages mogą zawierać extensions, skills, prompts i themes.
- Lokalny package nie jest automatycznie modyfikowany ani nie dostaje automatycznie dependency install; zależności lokalnych extensionów trzeba utrzymać samodzielnie.
- `amosblomqvist/pi-config` nie jest przeznaczony do instalowania jako jeden kompletny config; autor zaleca kopiowanie wybranych elementów.
- `bash-guard`, `browser` i `web-fetch` posiadają własne npm dependencies.
- `browser` wymaga Chromium/Playwright setup.
- `web-search` upstream korzysta z Google Custom Search credentials.
- aktualny loader Pi posiada runtime aliasy dla starych `@mariozechner/*` importów do aktualnych `@earendil-works/*`.
- `pi-interactive-subagents` Amosa jest tmux-only i używa osobnych sesji/panes.
- bundled agent definitions z third-party package nie powinny automatycznie wyznaczać naszej polityki modeli.
- observational memory należy wdrażać dopiero po stabilizacji podstawowego workflow, początkowo w trybie wyłączonym/testowym.
- third-party extensions wykonują kod z uprawnieniami procesu Pi i muszą być traktowane jako zaufany kod po review.

---

# 30. Źródła do ponownej weryfikacji przez lokalnego agenta

Nazwy repo/dokumentów zamiast zakładania niezmienności API:

```text
earendil-works/pi
  docs/latest/models
  docs/latest/settings
  docs/latest/extensions
  docs/latest/packages
  docs/latest/security

amosblomqvist/pi-config
amosblomqvist/pi-interactive-subagents
amosblomqvist/pi-observational-memory
amosblomqvist/pi-subagents
```

Przed większą integracją:

```text
1. sprawdź latest README
2. sprawdź package.json
3. sprawdź ostatni commit/tag
4. sprawdź wymagania Pi
5. sprawdź otwarte breaking-change issues
6. pinuj wersję/commit
7. dopiero instaluj
```

---

## Ostateczna zasada

Nie budujemy „systemu, który ma najwięcej modeli i pluginów”.

Budujemy system, w którym:

```text
mała liczba dobrze dobranych modeli
+
sprawdzone tools
+
kontrolowane subagenty
+
jawna polityka bezpieczeństwa
+
mierzalny routing
```

daje stabilniejsze i bardziej przewidywalne środowisko niż bezpośrednie wystawienie 700+ modeli i wszystkich możliwych rozszerzeń.
