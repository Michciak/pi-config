# Pi Remote: powiadomienia, delegaci ACP i awarie

## Przyczyny z logs.rtf i kodu

- Powiadomienia telefoniczne inne niż test były pomijane, jeśli przeglądarka zgłosiła aktywność w ostatnich 30 sekundach. Obejmowało to pytania i akceptacje. Obecność przeglądarki nie jest już kryterium wyciszania telefonu.
- Log zawiera sześć powtórzeń nieobsłużonego odrzucenia `Nested Pi exited before settling (null)` w backendzie RPC subagentów. Promise oczekujący na zakończenie mógł zostać odrzucony podczas `start/getState/prompt`, zanim kod wykonał `await`. Teraz zwraca wynik błędu i jest odczytywany w kontrolowanym `try/catch`. Nie dodano globalnego ignorowania nieobsłużonych błędów ani automatycznego odtwarzania promptów.
- Ostrzeżenia bili o niezdrowym proxy/20-sekundowym timeout są odrębnym problemem dostępności kompresji. Pakiet deklaruje przejście do ruchu bez kompresji; same te wpisy nie dowodzą awarii procesu. Nie zmieniono konfiguracji proxy ani limitów kompresji.
- Brakujące wzorce modeli i ostrzeżenia o peerDependencies są ostrzeżeniami konfiguracji, nie dowodem przyczyny powyższego crasha.

## Telefon

Preferencje w SQLite (`metadata.phone_notifications`) są wspólne dla sparowanych telefonów. Domyślnie włączone: akceptacje, pytania, błędy, stan silnika; gotowe odpowiedzi wyłączone. Zmiana nie wymaga restartu. Zapis tylko dla lokalnego administratora, odczyt dla uwierzytelnionych klientów.

Błędy obejmują awarię/nieudany start sesji, błąd subagenta, komunikat błędu rozszerzenia i błąd odpowiedzi modelu. Powtórzenia tego samego typu/obiektu w sesji są ograniczone do jednej próby na minutę. Telefon otrzymuje ogólny komunikat, bez stderr, promptu, ścieżek i sekretów. Alerty korzystają z istniejącej koperty `notification.test` (z kategorią i źródłowym eventId), którą zainstalowany klient Android już wyświetla; nie jest wymagany nowy APK. Prawdziwy test ignoruje preferencje kategorii. Sukces FCM oznacza przyjęcie wysyłki, nie potwierdzenie wyświetlenia przez telefon.

## ACP

Installer z kopią zapasową dodaje do istniejącego `billion-context/dist/agent/pi-native.js` adapter udostępniający jego własny fleet snapshot. Adapter działa wyłącznie przy `PI_WEB_SESSION_ID`; terminal Pi zachowuje dotychczasowe działanie. Nie zastępuje narzędzi `acp_delegate` ani ich zasad uruchamiania. Nie uruchamia dodatkowych agentów/modelowych tur.

Bridge publikuje delegatów ACP przez ten sam kanał co subagentów RPC. Zakładki mają status i podgląd własnej sesji; rzeczywisty model jest odczytywany z `model_change`. Odczyt ACP jest ograniczony przez realpath do katalogu tymczasowego `acp-delegate`, z limitem 32 MB. Podgląd nie kopiuje historii do sesji nadrzędnej. Widok jest tylko do odczytu; komendy kierowane są nadal do orchestratora. Adapter nowej wersji pakietu musi przejść kontrolę kotwic; nieznany format zatrzymuje instalację zamiast wykonywać przypadkową podmianę.

Referencje wcześniejszych delegatów są odtwarzane z tool-callów i komunikatów ukończenia w gałęzi bieżącej sesji; nie przez przeglądanie wszystkich katalogów tymczasowych. Końcówka ID runu rozróżnia agentów tej samej roli. Odtwarzanie historycznego błędu nie wysyła nowego alertu.

## Ustawienia

Zamiast rozproszonych ustawień Mac i ciasnych zakładek: jeden panel Ustawienia z sekcjami Usługi, Powiadomienia, Modele i scope, Mac i providerzy, Diagnostyka. Procesy, aktualizacje i providerzy są zwijanymi grupami. Panele Pliki/Git/Dodatki/Pluginy zachowują swoje funkcje. Edytor plików pozostaje zamontowany przy otwieraniu ustawień.

## Weryfikacja wdrożenia

Release: `2026-10-07T06-48-32-887Z`. Backup: `~/.pi/agent/backups/pi-web-control-20261007-084924`. Przywrócono tylko wcześniej otwartą BNC-voice3, bez promptu; 1254 wiadomości i wstrzymany cel zachowane. UI wyświetla 9 odtworzonych delegatów ACP z rzeczywistym modelem i własnymi wiadomościami. Trzy próby kategorii approvals/questions/errors przy aktywnej przeglądarce zostały przyjęte przez FCM (1/0 dla każdej). Użytkownik potwierdził otrzymanie komunikatu testowego; testy Androida zastępują się w jednej pozycji. Prawdziwe pytania i akceptacje mają niezależne identyfikatory.
