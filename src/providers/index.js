// ============================================================
//  Rejestr dostawców danych.
//  Dodanie nowego źródła = dopisanie jednego importu tutaj.
//  Każdy dostawca implementuje: meta, isEnabled(), search(crit).
// ============================================================

import * as mock from "./mock.js";
import * as hotelbeds from "./hotelbeds.js";
import * as merlinx from "./merlinx.js";
import * as travellead from "./travellead.js";
import * as plPackages from "./packages.js";
import { normalizeName } from "../ranking.js";
import { withDeadline } from "../http.js";

// Provider wakacje.js jest LOKALNY (gitignored) — na publicznym wdrożeniu (Render)
// tego pliku nie ma. Ładujemy go OPCJONALNIE, żeby build nie padał przy jego braku;
// bez pliku wakacje po prostu nie startuje (strona publiczna zostaje czysta).
let wakacje = null;
try {
  wakacje = await import("./wakacje.js");
} catch {
  /* brak lokalnego providera — produkcja/publiczne repo */
}

// Kolejność = priorytet przy scalaniu duplikatów (niżej = ważniejsze).
// wakacje (jeśli obecne) = realne oferty+oceny+link, więc na czele realnych źródeł.
const ALL = [wakacje, travellead, merlinx, hotelbeds, plPackages, mock].filter(Boolean);

export function activeProviders() {
  return ALL.filter((p) => p.isEnabled());
}

export function providerStatus() {
  return ALL.map((p) => ({
    id: p.meta.id,
    label: p.meta.label,
    needsKeys: p.meta.needsKeys,
    enabled: p.isEnabled(),
  }));
}

// Ile czasu wolno zająć JEDNEMU dostawcy. Hotelbeds robi kilka wywołań po
// kolei (dostępność + treści), więc limit jest wyższy niż na pojedynczy fetch.
const PROVIDER_DEADLINE_MS = Number(process.env.PROVIDER_TIMEOUT_MS) || 25000;

// Ile czasu konsultant CZEKA na odpowiedź, zanim oddamy mu to, co już jest.
//
// Komentarz nad searchAll obiecywał: „wynik składamy z tych, które zdążyły" — ale
// Promise.all czeka na WSZYSTKICH, więc jedno martwe źródło zatrzymywało całe
// wyszukiwanie. Zmierzone 26.08.2026 audytem na żywych źródłach: katalog PL
// odpowiadał w 4-7 ms, Hotelbeds w 0,6 s, a każde zapytanie i tak trwało 15 s,
// bo tyle wisiał lokalny provider wakacje.pl, zanim padł na timeoucie. Pięć
// scenariuszy audytu = 75 sekund czekania na dane, które były gotowe po sekundzie.
//
// Po tym progu oddajemy wynik z tego, co dojechało. Dostawca, który nie zdążył,
// NIE jest przerywany: leci dalej do twardego PROVIDER_DEADLINE_MS i zapisuje się
// do cache, więc następne pytanie o to samo ma jego oferty od ręki. To ten sam
// wzorzec co odswiezWTle() niżej — konsultant nie czeka przy ekranie na
// najwolniejsze źródło, a dane nie przepadają.
//
// 2500 ms, a nie 6000 jak w pierwszej wersji. Pierwsza liczba była z wyczucia,
// ta jest z pomiaru (26.08.2026, npm run czasy): czasy źródeł są w dwóch
// skupiskach — pl-packages 8 ms i hotelbeds 642 ms z jednej strony, wakacje
// 7894-9964 ms z drugiej. Między 0,7 s a 7,9 s NIE MA ŻADNEGO ŹRÓDŁA, więc
// każdy próg z tego przedziału przepuszcza dokładnie ten sam komplet: próg 6000
// i próg 2000 dały po 126 ofert w pięciu scenariuszach, tyle że pierwszy kazał
// czekać 30,0 s zamiast 10,1 s. Sześć sekund kupowało zero ofert.
// Zapas nad Hotelbedsem jest prawie czterokrotny, bo jego 642 ms zmierzono na
// odpowiedzi 403 — ze sprawną pulą robi kilka wywołań po kolei i będzie wolniejszy.
// Gdy pula wróci: przemierzyć (npm run czasy) i podnieść, jeśli wypadnie z progu.
const PROVIDER_SOFT_DEADLINE_MS = Number(process.env.PROVIDER_SOFT_TIMEOUT_MS) || 2500;

