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
npm start
```

Otwórz http://localhost:3000 — działa na danych demonstracyjnych.

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
