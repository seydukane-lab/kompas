# 🧭 Kompas — wyszukiwarka ofert wakacyjnych

Panel dla biura podróży: wyszukiwanie hoteli po realnych kryteriach, ranking z filtrem
„anty-przekoloryzacja" (wiarygodność opinii) i generator skryptów sprzedażowych
(cecha → korzyść → obraz wakacji).

Architektura jest przygotowana pod **legalne** źródła danych: zdjęcia i oferty przychodzą
z API dostawców wraz z licencją na wyświetlanie — **nic nie jest scrapowane**.

## Szybki start (tryb demo — bez kluczy)

```powershell
cd C:\Users\Wiktor\kompas
npm install
npm run user:add -- ty@biuro.pl "Twoje Imię" mocneHaslo123 admin
npm start
```

Otwórz http://localhost:3000 — zobaczysz ekran logowania, a po zalogowaniu panel
na danych demonstracyjnych.

## Konta konsultantów

Panel nie jest stroną publiczną — bez zalogowania widać wyłącznie ekran logowania.
Każdy konsultant ma własne konto, a **koszyk odłożonych ofert jest przypisany do konta**,
nie do przeglądarki: po przesiadce na inne stanowisko oferty są na miejscu, a dwie osoby
przy jednym komputerze nie mieszają sobie propozycji.

```powershell
npm run user:add  -- jan@biuro.pl "Jan Kowalski" haslo1234   # nowy konsultant
npm run user:add  -- szef@biuro.pl "Anna Nowak" haslo1234 admin
npm run user:list                                            # kto ma dostęp
npm run user:pass -- jan@biuro.pl noweHaslo123               # reset hasła
npm run user:off  -- jan@biuro.pl                            # odcięcie dostępu
npm run user:on   -- jan@biuro.pl
```

Role: `consultant` (praca w panelu) i `admin` (dodatkowo `/api/users` — zakładanie kont,
reset haseł, wyłączanie dostępu). Zmiana hasła i wyłączenie konta natychmiast unieważniają
otwarte sesje. Hasła są hashowane scryptem, sesja to token w ciasteczku `HttpOnly`.

Konta, sesje i koszyki leżą w SQLite (`data/kompas.db`, katalog jest w `.gitignore`).
Baza korzysta z wbudowanego modułu `node:sqlite`, więc nie instaluje żadnych dodatkowych
zależności (i nie wymaga kompilacji), ale **wymaga Node ≥ 24** — na Node 22 moduł jest
jeszcze schowany za flagą `--experimental-sqlite`.

## Tryb produkcyjny (prawdziwe hotele + zdjęcia)

1. Załóż darmowe konto na https://developer.hotelbeds.com → aplikacja „APItude" →
   dostaniesz **API key** i **secret** (środowisko testowe/sandbox).
2. Skopiuj `.env.example` jako `.env` i wklej klucze:
   ```
   HOTELBEDS_API_KEY=twoj_klucz
   HOTELBEDS_SECRET=twoj_secret
   HOTELBEDS_ENV=test
   ```
3. `npm start` — baner w panelu zmieni się na „Dane na żywo", pojawią się prawdziwe zdjęcia.

## Testy

```powershell
npm test          # cały zestaw
npm run test:watch  # w trybie ciągłym podczas pracy
```

Wbudowany runner Node (`node --test`) — zero zależności, zero konfiguracji.
Testy **nie wymagają żadnych kluczy API ani dostępu do sieci**: kurs NBP jest
podmieniany, a dostawcy bez kluczy po prostu się nie włączają. Dzięki temu ten
sam zestaw przechodzi na czystej maszynie i w CI.

| Plik | Czego pilnuje |
|---|---|
| `test/ranking.test.js` | anty-przekoloryzacja, scoring, sortowanie, wszystkie filtry |
| `test/auth.test.js` | hasła, sesje, role, izolacja koszyków, konto startowe |
| `test/providers.test.js` | scalanie ofert z wielu źródeł, cache, limity czasu |
| `test/fx.test.js` | kurs NBP i zachowanie przy awarii NBP |
| `test/http.test.js` | kolejkowanie zapytań do dostawcy i ponawianie po 429 |
| `test/hotelbeds.test.js` | wybór destynacji z krajów/regionów, skład grupy |
| `test/destinations.test.js` | kompletność bazy kierunków i danych krajów |
| `test/server.test.js` | serwer po HTTP: kto gdzie wchodzi, czego nie widzi |

Najważniejszy test w całym zestawie nazywa się `ANTY-PRZEKOLORYZACJA` i pilnuje,
żeby hotel z oceną 9,8 wystawioną przez trzy osoby przegrywał z 8,7 z tysięcy
świeżych opinii. To jest obietnica produktu — musi być weryfikowalna, nie
deklaratywna.

## Jak to zbudowane

```
server.js                 – serwer Express (klucze API tylko tutaj, nigdy w przeglądarce)
src/ranking.js            – filtry + ranking + wskaźnik wiarygodności opinii (wspólne)
src/providers/
  index.js                – rejestr dostawców (scala wyniki z wielu źródeł)
  mock.js                 – dane demo (działa zawsze)
  hotelbeds.js            – adapter Hotelbeds (dostępność + treści + zdjęcia)
public/index.html         – panel doradcy (UI + generator skryptów)
```

**Dodanie kolejnego dostawcy** (Ratehawk, TravelGate, feed afiliacyjny PL) = nowy plik
w `src/providers/` z funkcjami `meta`, `isEnabled()`, `search()` + jeden import w `index.js`.
Reszta systemu (ranking, panel, skrypty) zostaje bez zmian.

## Znane miejsca do dopracowania w Etapie 2

- **Oceny gości (rating/reviews):** podstawowe Content API Hotelbeds nie zwraca ocen
  gości ani ich świeżości. Wymaga dodatku recenzji (np. TripAdvisor przez Hotelbeds)
  lub osobnego źródła. Do czasu podpięcia adapter szacuje ocenę z kategorii i oznacza
  „brak danych o opiniach". To jest kluczowe dla wymogu „po najświeższych ocenach".
- **Przeliczanie ceny:** obecnie stały kurs EUR→PLN i uproszczona cena za pobyt.
  W produkcji: kurs z API NBP + jasne rozbicie na cenę za osobę / za pobyt.
- **Mapowanie kierunków:** `DEST_CODES` w `hotelbeds.js` to punkt startowy (jeden kod
  na kraj). Docelowo autouzupełnianie miast/regionów przez Content API `/locations`.
