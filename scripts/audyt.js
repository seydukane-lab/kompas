// ============================================================
//  Audyt danych na ŻYWYCH źródłach
//
//  Testy (`npm test`) sprawdzają logikę na atrapach — celowo, bo mają działać
//  bez sieci i bez kluczy API. Dlatego nie zobaczą klasy błędów, która bierze
//  się z tego, co realnie przychodzi od dostawców: pola znaczącego co innego
//  w każdym źródle, sumy dla innego składu, przemilczanego braku danych.
//
//  Dokładnie tak wyszedł błąd z 17.08.2026: przy rodzinie 2+3 wszystkie oferty
//  pokazywały „Razem" za parę. Żaden test tego nie łapał, bo każdy z osobna
//  był zielony — widać to było dopiero na prawdziwych danych, w liczbach.
//
//  Ten skrypt odpytuje uruchomiony panel tak, jak robi to konsultant, i szuka
//  niespójności. Nie zastępuje testów — pyta o coś innego.
//
//  Użycie:
//    npm start                     (w drugim oknie, albo serwer już działa)
//    npm run audyt                 (domyślnie http://127.0.0.1:3000)
//    KOMPAS_URL=... KOMPAS_EMAIL=... KOMPAS_PASS=... npm run audyt
// ============================================================

import { podejrzaneZero, ocenObietnice, filtrPrzecieka, filtrBezPotwierdzen, plakietkiRozproszenia, ocenFiltrWariantowy } from "../src/audyt-reguly.js";

const BASE = process.env.KOMPAS_URL || "http://127.0.0.1:3000";
const EMAIL = process.env.KOMPAS_EMAIL || "test@local.test";
const PASS = process.env.KOMPAS_PASS || "haslo12345";

const znaleziska = [];
const zglos = (waga, tytul, szczegol) => znaleziska.push({ waga, tytul, szczegol });
const licz = (n) => String(n).padStart(4);

async function zaloguj() {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  if (!r.ok) {
    console.error(`\nNie udało się zalogować jako ${EMAIL} (HTTP ${r.status}).`);
    console.error("Załóż konto testowe albo podaj własne:");
    console.error('  npm run user:add -- test@local.test "Test" haslo12345 admin');
    console.error("  KOMPAS_EMAIL=... KOMPAS_PASS=... npm run audyt\n");
    process.exit(2);
  }
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
}

async function szukaj(cookie, query) {
  const t0 = Date.now();
  const res = await fetch(BASE + "/api/search?" + query, { headers: { cookie } });
  const body = await res.json().catch(() => ({}));
  return { ...body, ms: Date.now() - t0, status: res.status };
}

// Ten sam wzór co offerGroupTotal w ranking.js i offerTotal w index.html.
function sumaZaGrupe(o, pax) {
  const osob = Math.max(1, pax || 1);
  return (typeof o.priceTotal === "number" && o.priceTotal > 0 && o.priceTotalPax === osob)
    ? o.priceTotal
    : o.price * osob;
}

const SCENARIUSZE = [
  { opis: "para, popularne kierunki", query: "countries=Grecja,Egipt,Turcja&adults=2", pax: 2 },
  { opis: "rodzina 2+3 z wiekiem dzieci", query: "countries=Grecja,Egipt,Turcja&adults=2&kids=3&childAges=6,9,12", pax: 5 },
  { opis: "budżet do 4000 zł/os.", query: "countries=Grecja,Turcja&adults=2&budget=4000&budgetMode=person", pax: 2 },
  { opis: "tylko 5 gwiazdek", query: "countries=Grecja,Egipt,Turcja&adults=2&minStars=5", pax: 2 },
  { opis: "wylot z Katowic, samolotem", query: "countries=Grecja,Egipt,Turcja&adults=2&departures=Katowice&transports=Samolot", pax: 2 },
];

const cookie = await zaloguj();
console.log(`\nAudyt danych — ${BASE}\n`);

