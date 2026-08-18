// ============================================================
//  Okresowe sprawdzanie warunków wjazdowych na gov.pl / MSZ
//
//  Użycie:
//    npm run wjazd            – sprawdź i pokaż raport (nic nie zapisuje)
//    npm run wjazd -- --zapisz  – zapisz nowy stan do src/wjazd-stan.json
//    npm run wjazd -- --potwierdz Egipt,Turcja
//                             – oznacz, że TREŚĆ dla tych krajów została
//                               przeczytana i przepisana do countries.js
//
//  Kod wyjścia 1, gdy coś czeka na weryfikację — do wpięcia w rutynę.
// ============================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { monitorowaneKraje, urlKraju, sygnatura, odcisk, porownaj, nowyStan, doWeryfikacji } from "../src/wjazd-monitor.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLIK_STANU = join(ROOT, "src", "wjazd-stan.json");
const args = process.argv.slice(2);
const zapisz = args.includes("--zapisz");
const potwierdzIdx = args.indexOf("--potwierdz");
const doPotwierdzenia = potwierdzIdx > -1 ? String(args[potwierdzIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean) : [];

function wczytajStan() {
  if (!existsSync(PLIK_STANU)) return { ostatnieSprawdzenie: null, kraje: {} };
  try { return JSON.parse(readFileSync(PLIK_STANU, "utf8")); }
  catch { return { ostatnieSprawdzenie: null, kraje: {} }; }
}

const stan = wczytajStan();

// --potwierdz: człowiek przeczytał źródło i zaktualizował countries.js.
if (doPotwierdzenia.length) {
  const dzis = new Date().toISOString().slice(0, 10);
  for (const kraj of doPotwierdzenia) {
    if (!stan.kraje[kraj]) { console.error(`Nieznany kraj w stanie: ${kraj}`); process.exit(2); }
    stan.kraje[kraj].zweryfikowane = dzis;
  }
  writeFileSync(PLIK_STANU, JSON.stringify(stan, null, 2) + "\n", "utf8");
  console.log(`Oznaczono jako zweryfikowane (${dzis}): ${doPotwierdzenia.join(", ")}`);
  console.log("Pamiętaj, żeby PRACTICAL_DATA_DATE w src/countries.js też wskazywało aktualny miesiąc.");
  process.exit(0);
}

async function sprawdzKraj(kraj) {
  const url = urlKraju(kraj);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Kompas/1.0 (monitor warunkow wjazdowych)" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { kraj, blad: `HTTP ${res.status}` };
    const tekst = await res.text();
    const s = sygnatura({ etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), dlugosc: tekst.length });
    return { kraj, url, sygnatura: s, odcisk: odcisk(s) };
  } catch (err) {
    return { kraj, blad: err.name === "TimeoutError" ? "przekroczony limit czasu" : err.message };
  }
}

const kraje = monitorowaneKraje();
console.log(`\nWarunki wjazdowe — sprawdzam ${kraje.length} ${kraje.length === 1 ? "kraj" : "krajów"} na gov.pl\n`);

const wyniki = [];
for (const kraj of kraje) wyniki.push(await sprawdzKraj(kraj));

const { zmienione, bezZmian, niedostepne } = porownaj(stan, wyniki);

for (const z of zmienione) console.log(`  ZMIANA    ${z.kraj.padEnd(12)} ${z.powod}${z.poprzednioSprawdzone ? ` (poprzednio: ${z.poprzednioSprawdzone})` : ""}`);
for (const b of bezZmian) console.log(`  bez zmian ${b.kraj.padEnd(12)} ostatnio sprawdzone ${b.poprzednioSprawdzone}`);
for (const n of niedostepne) console.log(`  BŁĄD      ${n.kraj.padEnd(12)} ${n.powod}`);

if (zapisz) {
  writeFileSync(PLIK_STANU, JSON.stringify(nowyStan(stan, wyniki), null, 2) + "\n", "utf8");
  console.log(`\nStan zapisany do src/wjazd-stan.json`);
}

const czekaja = doWeryfikacji(zapisz ? nowyStan(stan, wyniki) : stan);
console.log("\n" + "=".repeat(62));
if (czekaja.length) {
  console.log("DO WERYFIKACJI PRZEZ CZŁOWIEKA:");
  for (const c of czekaja) console.log(`  ${c.kraj} — strona MSZ zmieniła się ${c.zmienioneOd}${c.zweryfikowane ? `, ostatnia weryfikacja treści: ${c.zweryfikowane}` : ", treść nigdy nie była weryfikowana"}`);
  console.log("\nCo zrobić:");
  console.log("  1. otwórz https://www.gov.pl/web/dyplomacja/<kraj> i przeczytaj warunki wjazdu,");
  console.log("  2. jeśli faktycznie się zmieniły — popraw `practical` w src/countries.js");
  console.log("     i zaktualizuj PRACTICAL_DATA_DATE,");
  console.log("  3. npm run wjazd -- --potwierdz " + czekaja.map((c) => c.kraj).join(","));
  console.log("\nUWAGA: sygnatura strony (ETag) zmienia się też przy poprawkach redakcyjnych,");
  console.log("więc ZMIANA nie znaczy jeszcze, że przepisy są inne. Dlatego czyta to człowiek.");
} else {
  console.log("Nic nie czeka na weryfikację.");
}
console.log("");
process.exit(czekaja.length ? 1 : 0);