// Znacznik wyścigu — własny obiekt, żeby nie dało się go pomylić z odpowiedzią
// dostawcy (dostawca zwraca tablicę, więc żadna jego wartość tym nie będzie).
const NIE_ZDAZYL = Symbol("nie zdążył w miękkim limicie");

// ---------------------------------------------------------------
//  Krótki cache wyników wyszukiwania
//
//  Konsultanci w jednym biurze pytają o to samo: te same kierunki, te same
//  terminy, w kółko przez cały dzień. Bez cache'u każde takie pytanie to
//  ponowne odpytanie wszystkich dostawców — a wąskim gardłem potrafi być
//  jedno wolne źródło (zmierzone: 8–10 s przy 0,5 s reszty).
//
//  TTL jest krótki celowo: ceny i dostępność realnie się zmieniają, a
//  konsultant nie może podać klientowi ceny sprzed pół godziny.
// ---------------------------------------------------------------
const CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS) || 180000; // 3 minuty
const CACHE_MAX = Number(process.env.SEARCH_CACHE_MAX) || 200;
const searchCache = new Map();

// Od jakiego wieku wpis, choć wciąż ważny, warto odświeżyć W TLE. Konsultant dostaje
// odpowiedź natychmiast z cache, a nowe dane dojeżdżają na kolejne pytanie — zamiast
// czekać przy ekranie na najwolniejsze źródło. Poniżej tego progu nie ruszamy sieci
// w ogóle, żeby seria kliknięć w jednym kierunku nie zamieniła się w serię zapytań.
const CACHE_REVALIDATE_MS = Number(process.env.SEARCH_CACHE_REVALIDATE_MS) || 60000; // 1 minuta
// Odświeżenia w locie: bez tego pięć równoległych wyszukiwań tego samego kierunku
// odpaliłoby pięć odświeżeń naraz i wolne źródło dostałoby pięć zapytań zamiast jednego.
const wLocie = new Map();

function cacheKey(crit) {
  // Stabilny klucz: te same kryteria w innej kolejności pól to ten sam wynik.
  return JSON.stringify(Object.keys(crit).sort().map((k) => [k, crit[k]]));
}

// Klucz jest PER DOSTAWCA, nie na całą odpowiedź. Powód zmierzony 17.08.2026 na
// lokalnym zestawie źródeł: cache całościowy zapisywał się tylko wtedy, gdy ŻADNE
// źródło nie padło — a Hotelbeds w sandboxie pada regularnie (403, wyczerpana pula).
// Efekt: cache nie działał ANI RAZU w 24 wyszukiwaniach z rzędu, więc konsultant
// czekał 15 s na każde pytanie, bo tyle zajmuje najwolniejsze źródło. Rozbicie na
// dostawców zachowuje sens starej reguły (padnięte źródło NIE jest zamrażane
// i próbujemy go ponownie), ale zdrowe źródła przestają płacić za cudzą awarię.
function providerCacheKey(id, crit) {
  return id + " " + cacheKey(crit);
}

function cacheGet(key) {
  const hit = cacheEntry(key);
  return hit ? hit.data : null;
}

// Wpis z czasem zapisu — panel ma prawo wiedzieć, jak stare są dane, zamiast
// dostawać je bez oznaczenia i pokazywać cenę sprzed kilku minut jako świeżą.
function cacheEntry(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  // Odświeżenie pozycji — najdawniej używane wypadają pierwsze.
  searchCache.delete(key);
  searchCache.set(key, hit);
  return hit;
}

function cacheSet(key, data) {
  searchCache.set(key, { at: Date.now(), data });
  while (searchCache.size > CACHE_MAX) {
    searchCache.delete(searchCache.keys().next().value);
  }
}

/** Czyści cache — przydatne w testach i po zmianie konfiguracji dostawców. */
export function clearSearchCache() {
  searchCache.clear();
  wLocie.clear();
}

/** Czy trwa odświeżanie w tle — testy nie mogą kończyć się w środku zapytania. */
export function trwajaceOdswiezenia() {
  return Promise.all([...wLocie.values()].map((p) => p.catch(() => {})));
}

