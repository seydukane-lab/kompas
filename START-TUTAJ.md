# Kompas — od czego zacząć w nowej sesji

*Zapisane 04.09.2026. Ten plik jest w repo, więc widzi go też nocny agent.*

## Stan

`origin/main` = **`3c943f3`**, **458 testów**, wszystkie zielone, `npm run audyt`
kończy się **„Bez anomalii w badanych scenariuszach"**. Drzewo robocze czyste.

```powershell
npm test          # 458 testów
npm run audyt     # wymaga uruchomionego npm start
npm run produkcja # co stoi pod publicznym adresem i czego tam nie ma
npm run sabotaz   # sprawdza, czy test czegokolwiek pilnuje
```

## ⏱ ZRÓB TO PRZED WYJAZDEM (5 minut) — bez tego nocny nie wypchnie nic

Nocny ma już kolejkę zadań (`docs/nocny-kolejka.md`, 7 pozycji) i skrypt
`npm run nocny-push`. Brakuje mu **jednej rzeczy: tokenu**.

**1. Wygeneruj token** — GitHub → Settings → Developer settings →
Personal access tokens → **Fine-grained tokens** → Generate new token:

- **Repository access:** Only select repositories → `seydukane-lab/kompas`
- **Permissions → Repository permissions → Contents:** `Read and write`
- reszta uprawnień: **No access**
- ważność: ustaw na 30 dni (wystarczy na tydzień z zapasem)

**2. Wklej go do konfiguracji nocnego w chmurze** jako zmienną `GITHUB_TOKEN`.
Nie wklejaj go do repo, do `.env` ani do rozmowy — skrypt go nie wypisuje
i tak ma zostać.

**3. Dopisz jedno zdanie do instrukcji nocnego** (tam, gdzie ustawiasz routine):

> Zadanie na dziś bierz z `docs/nocny-kolejka.md` — pierwsza pozycja bez
> `[ZROBIONE]`. Zasady pracy: `docs/nocny-instrukcja.md`. Na koniec, jeśli masz
> commity, uruchom `npm run nocny-push`.

To zastępuje wpisywanie zadania na sztywno w konfiguracji — kolejka jest w repo,
więc nie trzeba tam wracać przez cały tydzień.

**Co zobaczysz po powrocie:** gałęzie `nightwork-RRRR-MM-DD`, jedna na noc.

```powershell
git fetch
git branch -r | Select-String nightwork          # co przyszło
git log --oneline origin/main..origin/nightwork-2026-09-08
git merge origin/nightwork-2026-09-08            # albo cherry-pick wybranych
```

Nic nie wleci na `main` samo — skrypt tego pilnuje i mają to zabezpieczone testy.

**Opcjonalnie, ta sama chwila:** wklej `RENDER_DEPLOY_HOOK` do `.env`, to po
powrocie wdrożysz produkcję jedną komendą zamiast klikać w panelu.

## Trzy rzeczy czekają na Ciebie — żadnej nie zrobię sam

**1. Produkcja jest 10 commitów w tyle** (stoi na `fec8d11`).
`npm run wdroz` potrzebuje `RENDER_DEPLOY_HOOK` w `.env` — adres bierzesz z
Render → usługa `kompas` → Settings → Deploy Hooks. Bez tego zostaje Manual Deploy
w panelu. Świadomie nie dotykam tego sekretu.

**2. Commit CI siedzi na gałęzi `ci-czeka-na-token`**, bo token `gh` nie ma zakresu
`workflow`. Trzy komendy i temat znika:

```powershell
gh auth refresh -h github.com -s workflow
git cherry-pick ci-czeka-na-token; git push origin main
git branch -D ci-czeka-na-token
```

**3. Nocny agent** — ma już `npm run nocny-push` i kolejkę zadań. Brakuje tylko
tokenu: patrz sekcja „ZRÓB TO PRZED WYJAZDEM" wyżej.

## Twardy termin

**Kredyt API 85 € przepada 19.09.2026.** Zostaje ~88 USD ≈ 440 raportów ETA
(zmierzone: ~0,2 USD i ~70 s za raport). Hamulec wydatków działa —
`ADVISOR_LIMIT_DZIEN_USD` domyślnie 5, łączny wyłączony.

## Backlog funkcjonalny jest pusty

Wszystkie cztery pozycje z listy nocnego zamknięte albo świadomie odłożone.
Otwarte zostaje to, co nie jest kodem: Cloudflare i własna domena, prawnik
(RODO/IP przed pierwszym klientem), pierwszy realny użytkownik, ETA OS jako
rozbudowa. Plus dwie rzeczy narzędziowe, których nie wziąłem bez Ciebie:
**Playwright** (300 MB i nowa zależność w projekcie, który celowo trzyma ich
minimum) oraz **backlog #2 nocnego** — jego opisu nie dało się jednoznacznie
odczytać z kodu, a nie chciałem zgadywać intencji.

## Co weszło 28.08–04.09

| commit | co |
|---|---|
| `eb69ed3` | audyt sprawdza filtry wariantowe |
| `fec8d11` | paski przewijania przestały wyglądać jak z innej aplikacji |
| `a954548` | formularz „dane do rezerwacji" — dane **nie** przechodzą przez Kompas |
| `20f5891` | przywrócone „Do wysłania" (wyłączone 15.08) |
| `1477c22` | plakietka „powrót poza wpisanym terminem" |
| `047992e` | `npm run produkcja` |
| `33e4d49` | `npm run sabotaz` + pierwsza luka, którą znalazł |
| `04add89` | miękki limit czasu źródła wreszcie chroniony testem |
| `05dd148` | hamulec wydatków ETA; testy przestały wołać płatne API |
| `b751b52` | ściągawka `/oznaczenia.html` dla konsultanta |
| `3c943f3` | audyt nie myli braku wiedzy źródła z podejrzanym filtrem |

## Czego nie wolno

Służbowy laptop, baza Merlina, żadnych pism ani prezentacji przed prawnikiem.
Nie zgłaszać Kompasa przez wewnętrzny program projektów wakacje.pl. Provider
`src/providers/wakacje.js` (nieoficjalny endpoint) zostaje **lokalny** — na
produkcji nie ma jego klucza i tak ma zostać.