for (const s of SCENARIUSZE) {
  const d = await szukaj(cookie, s.query + "&sort=total");
  const oferty = d.offers || [];
  console.log(`${s.opis.padEnd(32)} ${licz(oferty.length)} ofert  ${licz(d.ms)} ms`);

  if (d.status !== 200) { zglos("WYSOKA", `scenariusz „${s.opis}" zwrócił HTTP ${d.status}`, JSON.stringify(d).slice(0, 120)); continue; }

  for (const o of oferty) {
    if (!(o.price > 0)) zglos("WYSOKA", "cena zerowa lub ujemna", `${o.name}: ${o.price}`);
    if (typeof o.priceTotal === "number" && o.priceTotal > 0 && typeof o.priceTotalPax !== "number") {
      zglos("WYSOKA", "cena łączna bez informacji, dla ilu osób", `${o.name}: ${o.priceTotal} zł (${o.source || "?"})`);
    }
    // Ocena bez liczby opinii to NORMALNY stan części źródeł (Hotelbeds Content API
    // nie ma recenzji, wakacje.pl podaje samą ocenę) — panel oznacza takie oferty
    // jako „brak danych o opiniach", więc to informacja o zasięgu danych, nie błąd.
    // Błędem byłoby dopiero twierdzenie o wolumenie, którego nie znamy.
    if (o.reviews === 0 && o.rating >= 9) zglos("INFO", "ocena bez potwierdzenia liczbą opinii", `${o.name}: ${o.rating} (${o.source || "?"})`);
    // Ocena poza skalą albo NaN po serializacji — to już realny błąd danych.
    if (o.rating != null && !(o.rating >= 0 && o.rating <= 10)) {
      zglos("WYSOKA", "ocena poza skalą 0-10", `${o.name}: ${o.rating}`);
    }
    for (const v of o.variants || []) {
      if (v.priceTotal === 0) zglos("ŚREDNIA", "wariant z sumą 0 zł", `${o.name} / ${v.operator || "?"}`);
      if (v.departDate && v.returnDate && v.returnDate < v.departDate) {
        zglos("WYSOKA", "powrót przed wylotem", `${o.name} / ${v.operator || "?"}`);
      }
    }
  }

  // Kolejność musi się zgadzać z sumą, którą realnie widzi konsultant.
  const sumy = oferty.map((o) => sumaZaGrupe(o, s.pax));
  const zlamania = sumy.filter((v, i) => i && v < sumy[i - 1]).length;
  if (zlamania) zglos("WYSOKA", `sortowanie po sumie nie trzyma kolejności („${s.opis}")`, `${zlamania} par nie po kolei`);

  // Źródła: co padło i dlaczego — to jest wiadomość dla właściciela, nie błąd kodu.
  for (const zr of d.sources || []) {
    if (zr.ok === false) console.log(`   └ ${zr.label || zr.id}: ${zr.reason || "brak odpowiedzi"}`);

    // Zero ofert po kilkunastu sekundach = błąd połknięty przez dostawcę
    // i podany jako brak wyników. Reguła i uzasadnienie: src/audyt-reguly.js.
    if (podejrzaneZero(zr)) {
      zglos("WYSOKA", `„${zr.label || zr.id}" zwraca zero ofert po ${(zr.ms / 1000).toFixed(1)} s`,
        "uczciwe zero przychodzi szybko — to wygląda na błąd połknięty przez dostawcę i zaraportowany jako brak wyników (ok:true zamiast ok:false)");
    }
  }
}

// Filtry, które przepuszczają wyłącznie oferty bez danych — panel musi to napisać
// wprost, ale warto wiedzieć, których cech to dotyczy przy bieżącym zestawie źródeł.
// UWAGA na nazwy kluczy: do 26.08.2026 stało tu "plaza-blisko", a atrybut nazywa się
// "plaza". Nieznany klucz nie odsiewał niczego, więc audyt co przebieg raportował
// "filtr zwraca same niewiadome" — znalezisko było artefaktem literówki w tym pliku.
// Dlatego niżej sprawdzamy też attrsNieznane: serwer mówi teraz wprost, czego nie zna.
for (const attr of ["pokoje-polaczone", "pokoj-dzielony", "plaza", "niepelnosprawni"]) {
  const d = await szukaj(cookie, `countries=Grecja,Egipt,Turcja&adults=2&attrs=${attr}`);
  if (d.attrsNieznane && d.attrsNieznane.length) {
    zglos("WYSOKA", `serwer nie zna atrybutu „${d.attrsNieznane.join(", ")}"`,
      "filtr o nieznanym kluczu nie odsiewa NICZEGO — lista wygląda na przefiltrowaną, a nie jest");
    continue;
  }
  const pokrycie = (d.attrs || [])[0];
  if (!pokrycie) continue;
  console.log(`atrybut ${attr.padEnd(24)} ${licz(d.count || 0)} ofert = ${pokrycie.confirmed} potwierdzonych + ${pokrycie.unknown} bez danych`);
  if (d.count > 0 && pokrycie.confirmed === 0) {
    zglos("INFO", `filtr „${attr}" zwraca same niewiadome`, `${d.count} ofert, 0 potwierdzonych`);
  }
}

