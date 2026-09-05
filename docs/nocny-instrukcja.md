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
