# Nocny agent — jak pracować w tym repozytorium

*Napisane 06.09.2026, gdy właściciel wyjechał na tydzień. Ten plik jest w repo,
więc widzisz go z czystego klonu — czytaj go przed każdą sesją.*

## Start

```bash
git fetch && git checkout -B nightwork origin/main
npm install
npm test          # musi być zielono ZANIM cokolwiek ruszysz
```

Jeśli testy są czerwone na starcie — **nie naprawiaj na ślepo i nic nie pushuj**.
Opisz to w raporcie jako pierwsze zdanie. Czerwone `main` znaczy, że coś poszło nie
tak po stronie człowieka i on musi o tym wiedzieć, zanim dołożysz swoje zmiany.

## Skąd bierzesz zadanie

Z `docs/nocny-kolejka.md` — **pierwsza pozycja bez znacznika `[ZROBIONE]`**.
Jedno zadanie na noc. Gdy skończysz, dopisz `[ZROBIONE — data, hash]` w tym pliku
i zacommituj to razem z pracą.

Zanim zaczniesz, **sprawdź w kodzie, czy zadanie nie jest już zrobione** — grepem,
nie z pamięci. Zdarzyło się to cztery noce z rzędu: instrukcja zlecała coś, co
istniało od tygodnia. Jeśli jest zrobione, oznacz je jako `[ZROBIONE]` z hashem
commita, który to wprowadził, i weź następne.

## Push — masz do niego prawo, ale jedną drogą

```bash
npm run nocny-push
```

Skrypt sam sprawdzi, że nie jesteś na `main`, że drzewo jest czyste, że testy są
zielone i że w ogóle masz co wypchnąć. Wypchnie na gałąź `nightwork-RRRR-MM-DD`.

**Nigdy nie pushuj ręcznie i nigdy na `main`.** Twoja praca ma czekać na gałęzi do
przejrzenia — to nie jest ograniczenie zaufania, tylko sposób, żeby człowiek mógł
rano zobaczyć różnicę, zamiast odtwarzać ją z opisu.

Gdy noc zeszła na pomiar i nie ma commitów — to normalne. Skrypt odmówi, wystarczy
raport.

## Zasady, które obowiązują zawsze