// Odświeżenie w tle: wynik ląduje w cache na następne pytanie, a błąd NIE może
// wywrócić procesu ani zostawić po sobie wpisu w mapie „w locie".
function odswiezWTle(prov, crit, key) {
  if (wLocie.has(key)) return;
  const zadanie = withDeadline(prov.search(crit), PROVIDER_DEADLINE_MS, prov.meta.id)
    .then((lista) => { if (Array.isArray(lista)) cacheSet(key, lista); })
    .catch((err) => { console.warn(`[${prov.meta.id}] odświeżanie w tle nie powiodło się:`, err?.message || err); })
    .finally(() => { wLocie.delete(key); });
  wLocie.set(key, zadanie);
}

// Krótki, czytelny dla konsultanta powód awarii źródła. Bez tego "dostawca
// nie odpowiedział" i "nic nie ma w tym terminie" wyglądają identycznie —
// a to dwie zupełnie różne wiadomości do przekazania klientowi.
function reasonFor(err) {
  const status = err?.status;
  if (status === 429) return "przekroczono limit zapytań (429) — spróbuj ponownie za chwilę";
  // 403 z Hotelbeds to praktycznie zawsze wyczerpana pula zapytań o DOSTĘPNOŚĆ, nie zły klucz —
  // zdiagnozowane 07.08.2026: przy trwającym 403 na availability endpoint /status i całe
  // Content API odpowiadały 200 OK. Komunikat nie może wysyłać nikogo na fałszywy trop klucza.
  if (status === 403) return "wyczerpana pula zapytań o dostępność (403) — klucz działa, pula odnawia się po stronie dostawcy";
  if (typeof status === "number" && status >= 500) return `błąd serwera dostawcy (${status})`;
  if (typeof status === "number") return `dostawca odpowiedział błędem HTTP ${status}`;
  if (/przekroczono limit \d+ ms/.test(err?.message || "")) return "przekroczono limit czasu odpowiedzi";
  return "dostawca nie odpowiedział";
}

