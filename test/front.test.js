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
  assert.match(totalFn, /h\.price\*Math\.max\(1,pax/, "offerTotal nie ma fallbacku cena/os. × liczba osób");

  // Szczegóły oferty (openDetail): wiersz „Razem” musi się pokazywać ZAWSZE (przez fallback),
  // a nie tylko gdy dostawca akurat poda realny priceTotal.
  // \r?\n, nie \n — index.html ma końce linii CRLF, więc regex zakotwiczony na samym
  // \n nie łapie tu nic na Windowsie (a na Linuksie łapie — test przechodziłby zależnie
  // od tego, gdzie go uruchomisz).
  const detailFn = html.match(/function openDetail\(h\)\{[\s\S]*?var naglowek=[\s\S]*?;\r?\n/)?.[0] || "";
  assert.ok(detailFn, "brak funkcji openDetail lub zmieniła kształt — nie znaleziono bloku naglowek");
  assert.match(detailFn, /row\("Razem \(orientacyjnie\)",fmt\(offerTotal\(h,paxCount\(\)\)\)/,
    "openDetail znowu czyta h.priceTotal wprost — w trybie demo wiersz Razem zniknie");
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
