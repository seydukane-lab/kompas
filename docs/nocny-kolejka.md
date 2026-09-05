# Kolejka zadań dla nocnego agenta

*Ułożone 06.09.2026 na tydzień nieobecności właściciela. Bierz **pierwszą pozycję
bez `[ZROBIONE]`**, jedno zadanie na noc. Po skończeniu dopisz `[ZROBIONE — data,
hash]` i zacommituj razem z pracą.*

**Zanim zaczniesz cokolwiek: sprawdź grepem w kodzie, czy to już nie istnieje.**
Cztery noce z rzędu zeszły na odkrywanie, że zlecone zadanie jest zrobione od tygodnia.

---

## 1. Audyt pokrycia: `src/advisor.js`

**Cel.** `npm run sabotaz` przejechał już `ranking.js`, `http.js`, `audyt-reguly.js`,
`auth.js`, `fx.js`, `wersje.js`, `login-limit.js` i providery. `advisor.js` nie był
sprawdzony ani razu, a to on wydaje pieniądze.

**Jak.** Dla każdej nietrywialnej gałęzi (cache trafiony/nietrafiony, składanie promptu,
liczenie kosztu w `logUsage`, zapis rejestru) uruchom sabotaż i sprawdź, czy któryś test
spada. Kod wyjścia 1 znaczy „ta gałąź nie jest chroniona" — wtedy **dopisz test** i powtórz
sabotaż, aż złapie.

**Uwaga.** Nie wywołuj prawdziwego API. Testy mają działać bez klucza — jeśli musisz
sprawdzić ścieżkę płatną, zrób to na atrapie odpowiedzi, nie na żywym dostawcy.

**Skończone, gdy:** każda sprawdzona gałąź albo ma test, który ją chroni, albo jest
w raporcie wymieniona z powodem, dla którego testu nie warto pisać.

---

## 2. Kontrakt oferty — czy providery naprawdę go dotrzymują

**Cel.** `docs/struktura-oferty-pakietowej.md` opisuje kształt oferty. `test/oferta-kontrakt.test.js`
sprawdza część z tego. Pytanie: czy **każdy** provider (`packages`, `hotelbeds`, `merlinx`,
`travellead`, `wakacje`, `mock`) zwraca komplet pól wymaganych przez `ranking.js` i panel —
a jeśli nie, to czy brak jest **jawny** (`undefined`), czy udawany (`0`, `""`, `false`).

**Dlaczego to ważne.** Udawany brak to najgorszy rodzaj kłamstwa w tym systemie: `beach: 0`
znaczy „plaża przy samym hotelu", a nie „nie wiemy, jak daleko".

**Skończone, gdy:** jest test, który dla każdego providera sprawdza tę granicę, plus raport
z listą pól, przy których któryś provider udaje wiedzę.

---

## 3. Pomiar: ile realnie trwa wyszukiwanie po wszystkich zmianach

**Cel.** Ostatni pomiar wydajności panelu jest z 17.08 (110 kart renderowało się w ~40 ms).
Od tego czasu doszły: promocja wariantów, dwie flagi liczone per oferta, plakietka powrotu,
pokrycie atrybutów. Zmierz, czy coś spuchło.

**Jak.** `npm run czasy` dla źródeł, a dla panelu — pomiar po stronie serwera: czas
`applyFilters` + `promoteMatchingVariant` + `ofertaZFlagami` + `scoreOffer` na realnym
katalogu PL, z rozbiciem na etapy. Skrypt pomiarowy trzymaj w scratchpadzie **poza repo**
i usuń po pomiarze — chyba że warto go zostawić jako `npm run czasy-panelu`, wtedy dopisz
go porządnie z komentarzem.

**Skończone, gdy:** raport ma liczby i wniosek, czy jest problem. Brak problemu to też wynik.

---

## 4. Uczciwość komunikatów panelu — przegląd

**Cel.** Ten projekt tępi zdania, które brzmią jak wynik sprawdzenia, choć niczego nie
sprawdzono (ostatni przykład: „żadna oferta nie ma potwierdzonej informacji" przy cesze,
której **żadne źródło nie przekazuje** — poprawione 04.09 w `3c943f3`).

