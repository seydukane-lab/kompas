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
    if (o.reviews === 0 && o.rating >= 9) zglos("WYSOKA", "wysoka ocena przy zerze opinii", `${o.name}: ${o.rating}`);
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
  }
}

// Filtry, które przepuszczają wyłącznie oferty bez danych — panel musi to napisać
// wprost, ale warto wiedzieć, których cech to dotyczy przy bieżącym zestawie źródeł.
for (const attr of ["pokoje-polaczone", "pokoj-dzielony", "plaza-blisko", "niepelnosprawni"]) {
  const d = await szukaj(cookie, `countries=Grecja,Egipt,Turcja&adults=2&attrs=${attr}`);
  const pokrycie = (d.attrs || [])[0];
  if (!pokrycie) continue;
  console.log(`atrybut ${attr.padEnd(24)} ${licz(d.count || 0)} ofert = ${pokrycie.confirmed} potwierdzonych + ${pokrycie.unknown} bez danych`);
  if (d.count > 0 && pokrycie.confirmed === 0) {
    zglos("INFO", `filtr „${attr}" zwraca same niewiadome`, `${d.count} ofert, 0 potwierdzonych`);
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
