# Pozostałe zadania — priorytety

Zdefiniowane przez użytkownika: 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14.

> Status wykonania: routing core (#1–#5), provider getter (#6), provider catalog smoke (#14), telemetry foundation (#10), native Hyprland backend (#11) oraz hyperlinks (#12) zostały wdrożone częściowo/core. Pozostają walidacje live: pełny inference providerów, extension smoke, memory compaction i realny spawn Hyprland.
>
> Uzupełnienia 2026-10-03: (a) scope/capabilities ładują się leniwie — zmiany `enabledModels` stosują się automatycznie przy `pi /reload`; (b) licencja opencode-go uwzględniona w quota, runtime-state, capabilities, scope (3 modele) i provider-smoke; (c) autostart Qwen przez extension `local-llama` z kontrolą bezpieczeństwa (konflikt GLM, podłoga pamięci, start tylko `--user`, stop przy wyjściu Pi tylko gdy ten proces go uruchomił).

---

## Priorytet 1 — KRITICAL (podstawa działania routera)

| # | Temat | Dlaczego pierwsze |
|---|---|---|
| **4** | Integracja runtime | Bez tego router nie dostaje live danych — to fundament, od którego zależy wszystko |
| **2** | Widoczność providerów | Router widzi tylko 3 modele; bez tego rozszerzanie quota/health nie ma sensu — nie ma co routować |
| **3** | Health check remote | Bez tego router nie filteruje unavailable remote providerów |
| **1** | Quota | Bez tego scoring nie używa quota — router nie odrzuca wyczerpanych modeli |
| **5** | Testy integracyjne | Bez testów nie masz walidacji, że #1–#4 działają razem |

**Bez tego zestawu router jest martwy.**

## Priorytet 2 — IMPORTANT (roboczy stan)

| # | Temat | Dlaczego drugie |
|---|---|---|
| **6** | Quota left getter (globalny) | Rozszerzenie #1 na wszystkich providerów — ma sens po naprawie #1 |
| **10** | Cost telemetry | Wymaga działającego routera (#1–#5), bo koszt ma znaczenie przy routing |
| **9** | Testy extensions | Wymaga działających rozszerzeń — można robić równolegle z #6/#10 |
| **7** | Testy memory compaction | Niezależne od routera — można robić równolegle |

## Priorytet 3 — NICE TO HAVE (UX/infra)

| # | Temat | Dlaczego ostatnie |
|---|---|---|
| **14** | Full provider smoke tests | Wymaga działających routera i extensions |
| **11** | Hyperland window opener | Infrastruktura subagentów — nie blokuje routera |
| **12** | Pi hyperlinks | Czysta kosmetyka terminala |

---

## Ścieżka realizacji (kolejność kroków)

```
1. [4] Integracja runtime          → collectRuntimeState → route() pipeline
2. [2] Widoczność providerów       → 11 nowych wpisów w model-capabilities.json
3. [3] Health check remote         → fetch /v1/models dla remote
4. [1] Quota                       → quota-check.mjs: cursor, github-copilot, openai-codex
5. [5] Testy integracyjne          → router.test.mjs: quota + health + full scope
6. [6] Quota left getter (globalny) → uzupełnienie handlerów
7. [10] Cost telemetry            → live cost tracking w routerze
8. [9] Testy extensions            → bash-guard, prompt-snippets, browser
9. [7] Testy memory compaction     → full compaction run
10. [14] Full provider smoke tests → każdy extension osobno
11. [11] Hyperland window opener   → hyprctl zamiast tmux
12. [12] Pi hyperlinks             → terminal.hyperlinks: true
```
