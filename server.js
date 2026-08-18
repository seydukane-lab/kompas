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
import * as hotelbeds from "./src/providers/hotelbeds.js";
import { applyFilters, promoteMatchingVariant, filtrRozproszony, scoreOffer, sortOffers, attributeCoverage, unknownAttrs, podpowiedziRozluznienia } from "./src/ranking.js";
import { clientData, PRACTICAL_DATA_DATE, practicalDataAgeMonths } from "./src/countries.js";
import { allDestinations } from "./src/destinations.js";
import { db, userCount, DB_PATH } from "./src/db.js";
import { refreshRate, fxStatus } from "./src/fx.js";
import { utworzHamulec } from "./src/login-limit.js";
import {
  attachUser, requireAuth, requireAdmin,
  verifyLogin, createSession, destroySession, purgeExpiredSessions,
  setSessionCookie, clearSessionCookie,
  listUsers, createUser, setPassword, setActive,
  getCart, saveCart, seedAdminFromEnv,
} from "./src/auth.js";

// Doradca ETA OS (Claude) — provider LOKALNY (prompt = know-how użytkownika, gitignored).
// Ładowany OPCJONALNIE: bez pliku (publiczny Render) AI jest po prostu wyłączone.
let advisor = { isEnabled: () => false };
try { advisor = await import("./src/advisor.js"); } catch { /* brak lokalnego providera AI */ }

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "256kb" }));

// Nagłówki bezpieczeństwa. Świadomie BEZ Content-Security-Policy: cały panel to
// jeden plik z inline'owym stylem i skryptem, więc sensowna polityka wymagałaby
// najpierw rozbicia frontu na osobne pliki. Poniższe trzy nagłówki nic nie psują,
// a zamykają najprostsze drogi ataku na panel wystawiony publicznie.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY"); // panel nie ma prawa działać w cudzej ramce
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use(attachUser);

// Panel jest narzędziem pracy konsultanta, nie stroną publiczną —
// bez sesji z „/" widać wyłącznie ekran logowania.
app.get(["/", "/index.html"], (req, res, next) => {
  if (!req.user) return res.redirect("/login.html");
  next();
});
app.use(express.static(join(__dirname, "public")));

// ============================================================
//  Logowanie
// ============================================================

// Hamulec na zgadywanie haseł — liczony PER KONTO i PER ADRES naraz, bo całe biuro
// wychodzi do internetu jednym IP i sam licznik adresowy zamykałby panel wszystkim
// przez jedną osobę mylącą własne hasło. Szczegóły i progi: src/login-limit.js.
const hamulecLogowania = utworzHamulec();

app.post("/api/auth/login", (req, res) => {
  const ip = req.ip || "?";
  const { email, password } = req.body || {};
  // Ten sam komunikat niezależnie od tego, CO zawiodło — inaczej odpowiedź
  // zdradzałaby, że dane konto istnieje i jest właśnie atakowane.
  if (hamulecLogowania.zablokowane({ email, ip })) {
    return res.status(429).json({ error: "Za dużo nieudanych prób. Spróbuj ponownie za kwadrans." });
  }
  const user = verifyLogin(email, password);
  if (!user) {
    hamulecLogowania.nieudana({ email, ip });
    return res.status(401).json({ error: "Nieprawidłowy e-mail lub hasło." });
  }
  hamulecLogowania.udana({ email, ip });
  setSessionCookie(res, createSession(user.id));
  res.json({ user });
});

app.post("/api/auth/logout", (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Bootstrap frontu — jedyny endpoint, który wolno wołać bez sesji.
app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.user || null });
});

// Od tego miejsca całe API wymaga zalogowania.
app.use("/api", requireAuth);

// ============================================================
//  Konta konsultantów (tylko administrator)
// ============================================================

app.get("/api/users", requireAdmin, (req, res) => {
  res.json({ users: listUsers() });
});

app.post("/api/users", requireAdmin, (req, res) => {
  try {
    const { email, name, password, role } = req.body || {};
    res.json({ user: createUser({ email, name, password, role }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/users/:id/password", requireAdmin, (req, res) => {
  try {
    setPassword(Number(req.params.id), (req.body || {}).password);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/users/:id/active", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: "Nie można wyłączyć własnego konta." });
  }
  setActive(id, Boolean((req.body || {}).active));
  res.json({ ok: true });
});

// ============================================================
//  Koszyk — przypisany do konta, nie do przeglądarki
//  Dzięki temu konsultant widzi swoje odłożone oferty także po
//  przesiadce na inne stanowisko, a dwie osoby przy jednym
//  komputerze nie mieszają sobie koszyków.
// ============================================================

app.get("/api/cart", (req, res) => {
  res.json(getCart(req.user.id));
});

app.put("/api/cart", (req, res) => {
  const items = (req.body || {}).items;
  if (!Array.isArray(items)) return res.status(400).json({ error: "Oczekiwano pola `items` z listą ofert." });
  res.json(saveCart(req.user.id, items));
});

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
    res.json({ report: r.text, model: r.model, cached: Boolean(r.cached) });
  } catch (err) {
    console.error("advisor error:", err);
    res.status(500).json({ error: "Błąd analizy AI: " + err.message });
  }
});

// Kontrola życia procesu — dla hostingu i prostego monitoringu.
// Poza /api, więc nie wymaga sesji: monitoring nie ma się jak zalogować.
app.get("/healthz", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), time: new Date().toISOString() });
});