**Jak.** Przejrzyj wszystkie komunikaty w `public/index.html` (`toast`, `.empty`, `.ac-row`,
`rep-*`, tytuły `title="..."`) i dla każdego odpowiedz: czy to zdanie jest prawdziwe także
wtedy, gdy dane są niepełne? Zbierz podejrzane w raporcie z propozycją brzmienia.

**Nie zmieniaj `public/index.html` sam** — to zadanie jest **przeglądowe**. Zmiany w panelu
robi człowiek, żeby nie kolidować.

**Skończone, gdy:** raport zawiera listę zdań z oceną i propozycją, albo stwierdzenie,
że wszystkie są uczciwe (z wymienieniem sprawdzonych miejsc).

---

## 5. Hotelbeds: co da się zrobić przy wyczerpanej puli

**Cel.** Od dawna każdy audyt pokazuje `403 — wyczerpana pula zapytań o dostępność`.
Panel obsługuje to poprawnie (mówi wprost, że lista jest niepełna), ale warto wiedzieć,
czy da się z tego źródła wyciągnąć cokolwiek mimo limitu.

**Trop.** Słowniki Hotelbeds (`types/...`, np. facilities) **nie zużywają puli availability**
i działają mimo 403 — to już kiedyś sprawdzono. Pytanie: czy da się nimi wzbogacić dane,
których dziś brakuje (np. udogodnienia dla osób z niepełnosprawnością — cecha, o której
**żadne** źródło dziś nie ma wiedzy).

**Ostrożnie.** Nie wywołuj availability. Nie zmieniaj kluczy. Jeśli słowniki wymagają
wywołań, policz najpierw, ile ich będzie.

**Skończone, gdy:** raport mówi, czy to wykonalne, jakim kosztem i co konkretnie dałoby
się uzupełnić. Implementacja tylko jeśli jest tania i bezpieczna.

---

## 6. Dostępność panelu z klawiatury

**Cel.** Panel to narzędzie pracy — konsultant siedzi w nim cały dzień. Sprawdź, czy da się
przejść całą ścieżkę (wpisanie kryteriów → wyszukanie → otwarcie szczegółów → odłożenie do
koszyka → wydruk) **bez myszy**, i czy fokus nie ginie po otwarciu modali.

**Jak.** Statycznie: czy każdy interaktywny element jest `<button>`/`<a>`, czy ma `aria-*`
tam, gdzie trzeba, czy modale przejmują i oddają fokus (`d5ed73e` twierdzi, że tak — sprawdź,
czy nadal). Testem: rozszerz `test/panel-runtime.test.js` o przypadki, które da się sprawdzić
bez przeglądarki.

**Skończone, gdy:** raport wymienia miejsca, gdzie klawiatura nie wystarcza, w kolejności
od najbardziej blokujących.

---

## 7. Przegląd `data/` i tego, co przeżywa restart

**Cel.** Na produkcji (Render free) dysk jest **efemeryczny** — wszystko w `data/` znika przy
wdrożeniu. Dotyczy to bazy kont, cache raportów ETA i rejestru wydatków. Sprawdź, co jeszcze
tam trafia i czy coś z tego jest cicho zakładane jako trwałe.

**Jak.** Grep po zapisach do `data/`, potem dla każdego pliku odpowiedz: co się stanie po
jego zniknięciu? Czy kod to przewiduje, czy założy, że plik jest?

**Skończone, gdy:** raport ma listę „co znika i z jakim skutkiem", a miejsca zakładające
trwałość są wskazane z numerami linii.

---

## Gdy skończą się zadania

Nie wymyślaj sobie pracy w kodzie produkcyjnym. Zrób pomiar czegoś, czego jeszcze nie
mierzyliśmy, albo przejrzyj kolejny moduł sabotażem i zgłoś luki. **Nic nie robić i uczciwie
to napisać jest lepsze niż zmiana wprowadzona po to, żeby coś było w raporcie.**
