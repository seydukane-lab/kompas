// ============================================================
//  Provider: MOCK (dane demonstracyjne)
//  Działa zawsze, bez żadnych kluczy — do rozwoju i pokazów.
//  Zwraca oferty w znormalizowanym kształcie (patrz niżej).
// ============================================================
//
//  Znormalizowany kształt oferty (WSPÓLNY dla wszystkich dostawców):
//  {
//    id, source, name, country, region, stars,
//    rating (0-10), reviews, freshDays,
//    price (zł/os.), board, cap, tags[], beach (m),
//    photo (URL lub klucz gradientu), photos[] (galeria URL)
//  }
// ============================================================

// Gradienty jako zdjęcia zastępcze — realny provider (Hotelbeds) zwróci prawdziwe URL-e.
const G = {
  c1: "linear-gradient(135deg,#0F6B68,#3FB0AB)", c2: "linear-gradient(135deg,#1E5A8A,#7FB4D6)",
  c3: "linear-gradient(135deg,#C68A3E,#E4C089)", c4: "linear-gradient(135deg,#A34747,#D98C6A)",
  c5: "linear-gradient(135deg,#6D3B8E,#C77FB4)", c6: "linear-gradient(135deg,#0E8388,#5FC4B8)",
  c7: "linear-gradient(135deg,#B5772E,#E0B36B)", c8: "linear-gradient(135deg,#8A5A2B,#D6A860)",
  c9: "linear-gradient(135deg,#1B6E8C,#6FB8CC)", c10: "linear-gradient(135deg,#7A3E6E,#C97FA8)",
  c11: "linear-gradient(135deg,#146157,#57B79B)", c12: "linear-gradient(135deg,#B06A2A,#E2B26E)",
  c13: "linear-gradient(135deg,#C29140,#EAD09A)", c14: "linear-gradient(135deg,#2A7A78,#77C3BC)",
  c15: "linear-gradient(135deg,#C08234,#EBC57F)", c16: "linear-gradient(135deg,#1F5F8B,#7EB2D2)",
};

const DATA = [
  { id: "mock-1", name: "Blue Horizon Resort & Spa", country: "Grecja", region: "Kreta, Chania", stars: 5, rating: 9.2, reviews: 1840, freshDays: 6, price: 5490, board: "Ultra All Inclusive", cap: 4, tags: ["rodzina", "plaza", "spa", "para"], beach: 80, photo: G.c1 },
  { id: "mock-2", name: "Aegean Pearl Boutique", country: "Grecja", region: "Santorini, Oia", stars: 4, rating: 9.0, reviews: 610, freshDays: 11, price: 6980, board: "BB", cap: 2, tags: ["para", "spa"], beach: 900, photo: G.c2 },
  { id: "mock-3", name: "Costa Verde Family Village", country: "Hiszpania", region: "Costa Brava", stars: 4, rating: 8.4, reviews: 2210, freshDays: 4, price: 4190, board: "All Inclusive", cap: 5, tags: ["rodzina", "plaza"], beach: 150, photo: G.c3 },
  { id: "mock-4", name: "Marbella Sun Palace", country: "Hiszpania", region: "Costa del Sol", stars: 5, rating: 8.8, reviews: 1490, freshDays: 9, price: 6250, board: "HB", cap: 3, tags: ["para", "spa", "plaza"], beach: 60, photo: G.c4 },
  { id: "mock-5", name: "Ibiza Beats Beach Club", country: "Hiszpania", region: "Ibiza, San Antonio", stars: 4, rating: 8.1, reviews: 970, freshDays: 7, price: 5880, board: "BB", cap: 3, tags: ["impreza", "plaza", "para"], beach: 40, photo: G.c5 },
  { id: "mock-6", name: "Sharm Grand Reef", country: "Egipt", region: "Sharm el-Sheikh", stars: 5, rating: 8.6, reviews: 3120, freshDays: 3, price: 3690, board: "Ultra All Inclusive", cap: 4, tags: ["rodzina", "plaza", "spa"], beach: 120, photo: G.c6 },
  { id: "mock-7", name: "Hurghada Coral Bay", country: "Egipt", region: "Hurghada", stars: 4, rating: 7.9, reviews: 2680, freshDays: 5, price: 2990, board: "All Inclusive", cap: 4, tags: ["rodzina", "plaza"], beach: 200, photo: G.c7 },
  { id: "mock-8", name: "Antalya Royal Lagoon", country: "Turcja", region: "Belek", stars: 5, rating: 9.1, reviews: 4050, freshDays: 2, price: 4790, board: "Ultra All Inclusive", cap: 5, tags: ["rodzina", "spa", "plaza", "para"], beach: 250, photo: G.c8 },
  { id: "mock-9", name: "Bodrum Azure Suites", country: "Turcja", region: "Bodrum", stars: 5, rating: 8.9, reviews: 880, freshDays: 14, price: 5590, board: "HB", cap: 2, tags: ["para", "spa"], beach: 300, photo: G.c9 },
  { id: "mock-10", name: "Alanya Party Tower", country: "Turcja", region: "Alanya", stars: 4, rating: 7.6, reviews: 1560, freshDays: 8, price: 3290, board: "All Inclusive", cap: 3, tags: ["impreza", "plaza"], beach: 100, photo: G.c10 },
  { id: "mock-11", name: "Sardinia Costa Smeralda", country: "Włochy", region: "Sardynia", stars: 5, rating: 9.3, reviews: 540, freshDays: 19, price: 8200, board: "HB", cap: 3, tags: ["para", "spa", "plaza"], beach: 70, photo: G.c11 },
  { id: "mock-12", name: "Sicilia Mare Family", country: "Włochy", region: "Sycylia, Taormina", stars: 4, rating: 8.5, reviews: 1120, freshDays: 10, price: 5340, board: "HB", cap: 5, tags: ["rodzina", "plaza", "para"], beach: 180, photo: G.c12 },
  { id: "mock-13", name: "Djerba Palm Oasis", country: "Tunezja", region: "Dżerba", stars: 4, rating: 8.2, reviews: 1980, freshDays: 6, price: 2790, board: "All Inclusive", cap: 4, tags: ["rodzina", "spa", "plaza"], beach: 90, photo: G.c13 },
  { id: "mock-14", name: "Hammamet Serenity Spa", country: "Tunezja", region: "Hammamet", stars: 5, rating: 8.7, reviews: 760, freshDays: 12, price: 3980, board: "All Inclusive", cap: 3, tags: ["spa", "para", "plaza"], beach: 130, photo: G.c14 },
  { id: "mock-15", name: "Algarve Golden Cliffs", country: "Portugalia", region: "Algarve, Albufeira", stars: 4, rating: 8.9, reviews: 1340, freshDays: 5, price: 5760, board: "BB", cap: 4, tags: ["para", "plaza", "rodzina"], beach: 220, photo: G.c15 },
  { id: "mock-16", name: "Lisbon Ocean Retreat", country: "Portugalia", region: "Cascais", stars: 5, rating: 9.0, reviews: 430, freshDays: 22, price: 7100, board: "BB", cap: 2, tags: ["para", "spa"], beach: 400, photo: G.c16 },
];

export const meta = { id: "mock", label: "Dane demo", needsKeys: false };

// eslint-disable-next-line no-unused-vars
export async function search(crit) {
  // Provider zawsze zwraca pełną listę; filtrowanie/ranking robi warstwa wspólna.
  return DATA.map((h) => ({ ...h, source: "demo", photos: [h.photo] }));
}

export function isEnabled() {
  return true; // mock działa zawsze
}
