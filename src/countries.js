// ============================================================
//  Dane krajów: regiony (+ kody destynacji Hotelbeds) oraz
//  "informacje praktyczne" / warunki wjazdowe (model jak Itaka).
//
//  Warunki wjazdowe zebrane ze stron gov.pl / MSZ oraz biur podróży
//  (stan: lipiec 2026). ZAWSZE do zweryfikowania przed wyjazdem —
//  panel pokazuje datę i link do gov.pl. Docelowo (Etap 3) można to
//  odświeżać automatycznie z portalu MSZ.
//
//  hbCode: kod destynacji Hotelbeds. Oznaczone [sandbox] mają
//  potwierdzone dane w środowisku testowym (konto SPAIN).
// ============================================================

export const COUNTRIES = {
  Hiszpania: {
    flag: "🇪🇸",
    regions: [
      { name: "Majorka", hbCode: "PMI" },            // [sandbox] 296 hoteli
      { name: "Barcelona / Costa Brava", hbCode: "BCN" }, // [sandbox]
      { name: "Costa del Sol (Malaga)", hbCode: "AGP" },  // [sandbox]
      { name: "Ibiza", hbCode: "IBZ" },              // [sandbox]
      { name: "Gran Canaria", hbCode: "LPA" },       // [sandbox]
      { name: "Menorka", hbCode: "MAH" },            // [sandbox]
      { name: "Madryt", hbCode: "MAD" },             // [sandbox]
    ],
    practical: {
      documents: "Dowód osobisty lub paszport (kraj strefy Schengen).",
      visa: "Bez wizy — pobyty turystyczne w ramach UE.",
      currency: "Euro (EUR)",
      time: "UTC+1 — ta sama strefa co w Polsce.",
      language: "hiszpański",
      emergency: "112",
      plug: "Gniazdka typu C/F, 230 V — wtyczki jak w Polsce.",
      health: "Zabierz kartę EKUZ (bezpłatna opieka w ramach NFZ). Brak wymaganych szczepień.",
      note: "Podróż w ramach strefy Schengen — brak kontroli granicznej, ale dokument tożsamości obowiązkowy.",
    },
  },

  Grecja: {
    flag: "🇬🇷",
    regions: [
      { name: "Kreta", hbCode: "CHQ" },
      { name: "Rodos", hbCode: "RHO" },
      { name: "Zakynthos", hbCode: "ZTH" },
      { name: "Kos", hbCode: "KGS" },
      { name: "Korfu", hbCode: "CFU" },
      { name: "Santorini", hbCode: "JTR" },
    ],
    practical: {
      documents: "Dowód osobisty lub paszport (kraj strefy Schengen).",
      visa: "Bez wizy — pobyty turystyczne w ramach UE.",
      currency: "Euro (EUR)",
      time: "UTC+2 — jedna godzina do przodu względem Polski.",
      language: "grecki",
      emergency: "112",
      plug: "Gniazdka typu C/F, 230 V — wtyczki jak w Polsce.",
      health: "Zabierz kartę EKUZ. Brak wymaganych szczepień.",
      note: "Na wyspach opłata klimatyczna pobierana w hotelu (zależna od kategorii obiektu).",
    },
  },

  Egipt: {
    flag: "🇪🇬",
    regions: [
      { name: "Hurghada", hbCode: "HRG" },
      { name: "Sharm el-Sheikh", hbCode: "SSH" },
      { name: "Marsa Alam", hbCode: "RMF" },
    ],
    practical: {
      documents: "Paszport ważny min. 6 miesięcy od daty powrotu.",
      visa: "Wiza wymagana. Na lotnisku (30 USD, od III 2026), e-wiza online lub w ambasadzie. Uwaga: dla kurortów Synaju (Sharm el-Sheikh, Dahab, Taba) dostępna bezpłatna wiza-stempel na 14 dni.",
      currency: "Funt egipski (EGP); w kurortach USD/EUR mile widziane.",
      time: "UTC+2 — jedna godzina do przodu względem Polski.",
      language: "arabski (w kurortach angielski)",
      emergency: "122 (policja), 123 (pogotowie)",
      plug: "Gniazdka typu C/F, 220 V — wtyczki jak w Polsce.",
      health: "Brak obowiązkowych szczepień. Zalecana ostrożność z wodą i lodem (pij butelkowaną). Ubezpieczenie turystyczne konieczne.",
      note: "Paszport musi mieć wszystkie strony i być nieuszkodzony — inaczej możliwa odmowa wjazdu.",
    },
  },

  Turcja: {
    flag: "🇹🇷",
    regions: [
      { name: "Antalya / Belek", hbCode: "AYT" },
      { name: "Bodrum", hbCode: "BJV" },
      { name: "Marmaris / Dalaman", hbCode: "DLM" },
      { name: "Alanya", hbCode: "GZP" },
    ],
    practical: {
      documents: "Dowód osobisty (ważny na cały pobyt) LUB paszport (ważny min. 150 dni od wjazdu). Aplikacja mObywatel NIE jest akceptowana.",
      visa: "Bez wizy do 90 dni w każdym okresie 180 dni.",
      currency: "Lira turecka (TRY)",
      time: "UTC+3 — dwie godziny do przodu względem Polski.",
      language: "turecki (w kurortach angielski)",
      emergency: "112",
      plug: "Gniazdka typu C/F, 230 V — wtyczki jak w Polsce.",
      health: "Brak obowiązkowych szczepień. Zalecane ubezpieczenie turystyczne.",
      note: "Przy wjeździe na dowód dostajesz białą kartkę (potwierdzenie wjazdu) — NIE zgub jej, jest sprawdzana przy wylocie. Dzieci muszą mieć własny dokument.",
    },
  },

  Włochy: {
    flag: "🇮🇹",
    regions: [
      { name: "Sardynia", hbCode: "OLB" },
      { name: "Sycylia", hbCode: "CTA" },
      { name: "Rzym / Lacjum", hbCode: "ROM" },
      { name: "Wenecja", hbCode: "VCE" },
    ],
    practical: {
      documents: "Dowód osobisty lub paszport (kraj strefy Schengen).",
      visa: "Bez wizy — pobyty turystyczne w ramach UE.",
      currency: "Euro (EUR)",
      time: "UTC+1 — ta sama strefa co w Polsce.",
      language: "włoski",
      emergency: "112",
      plug: "Gniazdka typu C/F/L, 230 V — zwykle pasują polskie wtyczki (miejscami przydaje się przejściówka typu L).",
      health: "Zabierz kartę EKUZ. Brak wymaganych szczepień.",
      note: "W wielu miastach obowiązuje opłata klimatyczna (tassa di soggiorno) płatna w hotelu.",
    },
  },

  Tunezja: {
    flag: "🇹🇳",
    regions: [
      { name: "Dżerba", hbCode: "DJE" },
      { name: "Hammamet / Enfidha", hbCode: "NBE" },
      { name: "Monastir / Sousse", hbCode: "MIR" },
    ],
    practical: {
      documents: "Paszport (od 1 stycznia 2025 wjazd wyłącznie na paszport). Ważny min. 3 miesiące od daty wyjazdu z Tunezji.",
      visa: "Bez wizy do 90 dni.",
      currency: "Dinar tunezyjski (TND) — nie wolno go wywozić.",
      time: "UTC+1 — ta sama strefa co w Polsce.",
      language: "arabski, francuski",
      emergency: "197 (policja), 190 (pogotowie)",
      plug: "Gniazdka typu C/E, 230 V — wtyczki jak w Polsce.",
      health: "Brak obowiązkowych szczepień. Ostrożność z wodą (pij butelkowaną). Ubezpieczenie zalecane.",
      note: "Podatek turystyczny płatny w hotelu: ~4 (1–2*), ~8 (3*), ~12 (4–5*) dinarów/os./noc, od 12 r.ż., maks. 10 nocy.",
    },
  },

  Portugalia: {
    flag: "🇵🇹",
    regions: [
      { name: "Algarve", hbCode: "FAO" },
      { name: "Lizbona", hbCode: "LIS" },
      { name: "Madera", hbCode: "FNC" },
    ],
    practical: {
      documents: "Dowód osobisty lub paszport (kraj strefy Schengen).",
      visa: "Bez wizy — pobyty turystyczne w ramach UE.",
      currency: "Euro (EUR)",
      time: "UTC+0 — jedna godzina do tyłu względem Polski.",
      language: "portugalski",
      emergency: "112",
      plug: "Gniazdka typu C/F, 230 V — wtyczki jak w Polsce.",
      health: "Zabierz kartę EKUZ. Brak wymaganych szczepień.",
      note: "W niektórych miastach (m.in. Lizbona, Porto) obowiązuje opłata miejska płatna w hotelu.",
    },
  },
};

// Płaski indeks regionów po nazwie -> { country, hbCode, flag }.
// Nazwy regionów są unikalne między krajami, więc mapa może wybierać
// regiony z różnych krajów bez podawania kraju.
const REGION_INDEX = {};
for (const [country, c] of Object.entries(COUNTRIES)) {
  for (const r of c.regions) REGION_INDEX[r.name] = { country, hbCode: r.hbCode, flag: c.flag };
}
export function regionInfo(name) {
  return REGION_INDEX[name] || null;
}

// Kod destynacji Hotelbeds dla wybranego regionu.
export function regionCode(country, region) {
  const c = COUNTRIES[country];
  if (!c) return null;
  const r = c.regions.find((x) => x.name === region);
  return r ? r.hbCode : null;
}

// Wersja dla przeglądarki (bez logiki serwera).
export function clientData() {
  const out = {};
  for (const [name, c] of Object.entries(COUNTRIES)) {
    out[name] = {
      flag: c.flag,
      regions: c.regions.map((r) => r.name),
      practical: c.practical,
    };
  }
  return out;
}
