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
