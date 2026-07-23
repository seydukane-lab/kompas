// ============================================================
//  Kompas — serwer (Express)
//  - Serwuje panel z /public
//  - /api/search : odpytuje dostawców, filtruje, rankinguje
//  - /api/status : które źródła danych są aktywne
//
//  Klucze API są odczytywane wyłącznie tu, po stronie serwera —
//  nigdy nie trafiają do przeglądarki.
// ============================================================

import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { searchAll, providerStatus } from "./src/providers/index.js";
import { applyFilters, scoreOffer, sortOffers } from "./src/ranking.js";
import { clientData } from "./src/countries.js";

// Doradca ETA OS (Claude) — provider LOKALNY (prompt = know-how użytkownika, gitignored).
// Ładowany OPCJONALNIE: bez pliku (publiczny Render) AI jest po prostu wyłączone.
let advisor = { isEnabled: () => false };
try { advisor = await import("./src/advisor.js"); } catch { /* brak lokalnego providera AI */ }

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(join(__dirname, "public")));
app.use(express.json({ limit: "256kb" }));

// --- Doradca ETA OS (Claude) — status + generowanie raportu ---
app.get("/api/advisor/status", (req, res) => {
  res.json({ enabled: advisor.isEnabled() });
});
app.post("/api/advisor", async (req, res) => {
  if (!advisor.isEnabled()) {
    return res.status(503).json({ error: "Analiza AI wyłączona — brak ANTHROPIC_API_KEY.", needKey: true });
  }
  try {
    const { offers, criteria } = req.body || {};
    if (!Array.isArray(offers) || !offers.length) {
      return res.status(400).json({ error: "Brak ofert do analizy — odłóż oferty do koszyka." });
    }
    const r = await advisor.generateReport(offers, criteria);
    res.json({ report: r.text, model: r.model });
  } catch (err) {
    console.error("advisor error:", err);
    res.status(500).json({ error: "Błąd analizy AI: " + err.message });
  }
});

// --- Status dostawców (do baneru w panelu) ---
app.get("/api/status", (req, res) => {
  res.json({ providers: providerStatus() });
});

// --- Kraje: regiony + informacje praktyczne / warunki wjazdowe ---
app.get("/api/countries", (req, res) => {
  res.json({ countries: clientData(), updated: "2026-07" });
});

// --- Wyszukiwanie ofert ---
app.get("/api/search", async (req, res) => {
  try {
    const q = req.query;
    const crit = {
      dest: q.dest || "",
      name: (q.name || "").trim(),
      // Wybór wielu krajów naraz (całe kraje). Regiony = konkretne obszary w krajach.
      countries: q.countries ? String(q.countries).split(",").filter(Boolean) : [],
      regions: q.regions ? String(q.regions).split(",").filter(Boolean) : [],
      from: q.from || "",
      to: q.to || "",
      adults: Number(q.adults) || 2,
      kids: Number(q.kids) || 0,
      pax: (Number(q.adults) || 2) + (Number(q.kids) || 0),
      // Wiek każdego dziecka (lata; 0 = niemowlę). Uwaga: wrapper wakacje.pl
      // liczy 2 dorosłych i wieku nie przyjmuje — pole pod inne źródła/filtry.
      childAges: q.childAges ? String(q.childAges).split(",").filter((s) => s !== "").map(Number) : [],
      // Długość pobytu w nocach (0/brak = dowolna).
      nights: Number(q.nights) || 0,
      budget: Number(q.budget) || 0,
      // Tryb budżetu: "person" = limit ceny za osobę, "total" = za cały wyjazd.
      budgetMode: q.budgetMode === "total" ? "total" : "person",
      minRate: Number(q.minRate) || 0,
      // Minimalna kategoria (gwiazdki) i filtr „tylko z realnymi opiniami".
      minStars: Number(q.minStars) || 0,
      onlyReviewed: q.onlyReviewed === "1" || q.onlyReviewed === "true",
      boards: q.boards ? String(q.boards).split(",").filter(Boolean) : [],
      tags: q.tags ? String(q.tags).split(",").filter(Boolean) : [],
      departure: q.departure || "",
      departures: q.departures ? String(q.departures).split(",").filter(Boolean) : [],
      transports: q.transports ? String(q.transports).split(",").filter(Boolean) : [],
      sort: q.sort || "score",
    };

    const { offers, sources } = await searchAll(crit);
    const filtered = applyFilters(offers, crit);
    const scored = filtered.map((o) => scoreOffer(o, crit));
    const sorted = sortOffers(scored, crit.sort);

    res.json({ offers: sorted, sources, count: sorted.length });
  } catch (err) {
    console.error("search error:", err);
    res.status(500).json({ error: "Błąd wyszukiwania", detail: err.message });
  }
});

app.listen(PORT, () => {
  const providers = providerStatus()
    .filter((p) => p.enabled)
    .map((p) => p.label)
    .join(", ");
  console.log("\n  🧭  Kompas działa:  http://localhost:" + PORT);
  console.log("  Aktywne źródła danych: " + (providers || "brak") + "\n");
});