// ------------------------------------------------------------------
//  Czy filtr faktycznie trzyma to, co obiecał
//
//  W nocy 26/27.08.2026 wyszło, że filtr o nieznanej nazwie klucza przepuszczał
//  CAŁY katalog, a panel liczył go jako aktywny. Znalezione przypadkiem — więc
//  ta sekcja zamienia tamto znalezisko w regułę i pyta o KAŻDY filtr osobno.
//
//  Dwa różne wnioski, oba ważne dla konsultanta:
//   - JAWNE ZŁAMANIE: wśród wyników jest oferta, o której WIEMY, że kryterium nie
//     spełnia. Filtr przecieka — ta oferta nie miała prawa tu być (WYSOKA).
//   - SAME NIEWIADOME: żadna oferta kryterium nie potwierdza, wszystkie przeszły
//     na braku danych. Filtr niczego nie gwarantuje, a lista wygląda na zawężoną (INFO).
//  Brak danych sam w sobie NIE jest błędem — to świadoma zasada (patrz applyFilters).
//  Błędem jest dopiero cisza na ten temat.
// ------------------------------------------------------------------
const OBIETNICE = [
  { opis: "min. 5 gwiazdek", query: "countries=Grecja,Egipt,Turcja&adults=2&minStars=5",
    znane: (o) => o.stars != null, spelnia: (o) => o.stars >= 5 },
  { opis: "ocena min. 9,0", query: "countries=Grecja,Egipt,Turcja&adults=2&minRate=9",
    znane: (o) => o.rating != null, spelnia: (o) => o.rating >= 9 },
  // Tolerancja +/-1 noc jest w applyFilters celowa (7 vs 8 to ten sam wyjazd).
  { opis: "7 nocy", query: "countries=Grecja,Egipt,Turcja&adults=2&nights=7",
    znane: (o) => o.nights != null && o.nights > 0, spelnia: (o) => Math.abs(o.nights - 7) <= 1 },
  { opis: "all inclusive", query: "countries=Grecja,Egipt,Turcja&adults=2&boards=All Inclusive",
    znane: (o) => o.board != null, spelnia: (o) => o.board === "All Inclusive" },
  // Ten jeden nie ma stanu "nie wiem": to filtr O BRAKU danych, więc każda oferta
  // bez wolumenu opinii jest jawnym złamaniem, a nie niewiadomą.
  { opis: "tylko z realnymi opiniami", query: "countries=Grecja,Egipt,Turcja&adults=2&onlyReviewed=1",
    znane: () => true, spelnia: (o) => o.reviews > 0 },
  { opis: "budżet 4000 zł/os.", query: "countries=Grecja,Egipt,Turcja&adults=2&budget=4000&budgetMode=person",
    znane: (o) => typeof o.price === "number", spelnia: (o) => o.price <= 4000 },
];

console.log("");
for (const ob of OBIETNICE) {
  const d = await szukaj(cookie, ob.query);
  if (d.status !== 200) { zglos("WYSOKA", `filtr „${ob.opis}" zwrócił HTTP ${d.status}`, ""); continue; }
  const oferty = d.offers || [];
  if (!oferty.length) { console.log(`obietnica ${ob.opis.padEnd(28)}    0 ofert — nie ma czego sprawdzać`); continue; }

  const ocena = ocenObietnice(oferty, ob.znane, ob.spelnia);
  console.log(`obietnica ${ob.opis.padEnd(28)} ${licz(ocena.razem)} ofert = ${ocena.potwierdza} potwierdza + ${ocena.bezDanych} bez danych + ${ocena.lamie} łamie`);

  if (filtrPrzecieka(ocena)) {
    const p = ocena.przyklady[0];
    zglos("WYSOKA", `filtr „${ob.opis}" przecieka`,
      `${ocena.lamie} z ${ocena.razem} ofert jawnie go nie spełnia, np. ${p.name} (${p.source || "?"})`);
  }
  if (filtrBezPotwierdzen(ocena)) {
    zglos("INFO", `filtr „${ob.opis}" niczego nie potwierdza`,
      `${ocena.razem} ofert przeszło wyłącznie na braku danych — lista wygląda na zawężoną, a nie jest`);
  }
}

