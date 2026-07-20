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

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(join(__dirname, "public")));

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
      regions: q.regions ? String(q.regions).split(",").filter(Boolean) : [],
      from: q.from || "",
      to: q.to || "",
      adults: Number(q.adults) || 2,
      kids: Number(q.kids) || 0,
      pax: (Number(q.adults) || 2) + (Number(q.kids) || 0),
      budget: Number(q.budget) || 0,
      minRate: Number(q.minRate) || 0,
      boards: q.boards ? String(q.boards).split(",").filter(Boolean) : [],
      tags: q.tags ? String(q.tags).split(",").filter(Boolean) : [],
      departure: q.departure || "",
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