// --- Status dostawców (do baneru w panelu) ---
app.get("/api/status", (req, res) => {
  res.json({ providers: providerStatus(), fx: fxStatus() });
});

// --- Destination Intelligence: kuratorowana wiedza o kierunkach ---
app.get("/api/destinations", (req, res) => {
  res.json({ destinations: allDestinations() });
});

// --- Kraje: regiony + informacje praktyczne / warunki wjazdowe ---
app.get("/api/countries", (req, res) => {
  res.json({ countries: clientData(), updated: PRACTICAL_DATA_DATE, wiekMiesiecy: practicalDataAgeMonths() });
});

// --- Multiroom Finder: kilka pokoi/składów, wspólny hotel+termin ---
// rooms = JSON: [{adults,children,ages:[]}, ...]. Wynik: hotele dostępne dla
// WSZYSTKICH pokoi, z rozbiciem ceny per pokój, od najtańszych za grupę.
app.get("/api/multiroom", async (req, res) => {
  try {
    if (!hotelbeds.isEnabled()) {
      return res.status(503).json({ error: "Multiroom wymaga Hotelbeds (dostępne lokalnie).", offers: [], count: 0 });
    }
    const q = req.query;
    let rooms = [];
    try { rooms = q.rooms ? JSON.parse(q.rooms) : []; } catch { rooms = []; }
    const crit = {
      dest: q.dest || "",
      countries: q.countries ? String(q.countries).split(",").filter(Boolean) : [],
      regions: q.regions ? String(q.regions).split(",").filter(Boolean) : [],
      from: q.from || "",
      to: q.to || "",
      rooms,
      roomsMode: q.roomsMode === "any" ? "any" : q.roomsMode === "compare" ? "compare" : "split",
    };
    const offers = await hotelbeds.searchMultiroom(crit);
    const scored = offers.map((o) => scoreOffer(o, crit)); // dodaj valueScore/trust; kolejność (od najtańszych) zachowana
    res.json({ offers: scored, count: scored.length });
  } catch (err) {
    console.error("multiroom error:", err.message);
    // Awaria dostawcy to nie jest błąd Kompasa — konsultant dostaje gotowy
    // komunikat i informację, czy ma sens spróbować ponownie za chwilę.
    if (err.providerFailure) {
      return res.status(err.rateLimited ? 429 : 502).json({
        error: err.message,
        retry: true,
        offers: [],
        count: 0,
      });
    }
    res.status(500).json({ error: "Błąd multiroom: " + err.message });
  }
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
      // Atrybuty z 3 kolumn (Lokalizacja/Obiekt/Aktywność) — patrz ranking.js:hasAttribute.
      attrs: q.attrs ? String(q.attrs).split(",").filter(Boolean) : [],
      // Dni tygodnia wylotu (0=nd..6=sob, jak Date#getDay).
      weekdays: q.weekdays ? String(q.weekdays).split(",").filter((s) => s !== "").map(Number) : [],
      sort: q.sort || "score",
    };

    // Kurs odświeża się w tle; jeśli jest aktualny, to koszt zerowy.
    refreshRate();

    const { offers, sources } = await searchAll(crit);
    const filtered = applyFilters(offers, crit);
    // Reprezentanta przestawiamy na wariant, przez który oferta faktycznie przeszła
    // filtr (patrz ranking.js:promoteMatchingVariant) — PRZED scoreOffer, żeby ranking
    // i cena liczyły się już na właściwym terminie, nie na przypadkowym reprezentancie.
    // Gdy żaden wariant nie spełnia wszystkich aktywnych filtrów pakietowych naraz
    // (patrz ranking.js:filtrRozproszony), oznaczamy to jawną flagą — kopia obiektu,
    // żeby nie dopisywać pola do oferty współdzielonej przez cache dostawców.
    const promoted = filtered.map((o) => {
      const p = promoteMatchingVariant(o, crit);
      return filtrRozproszony(o, crit) ? { ...p, filtrRozproszony: true } : p;
    });
    const scored = promoted.map((o) => scoreOffer(o, crit));
    const sorted = sortOffers(scored, crit.sort, crit.pax);

    // attrs: ile wyników POTWIERDZA każdy wybrany atrybut, a ile przeszło z braku
    // danych. Panel może dzięki temu napisać wprost „93 potwierdzone, 30 bez danych”
    // zamiast samego „123 oferty”, które przy rzadkich atrybutach bywa mylące.
    // attrUnknown: które z wybranych atrybutów TA oferta nie potwierdza (przeszła
    // filtr z braku danych, nie z jawnego dopasowania) — karta oznacza to znacznikiem.
    const withAttrUnknown = sorted.map((o) => ({ ...o, attrUnknown: unknownAttrs(o, crit.attrs) }));

    // Zero wyników mówi konsultantowi tylko tyle, że trzeba coś zdjąć — ale nie co.
    // Liczymy więc na JUŻ POBRANEJ liście, ile ofert odblokowałoby zdjęcie każdego
    // pojedynczego filtra. Zero dodatkowych zapytań do dostawców.
    // Granice suwaków przychodzą z panelu, bo tylko on wie, na co realnie ustawi
    // kontrolkę po kliknięciu „Zdejmij" (ocena nie schodzi poniżej swojego minimum,
    // budżet idzie na maksimum). Bez nich podpowiedź obiecuje nieosiągalny stan.
    const granice = {};
    if (q.budgetMax) granice.budget = Number(q.budgetMax) || 0;
    if (q.minRateMin) granice.minRate = Number(q.minRateMin) || 0;
    const rozluznienia = withAttrUnknown.length === 0 ? podpowiedziRozluznienia(offers, crit, granice) : [];

    res.json({
      offers: withAttrUnknown, sources, count: withAttrUnknown.length,
      attrs: attributeCoverage(sorted, crit),
      ...(rozluznienia.length ? { rozluznienia } : {}),
    });
  } catch (err) {
    console.error("search error:", err);
    res.status(500).json({ error: "Błąd wyszukiwania", detail: err.message });
  }
});