// ------------------------------------------------------------------
//  Czy plakietka „terminy rozproszone" mówi prawdę
//
//  Panel pisze przy ofercie, że ŻADEN pojedynczy termin nie spełnia wszystkich
//  filtrów naraz. To zdanie idzie dalej do klienta — konsultant uprzedza go, że
//  wyjazd trzeba poskładać inaczej, niż wygląda na karcie. Sprawdzamy je licząc
//  wszystko OD NOWA z wariantów, które wróciły z API (patrz audyt-reguly.js:
//  rozproszenieZWariantow), a nie wołając ranking.js — inaczej audyt potwierdzałby
//  sam siebie i przespał błąd obecny po obu stronach naraz.
//
//  Kombinacje dobrane pod zjawisko: to pary „miasto wylotu + dzień tygodnia" dawały
//  76% rozproszonych ofert (pomiar z 18.08.2026), a Warszawa+Autokar zero.
// ------------------------------------------------------------------
const ROZPROSZENIA = [
  { opis: "Katowice + sobota", query: "countries=Grecja,Egipt,Turcja&adults=2&departures=Katowice&weekdays=6",
    kryteria: { departures: ["Katowice"], weekdays: [6] } },
  { opis: "Samolot + niedziela", query: "countries=Grecja,Egipt,Turcja&adults=2&transports=Samolot&weekdays=0",
    kryteria: { transports: ["Samolot"], weekdays: [0] } },
  { opis: "Warszawa + Autokar", query: "countries=Grecja,Egipt,Turcja&adults=2&departures=Warszawa&transports=Autokar",
    kryteria: { departures: ["Warszawa"], transports: ["Autokar"] } },
];

console.log("");
for (const r of ROZPROSZENIA) {
  const d = await szukaj(cookie, r.query);
  if (d.status !== 200) { zglos("WYSOKA", `„${r.opis}" zwrócił HTTP ${d.status}`, ""); continue; }
  const w = plakietkiRozproszenia(d.offers || [], r.kryteria);
  if (!w.sprawdzone) { console.log(`rozproszenie ${r.opis.padEnd(22)}    — brak ofert z kilkoma terminami`); continue; }
  console.log(`rozproszenie ${r.opis.padEnd(22)} ${licz(w.sprawdzone)} ofert = ${w.zgodne} zgodnych + ${w.brakujaca.length} bez plakietki + ${w.nadmiarowa.length} z nadmiarową`);

  // Plakietki BRAKUJĄCEJ nie widać — konsultant obiecuje klientowi wyjazd,
  // którego w tym układzie nie ma. To groźniejszy kierunek pomyłki.
  if (w.brakujaca.length) {
    zglos("WYSOKA", `brak plakietki „terminy rozproszone" przy „${r.opis}"`,
      `${w.brakujaca.length} ofert: ${w.brakujaca.slice(0, 3).join(", ")}`);
  }
  // Plakietka NADMIAROWA straszy rozproszeniem, którego nie ma.
  if (w.nadmiarowa.length) {
    zglos("ŚREDNIA", `nadmiarowa plakietka „terminy rozproszone" przy „${r.opis}"`,
      `${w.nadmiarowa.length} ofert: ${w.nadmiarowa.slice(0, 3).join(", ")}`);
  }
}