1. **Sabotaż jest jedynym dowodem, że test czegokolwiek pilnuje.** Po dopisaniu
   testu do nietrywialnej reguły uruchom `npm run sabotaz` i pokaż wynik w raporcie.
   Sabotaż, który **cicho nie zaszedł**, wygląda identycznie jak sukces — dlatego
   skrypt odmawia, gdy wzorzec nie trafia. Kod wyjścia 1 („przeszedł niezauważony")
   to znalezisko, nie awaria narzędzia.
2. **Brak danych zostaje brakiem danych.** Nie wypełniaj luk wygodnymi wartościami
   domyślnymi. Hotel bez podanej odległości od plaży nie ma „300 m".
3. **Nie tykaj `public/index.html` w nocy**, chyba że zadanie mówi wprost inaczej —
   to jedyny plik, przy którym realnie kolidujemy z pracą człowieka.
4. **Nie ruszaj `src/providers/wakacje.js`** ani niczego, co dotyczy kluczy API.
5. **Testy nie mogą wołać płatnego API.** Serwer w `test/server.test.js` startuje
   z pustym `ANTHROPIC_API_KEY` — nie usuwaj tego. Jedno wywołanie kosztuje ~0,2 USD,
   a kredyt jest skończony.
6. **Komentuj PO CO, nie CO.** Ten projekt trzyma w komentarzach powody decyzji
   i pomiary, na których je oparto — one przeżywają dłużej niż kod.

## Raport

Trzymaj dotychczasowy format (stan zastany → co zrobiłem → wynik audytu → sabotaż →
testy → commit → patch → znalezione i nienaprawione). Jeśli pushnąłeś, podaj nazwę
gałęzi. Jeśli czegoś nie zrobiłeś, napisz dlaczego — to jest ważniejsze niż lista
rzeczy, które się udały.

## Narzędzia, które masz

| komenda | do czego |
|---|---|
| `npm test` | 458 testów, bez sieci i bez kluczy |
| `npm run audyt` | audyt na żywych danych (wymaga `npm start` w tle) |
| `npm run sabotaz` | sprawdza, czy test czegokolwiek pilnuje |
| `npm run produkcja` | co stoi pod publicznym adresem i czego tam nie ma |
| `npm run czasy` | pomiar czasów odpowiedzi źródeł |
| `npm run nocny-push` | jedyna droga wypchnięcia twojej pracy |

---

# Wiedza przeniesiona z promptu w chmurze (06.09.2026)

*Do dziś te zasady żyły wyłącznie w konfiguracji agenta na claude.ai — czyli nikt
poza właścicielem nie mógł ich przeczytać ani poprawić, a zmiana wymagała wejścia
do panelu. Teraz są w repo: agent czyta je z klonu, a poprawia się je commitem.*

## Czym jest Kompas (kontekst dla agenta startującego bez pamięci)

Node 24 + Express. Backend w `src/` (`providers/`, `ranking.js`, `auth.js`,
`login-limit.js`, `db.js`, `fx.js`, `http.js`, `audyt-reguly.js`, `sabotaz.js`,
`advisor-limit.js`, `wersje.js`, `czasy-zrodel.js`) oraz `server.js`.
Front: **jeden plik** `public/index.html`, plus strony `login.html`,
`o-serwisie.html`, `oznaczenia.html`, `dane-do-rezerwacji.html`.

- Panel wymaga logowania: `npm run user:add -- test@local.test "Test" haslo12345 admin`
- Kompas to narzędzie **konsultanta**, nie agregat dla turystów.
- **ANTY-PRZEKOLORYZACJA:** nigdy nie pokazuj danych, których nie ma. Brak danych
  NIE odsiewa oferty i NIE obniża jej pozycji.
- Jedyne źródło dające dziś oferty to katalog PL (ceny w złotówkach). Hotelbeds ma
  wyczerpaną pulę (403), TravelLead i MerlinX nie mają kluczy, a `providers/wakacje.js`
  nie istnieje w kontenerze. **Zadanie dotyczące źródła, które nie odpowiada, jest
  pracą w próżni** — powiedz to wprost i weź następną pozycję z kolejki.

## Czego NIE wolno tykać

- ⚠️ **Nie „poprawiaj" wzorców `\r?\n` w testach ani komentarzy o CRLF.** W kontenerze
  (Linux) checkout daje LF, więc `grep -cU $'\r'` pokaże 0 i komentarz będzie
  **wyglądał** na nieaktualny. U właściciela (Windows) te same pliki mają CRLF.
- **`public/index.html`** — właściciel pracuje na nim równolegle. Nie tykaj, chyba że
  zadanie mówi wprost inaczej.
- `test/panel-runtime.test.js` — możesz wołać, nie przebudowuj. Bez `activeCountries`
  render() wpada w gałąź „Zacznij od kierunku"; atrapa musi rozróżniać elementy po `id`.
- `src/advisor.js`, `src/eta-os-prompt.js`, `src/providers/wakacje.js` — **gitignorowane**,
  nie odtwarzaj. `/api/advisor` bez klucza zwraca 503 i to jest normalne.
- `deriveTags` (hotelbeds.js), `clientFit()` (ranking.js) i jego bliźniak w index.html.
- `etaTop`, `ustawProgETA()`, `etaValue()` w index.html — `(h.stars||3)/5` jest tam **celowo**.
- `BOARD_MAP`, `mapBoard()`, `mapStars()`, `buildPaxes()`, `normalizeRoomsInput()` (hotelbeds.js).
- `buildVariants()`, `rng()`, `historiaCeny()`, `opcjePokoju()` (packages.js) — możesz czytać.
- **Mają testy regresji i sabotaże — wołaj, nie przebudowuj:** `matchesAnyVariant`,
  `promoteMatchingVariant`, `activeVariantPredicates`, `VARIANT_FIELDS`, `variantWithinDates`,
  `filtrRozproszony`, `powrotPoOknie`, `ofertaZFlagami`, `offerGroupTotal`, `isGroupTotalExact`,
  `trustLabel`, `podpowiedziRozluznienia`, `ZNANE_ATRYBUTY`, `znanyAtrybut`, `attributeCoverage`
  (ranking.js); `parseChildAges`, `oknoTerminu` (hotelbeds.js); cały wyścig miękkiego limitu
  (providers/index.js); `refreshRate`, `ensureRate`, `fxStatus` (fx.js); `podejrzaneZero`,
  `ocenObietnice`, `filtrPrzecieka`, `filtrBezPotwierdzen`, `rozproszenieZWariantow`,
  `plakietkiRozproszenia`, `ocenFiltrWariantowy` (audyt-reguly.js); `analizaProgu`,
  `najwiekszaPrzerwa` (czasy-zrodel.js); cały `src/login-limit.js`; `src/wjazd-monitor.js`;
  `normalize()` w travellead.js i merlinx.js; cały `src/sabotaz.js` i `src/advisor-limit.js`.
- Nie dotykaj skryptu sprzedażowego. Nie dodawaj rejsów ani objazdowych. Nie włączaj
  auto-deployu. Nie wymyślaj źródeł danych.
- **Nigdy do repo:** sekrety, `.env*`, `data/`, `inspiracje/`, `wakacje.js`, `advisor.js`,
  `eta-os-prompt.js`.

## Pułapki, na których już się przewracano

- **Końcówki linii.** W regexach i podmianach na treść plików zawsze `\r?\n`, nigdy samo
  `\n`. Wzorzec wieloliniowy z gołym `\n` **nie trafi** w plik z CRLF i podmiana cicho
  nie zajdzie — a sabotaż będzie wyglądał na „test przeszedł". `npm run sabotaz` robi to
  za ciebie i odmawia, gdy wzorzec nie trafia.
- **Git Bash na Windows** zamienia argument zaczynający się od `/` na ścieżkę Windows.
  Przy wzorcach ze ścieżką: `MSYS_NO_PATHCONV=1`.
- **Pomiar czasu przez `/api/search` mierzy dostawców, nie twoją zmianę.** Miękki limit
  ucina czekanie na 2,5 s, a cache oddaje wynik w 0 ms. Mierz funkcje wprost.
- **Regex wycinający funkcję z index.html potrafi sięgnąć poza nią.** Po wycięciu asertuj,
  że wycinek nie zawiera nazwy następnej funkcji.
- **Powód albo flaga, która zgaduje, jest tym samym błędem co zgadywanie danych.**
- **Polski cudzysłów zamykający w stringu JS kończy string** i wywala cały plik testowy
  z przebiegu — liczba testów cicho maleje. Uwaga też na ASCII-owy cudzysłów wewnątrz
  polskiego cytatu.
- **Asercja negatywna potrafi złapać własny komentarz.**
- **Obiekty ofert krążą przez referencje** ze wspólnego cache'u. Pole zależne od kryteriów
  dopisuj wyłącznie na kopii (`{...o, pole:true}`) — patrz `ofertaZFlagami`.
- **Test, który sam się wyłącza, jest gorszy niż jego brak.** Wyjątek: plik gitignorowany,
  którego fizycznie nie ma w klonie (`advisor.js`) — wtedy `t.skip()` z powodem.
- **Asercja na polu, którego obiekt nie zwraca, przechodzi zawsze.**
- Testując warunek, asertuj **cały** warunek razem z flagą, nie sam skutek.
- **Lista pól w `cartSnap()` jest ręczna** — każde nowe pole oferty trzeba tam dopisać
  jawnie, inaczej ginie w drodze do wydruku dla klienta i do doradcy ETA.
- **Testy nie mogą wołać płatnego API.** `test/server.test.js` startuje serwer z pustym
  `ANTHROPIC_API_KEY`. Nie usuwaj tego.
