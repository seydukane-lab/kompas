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
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
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
