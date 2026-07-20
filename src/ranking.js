// ============================================================
//  Ranking ofert + wskaźnik wiarygodności opinii
//  Ta sama logika działa niezależnie od dostawcy danych,
//  bo pracuje na znormalizowanym kształcie oferty (patrz normalize.js).
// ============================================================

// Wiarygodność opinii (0..1): łączy liczbę opinii i ich świeżość.
// Chroni przed "przekoloryzowaniem" — wysoka ocena z małej / starej próbki jest mniej warta.
export function trustScore(offer) {
  const reviews = offer.reviews || 0;
  const freshDays = offer.freshDays == null ? 60 : offer.freshDays;
  const volume = Math.min(1, Math.log10(reviews + 1) / Math.log10(3000)); // 0..1
  const fresh = Math.max(0, 1 - freshDays / 30); // >30 dni -> 0
  return 0.6 * volume + 0.4 * fresh;
}

export function trustLabel(t) {
  if (t >= 0.7) return { cls: "high", txt: "Opinie wiarygodne" };
  if (t >= 0.45) return { cls: "mid", txt: "Opinie umiarkowane" };
  return { cls: "low", txt: "Mało / stare opinie" };
}

// Ranking trafności: ocena skorygowana o wiarygodność + cena + dopasowanie profilu + standard.
export function scoreOffer(offer, crit) {
  const t = trustScore(offer);
  // Ocena "skorygowana": niepewne oceny ściągane w stronę średniej (7.5) -> anty-przekoloryzacja.
  const adjRating = offer.rating * t + 7.5 * (1 - t);
  const ratingPart = Math.max(0, Math.min(1, (adjRating - 6) / 4));

  let pricePart = 1 - (offer.price - 2500) / 9000;
  pricePart = Math.max(0, Math.min(1, pricePart));

  const tags = (crit && crit.tags) || [];
  let tagMatch = 0.5;
  if (tags.length) {
    const hit = tags.filter((x) => (offer.tags || []).includes(x)).length;
    tagMatch = hit / tags.length;
  }

  const starPart = (offer.stars || 3) / 5;
  const score =
    0.34 * ratingPart + 0.22 * pricePart + 0.2 * tagMatch + 0.1 * starPart + 0.14 * t;

  return { ...offer, score, trust: t, adjRating };
}

export function sortOffers(list, mode) {
  const arr = list.slice();
  arr.sort((a, b) => {
    if (mode === "price") return a.price - b.price;
    if (mode === "rating") return b.rating - a.rating;
    if (mode === "trust") return b.trust - a.trust;
    return b.score - a.score; // domyślnie: trafność
  });
  return arr;
}

// Normalizacja tekstu do porównań nazw: małe litery + usunięcie polskich znaków
// diakrytycznych (ł, ą, é…), żeby "Lagoon" == "lagoon", a "Dżerba" == "dzerba".
function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ł/g, "l") // ł
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // znaki diakrytyczne
    .trim();
}

// Filtrowanie po kryteriach (wspólne dla wszystkich dostawców).
export function applyFilters(list, crit) {
  // Wyszukiwanie po NAZWIE hotelu jest dominujące: gdy podano nazwę,
  // pomijamy miękkie filtry (budżet, ocena, wyżywienie, profil, liczba osób),
  // żeby konkretny hotel zawsze się pokazał — niezależnie od pozostałych suwaków.
  if (crit.name) {
    const needle = normalizeName(crit.name);
    return needle ? list.filter((h) => normalizeName(h.name).includes(needle)) : list;
  }

  return list.filter((h) => {
    // Filtr kraju — pomijany, gdy wybrano konkretne regiony (mogą być z różnych krajów).
    if (crit.dest && !(crit.regions && crit.regions.length) && h.country !== crit.dest) return false;
    // Filtr regionów (wielokrotny wybór): oferta pasuje, jeśli jej region
    // odpowiada KTÓREMUKOLWIEK z zaznaczonych regionów.
    if (crit.regions && crit.regions.length) {
      const hay = (h.region || "").toLowerCase();
      // Hotelbeds jest odpytywany po kodach destynacji (region już właściwy,
      // ale po angielsku, np. "Majorca" != "Majorka"), więc jego oferty
      // przepuszczamy bez filtra tekstowego. Pozostałe źródła (pakiety PL,
      // dane demo, TravelLead) mają polskie nazwy regionów — filtrujemy je,
      // żeby np. przy wyborze "Kreta" nie wpadały hotele z Egiptu czy Rodos.
      if (h.source !== "Hotelbeds") {
        const match = crit.regions.some((reg) => {
          const needle = reg.split(/[\/(]/)[0].trim().toLowerCase();
          return needle && hay.includes(needle);
        });
        if (!match) return false;
      }
    }
    if (crit.budget && h.price > crit.budget) return false;
    if (crit.minRate && h.rating < crit.minRate) return false;
    if (crit.boards && crit.boards.length && !crit.boards.includes(h.board)) return false;
    if (crit.pax && h.cap < crit.pax) return false;
    // Filtry pakietowe: dotyczą tylko ofert typu "package" (lot+hotel).
    // Gdy aktywne, oferty hotel-only odpadają — użytkownik szuka wyjazdu z konkretnego miasta.
    if (crit.departure && !(h.type === "package" && h.departureCity === crit.departure)) return false;
    if (crit.transports && crit.transports.length && !(h.type === "package" && crit.transports.includes(h.transport))) return false;
    return true;
  });
}