// Ostatnia zapora: cokolwiek wyleci z trasy i nie zostanie złapane wyżej,
// kończy się czytelnym 500 zamiast zerwanego połączenia. Treść błędu zostaje
// w logu serwera — do przeglądarki idzie komunikat bez szczegółów technicznych.
app.use((err, req, res, next) => {
  console.error("nieobsłużony błąd trasy:", req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Coś poszło nie tak po stronie serwera. Spróbuj ponownie." });
});

// Panel ma stać przez całą zmianę w biurze. Pojedynczy błąd w kodzie
// asynchronicznym nie może kłaść procesu i wyrzucać wszystkich z sesji —
// logujemy i pracujemy dalej.
process.on("unhandledRejection", (reason) => {
  console.error("nieobsłużone odrzucenie obietnicy:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("nieprzechwycony wyjątek:", err);
});

purgeExpiredSessions();

// Konto startowe na hostingu bez konsoli (Render): zakładane tylko przy pustej bazie.
try {
  const seeded = seedAdminFromEnv();
  if (seeded) console.log(`  Założono konto startowe z ADMIN_EMAIL: ${seeded.email}`);
} catch (err) {
  console.error("  Nie udało się założyć konta startowego:", err.message);
}
// Kurs pobieramy od razu przy starcie, żeby pierwsze wyszukiwanie po wdrożeniu
// nie liczyło cen po wartości awaryjnej.
refreshRate(true);

const server = app.listen(PORT, () => {
  const providers = providerStatus()
    .filter((p) => p.enabled)
    .map((p) => p.label)
    .join(", ");
  console.log("\n  🧭  Kompas działa:  http://localhost:" + PORT);
  console.log("  Aktywne źródła danych: " + (providers || "brak"));
  console.log("  Baza kont: " + DB_PATH);
  if (userCount() === 0) {
    console.log("\n  ⚠️  Brak kont — nikt się nie zaloguje.");
    console.log("     Załóż konto administratora:  npm run user:add -- admin@example.com \"Imię\" haslo123 admin");
  }
  console.log("");
});

// Wdrożenie (Render, systemd, docker) wysyła SIGTERM. Domykamy w porządku:
// bez tego zapis koszyka trafiony w złym momencie mógłby zostać ucięty.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`\n  ${sig} — zamykam Kompas…`);
    server.close(() => {
      try { db.close(); } catch { /* baza mogła już zostać zamknięta */ }
      process.exit(0);
    });
    // Gdyby otwarte połączenia nie chciały się rozejść — nie wisimy w nieskończoność.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
