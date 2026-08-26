// ============================================================
//  Czasy odpowiedzi źródeł — kalibracja miękkiego limitu
//
//  PROVIDER_SOFT_TIMEOUT_MS decyduje, ile konsultant czeka, zanim oddamy mu
//  to, co dojechało. Dobiera się go RAZ na jakiś czas i tylko wtedy, gdy zna
//  się realne czasy źródeł — a te się zmieniają: dostawca przyspiesza, pula
//  zapytań się wyczerpuje, dochodzi nowe źródło.
//
//  Ten skrypt odpytuje każde włączone źródło OSOBNO, bez wyścigu i bez cache'u,
//  więc widzi ich prawdziwe czasy — a nie ucięte progiem. Potem pokazuje, co
//  obecny próg z nimi robi i ile czekania da się oddać konsultantowi bez
//  zmiany wyniku.
//
//  Nie zmienia niczego w konfiguracji. Próg to decyzja właściciela: zapas nad
//  najwolniejszym źródłem, które ma zdążyć, jest kwestią ryzyka, nie arytmetyki.
//
//  Użycie:
//    npm run czasy                          (kilka krajów, domyślny próg z .env)
//    npm run czasy -- Grecja Egipt          (własna lista krajów)
//    PROVIDER_SOFT_TIMEOUT_MS=2000 npm run czasy
// ============================================================

import "dotenv/config";
import { activeProviders, providerStatus } from "../src/providers/index.js";
import { analizaProgu, najwiekszaPrzerwa } from "../src/czasy-zrodel.js";
import { ensureRate } from "../src/fx.js";

const PROG = Number(process.env.PROVIDER_SOFT_TIMEOUT_MS) || 6000;
const KRAJE = process.argv.slice(2).length ? process.argv.slice(2) : ["Grecja", "Egipt", "Hiszpania", "Turcja"];

// Kryteria możliwie neutralne — chodzi o czas źródła, nie o trafność wyniku.
const BAZA = {
  adults: 2, kids: 0, pax: 2, childAges: [], nights: 0, budget: 0, budgetMode: "person",
  minRate: 0, minStars: 0, onlyReviewed: false, boards: [], tags: [], departure: "",
  departures: [], transports: [], attrs: [], weekdays: [], regions: [], name: "",
  from: "", to: "", sort: "score",
};

function ms(n) {
  return (n === null || n === undefined ? "-" : String(n)) + " ms";
}

async function main() {
  const aktywne = activeProviders();
  if (!aktywne.length) {
    console.log("\nŻadne źródło nie jest włączone — nie ma czego mierzyć.");
    console.log("Stan źródeł:", providerStatus().map((s) => `${s.id}=${s.enabled ? "on" : "off"}`).join(" "));
    return;
  }

  // Kurs pobieramy PRZED pomiarem: inaczej pierwsze źródło płaci w swoim czasie
  // za jednorazowe pytanie do NBP i wychodzi wolniejsze, niż jest naprawdę.
  await ensureRate();

  console.log(`\nCZASY ŹRÓDEŁ — ${KRAJE.length} krajów, każde źródło osobno, bez cache'u\n`);
  console.log("źródło        kraj           czas       wynik");

  // Czasy zbieramy per źródło: jedna próba to za mało, żeby cokolwiek na niej oprzeć.
  const proby = new Map(aktywne.map((p) => [p.meta.id, []]));

  for (const kraj of KRAJE) {
    for (const prov of aktywne) {
      const t0 = Date.now();
      let wynik;
      try {
        const lista = await prov.search({ ...BAZA, countries: [kraj] });
        wynik = Array.isArray(lista) ? `${lista.length} ofert` : "odpowiedź nie jest listą ofert";
      } catch (err) {
        // Padnięcie NIE unieważnia pomiaru czasu: źródło, które rzuca po 0,6 s,
        // realnie zajmuje 0,6 s i tyle właśnie musi mieścić się w progu.
        wynik = "RZUCIŁ: " + (err?.message || err);
      }
      const czas = Date.now() - t0;
      proby.get(prov.meta.id).push(czas);
      console.log(`${prov.meta.id.padEnd(13)} ${kraj.padEnd(14)} ${String(czas).padStart(6)} ms  ${wynik}`);
    }
  }

  // Do analizy bierzemy czas NAJGORSZY z prób, nie średni. Próg ma trzymać
  // w złym dniu — średnia zamiotłaby pod dywan właśnie te przypadki,
  // w których konsultant czeka.
  const pomiary = [...proby.entries()].map(([id, lista]) => ({ id, ms: Math.max(...lista) }));
  pomiary.sort((a, b) => a.ms - b.ms);

  console.log("\nNAJGORSZY CZAS ŹRÓDŁA (na tym opiera się próg)");
  for (const p of pomiary) console.log(`   ${p.id.padEnd(13)} ${ms(p.ms)}`);

  const a = analizaProgu(pomiary, PROG);
  console.log(`\nPRZY OBECNYM PROGU ${PROG} ms:`);
  console.log(`   zdążą:      ${a.zdazyly.join(", ") || "(żadne)"}`);
  console.log(`   nie zdążą:  ${a.nieZdazyly.join(", ") || "(żadne)"}`);
  console.log(`   konsultant czeka: ${ms(a.czekanie)}`);

  const gora = a.rownowazne.do === Infinity ? "bez górnej granicy" : `${a.rownowazne.do} ms`;
  console.log(`\n   Ten sam wynik daje KAŻDY próg od ${a.rownowazne.od} ms do ${gora}.`);
  if (a.doUciecia > 0) {
    console.log(`   Trzymanie progu na ${PROG} ms kosztuje ${a.doUciecia} ms czekania na każde`);
    console.log("   zimne wyszukiwanie i NIE dokłada ani jednej oferty.");
  } else {
    console.log("   Próg nie jest dziś wąskim gardłem — czekanie to realna praca źródeł.");
  }

  const przerwa = najwiekszaPrzerwa(pomiary);
  if (przerwa) {
    console.log(`\n   Największa przerwa między czasami: ${przerwa.od} ms .. ${przerwa.do} ms (${przerwa.szerokosc} ms).`);
    console.log("   Próg postawiony w przerwie jest najodporniejszy na wahania czasów.");
  }

  console.log("\nŹródło, które nie zdąży, NIE jest przerywane: leci do PROVIDER_TIMEOUT_MS");
  console.log("i zapisuje się do cache'u, więc jego oferty dojeżdżają na następne pytanie.");
  console.log("Zmierzone 26.08.2026: pierwsze pytanie 126 ofert w 6,0 s, drugie 145 ofert w 0,6 s.\n");
}

main().catch((err) => {
  console.error("Pomiar nie doszedł do końca:", err?.message || err);
  process.exitCode = 1;
});