// Odpytuje wszystkich aktywnych dostawców równolegle i scala oferty.
// Wolne źródło nie może opóźniać reszty: każdy dostawca ma własny limit czasu,
// a wynik składamy z tych, które zdążyły. Lepiej pokazać oferty z trzech źródeł
// niż kazać konsultantowi czekać na czwarte, które akurat leży.
//
// `providers` jest parametrem (domyślnie aktywni dostawcy) głównie dla testów —
// pozwala podstawić atrapę dostawcy, żeby sprawdzić rozróżnienie
// odpowiedziało/odpowiedziało zerem/padło bez prawdziwej sieci.
export async function searchAll(crit, providers = null) {
  // `providers` podane jawnie (testy, wywołania punktowe) opisuje CAŁY świat tego
  // wyszukiwania — wtedy rejestr ALL nie ma z nim nic wspólnego i nie wolno z niego
  // dopisywać pominiętych źródeł. Bez tego rozróżnienia wyszukiwanie po jednej
  // atrapie raportowałoby sześć źródeł, z których pięciu nikt nie dotykał.
  const rejestr = providers || ALL;
  // Odpytujemy WYŁĄCZNIE włączonych — niezależnie od tego, skąd wzięła się lista.
  // Przy jawnie podanych dostawcach filtr `isEnabled()` był wcześniej pomijany, więc
  // źródło bez kluczy i tak szło do sieci; przy prawdziwych dostawcach nie miało to
  // jak wyjść (jawną listę podają tylko testy), ale to była różnica w zachowaniu
  // tej samej funkcji zależna od sposobu wywołania.
  const doOdpytania = rejestr.filter((p) => p.isEnabled());
  const wyniki = await Promise.all(doOdpytania.map(async (prov) => {
    const key = providerCacheKey(prov.meta.id, crit);
    const hit = cacheEntry(key);
    // Świeży wpis tego dostawcy: bierzemy go i NIE ruszamy sieci. Wiek podajemy
    // dalej, bo „z cache sprzed 12 s" i „właśnie odpytane" to dwie różne wiadomości.
    if (hit) {
      const wiekMs = Date.now() - hit.at;
      // Wpis dalej ważny, ale już nie pierwszej świeżości — oddajemy go od razu
      // i odświeżamy w tle. Konsultant nie czeka, a następne pytanie ma nowe dane.
      if (wiekMs > CACHE_REVALIDATE_MS) odswiezWTle(prov, crit, key);
      return { prov, offers: hit.data, ok: true, ms: 0, cached: true, wiek: Math.round(wiekMs / 1000) };
    }

    const t0 = Date.now();
    // Zadanie leci do TWARDEGO limitu i samo zapisuje się do cache — także wtedy,
    // gdy przestaniemy na nie czekać. Dzięki temu wolne źródło nie przepada:
    // jego oferty dojeżdżają na następne pytanie o te same kryteria.
    const zadanie = withDeadline(prov.search(crit), PROVIDER_DEADLINE_MS, prov.meta.id)
      .then((lista) => { if (Array.isArray(lista)) cacheSet(key, lista); return lista; });

    let zegar;
    const miekkiLimit = new Promise((res) => {
      zegar = setTimeout(() => res(NIE_ZDAZYL), PROVIDER_SOFT_DEADLINE_MS);
      // Zegar nie może trzymać procesu przy życiu — inaczej `npm test` wisiałby
      // sekundami po ostatniej asercji, czekając na timery, na które nikt nie patrzy.
      zegar.unref?.();
    });

    try {
      const lista = await Promise.race([zadanie, miekkiLimit]);
      const ms = Date.now() - t0;

      if (lista === NIE_ZDAZYL) {
        // Rejestrujemy w `wLocie`, żeby liczyło się jako praca w tle: testy czekają
        // na nią przez trwajaceOdswiezenia(), a równoległe pytanie o te same
        // kryteria nie odpali drugiego zapytania do tego samego dostawcy.
        if (!wLocie.has(key)) {
          const wTle = zadanie
            .catch((err) => { console.warn(`[${prov.meta.id}] nie zdążył i padł w tle:`, err?.message || err); })
            .finally(() => { wLocie.delete(key); });
          wLocie.set(key, wTle);
        }
        return { prov, offers: [], ok: null, pending: true, ms };
      }

      clearTimeout(zegar);
      // Dostawca, który zwrócił coś innego niż tablicę, jest pomijany tak jak dotąd:
      // nie mamy z tego ofert i nie umiemy uczciwie nazwać takiego stanu.
      if (!Array.isArray(lista)) return null;
      return { prov, offers: lista, ok: true, ms };
    } catch (err) {
      clearTimeout(zegar);
      console.warn(`[${prov.meta.id}] search error:`, err?.message || err);
      // Padnięte źródło NIE trafia do cache — następne pytanie ma je odpytać ponownie.
      return { prov, offers: [], ok: false, ms: Date.now() - t0, reason: reasonFor(err) };
    }
  }));

  const offers = [];
  const sources = [];
  for (const w of wyniki) {
    if (!w) continue;
    if (w.ok) {
      // Priorytet dostawcy = pozycja w ALL (niższa = ważniejsza). Przyda się przy scalaniu.
      const prio = ALL.indexOf(w.prov);
      offers.push(...w.offers.map((o) => ({ ...o, __prio: prio })));
    }
    // ok:true niezależnie od count — uczciwe zero (dostawca odpytany, nic nie ma)
    // to inna sytuacja niż padnięcie, choć obie dają count:0.
    const wpis = { id: w.prov.meta.id, label: w.prov.meta.label, count: w.offers.length, ok: w.ok, ms: w.ms };
    if (w.reason) wpis.reason = w.reason;
    // NIE ZDĄŻYŁ w miękkim limicie. To trzeci stan obok „odpowiedział" i „padł":
    // dostawca dalej pracuje, więc `ok` zostaje NULL-em — ani nie skłamiemy, że
    // odpowiedział (ok:true z zerem ofert znaczy „nic nie ma"), ani nie ogłosimy
    // awarii, której nie stwierdziliśmy (ok:false zapala czerwony pasek).
    if (w.pending) {
      wpis.pending = true;
      wpis.reason = "nie zdążył w limicie — jego oferty dojadą przy następnym wyszukiwaniu";
    }
    if (w.cached) { wpis.cached = true; wpis.wiek = w.wiek; }
    sources.push(wpis);
  }

  // Dostawca BEZ kluczy nie był odpytany, więc nie ma go w `wyniki` — i do 24.08
  // nie było go też w `sources`. Wyszukiwanie wyglądało wtedy tak, jakby MerlinX
  // czy Hotelbeds w ogóle nie istniały, zamiast: „są, ale nie skonfigurowane".
  // Dziś to nieszkodliwe (żadne źródło nie ma kluczy, więc baner „wersja
  // przedpremierowa" jest uczciwy), ale przy CZĘŚCIOWEJ konfiguracji — a taka
  // będzie pierwsza wersja z pilotażu, gdy Hotelbeds dostanie klucze, a MerlinX
  // jeszcze nie — konsultant nie miałby jak zauważyć, że pyta o pół rynku.
  //
  // ⚠️ `ok` zostaje NULL-em, nie false. Front pokazuje „<źródło> nie odpowiedział"
  // dokładnie dla ok === false (renderSourceWarn w public/index.html), a brak
  // konfiguracji to nie awaria — fałszywy alarm o padniętym źródle byłby gorszy
  // od dzisiejszego milczenia. `skipped: true` jest osobnym, jawnym stanem.
  // Pomijamy tych, których searchAll faktycznie miał do dyspozycji: przy wywołaniu
  // z własną listą dostawców (testy, wywołania punktowe) globalne ALL nie opisuje
  // tego wyszukiwania i dopisywałoby wpisy o źródłach, o które nikt nie pytał.
  // ⚠️ POWÓD MUSI BYĆ PRAWDZIWY. Pierwsza wersja (24.08) wpisywała każdemu
  // wyłączonemu dostawcy „brak kluczy" — także `mock`, który ma needsKeys:false
  // i jest wyłączony CELOWO flagą ENABLE_MOCK, bo fikcyjne hotele kłócą się
  // z anty-przekoloryzacją. Nocny wziął ten powód w dobrej wierze i pokazał
  // konsultantowi „nie pytaliśmy: Dane demo", czyli zdanie nieprawdziwe w obie
  // strony: nie chodziło o klucze i nie chodziło o żaden utracony rynek.
  //
  // `rynkowy` mówi frontowi, o kogo warto zawracać głowę konsultantowi: brak
  // kluczy do REALNEGO dostawcy znaczy „nie pytaliśmy części rynku", a celowo
  // wyłączona atrapa nie znaczy nic i byłaby czystym szumem w panelu.
  for (const p of rejestr) {
    if (p.isEnabled()) continue;
    const wymagaKluczy = p.meta.needsKeys === true;
    sources.push({
      id: p.meta.id, label: p.meta.label, count: 0,
      ok: null, skipped: true, rynkowy: wymagaKluczy,
      reason: wymagaKluczy
        ? "brak kluczy — dostawca nieskonfigurowany"
        : "wyłączony w konfiguracji",
    });
  }

  // Czas każdego źródła w logu — bez tego nie da się powiedzieć, które
  // z nich spowalnia wyszukiwanie, a to jest pytanie, które wróci przy pilotażu.
  // Dostawcy pominięci (brak kluczy) nie mają czasu ani cache'u — w logu mają
  // być widoczni, ale opisani tym, czym są, a nie „undefinedms/0".
  console.log("[search] " + sources.map((s) => {
    if (s.skipped) return `${s.id} pominięty(brak kluczy)`;
    // Pending ma `ms` równe miękkiemu limitowi, nie czasowi odpowiedzi — pisanie
    // „2500ms/0" sugerowałoby, że dostawca odpowiedział zerem po dwóch i pół sekundy.
    if (s.pending) return `${s.id} nie zdążył(${s.ms}ms, leci w tle)`;
    return `${s.id} ${s.cached ? "cache/" + s.wiek + "s" : s.ms + "ms"}/${s.count}`;
  }).join("  "));

  const result = { offers: dedupeOffers(offers), sources };
  // `cached` na całej odpowiedzi znaczy: NIC nie poszło do sieci. Gdy choć jedno
  // źródło było odpytywane na żywo, odpowiedź nie jest „z cache" i tak ją opisujemy.
  // ⚠️ Liczą się tylko źródła FAKTYCZNIE ODPYTANE: dostawca pominięty z braku
  // kluczy nigdy nie ma `cached`, więc naiwne `every` po wszystkich wpisach
  // kasowałoby flagę na zawsze — odpowiedź w całości z cache przestałaby się
  // jako taka przedstawiać.
  const odpytane = sources.filter((s) => !s.skipped);
  if (odpytane.length && odpytane.every((s) => s.cached)) result.cached = true;
  return result;
}