// ------------------------------------------------------------------
//  Czy filtry WARIANTOWE (pakietowe) trzymają obietnicę
//
//  Sekcja OBIETNICE wyżej pyta o pola SAMEJ oferty. Wylot z miasta, transport,
//  dzień tygodnia i okno terminu odpowiadają na inne pytanie: oferta przechodzi,
//  gdy KTÓRYKOLWIEK z jej terminów spełnia kryterium (ranking.js:matchesAnyVariant).
//  Reprezentant na karcie bywa innym wariantem niż ten, który filtr przepuścił,
//  więc tamta reguła nie umiałaby tych czterech filtrów sprawdzić — i do 28.08.2026
//  nikt ich maszynowo nie sprawdzał, mimo że 27.08 zmieniła się semantyka terminu.
//
//  Liczone OD NOWA z variants[] (audyt-reguly.js:ocenFiltrWariantowy), nie przez
//  ranking.js — inaczej audyt potwierdzałby sam siebie.
//
//  Okno terminu sprawdzamy po dacie WYLOTU wariantu, zgodnie z decyzją właściciela
//  z 27.08.2026 (patrz variantWithinDates): data powrotu nie jest tu warunkiem.
//  Gdyby ktoś cofnął tamtą zmianę, ten test zapali się jako przeciek.
// ------------------------------------------------------------------
// Okno liczone od DZIŚ, żeby audyt nie zestarzał się razem z wpisaną datą.
// Ta sama para OD/DO idzie do zapytania i do testu, więc nie ma jak się rozjechać.
const zaDni = (dni) => new Date(Date.now() + dni * 86400000).toISOString().slice(0, 10);
const OD = zaDni(10);
const DO = zaDni(30);

const WARIANTOWE = [
  { opis: "wylot z Katowic", query: "countries=Grecja,Egipt,Turcja&adults=2&departures=Katowice",
    test: (v) => v.departureCity === "Katowice" },
  { opis: "transport: Samolot", query: "countries=Grecja,Egipt,Turcja&adults=2&transports=Samolot",
    test: (v) => v.transport === "Samolot" },
  { opis: "wylot w sobotę", query: "countries=Grecja,Egipt,Turcja&adults=2&weekdays=6",
    test: (v) => !!v.departDate && new Date(v.departDate + "T00:00:00").getDay() === 6 },
  { opis: `okno terminu ${OD}..${DO}`, query: `countries=Grecja,Egipt,Turcja&adults=2&from=${OD}&to=${DO}`,
    test: (v) => !!v.departDate && v.departDate >= OD && v.departDate <= DO },
];

console.log("");
for (const w of WARIANTOWE) {
  const d = await szukaj(cookie, w.query);
  if (d.status !== 200) { zglos("WYSOKA", `filtr „${w.opis}" zwrócił HTTP ${d.status}`, ""); continue; }
  const oferty = d.offers || [];
  const ocena = ocenFiltrWariantowy(oferty, w.test);

  if (!ocena.razem) {
    console.log(`wariant ${w.opis.padEnd(31)}    0 ofert pakietowych — nie ma czego sprawdzać`);
    continue;
  }
  console.log(`wariant ${w.opis.padEnd(31)} ${licz(ocena.razem)} ofert = ${ocena.potwierdza} potwierdza + ${ocena.lamie} łamie`);

  // Tu nie ma stanu „bez danych": wariant bez daty czy bez miasta po prostu nie
  // spełnia kryterium, dokładnie jak w applyFilters. Każde złamanie jest jawne.
  if (filtrPrzecieka(ocena)) {
    const p = ocena.przyklady[0];
    zglos("WYSOKA", `filtr „${w.opis}" przecieka`,
      `${ocena.lamie} z ${ocena.razem} ofert nie ma ANI JEDNEGO pasującego terminu, np. ${p.name} (${p.source || "?"})`);
  }
}

console.log("\n" + "=".repeat(60));
if (!znaleziska.length) {
  console.log("Bez anomalii w badanych scenariuszach.");
} else {
  // Te same znaleziska powtarzają się dla wielu ofert — grupujemy, żeby raport
  // dało się przeczytać, zamiast przewijać sto identycznych linii.
  const wg = new Map();
  for (const z of znaleziska) {
    const klucz = z.waga + "|" + z.tytul;
    if (!wg.has(klucz)) wg.set(klucz, []);
    wg.get(klucz).push(z.szczegol);
  }
  for (const [klucz, szczegoly] of wg) {
    const [waga, tytul] = klucz.split("|");
    console.log(`[${waga}] ${tytul} — ${szczegoly.length}×`);
    for (const s of szczegoly.slice(0, 3)) console.log(`         ${s}`);
    if (szczegoly.length > 3) console.log(`         … i ${szczegoly.length - 3} więcej`);
  }
}
console.log("");
// Kod wyjścia: 1 tylko przy realnych błędach danych, żeby dało się to wpiąć w CI.
process.exit(znaleziska.some((z) => z.waga === "WYSOKA") ? 1 : 0);
