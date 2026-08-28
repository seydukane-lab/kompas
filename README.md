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
| `test/login-limit.test.js` | hamulec na zgadywanie haseł — per konto i per adres |
| `test/providers.test.js` | scalanie ofert z wielu źródeł, cache per źródło, limity czasu |
| `test/providery-uspione.test.js` | źródła bez kluczy nie zmyślają brakujących danych |
| `test/fx.test.js` | kurs NBP i zachowanie przy awarii NBP |
| `test/http.test.js` | kolejkowanie zapytań do dostawcy i ponawianie po 429 |
| `test/hotelbeds.test.js` | wybór destynacji z krajów/regionów, skład grupy |
| `test/wiek-dzieci.test.js` | wiek dzieci trafia do dostawcy w składzie pokoju |
| `test/destinations.test.js` | kompletność bazy kierunków, dopasowanie po całym słowie |
| `test/oferta-kontrakt.test.js` | wspólny kształt oferty — siatka dla nowych dostawców |
| `test/front.test.js` | składnia inline-scriptu i pułapki panelu |
| `test/server.test.js` | serwer po HTTP: kto gdzie wchodzi, czego nie widzi |

### Audyt na żywych danych

```powershell
npm start        # w drugim oknie
npm run audyt    # albo: KOMPAS_URL=... KOMPAS_EMAIL=... KOMPAS_PASS=... npm run audyt
```

Testy chodzą na atrapach — i słusznie, mają działać bez sieci i kluczy. Dlatego nie
widzą klasy błędów, która bierze się z tego, co **realnie** przychodzi od dostawców:
pola znaczącego co innego w każdym źródle, sumy policzonej dla innego składu,
przemilczanego braku danych. `npm run audyt` przechodzi pięć scenariuszy konsultanta
na uruchomionym panelu i grupuje znaleziska; kończy się kodem 1 przy błędach
oznaczonych jako WYSOKIE, więc da się go wpiąć w CI.

Najważniejszy test w całym zestawie nazywa się `ANTY-PRZEKOLORYZACJA` i pilnuje,
żeby hotel z oceną 9,8 wystawioną przez trzy osoby przegrywał z 8,7 z tysięcy
świeżych opinii. To jest obietnica produktu — musi być weryfikowalna, nie
deklaratywna.

### Co stoi na produkcji

```powershell
npm run produkcja   # czyta i porównuje, niczego nie wdraża
npm run wdroz       # ręczny spust wdrożenia (potrzebuje RENDER_DEPLOY_HOOK w .env)
```

**Repo to nie produkcja.** Auto-deploy na Renderze jest wyłączony celowo — to on
chroni klientów przed każdym commitem, który trafia na `main` w nocy. Skutek uboczny:
kod bywa naprawiony w repo, ma zielony test, a pod adresem, którego używa konsultant,
dalej stoi stara wersja. Zdarzyło się to 28.08.2026 przy suwakach: naprawa leżała
w repo dwa dni, produkcja stała trzy commity wcześniej, a diagnoza poszła w kod,
w którym błędu już nie było.

`npm run produkcja` odpowiada na to jednym przebiegiem: pyta `/healthz` o wersję
i **wymienia z nazwy commity, których pod tym adresem nie ma**. Osobno pokazuje
commity siedzące tylko lokalnie — te nie pojadą nawet po wdrożeniu, bo hook wdraża
czubek gałęzi zdalnej. Kod wyjścia 1, gdy produkcja odstaje.

## Jak to zbudowane

```
server.js                 – serwer Express (klucze API tylko tutaj, nigdy w przeglądarce)
src/ranking.js            – filtry + ranking + wiarygodność opinii + podpowiedzi przy zerze wyników
src/login-limit.js        – hamulec na zgadywanie haseł (per konto i per adres)
src/countries.js          – kraje, regiony i warunki wjazdowe (z datą zebrania danych)
src/destinations.js       – kuratorowana wiedza o kierunkach (dopasowanie po całym słowie)
src/providers/
  index.js                – rejestr dostawców: scalanie ofert, cache per źródło, odświeżanie w tle
  packages.js             – dane demo (działa zawsze, generuje warianty terminów)
  hotelbeds.js            – adapter Hotelbeds (dostępność + treści + zdjęcia)
public/index.html         – panel doradcy (UI + generator skryptów)
scripts/audyt.js          – audyt danych na żywych źródłach (`npm run audyt`)
src/wersje.js             – co stoi na produkcji i czego tam nie ma (`npm run produkcja`)
docs/struktura-oferty-pakietowej.md – kontrakt oferty; czytaj przed dodaniem źródła
```

**Dodanie kolejnego dostawcy** (Ratehawk, TravelGate, feed afiliacyjny PL) = nowy plik
w `src/providers/` z funkcjami `meta`, `isEnabled()`, `search()` + jeden import w `index.js`.
Reszta systemu (ranking, panel, skrypty) zostaje bez zmian.

**Zanim to zrobisz, przeczytaj `docs/struktura-oferty-pakietowej.md`.** Jedna zasada jest
ważniejsza od reszty: **brak danych zostaje brakiem**. Nie wolno wypełniać luk wygodnymi
wartościami domyślnymi — hotel bez podanej odległości od plaży nie ma „300 m", brak
kategorii to nie „3 gwiazdki", a brak informacji o wyżywieniu to nie „śniadania w cenie".
Takie wartości trafiają na kartę i do skryptu sprzedażowego jako fakty o hotelu,
które konsultant czyta klientowi. Pilnuje tego `test/providery-uspione.test.js`.
Suma za pobyt musi nieść `priceTotalPax` — informację, dla ilu osób ją policzono.

## Znane miejsca do dopracowania w Etapie 2

- **Oceny gości (rating/reviews):** podstawowe Content API Hotelbeds nie zwraca ocen
  gości ani ich świeżości. Wymaga dodatku recenzji (np. TripAdvisor przez Hotelbeds)
  lub osobnego źródła. Do czasu podpięcia adapter szacuje ocenę z kategorii i oznacza
  „brak danych o opiniach". To jest kluczowe dla wymogu „po najświeższych ocenach".
- ~~**Przeliczanie ceny:** stały kurs EUR→PLN~~ — **zrobione:** kurs pobierany z API NBP
  (`src/fx.js`, z zachowaniem ostatniego znanego kursu przy awarii NBP), a cena rozbita
  na „za osobę" i „razem", z jawną informacją, dla ilu osób liczona jest suma.
- **Mapowanie kierunków:** `DEST_CODES` w `hotelbeds.js` to punkt startowy (jeden kod
  na kraj). Docelowo autouzupełnianie miast/regionów przez Content API `/locations`.