// ---------------------------------------------------------------
//  Scalanie duplikatów między źródłami.
//  Gdy ten sam hotel przyjdzie z kilku źródeł (np. feed z bazy + pakiety
//  demo + Hotelbeds), łączymy go w JEDNĄ ofertę zamiast pokazywać kilka razy.
//  Reprezentanta wybiera priorytet dostawcy (realne źródła > demo), a brakujące
//  mocne pola (realne oceny, zdjęcia, link do rezerwacji) dobieramy z pozostałych.
// ---------------------------------------------------------------

// Tożsamość hotelu: znormalizowana nazwa + kraj. Region bywa różnie zapisany
// między źródłami ("Hurghada" vs "Hurghada, Sahl Hasheed"), więc go do klucza
// nie bierzemy — różnice regionu rozstrzyga wybór reprezentanta.
function identityKey(o) {
  return normalizeName(o.name) + "|" + normalizeName(o.country);
}

// Realne zdjęcie (URL) vs gradient-placeholder (CSS).
function hasRealPhoto(o) {
  const p = o.photo || (o.photos && o.photos[0]) || "";
  return /^https?:/i.test(p);
}

export function dedupeOffers(list) {
  const groups = new Map();
  for (const o of list) {
    const key = identityKey(o);
    if (!key.replace(/[|]/g, "").trim()) {
      // Brak nazwy/kraju — nie ryzykujemy scalania, przepuszczamy jako unikat.
      groups.set(Symbol(), [o]);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  const out = [];
  for (const grp of groups.values()) {
    if (grp.length === 1) {
      out.push(strip(attachVariants(grp[0], grp)));
      continue;
    }
    // Reprezentant: najwyższy priorytet dostawcy (najniższy __prio).
    grp.sort((a, b) => (a.__prio ?? 99) - (b.__prio ?? 99));
    const primary = { ...grp[0] };
    const rest = grp.slice(1);

    // Realne oceny (reviews > 0) biją oszacowane — kluczowe dla anty-przekoloryzacji.
    if (!(primary.reviews > 0)) {
      const withReviews = rest.find((o) => o.reviews > 0);
      if (withReviews) {
        primary.rating = withReviews.rating;
        primary.reviews = withReviews.reviews;
        primary.freshDays = withReviews.freshDays;
      }
    }
    // Realne zdjęcia, jeśli reprezentant ma tylko placeholder.
    if (!hasRealPhoto(primary)) {
      const withPhoto = rest.find(hasRealPhoto);
      if (withPhoto) {
        primary.photo = withPhoto.photo;
        primary.photos = withPhoto.photos;
      }
    }
    // Link do rezerwacji (afiliacja) — bierzemy pierwszy dostępny.
    if (!primary.bookingUrl) {
      const withUrl = rest.find((o) => o.bookingUrl);
      if (withUrl) primary.bookingUrl = withUrl.bookingUrl;
    }
    // Fakty o obiekcie z bogatszego źródła (Hotelbeds): odległość od plaży,
    // typ pokoju, dystanse. Reprezentant (np. wakacje) ich nie ma — a to
    // dokładnie dane, których szuka doradca i klient. Nie nadpisujemy tego,
    // co reprezentant już zna.
    if (typeof primary.beach !== "number") {
      const withBeach = rest.find((o) => typeof o.beach === "number");
      if (withBeach) primary.beach = withBeach.beach;
    }
    if (!primary.roomType) {
      const withRoom = rest.find((o) => o.roomType);
      if (withRoom) primary.roomType = withRoom.roomType;
    }
    for (const k of ["airport", "centre", "yearBuilt", "yearRenov", "ski"]) {
      if (typeof primary[k] !== "number") {
        const src = rest.find((o) => typeof o[k] === "number");
        if (src) primary[k] = src[k];
      }
    }
    for (const k of ["adultsOnly", "newHotel"]) {
      if (!primary[k]) {
        const src = rest.find((o) => o[k]);
        if (src) primary[k] = true;
      }
    }
    // Amenities (basen/spa/wifi/...): jeśli reprezentant w ogóle nie ma o nich
    // wiedzy (undefined), bierzemy je z innego źródła, które je ma. Reprezentanta
    // z JUŻ znaną tablicą (nawet pustą — to legalne "sprawdziliśmy, nic nie pasuje")
    // nie nadpisujemy, żeby nie zgubić jego własnej odpowiedzi.
    if (!Array.isArray(primary.amenities)) {
      const withAmenities = rest.find((o) => Array.isArray(o.amenities));
      if (withAmenities) {
        primary.amenities = withAmenities.amenities;
        // Razem z tablicą przejmujemy deklarację pokrycia dawcy (albo jej BRAK) —
        // inaczej lista udogodnień z ograniczonego źródła (demo) czytałaby się jako
        // pełna wiedza i cechy spoza jego zakresu znowu wyszłyby jako "nie ma".
        primary.amenityCoverage = withAmenities.amenityCoverage;
      }
    }
    // Ślad, że oferta łączy kilka źródeł (do ewentualnej plakietki na karcie).
    primary.mergedFrom = grp.map((o) => o.source).filter((s, i, a) => s && a.indexOf(s) === i);
    out.push(strip(attachVariants(primary, grp)));
  }
  return out;
}

// Warianty oferty = wszystkie terminy/wyloty tego samego hotelu, które inaczej
// zniknęłyby przy scalaniu. Zasila „widok hotelu" (klik → lista wylotów z osobnymi
// cenami). Unikalne po (data|wylot|cena), rosnąco po cenie.
function variantOf(o) {
  return {
    departDate: o.departDate || "",
    nights: o.nights || 0,
    price: o.price,
    // Brak sumy zostaje BRAKIEM (undefined), nie zerem: „0 zł za grupę" to nieprawda,
    // a każdy odbiorca musiałby pamiętać, żeby to zero odsiać. Razem z sumą idzie
    // deklaracja, dla ilu osób jest liczona — bez niej wariant kłamie przy składzie
    // innym niż para (patrz ranking.js:offerGroupTotal).
    priceTotal: typeof o.priceTotal === "number" && o.priceTotal > 0 ? o.priceTotal : undefined,
    priceTotalPax: o.priceTotalPax,
    board: o.board || "",
    departureCity: o.departureCity || "",
    transport: o.transport || "",
    operator: o.operator || o.source || "",
    bookingUrl: o.bookingUrl || "",
    offerNumber: o.offerNumber || "",
    // Szczegóły przelotu i warunków — to są cechy WARIANTU, nie hotelu: ten sam
    // obiekt u innego operatora leci z innego lotniska, inną linią i bywa bez
    // transferu. Bez tych pól konsultant musiałby i tak wracać do systemu
    // operatora, czyli Kompas dokładałby krok zamiast go usuwać.
    // Konsekwentnie `undefined`, nie "" ani 0 — brak danych ma zostać brakiem
    // danych (np. wolne miejsca na powrót bywają nieznane).
    days: o.days,
    returnDate: o.returnDate,
    departureCode: o.departureCode,
    arrivalCode: o.arrivalCode,
    carrier: o.carrier,
    flightNo: o.flightNo,
    returnFlightNo: o.returnFlightNo,
    outboundDep: o.outboundDep,
    outboundArr: o.outboundArr,
    returnDep: o.returnDep,
    returnArr: o.returnArr,
    handLuggage: o.handLuggage,
    seatsLeft: o.seatsLeft,
    directFlight: o.directFlight,
    transferIncluded: o.transferIncluded,
    roomOptions: o.roomOptions,
    offerAttributes: o.offerAttributes,
    priceHistory: o.priceHistory,
    optionalUntil: o.optionalUntil,
  };
}
function attachVariants(primary, grp) {
  const seen = new Set();
  const vars = [];
  for (const o of grp) {
    const v = variantOf(o);
    const k = v.departDate + "|" + v.departureCity + "|" + v.price;
    if (!seen.has(k)) { seen.add(k); vars.push(v); }
  }
  vars.sort((a, b) => a.price - b.price);
  primary.variants = vars;
  return primary;
}

function strip(o) {
  const { __prio, ...rest } = o;
  return rest;
}
