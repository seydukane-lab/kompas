// ============================================================
//  Składnia i higiena frontu
//
//  Cały panel to jeden plik z wielkim inline'owym skryptem. Pojedynczy zły
//  cudzysłów wywalił już kiedyś CAŁĄ stronę przy zdrowym backendzie — i żaden
//  test serwera tego nie widzi, bo serwer działa bez zarzutu, tylko przeglądarka
//  nie umie wykonać skryptu. Ten plik zamyka tę dziurę.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRONY = ["public/index.html", "public/login.html", "public/o-serwisie.html"];

function wczytaj(plik) {
  return readFileSync(join(ROOT, plik), "utf8");
}

function skrypty(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

test("inline'owe skrypty na każdej stronie są poprawne składniowo", () => {
  const dir = mkdtempSync(join(tmpdir(), "kompas-front-"));
  try {
    for (const plik of STRONY) {
      const bloki = skrypty(wczytaj(plik));
      for (const [i, kod] of bloki.entries()) {
        const sciezka = join(dir, `${plik.replace(/[\/.]/g, "_")}_${i}.js`);
        writeFileSync(sciezka, kod, "utf8");
        try {
          execFileSync(process.execPath, ["--check", sciezka], { stdio: "pipe" });
        } catch (err) {
          const opis = (err.stderr || Buffer.from("")).toString().split("\n").slice(0, 6).join("\n");
          assert.fail(`błąd składni w ${plik}, blok ${i + 1}:\n${opis}`);
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("każda strona ma dokładnie tyle otwarć co zamknięć tagu script", () => {
  for (const plik of STRONY) {
    const html = wczytaj(plik);
    const otwarcia = (html.match(/<script[\s>]/g) || []).length;
    const zamkniecia = (html.match(/<\/script>/g) || []).length;
    assert.equal(otwarcia, zamkniecia, `${plik}: ${otwarcia} otwarć i ${zamkniecia} zamknięć`);
  }
});

test("reguła chroniąca atrybut hidden nie zniknęła", () => {
  // Element z atrybutem `hidden` ORAZ regułą display:flex/grid jest widoczny
  // mimo hidden — ta pułapka wystąpiła w tym projekcie już dwa razy
  // (rozwijane regiony, modal porównywarki). Globalna reguła to naprawia.
  const html = wczytaj("public/index.html");
  assert.match(html, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    "brak globalnej reguły [hidden]{display:none!important} — modale zaczną się pokazywać same");
});

test("panel nie odwołuje się do zewnętrznych skryptów", () => {
  // Panel ma działać w biurze bez zależności od cudzych serwerów — i bez
  // wysyłania czegokolwiek o ofertach klienta na zewnątrz.
  for (const plik of STRONY) {
    const html = wczytaj(plik);
    const zewnetrzne = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]);
    const obce = zewnetrzne.filter((s) => /^https?:\/\//.test(s));
    assert.deepEqual(obce, [], `${plik} ładuje obce skrypty: ${obce.join(", ")}`);
  }
});

test("front woła API przez wrapper obsługujący wygaśnięcie sesji", () => {
  // Gołe fetch("/api/...") ominęłoby przekierowanie na ekran logowania i przy
  // wygasłej sesji konsultant zobaczyłby po prostu „nic się nie dzieje".
  const html = wczytaj("public/index.html");
  const gole = [...html.matchAll(/fetch\("\/api\/([a-z/-]+)/g)].map((m) => m[1]);
  const dozwolone = gole.filter((s) => s.startsWith("auth/"));
  assert.deepEqual(
    gole.filter((s) => !dozwolone.includes(s)),
    [],
    "znaleziono gołe fetch do /api poza endpointami logowania — użyj api()"
  );
});

test("ekran logowania nie zdradza, czy konto istnieje", () => {
  const html = wczytaj("public/login.html");
  assert.ok(!/nie ma takiego konta|konto nie istnieje|nieprawid[łl]owy login/i.test(html),
    "komunikat rozróżniający zły login od złego hasła ułatwia zgadywanie kont");
});

test("strona „O serwisie” nie obiecuje prowizji ani afiliacji", () => {
  // Po odmowie TravelLead (28.07.2026) Kompas nie jest serwisem afiliacyjnym.
  // Deklaracja o prowizji byłaby nieprawdziwa i szkodziłaby rozmowie w firmie.
  const html = wczytaj("public/o-serwisie.html");
  assert.ok(!/prowizj/i.test(html), "strona nadal deklaruje prowizję za polecenie");
});

test("czekanie na analizę ETA AI ma czytelny stan w miejscu raportu, nie tylko na przycisku", () => {
  // Zmierzone 30.07.2026: jedno wywołanie ETA trwa ~104 s (research każdego
  // hotelu w sieci). Sam zmieniony tekst przycisku łatwo przeoczyć — stan
  // musi być widoczny w #repBody, z rosnącym licznikiem czasu (uczciwym —
  // bez udawania procentów, których backend nie zna).
  const html = wczytaj("public/index.html");
  assert.match(html, /rep-ai-wait/, "brak widocznego bloku oczekiwania w treści raportu");
  assert.match(html, /repAiClock/, "brak rosnącego licznika czasu podczas analizy AI");
  const blokOczekiwania = html.match(/repBody\.innerHTML=[\s\S]{0,600}?rep-ai-wait[\s\S]{0,600}/)?.[0] || "";
  assert.ok(!/\d+\s?%/.test(blokOczekiwania),
    "pasek oczekiwania nie może udawać fałszywego procentu postępu");
});

test("błąd analizy ETA AI zostaje na ekranie, nie tylko w znikającym toaście", () => {
  // Po ~2 minutach czekania doradca łatwo przegapi toast, który znika po ~2 s
  // (patrz `toast()`) — błąd musi trafić do #repBody i tam zostać.
  const html = wczytaj("public/index.html");
  assert.match(html, /showAdvisorError/, "brak funkcji renderującej trwały błąd analizy AI w treści raportu");
  assert.match(html, /rep-ai-err/, "brak stylu/bloku błędu w treści raportu");
});

test("szczegóły oferty mają zakładki (wzorem MerlinX) i zakładka bez danych się nie renderuje", () => {
  const html = wczytaj("public/index.html");
  for (const etykieta of ["Opis obiektu", "Pokoje", "Położenie i dojazd", "Wyżywienie"]) {
    assert.ok(html.includes(etykieta), `brak zakładki „${etykieta}” w openDetail()`);
  }
  // Pusta zakładka sugerowałaby brak informacji tam, gdzie jej po prostu nie
  // pobraliśmy — TABS musi być filtrowane po tym, czy ma choć jeden wiersz.
  assert.match(html, /TABS\s*=\s*\[[\s\S]*?\]\.filter\(function\(t\)\{return t\.html;\}\)/,
    "lista zakładek nie jest filtrowana po obecności danych");
});

test("formularz rezerwacji został usunięty i nie wraca tylnymi drzwiami", () => {
  // Decyzja właściciela z 04.08: „za dużo roboty, i tak mamy szablony do wysłania".
  // Powód głębszy: formularz zbierał dane osobowe klienta, czyli ciągnął za sobą
  // RODO, którego projekt świadomie nie rusza przed konsultacją prawną.
  // ZOSTAJE „Do wysłania" (openSend) — to szablon oferty, zupełnie inna funkcja,
  // która żadnych danych osobowych nie zbiera. Łatwo je pomylić, stąd ostatnia asercja.
  const html = wczytaj("public/index.html");

  for (const znacznik of ["bookModal", "openBookForm", "renderBookPax", "bookOrderText",
                          "bookPaxRowHtml", "data-book", "data-detbook", "bkName", "bkGenerate"]) {
    assert.ok(!html.includes(znacznik), `formularz rezerwacji wrócił — znaleziono „${znacznik}”`);
  }

  assert.ok(html.includes("openSend"),
    "„Do wysłania” nie może zniknąć razem z formularzem — to szablon oferty, nie zbieranie danych");
});

test("etykiety udogodnień w szczegółach oferty pokrywają dokładnie te same kody co mapAmenities", () => {
  // Rozjazd tutaj = kod udogodnienia bez etykiety renderuje się jako surowy
  // klucz (np. "sporty-wodne" zamiast "🏄 Sporty wodne") albo znika po cichu.
  const hbSrc = readFileSync(join(ROOT, "src/providers/hotelbeds.js"), "utf8");
  const wzorzec = hbSrc.match(/AMENITY_PATTERNS\s*=\s*\{([\s\S]*?)\n\};/)?.[1] || "";
  const kodyBackend = [...wzorzec.matchAll(/(?:^|\n)\s*(?:"([a-z-]+)"|([a-z-]+)):/g)].map((m) => m[1] || m[2]).sort();
  assert.ok(kodyBackend.length >= 8, "nie udało się wyciągnąć kodów z AMENITY_PATTERNS — zmieniła się struktura?");

  const html = wczytaj("public/index.html");
  const etykiety = html.match(/AMENITY_LABELS\s*=\s*\{([\s\S]*?)\};/)?.[1] || "";
  const kodyFrontu = [...etykiety.matchAll(/(?:^|,)\s*(?:"([a-z-]+)"|([a-z-]+)):/g)].map((m) => m[1] || m[2]).sort();

  assert.deepEqual(kodyFrontu, kodyBackend,
    "AMENITY_LABELS we froncie musi mieć dokładnie te same kody co AMENITY_PATTERNS w hotelbeds.js");
});

test("każdy modal panelu zamyka się klawiszem Escape", () => {
  // Konsultant przyzwyczaja się, że Escape działa — modal, który go ignoruje,
  // wygląda jak zawieszony. Dwa modale („Do wysłania", „Wspólny wyjazd") długo
  // tego nie miały, mimo że pozostałe pięć tak. Ten test pilnuje, żeby nowy
  // modal nie dołączył do wyjątków.
  const html = readFileSync(join(ROOT, "public/index.html"), "utf8");

  const modale = [...html.matchAll(/<div class="cmp-modal" id="([^"]+)"/g)].map((m) => m[1]);
  // Próg jest absolutny, nie relatywny — po każdej zmianie liczby modali trzeba go
  // przejrzeć. Spadł z 7 na 6, gdy zniknął formularz rezerwacji.
  assert.ok(modale.length >= 6, `spodziewano się co najmniej 6 modali, jest ${modale.length}`);

  // Obsługa bywa zapisana dwojako: przez zmienną (`!mrModal.hidden`) albo przez
  // getElementById("sendModal") na początku handlera — czyli id potrafi stać
  // przed słowem "Escape" albo po nim. Test sprawdza współwystępowanie w tej samej
  // linii, żeby nie narzucać stylu zapisu, a nie kolejność.
  const linieZEscape = html.split(/\r?\n/).filter((l) => l.includes("Escape") && !l.trim().startsWith("//"));
  const bezEscape = modale.filter((id) => !linieZEscape.some((l) => l.includes(id)));

  assert.deepEqual(bezEscape, [], `modale bez obsługi Escape: ${bezEscape.join(", ")}`);
});

test("plakietka „Najlepszy value” ma próg relatywny z podłogą jakości", () => {
  // Sztywne 82 pkt przestało działać, odkąd ETA uwzględnia dopasowanie do klienta:
  // dobrze wycelowane zapytanie podbijało prawie całą stawkę i odznakę dostawały
  // dziesiątki ofert naraz. Próg musi być liczony z bieżących wyników, ale nie może
  // spaść dowolnie nisko — inaczej w słabej stawce koronowalibyśmy najlepszego z kiepskich.
  const html = wczytaj("public/index.html");

  const fn = html.match(/function ustawProgETA\(list\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "brak funkcji ustawProgETA — próg znowu jest sztywny?");
  assert.match(fn, /Math\.max\(72,/, "zniknęła podłoga jakości 72 pkt");
  assert.match(fn, /0\.1/, "próg nie odnosi się już do czołowych 10% wyników");

  // Werdykt musi czytać próg ze zmiennej, a nie mieć zaszytej liczby.
  const verdict = html.match(/function etaVerdict\(h\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(verdict, /s>=etaTop/, "etaVerdict nie używa wyliczonego progu");
  assert.ok(!/s>=82/.test(verdict), "w etaVerdict został zaszyty stary próg 82");

  // Próg liczony raz na wyszukiwanie — inaczej ta sama oferta miałaby plakietkę
  // na karcie, a w koszyku już nie.
  assert.match(html, /function render\(list\)\{[\s\S]{0,200}ustawProgETA\(list\)/,
    "render() nie przelicza progu przed rysowaniem wyników");
});

test("data powrotu nie może wypaść przed wylotem", () => {
  // Bez atrybutu min kalendarz powrotu otwierał się na starym miesiącu: po zmianie
  // wylotu na październik data powrotu dalej pokazywała sierpień i dawała się wybrać,
  // a wyszukiwanie leciało z terminem wstecz.
  const html = wczytaj("public/index.html");

  assert.match(html, /doo\.min=od\.value/,
    "pole powrotu nie dostaje atrybutu min z daty wylotu — kalendarz znowu otworzy się na złym miesiącu");

  // Sam min nie wystarcza: datę da się wpisać z klawiatury, omijając kalendarz.
  assert.match(html, /function search\(\)\{[\s\S]{0,400}_do\.value<_od\.value/,
    "search() nie sprawdza, czy powrót nie jest przed wylotem");

  // Daty startowe ustawiane są PO spięciu pól, więc bez zdarzenia change
  // powrót nie dostałby min aż do pierwszej ręcznej zmiany.
  assert.match(html, /function initDates\(\)\{[\s\S]{0,400}dispatchEvent\(new Event\("change"\)\)/,
    "initDates nie odpala change — min nie zostanie ustawione na starcie");
});

test("karta oferty oznacza atrybuty, które przeszły filtr tylko z braku danych", () => {
  // Backend (src/ranking.js:unknownAttrs) mówi, KTÓRYCH wybranych atrybutów dana
  // oferta nie potwierdza — offer.attrUnknown. Karta musi to pokazać, inaczej
  // konsultant patrzący na wynik filtra „Przy plaży” nie wie, że akurat TA oferta
  // przeszła z braku danych, a nie bo faktycznie jest przy plaży.
  const html = wczytaj("public/index.html");

  const cardFn = html.match(/function cardEl\(h,i,n,pax\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(cardFn, "brak funkcji cardEl — zmieniła nazwę/sygnaturę?");
  assert.match(cardFn, /h\.attrUnknown/, "cardEl nie czyta pola attrUnknown z oferty");
  assert.match(cardFn, /tag-unknown/, "brak dyskretnego znacznika (klasa tag-unknown) dla atrybutów bez danych");

  // Etykieta atrybutu ma iść przez wspólny helper, nie przez powieloną logikę —
  // 05-06.08 duplikacja tej samej rzeczy między backendem a frontem już się rozjechała raz.
  assert.match(cardFn, /attrChipLabel\(/, "cardEl nie używa attrChipLabel — nazwa atrybutu znowu zdubluje logikę renderAttrCover");
});

test("cena łączna za grupę liczy się jednym wspólnym wzorem (offerTotal), nie osobno w każdym widoku", () => {
  // packages.js (dane demo) nigdy nie ustawia priceTotal — providers/index.js normalizuje
  // to na 0. Karta i tabela liczyły więc lokalny fallback (cena/os. × liczba osób), ale
  // szczegóły oferty, porównywarka (przez cartSnap), koszyk i wydruk/prezentacja czytały
  // h.priceTotal WPROST — więc dla każdej oferty demo pokazywały kreskę albo nic. Klient
  // dostawał ofertę bez najważniejszej liczby: ile zapłaci razem za całą grupę.
  const html = wczytaj("public/index.html");

  const totalFn = html.match(/function offerTotal\(h,pax\)\{[\s\S]*?\}/)?.[0] || "";
  assert.ok(totalFn, "brak funkcji offerTotal — wspólny licznik totalu zniknął?");
  assert.match(totalFn, /var os=Math\.max\(1,pax\|\|1\)/, "offerTotal nie ustala liczby osób");
  assert.match(totalFn, /h\.price\*os/, "offerTotal nie ma fallbacku cena/os. × liczba osób");
  // Suma od dostawcy wolno użyć tylko dla składu, dla którego ją podano — inaczej
  // rodzina 2+3 dostaje sumę za parę (patrz sumaDokladna i ranking.js:offerGroupTotal).
  assert.match(totalFn, /sumaDokladna\(h,os\)/,
    "offerTotal bierze h.priceTotal bez sprawdzenia, dla ilu osób jest ta suma");
  const dokladnaFn = html.match(/function sumaDokladna\(o,pax\)\{[\s\S]*?\}/)?.[0] || "";
  assert.ok(dokladnaFn, "brak funkcji sumaDokladna");
  assert.match(dokladnaFn, /o\.priceTotalPax===Math\.max\(1,pax\|\|1\)/,
    "sumaDokladna nie porównuje składu, dla którego podano sumę, z realnym składem");

  // Szczegóły oferty (openDetail): wiersz „Razem” musi się pokazywać ZAWSZE (przez fallback),
  // a nie tylko gdy dostawca akurat poda realny priceTotal.
  // \r?\n, nie \n — index.html ma końce linii CRLF, więc regex zakotwiczony na samym
  // \n nie łapie tu nic na Windowsie (a na Linuksie łapie — test przechodziłby zależnie
  // od tego, gdzie go uruchomisz).
  const detailFn = html.match(/function openDetail\(h,tabKey\)\{[\s\S]*?var naglowek=[\s\S]*?;\r?\n/)?.[0] || "";
  assert.ok(detailFn, "brak funkcji openDetail lub zmieniła kształt — nie znaleziono bloku naglowek");
  assert.match(detailFn, /row\("Razem za "\+paxCount\(\)\+" "\+odmOsob\(paxCount\(\)\),fmt\(offerTotal\(h,paxCount\(\)\)\)/,
    "openDetail znowu czyta h.priceTotal wprost albo przestał mówić, dla ilu osób jest suma");
  assert.ok(!/h\.priceTotal>0\?row\("Razem/.test(detailFn),
    "wiersz Razem w openDetail nadal jest warunkowy na surowe h.priceTotal");

  // Koszyk: snapshot musi liczyć total przez offerTotal, inaczej porównywarka i lista
  // koszyka (obie czytają x.priceTotal z zapamiętanej oferty) dostają zero dla demo.
  const cartSnapFn = html.match(/function cartSnap\(h\)\{[\s\S]*?\}/)?.[0] || "";
  assert.ok(cartSnapFn, "brak funkcji cartSnap — zmieniła nazwę?");
  assert.match(cartSnapFn, /priceTotal:offerTotal\(h,paxCount\(\)\)/,
    "cartSnap znowu zapisuje surowe h.priceTotal||0 — koszyk i porównywarka zgubią total dla ofert demo");

  // Wydruk/prezentacja klienta (offerDocHtml) — używana i dla pojedynczej oferty,
  // i dla całego koszyka — musi pokazywać total zawsze, nie tylko gdy jest w danych źródła.
  const docFn = html.match(/function offerDocHtml\(x,n\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(docFn, "brak funkcji offerDocHtml — zmieniła nazwę/sygnaturę?");
  assert.match(docFn, /offerTotal\(x,paxCount\(\)\)/,
    "offerDocHtml nie liczy totalu przez offerTotal — wydruk dla klienta znowu zgubi Razem dla ofert demo");
});

// ============================================================
//  Front nie zakłada, że wyżywienie i kategoria są zawsze znane.
//
//  3d5cc3f nauczył BACKEND nie zgadywać (mapBoard/mapStars zwracają undefined
//  dla kodów spoza oficjalnego słownika). Front tego nie wiedział i dalej wklejał
//  te pola wprost albo podstawiał za nie fikcyjne 3 gwiazdki — czyli dokładnie ten
//  sam błąd, który właśnie usunięto z providera, tylko o jedną warstwę wyżej
//  i widoczny bezpośrednio dla klienta.
// ============================================================

test("scriptText nie wypisuje „undefined” ani gołej gwiazdki, gdy oferta nie zna wyżywienia/kategorii", () => {
  const html = wczytaj("public/index.html");

  // Cała funkcja mieści się w jednej fizycznej linii, więc ZACHŁANNE .*\} zatrzyma się
  // na ostatniej klamrze w tym samym wierszu (kropka nie łapie \n). Niegreedy [\s\S]*?\}
  // złapałoby tu wnętrze sc.cb.forEach(function(x){...}) i test badałby nie tę funkcję.
  const kod = html.match(/function scriptText\(h,sc\)\{.*\}/)?.[0] || "";
  assert.ok(kod, "brak funkcji scriptText — zmieniła nazwę/sygnaturę?");

  // Test behawioralny, nie sam regex: uruchamiamy prawdziwy kod z pliku na podstawionych
  // zależnościach i patrzymy na tekst, który realnie zobaczy konsultant.
  const scriptText = new Function("ratingTxt", "AUD_META", "fmt", kod + "; return scriptText;")(
    () => "brak opinii",
    { rodzina: { label: "Rodzina" } },
    (n) => String(n)
  );
  const sc = { aud: "rodzina", lead: "Lead", cb: [], closer: "Zamknięcie" };

  const bezDanych = scriptText({ name: "Hotel X", region: "Hurghada", price: 4200 }, sc);
  assert.ok(!/undefined/.test(bezDanych),
    "skrypt sprzedażowy wypisuje „undefined” dla oferty bez wyżywienia/kategorii");
  assert.ok(!/\|\s*\*/.test(bezDanych),
    "została goła gwiazdka bez liczby — segment kategorii dokłada się mimo braku danych");

  // Pułapka kontrolna: bez tego test przeszedłby też dla wersji, która po prostu
  // usunęła oba pola na stałe — a mają się pokazywać, gdy provider je potwierdzi.
  const zDanymi = scriptText(
    { name: "Hotel X", region: "Hurghada", price: 4200, board: "All Inclusive", stars: 5 }, sc);
  assert.match(zDanymi, /All Inclusive/, "znane wyżywienie zniknęło ze skryptu");
  assert.match(zDanymi, /5\*/, "znana kategoria zniknęła ze skryptu");
});

test("nieznana kategoria nie zamienia się w fikcyjne 3 gwiazdki — ani w koszyku, ani u klienta", () => {
  const html = wczytaj("public/index.html");

  const snapFn = html.match(/function cartSnap\(h\)\{[\s\S]*?\}/)?.[0] || "";
  assert.ok(snapFn, "brak funkcji cartSnap — zmieniła nazwę?");
  assert.match(snapFn, /stars:h\.stars,/,
    "cartSnap znowu podstawia fallback za nieznaną kategorię");

  // Globalnie po całym pliku: ten wzorzec nie ma prawa wrócić NIGDZIE w warstwie
  // wyświetlania. Jedyne dozwolone (h.stars||3) to formuła etaValue — tam 3/5 jest
  // neutralnym priorem w ważonej średniej, a nie twierdzeniem o hotelu.
  assert.ok(!/stars\((?:h|x)\.stars\|\|3\)/.test(html),
    "wróciło stars(...||3) — nieznana kategoria znowu renderuje się jako potwierdzone 3 gwiazdki");
  assert.ok(!/\(x\.stars\|\|"\?"\)/.test(html),
    "wiersz „Kategoria” w wydruku znowu pokazuje placeholder ?★ zamiast zniknąć");
  assert.match(html, /var starPart=\(h\.stars\|\|3\)\/5/,
    "prior w etaValue zniknął — to wzór scoringu, miał zostać nietknięty");
});

test("karta wyniku nie pokazuje słowa „undefined” w miejscu wyżywienia", () => {
  const html = wczytaj("public/index.html");

  const cardFn = html.match(/function cardEl\(h,i,n,pax\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(cardFn, "brak funkcji cardEl — zmieniła nazwę/sygnaturę?");
  // Uwaga na konstrukcję tego warunku: poprawna, warunkowa wersja ZAWIERA ten sam
  // podciąg co zepsuta, więc szukanie samego '<span class="tag board">'+h.board+'</span>'
  // dawałoby fałszywy alarm. Rozróżnia je dopiero kontekst — czy tag jest wklejony
  // bezwarunkowo zaraz po otwarciu meta-row.
  assert.ok(!/"meta-row"><span class="tag board">/.test(cardFn),
    "cardEl wkleja h.board bez osłony — oferta bez wyżywienia pokaże „undefined” na najczęściej oglądanym ekranie panelu");
  assert.match(cardFn, /h\.board\?'<span class="tag board">'\+h\.board\+'<\/span>':''/,
    "brak warunku na h.board — tag wyżywienia ma się nie renderować, gdy dostawca go nie podał");
});

test("filtr wyżywienia ma chip dla najliczniejszej realnej kategorii, spójny z mapBoard", () => {
  const html = wczytaj("public/index.html");
  const provider = wczytaj("src/providers/hotelbeds.js");

  // Etykieta w data-board musi być DOSŁOWNIE tym, co zwraca provider — applyFilters
  // porównuje stringi wprost, więc literówka albo „ż” zamienione na „z” daje chip,
  // który zawsze zwraca zero wyników i wygląda jak zepsuty filtr.
  assert.match(provider, /RO: "Bez wyżywienia"/,
    "BOARD_MAP nie mapuje już RO na „Bez wyżywienia” — chip w panelu straci pokrycie");
  assert.match(html, /<button class="chip" data-board="Bez wyżywienia"/,
    "brak chipa „Bez wyżywienia” — w realnych danych to 64 ze 120 ofert, największa kategoria");

  const blok = html.match(/<div class="chips" id="boardChips">[\s\S]*?<\/div>/)?.[0] || "";
  assert.ok(blok, "nie znaleziono bloku #boardChips");
  assert.equal((blok.match(/data-board="/g) || []).length, 5,
    "spodziewane 5 chipów wyżywienia (AI, Ultra AI, HB, BB, Bez wyżywienia)");
});

// ============================================================
//  Warianty widoczne na liście, nie tylko po kliknięciu w ofertę.
//
//  Backend dokłada h.variants[] do każdej oferty, ale przez pewien czas czytała je
//  WYŁĄCZNIE zakładka „Terminy i operatorzy" w modalu szczegółów — konsultant musiał
//  kliknąć w każdą ofertę osobno, żeby się dowiedzieć, że są inne terminy. Ten blok
//  pilnuje, żeby ta informacja została na karcie i w tabeli, bez dodatkowego kliku.
// ============================================================

test("variantInfo liczy inne terminy i najtańszą sumę za grupę, a odmiana się zgadza", () => {
  const html = wczytaj("public/index.html");

  const sumaFn = html.match(/function variantSuma\(v,pax\)\{.*?\}/)?.[0] || "";
  const totalFn = html.match(/function offerTotal\(h,pax\)\{[\s\S]*?\}/)?.[0] || "";
  const dokladnaFn = html.match(/function sumaDokladna\(o,pax\)\{[\s\S]*?\}/)?.[0] || "";
  const infoFn = html.match(/function variantInfo\(h,pax\)\{[\s\S]*?\n  \}/)?.[0] || "";
  const odmWspolna = html.match(/function odmiana\(n,poj,mn24,mn5\)\{[\s\S]*?\n  \}/)?.[0] || "";
  const odmFn = html.match(/function odmTerminow\(n\)\{.*?\}/)?.[0] || "";
  const odmInnyFn = html.match(/function odmInny\(n\)\{.*?\}/)?.[0] || "";
  assert.ok(odmWspolna, "brak wspólnej funkcji odmiana() — pozostałe są jej opakowaniami");
  assert.ok(sumaFn, "brak funkcji variantSuma — zmieniła nazwę/sygnaturę?");
  assert.ok(totalFn, "brak funkcji offerTotal — variantSuma nie ma na czym stanąć");
  assert.ok(dokladnaFn, "brak funkcji sumaDokladna");
  assert.ok(infoFn, "brak funkcji variantInfo — zmieniła nazwę/sygnaturę?");
  assert.ok(odmFn, "brak funkcji odmTerminow — zmieniła nazwę/sygnaturę?");
  assert.ok(odmInnyFn, "brak odmInny — przymiotnik przy karcie przestanie się zgadzać z rzeczownikiem");

  // paxCount() czyta pola formularza, których tu nie ma — podstawiamy sterowaną atrapę,
  // żeby dało się sprawdzić TO SAMO wyliczenie dla pary i dla większej grupy.
  const zbuduj = (pax) => new Function(
    `function paxCount(){return ${pax};}\n` + odmWspolna + "\n" + dokladnaFn + "\n" + totalFn + "\n" + sumaFn + "\n" + infoFn + "\n" + odmFn + "\n" + odmInnyFn +
    "\nreturn {variantInfo, variantSuma, odmTerminow, odmInny};"
  )();
  const { variantInfo, odmTerminow, odmInny } = zbuduj(2);

  assert.equal(variantInfo({ variants: [{ price: 3000, priceTotal: 6000, priceTotalPax: 2 }] }), null,
    "variantInfo zwraca dane przy jednym wariancie — karta pokazałaby „+0 innych”");
  assert.equal(variantInfo({}), null, "variantInfo nie radzi sobie z ofertą bez pola variants");

  // Trzy warianty jak w docs/struktura-oferty-pakietowej.md: cena za osobę NIE jest
  // monotoniczna względem sumy (promocja „druga osoba taniej”), więc najtańsza suma
  // musi wyjść z minimum po sumach, a nie z pierwszego czy ostatniego wariantu.
  const trzyWarianty = {
    variants: [
      { price: 5349, priceTotal: 10698, priceTotalPax: 2 },
      { price: 5299, priceTotal: 10598, priceTotalPax: 2 },
      { price: 9101, priceTotal: 10521, priceTotalPax: 2 }, // drożej za osobę, taniej razem
    ],
  };
  const vi = variantInfo(trzyWarianty);
  assert.ok(vi, "variantInfo zwróciła null dla trzech wariantów");
  assert.equal(vi.count, 3);
  assert.equal(vi.other, 2, "„inne” to wszystkie warianty minus ten pokazany na karcie");
  assert.equal(vi.minTotal, 10521, "najtańsza suma ma wyjść z minimum sum, nie z pierwszego wariantu");

  // Ta sama oferta dla pięciu osób: sumy operatora dotyczą PARY, więc nie wolno ich
  // podać jako sumy za grupę. Najtańszy staje się wariant o najniższej cenie za osobę.
  const dlaPieciu = zbuduj(5).variantInfo(trzyWarianty);
  assert.equal(dlaPieciu.minTotal, 5299 * 5,
    "suma za parę użyta jako suma za pięć osób — dokładnie ten błąd, który naprawiono 17.08.2026");

  const bezTotal = variantInfo({ variants: [{ price: 100 }, { price: 200, priceTotal: 0 }] });
  assert.equal(bezTotal.minTotal, 200, "fallback cena/os. × liczba osób nie zadziałał dla wariantu bez priceTotal");

  assert.equal(odmTerminow(1), "termin");
  assert.equal(odmTerminow(2), "terminy");
  assert.equal(odmTerminow(5), "terminów");
  assert.equal(odmTerminow(12), "terminów");
  assert.equal(odmTerminow(22), "terminy");

  // Przymiotnik musi się zgadzać z rzeczownikiem przy KAŻDEJ z tych liczb —
  // „1 inne termin” albo „5 inne terminów” to błąd widoczny dla konsultanta.
  const formy = { 1: "inny termin", 2: "inne terminy", 4: "inne terminy", 5: "innych terminów", 12: "innych terminów", 22: "inne terminy" };
  for (const [n, oczekiwane] of Object.entries(formy)) {
    const fraza = odmInny(+n) + " " + odmTerminow(+n);
    assert.equal(fraza, oczekiwane, `dla ${n} spodziewano się „${oczekiwane}”, wyszło „${fraza}”`);
  }
});

test("karta pokazuje inne terminy tylko gdy są, i otwiera od razu zakładkę „terminy”", () => {
  const html = wczytaj("public/index.html");

  const cardFn = html.match(/function cardEl\(h,i,n,pax\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(cardFn, "brak funkcji cardEl — zmieniła nazwę/sygnaturę?");
  assert.match(cardFn, /variantInfo\(h\)/, "cardEl nie liczy variantInfo — informacja o terminach znikła z karty");
  assert.match(cardFn, /var vi=variantInfo\(h\);return vi\?/,
    "cardEl nie sprawdza, czy jest co pokazać — przy jednym wariancie wyświetli „+0”");
  assert.match(cardFn, /data-variants/, "brak klikalnego elementu z informacją o innych terminach");
  assert.match(cardFn, /odmInny\(vi\.other\)\+' '\+odmTerminow\(vi\.other\)/,
    "karta wkleja „inne” na sztywno — przy jednym innym terminie wyjdzie błąd gramatyczny");
  assert.match(cardFn, /openDetail\(h,"terminy"\)/,
    "klik w „inne terminy” nie otwiera zakładki terminów w szczegółach");

  // Pułapka kontrolna: gdyby oba przyciski dostały ten sam atrybut, querySelector
  // złapałby tylko pierwszy i obydwa otwierałyby tę samą zakładkę.
  const wywolania = cardFn.match(/openDetail\([^)]*\)/g) || [];
  assert.ok(wywolania.includes("openDetail(h)") && wywolania.includes('openDetail(h,"terminy")'),
    "spodziewano się dwóch różnych wywołań openDetail — zwykłego i z zakładką terminy");
});

test("openDetail przyjmuje zakładkę startową i waliduje ją względem istniejących", () => {
  const html = wczytaj("public/index.html");

  assert.match(html, /function openDetail\(h,tabKey\)\{/,
    "openDetail nie przyjmuje drugiego argumentu z kluczem zakładki");
  assert.match(html, /var activeKey=\(tabKey&&TABS\.some\(function\(t\)\{return t\.key===tabKey;\}\)\)\?tabKey:\(TABS\[0\]&&TABS\[0\]\.key\)/,
    "openDetail nie sprawdza, czy żądana zakładka w ogóle istnieje — oferta z jednym wariantem nie ma zakładki „terminy”");
  assert.match(html, /aria-selected="'\+\(t\.key===activeKey\?"true":"false"\)\+'"/,
    "nagłówki zakładek nie czytają aktywności z activeKey — zakładka startowa przestanie działać");
  assert.match(html, /class="det-tab-panel'\+\(t\.key===activeKey\?" active":""\)\+'"/,
    "panele nie czytają aktywności z activeKey — treść startowej zakładki się nie pokaże");
});

test("widok tabeli ma kolumnę „Terminy”, a nagłówki i komórki się nie rozjeżdżają", () => {
  const html = wczytaj("public/index.html");

  const fn = html.match(/function renderTable\(list,n,pax\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "brak funkcji renderTable — zmieniła nazwę/sygnaturę?");
  assert.match(fn, /variantInfo\(h\)/, "renderTable nie liczy variantInfo — brak danych o terminach w tabeli");
  assert.match(fn, /<th>Terminy<\/th>/, "brak nagłówka kolumny „Terminy”");

  // Nagłówek to mieszanka literalnych <th> i wywołań pomocniczego th(key,label)
  // dla kolumn sortowalnych — liczenie samych "<th" dałoby wynik mniejszy niż liczba
  // kolumn i test przepuściłby rozjechaną tabelę.
  const theadMatch = fn.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
  assert.ok(theadMatch, "nie znaleziono <thead> w renderTable");
  const naglowek = theadMatch[1];
  const liczbaTh = (naglowek.match(/<th/g) || []).length + (naglowek.match(/\bth\(/g) || []).length;

  const rowsBlock = fn.match(/var rows=list\.map\(function\(h,i\)\{[\s\S]*?\n    \}\)\.join\(""\);/)?.[0] || "";
  assert.ok(rowsBlock, "nie znaleziono budowy wierszy tabeli (var rows=...)");
  const liczbaTd = (rowsBlock.match(/<td class="tc-/g) || []).length;

  assert.equal(liczbaTh, liczbaTd,
    `liczba nagłówków (${liczbaTh}) i komórek (${liczbaTd}) w tabeli wyników się rozjechała`);
});

// ============================================================
// Zakładka „Terminy i operatorzy” po promoteMatchingVariant.
//
// Karta wyniku pokazuje KONKRETNY wariant (ten pasujący do filtrów), a tabela
// terminów wyglądała dokładnie tak samo jak przedtem — konsultant nie wiedział,
// o którym wierszu mówi karta ani które terminy są poza jego kryteriami.
// Test pilnuje trzech rzeczy naraz: wyróżnienia, wyciszenia i tego, że
// dopasowanie idzie po polach wariantu, a NIE po indeksie w tablicy (tabela
// jest przesortowana po sumie za grupę, więc indeks nic nie znaczy).
// ============================================================
test("tabWarianty wyróżnia wariant pokazany na karcie i wycisza te poza aktywnymi filtrami", () => {
  const html = wczytaj("public/index.html");

  const fn = html.match(/var tabWarianty=\(function\(\)\{[\s\S]*?\n {4}\}\)\(\);/)?.[0] || "";
  assert.ok(fn, "brak bloku tabWarianty — zmienił nazwę/strukturę?");

  // Wyróżnienie wiersza z karty: klasa + podpis, żeby działało też bez koloru.
  // Sprawdzamy CAŁY warunek razem z flagą, nie samo cls.push — podmiana warunku na
  // if(false) zostawia ten sam podciąg i przeszłaby przez luźniejszą asercję.
  assert.match(fn, /if\(pokazany\)cls\.push\("wr-shown"\)/,
    "klasa wr-shown nie jest wiązana z flagą pokazany — wyróżnienie może być martwe");
  assert.match(fn, /var pokazany=\(i===iPokazany\)/,
    "flaga pokazany nie wynika z wyliczonego wiersza — wyróżnienie może być zawsze fałszywe");
  assert.match(fn, /pokazany\?'<span class="wr-tag wr-tag-shown">pokazany na karcie<\/span>':''/,
    "brak podpisu „pokazany na karcie” zależnego od flagi");

  // Dopasowanie po polach wariantu, nie po pozycji na liście.
  const dopasowanie = fn.match(/V\[vi\]\.departDate===h\.departDate[\s\S]{0,160}/)?.[0] || "";
  assert.ok(dopasowanie, "brak dopasowania wariantu po departDate — szukamy po indeksie?");
  assert.match(dopasowanie, /departureCity===h\.departureCity/, "dopasowanie nie sprawdza miasta wylotu");
  assert.match(dopasowanie, /operator===h\.operator/, "dopasowanie nie sprawdza operatora");

  // Wyciszenie wariantów poza filtrem — stonowanie plus tytuł z powodem,
  // ale NIE ukrywanie (żadnego display:none ani filtrowania listy).
  assert.match(fn, /if\(powod\)cls\.push\("wr-excluded"\)/,
    "klasa wr-excluded nie jest wiązana z powodem odrzucenia — wyciszenie może być martwe");
  assert.match(fn, /if\(!filtry\[fi\]\.test\(v\)\)\{powod=filtry\[fi\]\.reason;break;\}/,
    "powód nie pochodzi z niespełnionego predykatu filtra");
  assert.match(fn, /title="Poza aktywnym filtrem: /, "brak wyjaśnienia, dlaczego wariant jest poza filtrem");
  assert.ok(!/V=V\.filter|wiersze=V\.filter/.test(fn),
    "warianty poza filtrem są usuwane z listy zamiast oznaczane — konsultant ma widzieć wszystkie terminy");

  // Bez aktywnych filtrów pakietowych lista ma wyglądać jak dotąd: predykaty
  // powstają wyłącznie z zaznaczonych chipów, więc pusta lista = zero wyciszeń.
  const filtry = html.match(/function wrAktywneFiltry\(\)\{[\s\S]*?\n {4}\}/)?.[0] || "";
  assert.ok(filtry, "brak funkcji wrAktywneFiltry");
  assert.match(filtry, /if\(activeDeps\.length\)/, "filtr miasta wylotu nie jest warunkowy");
  assert.match(filtry, /if\(activeTrans\.length\)/, "filtr transportu nie jest warunkowy");
  assert.match(filtry, /if\(activeWeekdays\.length\)/, "filtr dnia tygodnia nie jest warunkowy");
  // activeWeekdays to stringi z data-wd, getDay() to liczba — bez String() filtr byłby martwy.
  assert.match(filtry, /String\(new Date\(/, "dzień tygodnia porównywany bez konwersji typu — filtr nigdy nie zadziała");

  // Style muszą istnieć, inaczej klasy nic nie zmieniają wizualnie.
  assert.match(html, /\.wr-shown\{[^}]+\}/, "brak stylu .wr-shown");
  assert.match(html, /\.wr-excluded\{[^}]+\}/, "brak stylu .wr-excluded");
});

test("tabela terminów liczy sumy dla realnego składu, nie dla zaszytych dwóch osób", () => {
  const html = wczytaj("public/index.html");
  const fn = html.match(/var tabWarianty=\(function\(\)\{[\s\S]*?\n {4}\}\)\(\);/)?.[0] || "";
  assert.ok(fn, "brak bloku tabWarianty");

  // Zaszyte ×2 dawało rodzinie 2+3 sumy za parę — i to w tabeli, z której konsultant
  // wybiera termin, więc porównywał ze sobą kwoty dotyczące różnych składów.
  assert.ok(!/price\*2/.test(fn),
    "w tabeli terminów wrócił zaszyty mnożnik 2 zamiast liczby osób z wyszukiwarki");
  assert.match(fn, /var osobWyjazd=paxCount\(\)/, "tabela nie czyta liczby osób z wyszukiwarki");
  assert.match(fn, /var suma=variantSuma\(v,osobWyjazd\)/, "wiersz nie liczy sumy wspólnym wzorem");
  assert.match(fn, /variantSuma\(a,osobWyjazd\)-variantSuma\(b,osobWyjazd\)/,
    "sortowanie wariantów nie używa sumy dla realnego składu");

  // Nagłówek kolumny i podpis komórki mają mówić, czego dotyczy liczba i czy to szacunek.
  assert.match(fn, /Razem'\+\(osobWyjazd\?' <span class="wr-th-sub">\('\+osobWyjazd\+' '\+odmOsob\(osobWyjazd\)/,
    "nagłówek „Razem” nie mówi, dla ilu osób jest suma");
  assert.match(fn, /sumaDokladna\(v,osobWyjazd\)\?"razem":"szacunek"/,
    "komórka sumy nie odróżnia ceny operatora od naszego szacunku");

  const odm = html.match(/function odmOsob\(n\)\{.*?\}/)?.[0] || "";
  const wspolna = html.match(/function odmiana\(n,poj,mn24,mn5\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(odm, "brak funkcji odmOsob");
  assert.ok(wspolna, "brak wspólnej funkcji odmiana() — pozostałe odmiany są jej opakowaniami");
  const { odmOsob } = new Function(wspolna + "\n" + odm + "\nreturn {odmOsob};")();
  assert.equal(odmOsob(1), "osoba");
  assert.equal(odmOsob(2), "osoby");
  assert.equal(odmOsob(5), "osób");
  assert.equal(odmOsob(12), "osób");
  assert.equal(odmOsob(22), "osoby");
});

// Zero wyników to moment, w którym konsultant siedzi przy kliencie i nie wie,
// co zdjąć. Backend liczy podpowiedzi (ranking.js:podpowiedziRozluznienia), front
// ma je pokazać KONKRETNIE i dać zdjąć filtr jednym kliknięciem.
test("przy zerze wyników panel podpowiada, który filtr zdjąć, i pozwala to zrobić", () => {
  const html = wczytaj("public/index.html");

  assert.match(html, /ostatnieRozluznienia=data\.rozluznienia\|\|\[\]/,
    "front nie odbiera podpowiedzi z odpowiedzi API");
  const pusty = html.match(/Nic nie pasuje do tych kryteriów[\s\S]{0,400}?<\/div>'/)?.[0] || "";
  assert.match(pusty, /\+podpowiedziHtml\(\)\+/,
    "komunikat o zerze wyników nie pokazuje podpowiedzi");

  const htmlFn = html.match(/function podpowiedziHtml\(\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(htmlFn, "brak funkcji podpowiedziHtml");
  assert.match(htmlFn, /slice\(0,4\)/, "brak ograniczenia liczby podpowiedzi — pustka zamieni się w ścianę tekstu");
  assert.match(htmlFn, /data-rozluznij="'\+p\.klucz\+'"/, "przycisk nie niesie klucza filtra do zdjęcia");
  assert.match(htmlFn, /p\.ofert\+' '\+odmOfert\(p\.ofert\)/, "brak odmiany „oferta/oferty/ofert”");

  // Zdjęcie filtra musi ruszyć TĘ SAMĄ kontrolkę, którą widzi konsultant, i przeszukać
  // ponownie — inaczej wyniki rozjadą się z formularzem po lewej.
  const zdejmij = html.match(/function zdejmijFiltr\(klucz\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(zdejmij, "brak funkcji zdejmijFiltr");
  for (const klucz of ["budget", "minRate", "minStars", "onlyReviewed", "nights", "boards", "tags", "attrs", "departures", "transports", "weekdays", "regions"]) {
    assert.ok(zdejmij.includes(`"${klucz}"`), `zdejmijFiltr nie obsługuje klucza „${klucz}” — przycisk nic nie zrobi`);
  }
  assert.match(zdejmij, /search\(\);\r?\n  \}/, "po zdjęciu filtra nie ma ponownego wyszukania");

  // Panel musi powiedzieć backendowi, NA CO ustawi suwaki po kliknięciu — inaczej
  // podpowiedź liczy filtr wyłączony do zera, a suwak oceny siada na swoim minimum
  // i konsultant dostaje mniej ofert, niż mu obiecano (zmierzone 17.08.2026: 4 → 1).
  assert.match(html, /budgetMax:budget\.max,minRateMin:minRate\.min/,
    "zapytanie nie niesie granic suwaków — podpowiedź będzie obiecywać nieosiągalny stan");

  const { odmOfert } = new Function(
    html.match(/function odmiana\(n,poj,mn24,mn5\)\{[\s\S]*?\n  \}/)[0] + "\n" +
    html.match(/function odmOfert\(n\)\{.*?\}/)[0] + "\nreturn {odmOfert};")();
  assert.equal(odmOfert(1), "oferta");
  assert.equal(odmOfert(3), "oferty");
  assert.equal(odmOfert(12), "ofert");
  assert.equal(odmOfert(47), "ofert");
});

// ============================================================
//  Skrypt sprzedażowy — zdania, które konsultant CZYTA KLIENTOWI.
//
//  To najgorsze możliwe miejsce na zgadywanie: klient słyszy obietnicę, płaci
//  i przyjeżdża. Generator miał gałąź `else`, która łapała wszystko poza
//  All Inclusive i HB — więc oferta BEZ danych o wyżywieniu i oferta z jawnym
//  „bez wyżywienia" (Hotelbeds RO) dostawały to samo zdanie: „Śniadania w cenie".
// ============================================================
// Panel jest narzędziem pracy na całą zmianę i sporo osób prowadzi go klawiaturą.
// Modale mają role="dialog", ale po otwarciu focus zostawał na tle: Tab wędrował
// po elementach POD modalem, a czytnik ekranu nie ogłaszał, że coś się otworzyło.
test("otwarcie modala przenosi focus do środka, a zamknięcie oddaje go z powrotem", () => {
  const html = wczytaj("public/index.html");
  const blok = html.match(/function pilnujFocusu\(m\)\{[\s\S]*?\n    \}/)?.[0] || "";
  assert.ok(blok, "brak centralnej obsługi focusu w modalach");

  assert.match(blok, /MutationObserver/,
    "focus obsługiwany przy każdym wywołaniu zamiast centralnie — któreś okno zostanie pominięte");
  assert.match(blok, /attributeFilter:\["hidden"\]/, "obserwator nie patrzy na atrybut hidden");
  assert.match(blok, /poprzedniFocus=document\.activeElement/, "nie zapamiętujemy, skąd konsultant wszedł");
  assert.match(blok, /panel\.setAttribute\("aria-modal","true"\)/, "brak aria-modal przy otwarciu");
  assert.match(blok, /panel\.removeAttribute\("aria-modal"\)/, "aria-modal zostaje po zamknięciu");
  assert.match(blok, /cel\.focus\(\{preventScroll:true\}\)/, "focus nie trafia do wnętrza modala");
  assert.match(blok, /document\.contains\(poprzedniFocus\)/,
    "powrót focusu bez sprawdzenia, czy element nadal istnieje — lista wyników bywa przerenderowana");

  // Mechanizm musi obejmować wszystkie okna, łącznie z szufladą koszyka.
  assert.match(html, /document\.querySelectorAll\("\.cmp-modal, #cartDrawer"\)\.forEach\(pilnujFocusu\)/,
    "obsługa focusu nie obejmuje wszystkich okien modalnych");
});

test("front dopasowuje wiedzę o kierunku po całym słowie, tak samo jak backend", () => {
  const html = wczytaj("public/index.html");
  const fn = html.match(/function pasujeKluczIntel\(hay,klucz\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "brak frontowego bliźniaka dopasowania kierunku — wróci indexOf po podłańcuchu");

  const normFn = html.match(/function normD\(s\)\{.*?\}/)?.[0] || "";
  assert.ok(normFn, "brak funkcji normD");
  const { pasujeKluczIntel, normD } = new Function(normFn + "\n" + fn + "\nreturn {pasujeKluczIntel, normD};")();

  assert.equal(pasujeKluczIntel(normD("Kosta Rika Kostaryka"), "kos"), false,
    "klucz złapał się w środku cudzej nazwy");
  assert.equal(pasujeKluczIntel(normD("Salou Hiszpania"), "sal"), false);
  assert.equal(pasujeKluczIntel(normD("Kos Grecja"), "kos"), true);
  assert.equal(pasujeKluczIntel(normD("Marsa Alam Egipt"), "marsa alam"), true,
    "klucz wielowyrazowy przestał pasować");

  // Sama funkcja nie wystarczy — musi być UŻYWANA przez dopasowanie kierunku.
  const uzycie = html.match(/function destIntelClient\(region,country\)\{.*?\}/)?.[0] || "";
  assert.ok(uzycie, "brak funkcji destIntelClient");
  assert.match(uzycie, /pasujeKluczIntel\(hay,k\)/,
    "destIntelClient nie korzysta z dopasowania po całym słowie — wrócił indexOf po podłańcuchu");
});

test("skrypt sprzedażowy nie obiecuje wyżywienia ani pojemności, których nie znamy", () => {
  const html = wczytaj("public/index.html");
  const fn = html.match(/function featureBenefits\(h\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "brak funkcji featureBenefits");

  const { featureBenefits } = new Function(fn + "\nreturn {featureBenefits};")();
  const cechy = (o) => featureBenefits(o).map((x) => x.f).join(" | ");

  // Wyżywienie
  assert.ok(!/Śniadania w cenie/.test(cechy({ tags: [] })),
    "oferta BEZ danych o wyżywieniu dostaje obietnicę śniadań");
  assert.ok(!/Śniadania w cenie/.test(cechy({ board: "Bez wyżywienia", tags: [] })),
    "oferta JAWNIE bez wyżywienia dostaje obietnicę śniadań — klient zapłaci i przyjedzie");
  assert.match(cechy({ board: "BB", tags: [] }), /Śniadania w cenie/,
    "potwierdzone BB ma nadal dawać zdanie o śniadaniach");
  assert.match(cechy({ board: "All Inclusive", tags: [] }), /All Inclusive/);
  assert.match(cechy({ board: "HB", tags: [] }), /Śniadania i obiadokolacje/);

  // Pojemność pokoju — liczba, po której konsultant sadza realną rodzinę.
  assert.ok(!/Pokoje rodzinne/.test(cechy({ board: "BB", tags: ["rodzina"], cap: 4, capUnknown: true })),
    "obietnica pokoi rodzinnych na podstawie domyślnej pojemności, której nikt nie podał");
  assert.match(cechy({ board: "BB", tags: ["rodzina"], cap: 4 }), /Pokoje rodzinne nawet dla 4 osób/,
    "przy POTWIERDZONEJ pojemności zdanie ma zostać");

  // Plaża — tylko przy znanym dystansie (reguła sprzed dzisiejszej sesji, pilnujemy dalej).
  assert.ok(!/Plaża/.test(cechy({ board: "BB", tags: [] })), "zdanie o plaży bez znanego dystansu");
  assert.match(cechy({ board: "BB", tags: [], beach: 80 }), /Plaża 80 m/);
});

test("skrypt nie powołuje się na opinie hotelu, którego opinii nie znamy", () => {
  const html = wczytaj("public/index.html");
  // Teksty uniwersalne sprzedają hotel jego oceną („dobra ocena gości", „Dobre opinie").
  assert.match(html, /uniwersalny_bez_opinii:\[/, "brak wariantu tekstów dla ofert bez znanych opinii");
  assert.match(html, /var kluczTekstow=\(aud==="uniwersalny"&&!\(h\.reviews>0\)\)\?"uniwersalny_bez_opinii":aud;/,
    "buildScript nie przełącza się na teksty niepowołujące się na opinie");

  const bezOpinii = html.match(/uniwersalny_bez_opinii:\[[\s\S]*?\n    \]/g) || [];
  assert.equal(bezOpinii.length, 2, "spodziewano się wariantów bez opinii i w LEADS, i w CLOSERS");
  for (const blok of bezOpinii) {
    // Sama nazwa klucza zawiera „opinii" — badamy wyłącznie treść zdań.
    const tresc = blok.slice(blok.indexOf("["));
    assert.ok(!/ocen[aęy]|opini/i.test(tresc),
      `wariant „bez opinii” nadal powołuje się na oceny: ${tresc.slice(0, 90)}`);
  }

  // AUD_META nadal musi znaleźć etykietę grupy — podmieniamy tylko źródło tekstów,
  // nie samą grupę docelową (inaczej nagłówek skryptu wywala się na undefined).
  assert.match(html, /return \{aud:aud,variant:v/, "buildScript zwraca inną grupę niż wybrana — etykieta się rozjedzie");
});

test("plakietka opinii we froncie mówi to samo co backend i nie zgaduje wolumenu", () => {
  const html = wczytaj("public/index.html");

  const fn = html.match(/function trustLabel\(t,h\)\{.*?\}\r?\n/)?.[0] || "";
  assert.ok(fn, "brak funkcji trustLabel we froncie albo zmieniła sygnaturę");
  assert.match(fn, /h&&!\(h\.reviews>0\)/,
    "front nie sprawdza, czy liczba opinii jest w ogóle znana");
  assert.match(fn, /cls:"unknown",txt:"Brak danych o opiniach"/,
    "brak neutralnego podpisu dla ofert bez znanej liczby opinii");

  // Wywołanie musi PRZEKAZYWAĆ ofertę — inaczej nowa gałąź nigdy się nie uruchomi.
  assert.match(html, /var tl=trustLabel\(h\.trust\|\|0,h\)/,
    "karta woła trustLabel bez oferty, więc plakietka dalej zgaduje wolumen opinii");
  assert.match(html, /\.trust\.unknown\{[^}]+\}/, "brak stylu neutralnej plakietki");

  const { trustLabel } = new Function(fn + "\nreturn {trustLabel};")();
  assert.equal(trustLabel(0, { reviews: 0 }).cls, "unknown");
  assert.equal(trustLabel(0.2, { reviews: 3 }).cls, "low");
  assert.equal(trustLabel(0.8, { reviews: 4000 }).cls, "high");

  // Werdykt ETA to DRUGIE miejsce na tej samej karcie, które mówiło o opiniach —
  // i mówiło co innego niż plakietka obok, twierdząc „Mało/starych opinii" przy
  // ofercie opisanej jednocześnie jako „Brak danych o opiniach".
  const verdict = html.match(/function etaVerdict\(h\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(verdict, "brak funkcji etaVerdict");
  assert.match(verdict, /\(h&&!\(h\.reviews>0\)\)\?\{t:"ℹ️ Brak danych o opiniach",c:"unk"\}/,
    "werdykt przy nieznanej liczbie opinii dalej twierdzi, że opinii jest mało");
  assert.match(verdict, /:\{t:"⚠️ Mało\/starych opinii",c:"warn"\}/,
    "werdykt dla realnie małej liczby opinii zniknął — a to prawdziwa informacja o hotelu");
  assert.match(html, /\.rep-verdict\.unk\{[^}]+\}/, "brak stylu neutralnego werdyktu");
});

// Backend oddaje dane z cache (providers/index.js) i podaje ich wiek. Front, który
// tego nie mówi, pokazuje ceny sprzed kilku minut jako świeże — a konsultant czyta
// z ekranu konkretną kwotę do klienta.
test("panel mówi, gdy wyniki pochodzą z pamięci podręcznej sprzed dłuższej chwili", () => {
  const html = wczytaj("public/index.html");

  assert.match(html, /<div class="cache-note" id="cacheNote" hidden><\/div>/,
    "brak miejsca w panelu na informację o wieku danych");
  assert.match(html, /\.cache-note\{[^}]+\}/, "brak stylu informacji o wieku danych");

  const wiekFn = html.match(/function wiekDanych\(sources\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(wiekFn, "brak funkcji liczącej wiek danych");
  assert.match(wiekFn, /s\.cached&&typeof s\.wiek==="number"/,
    "wiek liczony bez sprawdzenia, czy źródło w ogóle poszło z cache");
  assert.match(wiekFn, /Math\.max\.apply/,
    "trzeba pokazać NAJSTARSZE dane, nie najświeższe — inaczej komunikat jest zbyt optymistyczny");

  const warnFn = html.match(/function renderSourceWarn\(sources\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(warnFn, /var wiek=wiekDanych\(sources\)/, "pasek statusu nie liczy wieku danych");
  assert.match(warnFn, /wiek>=90/, "brak progu — dopisek pokazywałby się przy danych sprzed sekundy");

  // Odmiana i jednostki: konsultant to czyta, „sprzed 1 minut" wygląda na błąd maszyny.
  const opisFn = html.match(/function opisWieku\(sek\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(opisFn, "brak funkcji opisującej wiek danych");
  const { opisWieku } = new Function(opisFn + "\nreturn {opisWieku};")();
  assert.equal(opisWieku(45), "sprzed 45 s");
  assert.equal(opisWieku(60), "sprzed 1 minuty");
  assert.equal(opisWieku(150), "sprzed 3 minut");
});

test("każda kwota łączna pokazana konsultantowi i klientowi mówi, ilu osób dotyczy", () => {
  const html = wczytaj("public/index.html");

  // Wydruk/prezentacja — ogląda go KLIENT, więc goła kwota bez składu jest pytaniem,
  // które zaraz padnie przy stole.
  const docFn = html.match(/function offerDocHtml\(x,n\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(docFn, "brak offerDocHtml");
  assert.match(docFn, /razem ok\. '\+fmt\(offerTotal\(x,paxCount\(\)\)\)\+' zł za '\+paxCount\(\)\+' '\+odmOsob\(paxCount\(\)\)/,
    "wydruk dla klienta podaje kwotę łączną bez informacji, dla ilu osób");

  // Koszyk przeżywa zmianę składu w wyszukiwarce — snapshot musi nieść swój skład,
  // inaczej kwota sprzed zmiany udaje aktualną.
  const snapFn = html.match(/function cartSnap\(h\)\{[\s\S]*?\}/)?.[0] || "";
  assert.match(snapFn, /priceTotalPax:paxCount\(\)/,
    "cartSnap nie zapisuje składu, dla którego policzono kwotę");
  assert.match(html, /os&&os!==teraz\?' <span class="ci-stale"/,
    "koszyk nie ostrzega, że kwota pochodzi z innego składu niż aktualny");
  assert.match(html, /\.ci-stale\{[^}]+\}/, "brak stylu ostrzeżenia w koszyku");

  // Porównywarka zestawia oferty odłożone w różnych momentach.
  assert.match(html, /x\.priceTotalPax\?'<span class="cmp-sub">za '\+x\.priceTotalPax/,
    "porównywarka nie mówi, dla ilu osób jest każda kwota — zestawia nieporównywalne liczby");
});

test("karta wyniku nie opisuje sumy za parę jako sumy za całą rodzinę", () => {
  const html = wczytaj("public/index.html");
  // Podpis pod kwotą na karcie brał się z tego, czy dostawca podał priceTotal —
  // przy rodzinie 2+3 pisał „(2 doros.)” pod liczbą, o którą nikt nie pytał.
  assert.match(html, /var hasSrcTotal=sumaDokladna\(h,pax\)/,
    "karta znowu ufa surowemu h.priceTotal zamiast sprawdzić skład");
  assert.ok(!/var totalWho=hasSrcTotal\?"2 doros\."/.test(html),
    "podpis na karcie znowu twierdzi, że kwota dotyczy dwóch dorosłych");
  assert.match(html, /hasSrcTotal\?"":", szacunek"/,
    "karta nie oznacza kwoty oszacowanej z ceny za osobę");
});

test("sortowanie po sumie za grupę istnieje i liczy tym samym wzorem co offerTotal", () => {
  const html = wczytaj("public/index.html");
  const server = wczytaj("server.js");
  const ranking = wczytaj("src/ranking.js");

  assert.match(html, /<option value="total">Cena razem za grupę \(rosnąco\)<\/option>/,
    "brak opcji sortowania po sumie za grupę w #sort");
  assert.match(server, /sortOffers\(scored, crit\.sort, crit\.pax\)/,
    "server.js nie przekazuje liczby osób do sortOffers — tryb „total” policzy złą sumę");
  assert.match(ranking, /if \(mode === "total"\) return offerGroupTotal\(a, pax\) - offerGroupTotal\(b, pax\);/,
    "sortOffers zgubił tryb „total” albo przestał liczyć przez offerGroupTotal");
});

// ============================================================
// Ostrzeżenie o „rozproszonych” terminach (h.filtrRozproszony z backendu,
// patrz ranking.js:filtrRozproszony). Karta i nagłówek zakładki „Terminy
// i operatorzy” mają pokazać spokojny znacznik, gdy żaden pojedynczy termin
// nie spełnia wszystkich aktywnych filtrów pakietowych naraz.
//
// Asertujemy CAŁY warunek razem z flagą (h.filtrRozproszony?...:''), nie sam
// napis „terminy rozproszone” — podmiana warunku na if(false)/martwy ternary
// zostawiłaby ten sam tekst w pliku i sabotaż przeszedłby niezauważony
// (dokładnie ta pułapka z testu na cls.push("wr-shown") z nocy 16/17.08).
// ============================================================
test("karta i zakładka „Terminy i operatorzy” ostrzegają, gdy żaden termin nie spełnia wszystkich filtrów naraz", () => {
  const html = wczytaj("public/index.html");

  // Styl musi istnieć, inaczej znacznik nic nie zmienia wizualnie.
  assert.match(html, /\.scatter-badge\{[^}]+\}/, "brak stylu .scatter-badge");
  assert.match(html, /\.tab-warn\{[^}]+\}/, "brak stylu .tab-warn");

  // Karta wyniku: znacznik zależy od h.filtrRozproszony, nie jest wyświetlany zawsze.
  const cardFn = html.match(/function cardEl\(h,i,n,pax\)\{[\s\S]*?\n {2}\}/)?.[0] || "";
  assert.ok(cardFn, "brak funkcji cardEl — zmieniła nazwę/sygnaturę?");
  assert.match(cardFn,
    /\(h\.filtrRozproszony\?'<span class="scatter-badge"[^']*title="[^"]*"[^']*>terminy rozproszone<\/span>':''\)/,
    "znacznik „terminy rozproszone” na karcie nie jest związany z h.filtrRozproszony — może być martwy albo zawsze widoczny");

  // Nagłówek zakładki: label „Terminy i operatorzy” dostaje badge TYLKO gdy h.filtrRozproszony.
  assert.match(html,
    /var terminyLabel="Terminy i operatorzy"\+\(h\.filtrRozproszony\?'<span class="tab-warn"[^']*>!<\/span>':""\)/,
    "nagłówek zakładki „Terminy i operatorzy” nie czyta h.filtrRozproszony — ostrzeżenie może nie pojawić się nigdy");
  assert.match(html, /\{key:"terminy",label:terminyLabel,html:tabWarianty\}/,
    "zakładka „terminy” nie używa wyliczonego terminyLabel — badge nigdy nie trafi na ekran");

  // Wnętrze zakładki: krótkie zdanie ostrzegawcze, też warunkowe.
  const fn = html.match(/var tabWarianty=\(function\(\)\{[\s\S]*?\n {4}\}\)\(\);/)?.[0] || "";
  assert.ok(fn, "brak bloku tabWarianty — zmienił nazwę/strukturę?");
  assert.match(fn,
    /var scatterNote=h\.filtrRozproszony\?'<div class="wr-intro"><span class="scatter-badge">[^<]*<\/span>[^']*':''/,
    "scatterNote w tabWarianty nie jest związany z h.filtrRozproszony — ostrzeżenie w zakładce może być martwe");
  assert.match(fn, /return scatterNote\+'<div class="wr-intro">/,
    "scatterNote policzony, ale nie trafia do zwracanego HTML zakładki");

  // Sabotaż na PODCIĄGU: sam napis „terminy rozproszone” istnieje też w komentarzach
  // i title — więc dowodem musi być cały warunek ternary z flagą, sprawdzony wyżej.
  // Tu tylko pilnujemy, że bez aktywnych dwóch filtrów backend nigdy nie ustawia
  // flagi na true (patrz test jednostkowy filtrRozproszony w ranking.test.js) —
  // front ma po prostu zaufać wartości z JSON, bez własnej kopii tej logiki.
  assert.ok(!/function filtrRozproszony/.test(html),
    "front duplikuje logikę filtrRozproszony zamiast czytać flagę z backendu — dwa miejsca do synchronizowania");
});

test("wiek dziecka nietknięty przez konsultanta nie udaje niemowlaka", () => {
  const html = wczytaj("public/index.html");

  // Sedno błędu: <select> bez atrybutu selected wybiera PIERWSZĄ opcję. Dopóki
  // pierwsza opcja miała value="0", każde dziecko, przy którym konsultant nie
  // kliknął wieku, jechało do dostawcy jako zerolatek — inna cena, inny pokój,
  // zero śladu na ekranie. Pierwsza opcja musi znaczyć „nie podano".
  const fn = html.match(/function wiekDzieckaOpcje\([\s\S]*?\n {2}\}/)?.[0] || "";
  assert.ok(fn, "brak funkcji wiekDzieckaOpcje — zmieniła nazwę/strukturę?");
  const pierwszaOpcja = fn.match(/var opts='<option value="([^"]*)"/)?.[1];
  assert.equal(pierwszaOpcja, "",
    'pierwsza opcja wieku ma wartość inną niż pusta — nietknięte pole wyśle ten wiek jako fakt');
  assert.match(fn, /var podano=selected!==undefined&&selected!==null&&selected!==""/,
    "wiekDzieckaOpcje nie rozróżnia „nie podano” od podanej wartości");
  assert.match(fn, /\(podano\?"":" selected"\)/,
    "pusta opcja nie jest zaznaczana domyślnie — przeglądarka i tak wybierze pierwszą, ale to musi być świadome");
  assert.match(fn, /<option value="0"'\+\(selected==="0"\?" selected":""\)/,
    "„niemowlę <2” nie umie się zaznaczyć po ponownym renderze — wybór 0 lat by znikał");

  // Ten sam błąd siedział w DWÓCH formularzach naraz (wyszukiwarka i Multiroom),
  // bo lista wieków była wklejona dwa razy. Teraz jest jedno źródło — i tak ma zostać.
  assert.match(html, /'">'\+wiekDzieckaOpcje\(old\[i\]\)/,
    "formularz główny nie używa wspólnego wiekDzieckaOpcje — poprawki znów rozjadą się między formularzami");
  assert.match(html, /var opts=wiekDzieckaOpcje\(selected\);/,
    "Multiroom nie używa wspólnego wiekDzieckaOpcje");
  assert.equal((html.match(/>niemowlę &lt;2</g) || []).length, 1,
    "lista wieków jest w kodzie więcej niż raz — wróciła duplikacja, która pozwoliła błędowi żyć w dwóch miejscach");

  // Skoro brak wieku zostaje brakiem, wycena z przybliżeniem musi to mówić.
  assert.match(html, /mrBezWieku=mrRooms\.reduce\(/,
    "nikt nie liczy dzieci bez podanego wieku — ostrzeżenie nie miałoby z czego powstać");
  assert.match(html, /function mrOstrzezenieWiek\(\)\{\s*\r?\n\s*if\(!\(mrBezWieku>0\)\)return"";/,
    "mrOstrzezenieWiek nie milczy, gdy wszystkie wieki są podane — albo w ogóle nie istnieje");
  assert.match(html, /res\.innerHTML=mrOstrzezenieWiek\(\)\+'<div class="det-note">/,
    "ostrzeżenie o zgadywanym wieku nie trafia nad listę wyników Multiroom");
  assert.match(html, /res\.innerHTML=mrOstrzezenieWiek\(\)\+'<div class="mr-empty">Brak hotelu/,
    "przy zerowym wyniku ostrzeżenie znika — a to wtedy konsultant szuka przyczyny");
  assert.match(html, /\.mr-warn\{/, "brak stylu .mr-warn — ostrzeżenie renderowałoby się bez oprawy");
});

// ============================================================
//  Nietknięty suwak to NIE jest decyzja konsultanta.
//
//  Budżet startował na 6000 zł/os., ocena na 7,5 — i oba jechały do backendu
//  jako twarde filtry od pierwszej sekundy. Zmierzone na seedzie demo: 34 ze
//  126 ofert znikały, zanim ktokolwiek cokolwiek kliknął (32 na budżecie,
//  2 na ocenie). Licznik filtrów przy nagłówku pokazywał przy tym zero, bo
//  liczy wyłącznie chipy — więc konsultant nie miał ŻADNEGO śladu, że część
//  rynku mu odcięto. Ta sama klasa błędu co wiek dziecka i zmyślone 7 nocy.
// ============================================================
test("nietknięty suwak budżetu i oceny nie filtruje po cichu", () => {
  const html = wczytaj("public/index.html");

  // Etykieta startowa nie może podawać liczby, której nikt nie wybrał.
  assert.match(html, /id="budgetVal">bez limitu</,
    "startowa etykieta budżetu pokazuje kwotę — konsultant czyta ją jako ustawiony limit");
  assert.match(html, /id="minRateVal">dowolna</,
    "startowa etykieta oceny pokazuje próg — konsultant czyta go jako ustawiony filtr");

  // Sedno: kryterium jedzie do backendu WYŁĄCZNIE gdy człowiek ruszył suwak.
  // Asercja obejmuje CAŁY warunek razem z flagą — samo `budget:` przeszłoby
  // niezauważone po podmianie na bezwarunkowe `budget.value`.
  assert.match(html, /budget:budgetTkniety\?budget\.value:""/,
    "zapytanie niesie budżet, nawet gdy nikt go nie ustawił");
  assert.match(html, /minRate:minRateTkniety\?minRate\.value:""/,
    "zapytanie niesie próg oceny, nawet gdy nikt go nie ustawił");
  assert.match(html, /budget:budgetTkniety\?\+budget\.value:0/,
    "raport ETA dostaje zmyślony budżet klienta, gdy konsultant go nie podał");

  // Obie flagi MUSZĄ startować od fałszu. Sam warunek nic nie daje, jeśli panel
  // wstaje z flagą już zapaloną — filtr wraca po cichu, a asercje wyżej przechodzą.
  assert.match(html, /var budgetTkniety=false,minRateTkniety=false;/,
    "suwaki wstają oznaczone jako ustawione — cichy filtr wrócił tylnymi drzwiami");

  // Flagi zapalają się dokładnie tam, gdzie człowiek dotyka kontrolki.
  assert.match(html, /budget\.addEventListener\("input",function\(\)\{budgetTkniety=true;/,
    "ruszenie suwaka budżetu nie oznacza go jako ustawionego — filtr nigdy by nie zadziałał");
  assert.match(html, /minRate\.addEventListener\("input",function\(\)\{minRateTkniety=true;/,
    "ruszenie suwaka oceny nie oznacza go jako ustawionego");

  // Licznik filtrów musi widzieć suwaki — inaczej cisza wraca drugą stroną.
  const licznik = html.match(/function updateFilterCount\(\)\{[\s\S]*?\n {2}\}/)?.[0] || "";
  assert.ok(licznik, "brak funkcji updateFilterCount");
  assert.match(licznik, /if\(budgetTkniety\)n\+\+;/, "ustawiony budżet nie liczy się do licznika filtrów");
  assert.match(licznik, /if\(minRateTkniety\)n\+\+;/, "ustawiony próg oceny nie liczy się do licznika filtrów");

  // „Wyczyść" wraca do stanu NIEUSTAWIONEGO, nie do dawnych 6000 i 7,5.
  const reset = html.match(/getElementById\("resetBtn"\)\.addEventListener[\s\S]*?search\(\);\}\);/)?.[0] || "";
  assert.ok(reset, "brak obsługi przycisku resetu");
  assert.match(reset, /budgetTkniety=false;minRateTkniety=false;/,
    "reset zostawia suwaki oznaczone jako ustawione — po wyczyszczeniu filtr dalej tnie");
  assert.match(reset, /budgetVal\.textContent=budgetOpis\(\)/,
    "reset wpisuje etykietę na sztywno zamiast pytać o realny stan suwaka");
  assert.match(reset, /minRateVal\.textContent=minRateOpis\(\)/,
    "reset wpisuje etykietę oceny na sztywno zamiast pytać o realny stan suwaka");

  // Same funkcje opisu wykonane naprawdę — sabotaż warunku nie przejdzie przez sito regexów.
  const zrodlo =
    html.match(/function fmt\(n\)\{.*?\}/)[0] + "\n" +
    html.match(/function budgetOpis\(\)\{.*?\}/)[0] + "\n" +
    html.match(/function minRateOpis\(\)\{.*?\}/)[0] + "\n" +
    "return {budgetOpis:budgetOpis,minRateOpis:minRateOpis};";
  const zbuduj = (tkB, tkR) =>
    new Function("budgetTkniety", "minRateTkniety", "budget", "minRate", zrodlo)(
      tkB, tkR, { value: "6000" }, { value: "7.5" });

  const nietkniete = zbuduj(false, false);
  assert.equal(nietkniete.budgetOpis(), "bez limitu",
    "nietknięty suwak budżetu opisuje się kwotą, której nikt nie wybrał");
  assert.equal(nietkniete.minRateOpis(), "dowolna",
    "nietknięty suwak oceny opisuje się progiem, którego nikt nie wybrał");

  const tkniete = zbuduj(true, true);
  assert.match(tkniete.budgetOpis(), /^6\s*000 zł$/,
    "ustawiony budżet przestał pokazywać kwotę — konsultant nie wie, co odciął");
  assert.equal(tkniete.minRateOpis(), "7,5", "ustawiony próg oceny przestał pokazywać wartość");
});

test("nietknięty termin nie udaje potwierdzonej daty klienta", () => {
  const html = wczytaj("public/index.html");

  // Etykieta startowa musi mówić wprost, że nikt jeszcze nie wybrał terminu —
  // pola dat startują wypełnione realną datą (initDates, +30/+37 dni), więc bez
  // tego wyglądają identycznie jak po ręcznym wpisaniu przez konsultanta.
  assert.match(html,
    /<label>Termin <span class="hint" id="datyHint">— termin przykładowy, nie zawęża jeszcze wyników<\/span><\/label>/,
    "startowa etykieta terminu nie ostrzega, że data jest tylko przykładowa");

  // Flaga MUSI startować od fałszu — inaczej etykieta z HTML wyżej jest jedynym
  // śladem, a JS od razu ją podmienia, jakby ktoś już potwierdził termin.
  assert.match(html, /var datyTkniete=false;/,
    "pole daty wstaje oznaczone jako potwierdzone — cichy termin wraca tylnymi drzwiami");

  // Flaga zapala się WYŁĄCZNIE tam, gdzie człowiek faktycznie dotyka pola (input),
  // nie tam, gdzie initDates() programowo wpisuje wartość startową.
  assert.match(html,
    /document\.getElementById\("dateFrom"\)\.addEventListener\("input",function\(\)\{datyTkniete=true;ustawDatyHint\(\);\}\);/,
    "ruszenie pola daty wylotu nie oznacza terminu jako potwierdzonego");
  assert.match(html,
    /document\.getElementById\("dateTo"\)\.addEventListener\("input",function\(\)\{datyTkniete=true;ustawDatyHint\(\);\}\);/,
    "ruszenie pola daty powrotu nie oznacza terminu jako potwierdzonego");

  // initDates() ustawia wartości PROGRAMOWO i rozgłasza tylko "change" — nie "input" —
  // więc auto-wypełnienie przy starcie strony nie może samo zgasić ostrzeżenia.
  const initFn = html.match(/\(function initDates\(\)\{[\s\S]*?\}\)\(\);/)?.[0] || "";
  assert.ok(initFn, "brak initDates()");
  assert.ok(!/dispatchEvent\(new Event\("input"/.test(initFn),
    'initDates rozgłasza "input" — auto-wypełniony termin od razu udawałby potwierdzony');

  // Sama funkcja ustawDatyHint() wykonana naprawdę — sabotaż warunku (np. odwrócenie
  // datyTkniete) nie przejdzie przez samo dopasowanie regexów wyżej.
  const zrodlo = html.match(/function ustawDatyHint\(\)\{.*?\}/)[0] + "\nustawDatyHint();";
  const uruchom = (tkniety) => {
    const h = { textContent: "start" };
    const document = { getElementById: (id) => (id === "datyHint" ? h : null) };
    new Function("datyTkniete", "document", zrodlo)(tkniety, document);
    return h.textContent;
  };
  assert.equal(uruchom(false), "— termin przykładowy, nie zawęża jeszcze wyników",
    "nietknięty termin przestał ostrzegać w etykiecie");
  assert.equal(uruchom(true), "",
    "ustawiony termin dalej pokazuje ostrzeżenie o dacie przykładowej");

  // I najważniejsze: ostrzeżenie musi być PRAWDZIWE. Nietknięta data nie może
  // jechać do /api/search, bo od 24.08 termin realnie filtruje oferty pakietowe
  // (variantWithinDates w ranking.js) — domyślne +30/+37 przy „Dokładnym terminie"
  // zostawiłoby 7 ofert z 453 w katalogu demo, zanim ktokolwiek cokolwiek kliknął.
  // To ta sama konstrukcja co budget:budgetTkniety?... w tym samym zapytaniu.
  assert.match(html, /from:datyTkniete\?widenDate\([^)]*dateFrom[^)]*\)[^:]*:""/,
    "nietknięta data wylotu jedzie do wyszukiwarki jako twarde kryterium");
  assert.match(html, /to:datyTkniete\?widenDate\([^)]*dateTo[^)]*\)[^:]*:""/,
    "nietknięta data powrotu jedzie do wyszukiwarki jako twarde kryterium");
});

// ============================================================
//  Źródła POMINIĘTE (brak kluczy) mają własny, spokojny komunikat — nie mylony
//  z czerwonym alarmem o padniętym źródle. Backend (providers/index.js) dokłada
//  do sources[] wpisy skipped:true / ok:null, front musi je pokazać z nazwy.
// ============================================================

test("źródła pominięte z braku kluczy mają spokojny komunikat, osobny od alarmu o awarii", () => {
  const html = wczytaj("public/index.html");

  assert.match(html, /<div class="source-skip" id="sourceSkip" hidden><\/div>/,
    "brak miejsca na komunikat o pominiętych źródłach");

  // Warunek MUSI być ścisły. `!s.ok` złapałoby też wpisy padnięte (ok:false)
  // i skleiło awarię z brakiem konfiguracji — dwie różne wiadomości dla klienta.
  const fn = html.match(/function renderSourceSkip\(sources\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "brak funkcji renderSourceSkip");
  assert.match(fn, /s\.skipped===true/,
    "komunikat o pominiętych nie filtruje ściśle po skipped — awaria i brak kluczy zleją się w jedno");
  assert.ok(!/!\s*s\.ok/.test(fn),
    "renderSourceSkip łapie po !s.ok — padnięte źródło trafi do spokojnego komunikatu zamiast do alarmu");

  // Czerwony alarm zostaje przy ok === false, inaczej pominięcia (ok:null) wpadną
  // do niego i konsultant zobaczy fałszywe „nie odpowiedział".
  const warnFn = html.match(/function renderSourceWarn\(sources\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(warnFn, "brak funkcji renderSourceWarn");
  assert.match(warnFn, /s\.ok===false/,
    "alarm o awarii przestał porównywać ściśle — pominięte źródła zaczną udawać padnięte");

  // Wykonujemy funkcję NAPRAWDĘ — regexy wyżej nie sprawdzą, co realnie widzi człowiek.
  const el = { hidden: true, innerHTML: "" };
  const uruchom = (sources) => {
    el.hidden = true; el.innerHTML = "";
    new Function("sourceSkipEl", "sources", fn + "\nrenderSourceSkip(sources);")(el, sources);
    return el;
  };

  const zPominietymi = uruchom([
    { id: "pl-packages", label: "Oferty PL (demo)", ok: true, count: 12 },
    { id: "merlinx", label: "MerlinX", ok: null, skipped: true, rynkowy: true },
    { id: "hotelbeds", label: "Hotelbeds", ok: null, skipped: true, rynkowy: true },
  ]);
  assert.equal(zPominietymi.hidden, false, "pominięte źródło nie zostało pokazane");
  assert.match(zPominietymi.innerHTML, /MerlinX/, "komunikat nie wymienia pominiętego źródła z nazwy");
  assert.match(zPominietymi.innerHTML, /Hotelbeds/, "komunikat wymienia tylko część pominiętych źródeł");

  // Brak konfiguracji to nie awaria: żadnej czerwieni, żadnego „spróbuj ponownie".
  assert.ok(!/sw-retry|Spróbuj ponownie/.test(zPominietymi.innerHTML),
    "spokojny komunikat proponuje ponowną próbę — a ta nic nie zmieni, dopóki nie ma kluczy");
  assert.ok(!/nie odpowiedzia/.test(zPominietymi.innerHTML),
    "brak konfiguracji opisany jak awaria dostawcy");

  // Padnięte źródło NIE należy do tego komunikatu.
  const zPadnietym = uruchom([{ id: "hotelbeds", label: "Hotelbeds", ok: false, count: 0, reason: "403" }]);
  assert.equal(zPadnietym.hidden, true,
    "padnięte źródło trafiło do spokojnego komunikatu — konsultant nie dowie się, że to awaria");

  // Celowo wyłączona atrapa (rynkowy:false) to nie jest utracona część rynku.
  const samaAtrapa = uruchom([{ id: "mock", label: "Dane demo", ok: null, skipped: true, rynkowy: false }]);
  assert.equal(samaAtrapa.hidden, true,
    "celowo wyłączona atrapa pokazana jako nieodpytany rynek — czysty szum w panelu");

  // Komplet aktywnych źródeł = cisza.
  const wszystkoOdpytane = uruchom([{ id: "pl-packages", label: "Oferty PL (demo)", ok: true, count: 12 }]);
  assert.equal(wszystkoOdpytane.hidden, true, "komunikat wisi, choć wszystkie źródła zostały odpytane");
});

// ============================================================
//  Termin DOMYŚLNY (oferty Hotelbeds). Backend znaczy `terminDomyslny`, gdy
//  konsultant terminu nie podał i pytaliśmy o nasze okno +30/+37 dni. Front musi
//  to powiedzieć wszędzie, gdzie pokazuje cenę — inaczej oferta na tydzień,
//  którego nikt nie wybrał, wygląda jak oferta na termin uzgodniony z klientem.
// ============================================================

function terminFn(html) {
  const badge = html.match(/function terminDemoBadge\(h\)\{[\s\S]*?\n  \}/)?.[0] || "";
  const fmt = html.match(/function fmtDate\(iso\)\{.*\}/)?.[0] || "";
  return { badge, fmt };
}

test("znacznik terminu przykładowego pokazuje się TYLKO dla ofert z domyślnym terminem", () => {
  const html = wczytaj("public/index.html");
  const { badge, fmt } = terminFn(html);
  assert.ok(badge, "brak funkcji terminDemoBadge");
  assert.ok(fmt, "brak fmtDate — znacznik nie miałby jak sformatować okna");

  const uruchom = (h) => new Function("h", fmt + "\n" + badge + "\nreturn terminDemoBadge(h);")(h);

  // Oferta pakietowa NIE MA pola terminDomyslny — undefined nie może dać ani
  // znacznika, ani pustego elementu wiszącego w layoucie.
  assert.equal(uruchom({ id: "pkg", departDate: "2026-09-22" }), "",
    "oferta bez pola terminDomyslny dostała znacznik");
  assert.equal(uruchom({ id: "hb", terminDomyslny: false, terminOd: "2026-09-22", terminDo: "2026-09-29" }), "",
    "oferta na terminie KLIENTA oznaczona jako przykładowa — konsultant przestanie ufać znacznikowi");

  const zNaszymOknem = uruchom({ id: "hb", terminDomyslny: true, terminOd: "2026-09-22", terminDo: "2026-09-29" });
  assert.notEqual(zNaszymOknem, "", "oferta na naszym oknie nie przyznaje się do tego");
  assert.match(zNaszymOknem, /przykładowy/, "znacznik nie mówi, że termin jest przykładowy");

  // Sama informacja „termin przykładowy" bez daty nie daje konsultantowi nic —
  // musi wiedzieć, o JAKIE okno faktycznie pytaliśmy dostawcy.
  assert.match(zNaszymOknem, /22 wrz 2026/, "znacznik nie pokazuje początku okna, o które pytaliśmy");
  assert.match(zNaszymOknem, /29 wrz 2026/, "znacznik nie pokazuje końca okna, o które pytaliśmy");
});

test("karta oferty wywołuje znacznik terminu, a nie renderuje go bezwarunkowo", () => {
  const html = wczytaj("public/index.html");
  // Znacznik musi trafić na kartę przez samą funkcję (ona pilnuje warunku),
  // a nie przez opakowanie, które dokłada pusty element ofertom pakietowym.
  assert.match(html, /terminDemoBadge\(h\)\+/,
    "karta nie pokazuje znacznika terminu przykładowego");
});

test("koszyk i wydruk nie gubią informacji, że termin jest nasz", () => {
  const html = wczytaj("public/index.html");

  // cartSnap kopiuje wybrane pola — bez jawnego przepisania znacznik ginie
  // przy dodaniu do koszyka i konsultant wysyła klientowi ofertę bez ostrzeżenia.
  // Regex MUSI kończyć się na samym cartSnap. Wersja „do najbliższego \n  }"
  // wciągała też renderCart, w którym `terminDomyslny` występuje — i asercja
  // przechodziła nawet po wycięciu pola z cartSnap. Test był ślepy, wykrył to
  // dopiero sabotaż.
  const snap = html.match(/function cartSnap\(h\)\{return \{.*?\};\}/)?.[0] || "";
  assert.ok(snap, "brak funkcji cartSnap");
  assert.ok(!/function renderCart/.test(snap),
    "wycinek cartSnap sięga poza samą funkcję — asercje niżej sprawdzą cudzy kod");
  assert.match(snap, /terminDomyslny/, "koszyk gubi informację, że termin jest przykładowy");
  assert.match(snap, /terminOd/, "koszyk gubi okno terminu, o które pytaliśmy");

  // Wydruk dla klienta: hotel bez lotu nie ma departDate, więc bez gałęzi na
  // terminOd/terminDo wiersz „Termin" znikał z dokumentu całkowicie.
  const params = html.match(/function offerParamsHtml\(x,n\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(params, "brak funkcji offerParamsHtml");
  assert.match(params, /x\.terminOd&&x\.terminDo/,
    "wydruk dla klienta nie pokazuje terminu pobytu hotelu bez lotu");
  assert.match(params, /termin przykładowy/,
    "wydruk nie ostrzega, że termin jest naszym oknem domyślnym");

  // Ten dokument czyta KLIENT — nie może zawierać wewnętrznego polecenia dla
  // konsultanta. Asercja negatywna musi patrzeć na SAM KOD, bez komentarzy:
  // komentarz wyjaśniający, czego tu nie wolno pisać, zawiera dokładnie ten
  // podciąg i przewracał ten test na własnym uzasadnieniu.
  const paramsKod = params.replace(/\/\/[^\n]*/g, "");
  assert.ok(!/do potwierdzenia z klientem/.test(paramsKod),
    "wydruk dla klienta zawiera instrukcję napisaną do konsultanta");
});

test("koszyk i szczegóły też pokazują znacznik terminu, nie tylko karta", () => {
  // Luka wykryta przy porównaniu z raportem nocnego 25/26.08: testy pokrywały
  // terminDemoBadge, kartę, cartSnap i wydruk, ale NIE renderCart ani nagłówka
  // szczegółów. Sabotaż w tych dwóch miejscach przeszedłby niezauważony, a to
  // właśnie tam konsultant patrzy, składając ofertę dla klienta.
  const html = wczytaj("public/index.html");

  // \r?\n, nie \n — pliki mają CRLF na Windowsie, a LF w kontenerze CI/nocnego.
  // Regex zakotwiczony na samym \n przechodziłby zależnie od tego, gdzie go uruchomisz.
  const cartFn = html.match(/function renderCart\(\)\{[\s\S]*?\r?\n  \}/)?.[0] || "";
  assert.ok(cartFn, "brak funkcji renderCart");
  assert.ok(!/function cartSnap/.test(cartFn),
    "wycinek renderCart sięga poza samą funkcję — asercje niżej sprawdzą cudzy kod");
  assert.match(cartFn, /terminDemoBadge\(x\)/,
    "odłożona oferta gubi w koszyku informację, że termin jest przykładowy");
  assert.match(cartFn, /x\.terminDomyslny\?/,
    "koszyk renderuje znacznik bezwarunkowo — oferta pakietowa dostanie pusty element");

  // Nagłówek szczegółów: wiersz z terminem pobytu pokazuje się dla KAŻDEJ oferty
  // ze znanym oknem, nie tylko dla domyślnego. Hotel na terminie uzgodnionym
  // z klientem też musi mieć widoczną datę przy cenie.
  const detailFn = html.match(/function openDetail\(h,tabKey\)\{[\s\S]*?var naglowek=[\s\S]*?;\r?\n/)?.[0] || "";
  assert.ok(detailFn, "brak funkcji openDetail lub zmieniła kształt");
  assert.match(detailFn, /h\.terminOd&&h\.terminDo\?row\("Termin pobytu"/,
    "szczegóły nie pokazują terminu pobytu hotelu bez lotu — przy cenie nie ma żadnej daty");
  assert.match(detailFn, /h\.terminDomyslny\?' '\+terminDemoBadge\(h\):""/,
    "szczegóły nie odróżniają terminu przykładowego od uzgodnionego z klientem");
});

test("panel mówi wprost, że lista jest niepełna, gdy źródło nie zdążyło", () => {
  // Miękki limit (providers/index.js) oddaje wynik po ~6 s zamiast czekać na
  // najwolniejszego dostawcę. To skraca czekanie z kilkunastu sekund, ale lista
  // JEST wtedy niepełna — a konsultant czyta ją jako komplet i pokazuje klientowi.
  // Bez tego zdania skrócenie czekania kupowałoby czas za ciche kłamstwo o rynku.
  const html = wczytaj("public/index.html");
  const fn = html.match(/function renderSourceSkip\(sources\)\{[\s\S]*?\r?\n  \}/)?.[0] || "";
  assert.ok(fn, "brak funkcji renderSourceSkip");
  assert.ok(!/function api\(/.test(fn), "wycinek sięga poza funkcję — asercje sprawdzą cudzy kod");

  const el = { hidden: true, innerHTML: "" };
  const uruchom = (sources) => {
    el.hidden = true; el.innerHTML = "";
    new Function("sourceSkipEl", "sources", fn + "\nrenderSourceSkip(sources);")(el, sources);
    return el;
  };

  const wDrodze = uruchom([
    { id: "pl-packages", label: "Oferty PL (demo)", ok: true, count: 45 },
    { id: "wakacje", label: "Wakacje.pl", ok: null, pending: true, count: 0 },
  ]);
  assert.equal(wDrodze.hidden, false, "źródło, które nie zdążyło, przeszło bez śladu — lista udaje komplet");
  assert.match(wDrodze.innerHTML, /Wakacje\.pl/, "komunikat nie mówi, którego źródła brakuje");
  assert.match(wDrodze.innerHTML, /niepełna/, "komunikat nie mówi wprost, że wyniki są niepełne");
  // To nie awaria — dostawca pracuje dalej, więc ton musi być inny niż przy padnięciu.
  assert.ok(!/nie odpowiedzia/.test(wDrodze.innerHTML), "pracujące źródło opisane jak padnięte");

  // Oba stany naraz: niezdążone i pominięte to różne wiadomości, obie muszą dojść.
  const oba = uruchom([
    { id: "wakacje", label: "Wakacje.pl", ok: null, pending: true, count: 0 },
    { id: "merlinx", label: "MerlinX", ok: null, skipped: true, rynkowy: true, count: 0 },
  ]);
  assert.match(oba.innerHTML, /Wakacje\.pl/, "przy dwóch stanach zgubiono źródło, które nie zdążyło");
  assert.match(oba.innerHTML, /MerlinX/, "przy dwóch stanach zgubiono źródło pominięte");

  // Komplet odpowiedzi = cisza.
  const komplet = uruchom([{ id: "pl-packages", label: "Oferty PL (demo)", ok: true, count: 45 }]);
  assert.equal(komplet.hidden, true, "komunikat wisi, choć wszystkie źródła odpowiedziały");
});


// ============================================================
//  Rozjazd nazw atrybutów między panelem a serwerem
//
//  Chip w panelu wysyła `data-attr` prosto do /api/search. Gdy nazwa się rozjedzie
//  (zmiana w jednym pliku, zapomniana w drugim), filtr nie odsiewa NICZEGO, a panel
//  dalej liczy go jako aktywny — konsultant czyta pełną listę jako spełniającą
//  kryterium. Ten test łapie rozjazd w chwili, w której powstaje.
// ============================================================

test("każdy chip atrybutu w panelu ma odpowiednik po stronie serwera", async () => {
  const { ZNANE_ATRYBUTY } = await import("../src/ranking.js");
  const html = wczytaj("public/index.html");
  const klucze = [...html.matchAll(/<button[^>]*data-attr="([^"]+)"/g)].map((m) => m[1]);

  assert.ok(klucze.length >= 12, `panel ma tylko ${klucze.length} chipów atrybutów — coś zniknęło`);
  for (const k of new Set(klucze)) {
    assert.ok(ZNANE_ATRYBUTY.has(k),
      `chip „${k}" wysyła klucz, którego serwer nie zna — ten filtr nie odsieje niczego`);
  }
});

test("panel mówi wprost, gdy kryterium nie zostało użyte", () => {
  const html = wczytaj("public/index.html");
  const fn = html.match(/function renderAttrCover\(stats,nieznane\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "brak funkcji renderAttrCover przyjmującej listę nieznanych kluczy");

  // Wywołanie musi PRZEKAZYWAĆ pole z odpowiedzi — inaczej gałąź nigdy nie ruszy.
  assert.match(html, /renderAttrCover\(data\.attrs,data\.attrsNieznane\)/,
    "panel nie przekazuje nieznanych atrybutów do komunikatu — ostrzeżenie nigdy się nie pokaże");

  const box = { hidden: true, innerHTML: "", className: "" };
  const document = { getElementById: () => box };
  const uruchom = (stats, nieznane) => {
    box.hidden = true; box.innerHTML = ""; box.className = "";
    new Function("document", "attrChipLabel", "odmianaOfert", "htmlNaZywo", "stats", "nieznane",
      fn + "\nrenderAttrCover(stats,nieznane);")(
      document, (k) => k, (n) => n + " ofert",
      (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
      stats, nieznane);
    return box;
  };

  // Bez pokrycia atrybutów, ale z nieznanym kluczem — komunikat MUSI się pokazać.
  const sam = uruchom([], ["plaza-blisko"]);
  assert.equal(sam.hidden, false, "nieużyte kryterium przeszło bez śladu — lista udaje przefiltrowaną");
  assert.match(sam.innerHTML, /plaza-blisko/, "komunikat nie mówi, KTÓREGO kryterium nie użyto");
  assert.match(sam.innerHTML, /nie zostało użyte/, "komunikat nie mówi wprost, że filtr nie zadziałał");

  // Klucz przychodzi z paska adresu i wraca na stronę — musi lecieć przez escape.
  const zlosliwy = uruchom([], ['<img src=x onerror="alert(1)">']);
  assert.ok(!/<img/.test(zlosliwy.innerHTML),
    "nazwa kryterium trafia do innerHTML bez ucieczki znaków — to XSS w panelu konsultanta");
  assert.match(zlosliwy.innerHTML, /&lt;img/, "escape nie zadziałał na nazwie kryterium");

  // Komplet znanych kryteriów = żadnego alarmu o nieużytym filtrze.
  const czysto = uruchom([{ key: "plaza", confirmed: 12, unknown: 0 }], []);
  assert.ok(!/nie zostało użyte/.test(czysto.innerHTML),
    "alarm o nieużytym kryterium pokazuje się mimo poprawnych kluczy");
});

// ============================================================
//  Oferta poglądowa nie może dojechać do klienta bez oznaczenia
//
//  cartSnap() przepisuje pola RĘCZNĄ listą, więc każde nowe pole oferty trzeba
//  dopisać jawnie — inaczej ginie po odłożeniu do koszyka. 27.08.2026 okazało się,
//  że ginęła tak flaga `demo`: karta pisze przy takiej ofercie „cena orientacyjna",
//  ale wydruk DLA KLIENTA nie miał już żadnego śladu, że hotel i cena są poglądowe.
//  Na produkcji (brak kluczy API) demo są WSZYSTKIE oferty.
//
//  Znacznik wchodzi w czterech miejscach i asercje pilnują wszystkich czterech —
//  przy znaczniku terminu sabotaż w dwóch z nich przeszedł kiedyś niezauważony.
// ============================================================

test("flaga oferty poglądowej przeżywa odłożenie do koszyka", () => {
  const html = wczytaj("public/index.html");
  const snap = html.match(/function cartSnap\(h\)\{[^}]*\};\}/)?.[0] || "";
  assert.ok(snap, "nie znalazłem cartSnap");

  for (const pole of ["demo:", "filtrRozproszony:", "attrUnknown:"]) {
    assert.ok(snap.includes(pole),
      `cartSnap nie przepisuje ${pole} — flaga ginie w chwili odłożenia oferty do koszyka`);
  }
  // `demo:!!h.demo`, nie `demo:h.demo` — do koszyka i localStorage ma trafiać wartość
  // logiczna, nie `undefined`, które po JSON.stringify znika z obiektu bez śladu.
  assert.match(snap, /demo:!!h\.demo/,
    "flaga demo bez normalizacji — undefined zniknie przy zapisie koszyka");
});

test("wydruk dla klienta mówi wprost, że oferta jest poglądowa", () => {
  const html = wczytaj("public/index.html");

  // 1. Przy KAŻDEJ ofercie osobno — nagłówek ginie przy wysłaniu jednej strony.
  const doc = html.match(/function offerDocHtml\(x,n\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(doc, "nie znalazłem offerDocHtml");
  assert.match(doc, /x\.demo/,
    "dokument dla klienta nie sprawdza flagi demo — oferta poglądowa wygląda w nim jak realna");

  // 2. W nagłówku wydruku całego koszyka.
  const cart = html.match(/function printCart\(\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(cart, "nie znalazłem printCart");
  assert.match(cart, /demoZdanie\(ranked\)/,
    "wydruk koszyka nie mówi klientowi, że zestawienie zawiera dane demonstracyjne");

  // 3. W nagłówku wydruku pojedynczej oferty.
  const jedna = html.match(/function printOffer\(h,sc,n,pax\)\{[\s\S]*?window\.print/)?.[0] || "";
  assert.ok(jedna, "nie znalazłem printOffer");
  assert.match(jedna, /h\.demo/,
    "wydruk pojedynczej oferty pomija informację o danych demonstracyjnych");

  // 4. Konsultant widzi to w koszyku, ZANIM cokolwiek wydrukuje.
  const render = html.match(/function renderCart\(\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(render, "nie znalazłem renderCart");
  assert.match(render, /x\.demo/,
    "koszyk nie oznacza ofert poglądowych — konsultant dowie się dopiero z wydruku");
});

test("zdanie o danych demonstracyjnych nie kłamie o skali", () => {
  const html = wczytaj("public/index.html");
  const fn = html.match(/function demoZdanie\(lista\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "nie znalazłem demoZdanie");
  const uruchom = (lista) => new Function("lista", fn + "\nreturn demoZdanie(lista);")(lista);

  assert.equal(uruchom([{ demo: false }, { demo: false }]), "",
    "zestawienie z samych realnych ofert dostaje ostrzeżenie, którego nie potrzebuje");
  assert.equal(uruchom([]), "", "puste zestawienie generuje ostrzeżenie");

  // Na produkcji bez kluczy API demo są WSZYSTKIE oferty — napisanie wtedy
  // „część pozycji" byłoby nieprawdą wobec klienta.
  assert.match(uruchom([{ demo: true }, { demo: true }]), /Wszystkie pozycje/,
    "komplet ofert poglądowych opisany jako część — to nieprawda wobec klienta");
  assert.match(uruchom([{ demo: true }, { demo: false }]), /Część pozycji/,
    "mieszane zestawienie opisane tak, jakby całe było demonstracyjne");
});

// ============================================================
//  Rozjazd: doradca ETA czyta pola, których koszyk nie przepisuje
//
//  Front woła /api/advisor z `offers: cart`, czyli z MIGAWKAMI z cartSnap, a nie
//  z ofertami z wyszukiwarki. Każde pole, które cartSnap pominie, dla modelu po
//  prostu nie istnieje — i nikt się o tym nie dowie, bo raport i tak się wygeneruje,
//  tylko na uboższych danych.
//
//  27.08.2026 tak właśnie było z `demo`: zabezpieczenie `dane_demo` siedziało
//  w advisor.js od 31.07 i było MARTWE, bo flaga nie przeżywała odłożenia do
//  koszyka. Model nigdy nie wiedział, że opisuje zmyślony hotel. Razem z nią
//  ginęły `centre`, `yearBuilt` i `amenities` (te ostatnie ma 45 z 45 ofert).
//
//  Ten test czyta obie strony z kodu, więc rozjazd wychodzi w chwili powstania.
// ============================================================

// `src/advisor.js` i `src/eta-os-prompt.js` są w .gitignore — prompt ETA OS to
// know-how właściciela i świadomie nie trafia na publiczne repo. W świeżym klonie
// (nocny agent, produkcja) tych plików NIE MA, więc oba testy niżej muszą wtedy
// zostać pominięte, a nie wywrócić cały przebieg. Tak samo robi server.js, który
// ładuje doradcę w try/catch i bez niego po prostu wyłącza /api/advisor.
const ADVISOR = join(ROOT, "src/advisor.js");
const maDoradce = existsSync(ADVISOR);

test("koszyk przepisuje każde pole oferty, które czyta doradca ETA", (t) => {
  if (!maDoradce) return t.skip("src/advisor.js nie istnieje w tym klonie (gitignore) — nie ma czego porównywać");
  const advisor = readFileSync(ADVISOR, "utf8");
  const start = advisor.indexOf("const items = (offers || [])");
  assert.ok(start > -1, "nie znalazłem budowania `items` w advisor.js");
  const blok = advisor.slice(start, advisor.indexOf("}));", start));

  const czytane = [...new Set([...blok.matchAll(/\bo\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
  assert.ok(czytane.length > 15, `podejrzanie mało pól (${czytane.length}) — zmienił się kształt advisor.js?`);

  const html = wczytaj("public/index.html");
  const snap = html.match(/function cartSnap\(h\)\{[^}]*\};\}/)?.[0] || "";
  assert.ok(snap, "nie znalazłem cartSnap");

  for (const pole of czytane) {
    // Pole liczy się jako przepisane na dwa sposoby, bo oba realnie występują:
    //  - jest czytane wprost z oferty (`beach:h.beach`, `operator:h.operator||h.source`),
    //  - albo stoi w koszyku jako klucz o tej nazwie z wartością POLICZONĄ na nowo
    //    (`priceTotal:offerTotal(h,paxCount())` — suma dla bieżącego składu, celowo
    //    nie kopia surowej wartości dostawcy).
    // Liczy się to, że pole dociera do modelu, a nie którędy.
    const jakoKlucz = new RegExp("[{,]" + pole + ":").test(snap);
    assert.ok(snap.includes("h." + pole) || jakoKlucz,
      `doradca ETA czyta o.${pole}, ale cartSnap tego nie przepisuje — dla modelu to pole nie istnieje, ` +
      "a raport i tak powstanie, tylko na uboższych danych (patrz historia flagi demo)");
  }
});

test("zmiana wsadu dla modelu unieważnia stare raporty z cache", (t) => {
  if (!maDoradce) return t.skip("src/advisor.js nie istnieje w tym klonie (gitignore)");
  const advisor = readFileSync(ADVISOR, "utf8");
  const rev = advisor.match(/const PAYLOAD_REV = "([^"]+)"/)?.[1] || "";
  assert.ok(rev, "nie znalazłem PAYLOAD_REV");

  // Wersja sprzed dodania flagi demo do wsadu nie może zostać: raporty policzone
  // pod nią powstały BEZ ostrzeżenia o danych demonstracyjnych, a czyta je klient.
  assert.notEqual(rev, "2026-08-01-sales-engine",
    "PAYLOAD_REV nie został podbity — cache odda raport napisany bez wiedzy o danych demo");
  assert.ok(advisor.includes("dane_demo"),
    "zniknęło pole dane_demo — model przestanie wiedzieć, że opisuje ofertę poglądową");
});

// ============================================================
//  Raport ETA na ekranie też musi powiedzieć, na czym stoi
//
//  Model DOSTAJE `dane_demo` (advisor.js), ale to zabezpieczenie miękkie: nikt nie
//  zagwarantuje, że w każdym raporcie o tym napisze. Twarde jest zdanie dokładane
//  przez panel — bo konsultant przepisuje zdania z tego okna wprost do maila
//  i pominięcie tej informacji tutaj przenosi ją do wiadomości dla klienta.
//  Dotyczy OBU raportów: statycznego rankingu i analizy z AI.
// ============================================================

test("raport ETA mówi, gdy stoi na danych demonstracyjnych", () => {
  const html = wczytaj("public/index.html");

  const fn = html.match(/function repDemoNote\(\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "brak repDemoNote — raport nie ma jak powiedzieć, że stoi na danych demo");
  assert.match(fn, /demoZdanie\(cart\)/,
    "repDemoNote nie liczy zdania z koszyka — pasek pokazywałby się nie wtedy, kiedy trzeba");
  assert.match(fn, /rep-note-warn/,
    "pasek o danych demo wygląda jak zwykła notka, a nie jak ostrzeżenie");

  // 1. Ranking statyczny.
  const stat = html.match(/function buildAdvisorReport\(\)\{[\s\S]*?repModal[^;]*;/)?.[0] || "";
  assert.ok(stat, "nie znalazłem buildAdvisorReport");
  assert.match(stat, /repDemoNote\(\)/,
    "statyczny ranking nie mówi, że stoi na ofertach poglądowych");

  // 2. Analiza z AI — tu pokusa jest największa, bo model „przecież sam napisze".
  assert.match(html, /repBody\.innerHTML=repDemoNote\(\)/,
    "raport z AI nie dokłada zdania o danych demo — zostaje wyłącznie na dobrej woli modelu");
});

// ============================================================
//  Zero wyników: „nic nie ma" kontra „nie sprawdziliśmy"
//
//  To dwie różne wiadomości i panel nie ma prawa ich mylić. Do 27.08.2026 nagłówek
//  zawsze brzmiał „Nic nie pasuje do tych kryteriów" — czyli panel ORZEKAŁ O RYNKU
//  także wtedy, gdy Hotelbeds oddawał 403, a wakacje.pl nie mieściło się w miękkim
//  limicie 2,5 s. Konsultant mówił klientowi „w tym terminie nic nie ma", choć
//  nikt tego terminu nie sprawdził. Pasek o źródłach istniał, ale OSOBNO — zdanie
//  na środku ekranu i tak twierdziło swoje.
//
//  Test wykonuje funkcję, a nie tylko sprawdza obecność kodu: cała wartość leży
//  w tym, KIEDY panel milczy o rynku, a kiedy wolno mu powiedzieć, że nic nie ma.
// ============================================================

test("panel nie twierdzi, że nic nie ma, gdy źródło nie odpowiedziało", () => {
  const html = wczytaj("public/index.html");
  const fn = html.match(/function zeroNaglowek\(\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "brak zeroNaglowek — pusty ekran znów orzeka o rynku bez podstaw");

  const uruchom = (zrodla) =>
    new Function("ostatnieZrodla", fn + "\nreturn zeroNaglowek();")(zrodla);

  // Komplet odpowiedzi = wolno powiedzieć wprost, że nic nie pasuje.
  assert.equal(uruchom([{ id: "pl-packages", label: "Oferty PL", ok: true, count: 0 }]), null,
    "wszystkie źródła odpowiedziały, a panel i tak się asekuruje — to szum podszyty nieprawdą");

  // Źródło PADŁO — nie znamy odpowiedzi.
  const padniete = uruchom([
    { id: "pl-packages", label: "Oferty PL", ok: true, count: 0 },
    { id: "hotelbeds", label: "Hotelbeds", ok: false, count: 0, reason: "403" },
  ]);
  assert.ok(padniete, "padnięte źródło nie zmienia nagłówka — panel twierdzi, że nic nie ma");
  assert.match(padniete.tytul, /nie wiemy/i, "nagłówek dalej orzeka o rynku");
  assert.match(padniete.tresc, /Hotelbeds/, "komunikat nie mówi, KTÓREGO źródła zabrakło");

  // Źródło NIE ZDĄŻYŁO w miękkim limicie — dokładnie ten sam wniosek.
  const wDrodze = uruchom([
    { id: "pl-packages", label: "Oferty PL", ok: true, count: 0 },
    { id: "wakacje", label: "Wakacje.pl", ok: null, pending: true, count: 0 },
  ]);
  assert.ok(wDrodze, "źródło, które nie zdążyło, przeszło bez śladu przy zerze wyników");
  assert.match(wDrodze.tresc, /Wakacje\.pl/, "komunikat nie wymienia źródła, które nie zdążyło");
  // Musi być jasne, że to NIE jest wyrok o rynku — bez tego zdania konsultant
  // przeczyta ostrzeżenie jako „nic nie ma, tylko wolniej".
  assert.match(wDrodze.tresc, /nie<\/b> znaczy|nie znaczy, że nic nie ma/,
    "komunikat nie prostuje wprost, że zero wyników to nie dowód na pusty rynek");

  // Źródło POMINIĘTE (brak kluczy) to świadoma konfiguracja, nie luka w wiedzy
  // o tym zapytaniu — ma swój własny, spokojny pasek i nie zmienia nagłówka.
  assert.equal(uruchom([
    { id: "pl-packages", label: "Oferty PL", ok: true, count: 0 },
    { id: "merlinx", label: "MerlinX", ok: null, skipped: true, rynkowy: true, count: 0 },
  ]), null, "nieskonfigurowane źródło blokuje zdanie o braku dopasowań — panel przestałby odpowiadać wprost");
});

test("pusty ekran czyta nagłówek z zeroNaglowek, a nie ze sztywnego tekstu", () => {
  const html = wczytaj("public/index.html");
  assert.match(html, /var nw=zeroNaglowek\(\);/,
    "gałąź pustego wyniku nie pyta o stan źródeł");
  assert.match(html, /nw\?nw\.tytul:"Nic nie pasuje do tych kryteriów"/,
    "nagłówek o braku dopasowań wrócił jako wartość bezwarunkowa");
  // Stan źródeł musi być ZAPAMIĘTANY z odpowiedzi, inaczej zeroNaglowek czyta pustkę.
  assert.match(html, /ostatnieZrodla=data\.sources\|\|\[\]/,
    "panel nie zapamiętuje źródeł z odpowiedzi — zeroNaglowek zawsze zobaczy pustą listę");
});

// ============================================================
//  Szukanie po nazwie hotelu — ta sama zasada co przy zerze wyników
//
//  „Nie znaleziono X" to twierdzenie o rynku. Gdy źródło padło albo nie zdążyło,
//  nie wiemy, czy tego hotelu nie ma — wiemy tylko, że go nie zobaczyliśmy.
//  Ta gałąź została pominięta przy pierwszej poprawce pustego ekranu (27.08),
//  choć popełnia dokładnie ten sam błąd.
// ============================================================

test("wyszukiwanie po nazwie nie twierdzi, że hotelu nie ma, gdy źródło milczy", () => {
  const html = wczytaj("public/index.html");

  assert.match(html, /var nwN=zeroNaglowek\(\),nmB=htmlNaZywo\(nm\);/,
    "gałąź szukania po nazwie nie pyta o stan źródeł ani nie ucieka znaków w nazwie");
  assert.match(html, /nwN\?'Nie wiemy, czy/,
    "przy niesprawdzonym rynku panel dalej twierdzi „nie znaleziono");

  // Nazwę wpisuje konsultant, a wraca ona do innerHTML — ten sam wzorzec, przez
  // który wcześniej dało się wstrzyknąć znacznik przez nieznane kryterium filtra.
  // Do nagłówka ma iść WYŁĄCZNIE wersja po escape (nmB); surowe `nm` zostaje
  // tylko w textContent paska pod licznikiem, gdzie przeglądarka nie parsuje HTML.
  assert.match(html, /Nie wiemy, czy „'\+nmB\+'/,
    "nagłówek buduje się z surowej nazwy zamiast z wersji po escape");
  assert.match(html, /Nie znaleziono „'\+nmB\+'/,
    "drugi wariant nagłówka dalej wstawia surową nazwę do innerHTML");
  assert.ok(!html.includes("<h3>Nie znaleziono „'+nm+'"),
    "stara, nieescape'owana wersja nagłówka wróciła");
});

// ============================================================
//  Suwak nietknięty nie może wyglądać jak ustawiony
//
//  Flagi budgetTkniety/minRateTkniety pilnują LOGIKI od 22.08.2026 — nietknięty
//  suwak nie jedzie do backendu jako filtr. Ale WYGLĄD o nich nie wiedział: tor
//  był wypełniony kolorem aż do uchwytu, dokładnie jak przy realnie wybranym
//  kryterium, podczas gdy etykieta mówiła „bez limitu". Kontrolka twierdziła
//  więc, że filtruje, choć nie filtrowała — ta sama nieuczciwość co w danych,
//  tylko w warstwie wizualnej.
// ============================================================

test("wypełnienie suwaka pokazuje stan, a nie samą pozycję uchwytu", () => {
  const html = wczytaj("public/index.html");
  const fn = html.match(/function rangeFill\(el,tkniety\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "rangeFill nie przyjmuje stanu — wygląd znów oderwie się od logiki");

  const suwak = (over = {}) => ({
    min: "1500", max: "30000", value: "6000",
    klasy: [], styl: {},
    style: { setProperty(k, v) { this.wartosci = this.wartosci || {}; this.wartosci[k] = v; } },
    classList: { toggle(nazwa, wl) { this.stan = { nazwa, wl }; } },
    ...over,
  });
  const uruchom = (el, tkniety) => {
    new Function("el", "tkniety", fn + "\nrangeFill(el,tkniety);")(el, tkniety);
    return el;
  };

  const nietkniety = uruchom(suwak(), false);
  assert.deepEqual(nietkniety.classList.stan, { nazwa: "nietkniety", wl: true },
    "nietknięty suwak nie dostał znacznika — wygląda jak ustawiony filtr");

  const tkniety = uruchom(suwak(), true);
  assert.deepEqual(tkniety.classList.stan, { nazwa: "nietkniety", wl: false },
    "ustawiony suwak został wyszarzony — konsultant nie zobaczy, że kryterium działa");
  // Pozycja uchwytu liczy się dalej normalnie, niezależnie od stanu.
  // (6000-1500)/(30000-1500) = 15,79% — pozycja liczy się dalej normalnie,
  // niezależnie od tego, czy suwak jest ustawiony.
  assert.equal(tkniety.style.wartosci["--fill"], "15.789473684210526%",
    "wypełnienie przestało być liczone z min/max/value");
});

test("start i reset zostawiają suwaki w stanie nieustawionym", () => {
  const html = wczytaj("public/index.html");

  // Wywołanie startowe MUSI przekazać flagę, a nie `true` na sztywno — inaczej
  // panel od pierwszej sekundy pokazuje dwa aktywne filtry, których nikt nie wybrał.
  assert.match(html, /rangeFill\(budget,budgetTkniety\);rangeFill\(minRate,minRateTkniety\);/,
    "start nie przekazuje stanu suwaków — wracają wypełnione bez decyzji konsultanta");
  assert.ok(!/rangeFill\(budget\)|rangeFill\(minRate\)/.test(html),
    "został gdzieś stary jednoargumentowy rangeFill — ten suwak zawsze wygląda na ustawiony");

  // Przełączenie trybu budżetu to jeszcze NIE ustawienie limitu (ta sama zasada,
  // co przy budgetOpis) — więc po zmianie trybu suwak ma zostać nieustawiony.
  const tryb = html.match(/function applyBudgetMode\(\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(tryb, "nie znalazłem applyBudgetMode");
  assert.match(tryb, /rangeFill\(budget,budgetTkniety\)/,
    "zmiana trybu budżetu oznacza suwak jako ustawiony, choć limitu nikt nie wybrał");
});

test("skala mówi, jaki jest zakres suwaka", () => {
  const html = wczytaj("public/index.html");

  assert.match(html, /<div class="range-skala"><span id="budgetMin"><\/span><span id="budgetMax">/,
    "brak skali pod budżetem — pozycja uchwytu nic nie mówi o kwocie");
  assert.match(html, /<div class="range-skala"><span>6,0<\/span><span>9,5<\/span>/,
    "brak skali pod oceną");

  // Zakres budżetu ZMIENIA SIĘ z trybem („za osobę" 1500-30000, „za wszystkich"
  // 3000-120000), więc podpisy muszą być liczone z kontrolki, nie wpisane w HTML.
  const tryb = html.match(/function applyBudgetMode\(\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(tryb, /rangeSkala\(budget,"budgetMin","budgetMax"/,
    "po zmianie trybu skala pokazuje zakres poprzedniego trybu — czyli kłamie");

  const fn = html.match(/function rangeSkala\([\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(fn, "nie znalazłem rangeSkala");
  const box = { a: {}, b: {} };
  new Function("document", "fmt", "el", fn +
    "\nrangeSkala(el,'a','b',' zł');")(
    { getElementById: (id) => (id === "a" ? box.a : box.b) },
    (n) => String(n),
    { min: "3000", max: "120000" });
  assert.equal(box.a.textContent, "3000 zł", "dolna granica skali nie pochodzi z kontrolki");
  assert.equal(box.b.textContent, "120000 zł", "górna granica skali nie pochodzi z kontrolki");
});

test("stan nieustawiony ma własny wygląd w CSS, nie tylko w JS", () => {
  const html = wczytaj("public/index.html");
  // Sam znacznik w klasie nic nie zmienia, jeśli nie ma reguły, która go czyta.
  assert.match(html, /input\[type=range\]\.nietkniety::-webkit-slider-runnable-track\{background:var\(--line\)\}/,
    "brak reguły neutralizującej wypełnienie toru — znacznik jest, a suwak dalej wygląda na ustawiony");
  assert.match(html, /input\[type=range\]\.nietkniety::-moz-range-progress\{background:var\(--line\)\}/,
    "Firefox rysuje ::-moz-range-progress sam — bez tej reguły tam dalej będzie wypełnienie");
});
