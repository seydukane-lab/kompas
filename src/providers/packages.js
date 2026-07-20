// ============================================================
//  Provider: OFERTY PAKIETOWE PL (seed demonstracyjny)
//  Realne hotele polskiego rynku czarterowego (Egipt, Turcja,
//  Grecja, Tunezja) w formie PAKIETU: lot + hotel + transfer.
//
//  To BRIDGE do czasu podpięcia MerlinX: nazwy, sieci i kierunki
//  są prawdziwe, ale CENY są orientacyjne (demo). Gdy wepniemy
//  merlinx.js, realne ceny „dokleją się" do tych samych hoteli.
//
//  Rozszerzony (pakietowy) kształt oferty — pola dodatkowe ponad
//  hotelowy standard (patrz mock.js):
//    type          "package" | "hotel"
//    operator       touroperator (TUI, Itaka, Coral Travel…)
//    departureCity  miasto wylotu (np. "Katowice")
//    transport      "Samolot" | "Autokar" | "Własny dojazd"
//    transferIncluded  boolean
//    nights         długość pobytu
//    departDate     data wylotu (ISO)
//    bookingUrl     link do rezerwacji (dla źródeł afiliacyjnych)
// ============================================================

const G = {
  eg: "linear-gradient(135deg,#C6853A,#E8C48A)", eg2: "linear-gradient(135deg,#B5772E,#E0B36B)",
  tr: "linear-gradient(135deg,#A34747,#D98C6A)", tr2: "linear-gradient(135deg,#8A3E3E,#C97F63)",
  gr: "linear-gradient(135deg,#0F6B68,#3FB0AB)", gr2: "linear-gradient(135deg,#1E5A8A,#7FB4D6)",
  tn: "linear-gradient(135deg,#146157,#57B79B)",
};

// depart: liczba dni od dziś; wszystkie loty w sezonie letnim.
function futureDate(daysAhead) {
  return new Date(Date.now() + daysAhead * 864e5).toISOString().slice(0, 10);
}

const DATA = [
  // ---------------- EGIPT ----------------
  { id: "pl-jaz-aquamarine", name: "Jaz Aquamarine Resort", country: "Egipt", region: "Hurghada", stars: 5, rating: 8.7, reviews: 4120, freshDays: 4, price: 3690, board: "All Inclusive", cap: 4, tags: ["rodzina", "plaza", "spa"], beach: 50, operator: "TUI", departureCity: "Katowice", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(18), photo: G.eg },
  { id: "pl-pick-aquablu", name: "Pickalbatros Aqua Blu Resort", country: "Egipt", region: "Sharm el-Sheikh", stars: 4, rating: 8.3, reviews: 5230, freshDays: 3, price: 3290, board: "All Inclusive", cap: 4, tags: ["rodzina", "plaza"], beach: 350, operator: "Coral Travel", departureCity: "Warszawa", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(15), photo: G.eg2 },
  { id: "pl-pick-whitebeach", name: "Pickalbatros White Beach Resort", country: "Egipt", region: "Hurghada", stars: 5, rating: 8.6, reviews: 3980, freshDays: 6, price: 4150, board: "All Inclusive", cap: 4, tags: ["rodzina", "plaza", "spa"], beach: 40, operator: "Itaka", departureCity: "Katowice", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(22), photo: G.eg },
  { id: "pl-rixos-seagate", name: "Rixos Premium Seagate", country: "Egipt", region: "Sharm el-Sheikh", stars: 5, rating: 9.1, reviews: 2870, freshDays: 5, price: 6490, board: "Ultra All Inclusive", cap: 4, tags: ["para", "spa", "plaza", "rodzina"], beach: 60, operator: "Rainbow", departureCity: "Wrocław", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(20), photo: G.eg2 },
  { id: "pl-steigenberger-aquamagic", name: "Steigenberger Aqua Magic", country: "Egipt", region: "Hurghada", stars: 5, rating: 8.8, reviews: 3450, freshDays: 7, price: 4290, board: "All Inclusive", cap: 4, tags: ["rodzina", "plaza", "spa"], beach: 30, operator: "TUI", departureCity: "Poznań", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(25), photo: G.eg },
  { id: "pl-sunrise-diamond", name: "Sunrise Diamond Beach Resort", country: "Egipt", region: "Sharm el-Sheikh", stars: 5, rating: 8.9, reviews: 2210, freshDays: 8, price: 4590, board: "All Inclusive", cap: 3, tags: ["para", "spa", "plaza"], beach: 80, operator: "Itaka", departureCity: "Gdańsk", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(19), photo: G.eg2 },

  // ---------------- TURCJA ----------------
  { id: "pl-rixos-belek", name: "Rixos Premium Belek", country: "Turcja", region: "Belek", stars: 5, rating: 9.2, reviews: 5610, freshDays: 3, price: 6890, board: "Ultra All Inclusive", cap: 5, tags: ["rodzina", "spa", "plaza", "para"], beach: 100, operator: "Coral Travel", departureCity: "Katowice", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(17), photo: G.tr },
  { id: "pl-delphin-imperial", name: "Delphin Imperial Lara", country: "Turcja", region: "Antalya, Lara", stars: 5, rating: 9.0, reviews: 4780, freshDays: 4, price: 5490, board: "Ultra All Inclusive", cap: 4, tags: ["rodzina", "spa", "plaza"], beach: 150, operator: "Itaka", departureCity: "Warszawa", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(21), photo: G.tr2 },
  { id: "pl-granada-belek", name: "Granada Luxury Belek", country: "Turcja", region: "Belek", stars: 5, rating: 8.7, reviews: 3320, freshDays: 6, price: 5190, board: "Ultra All Inclusive", cap: 5, tags: ["rodzina", "plaza", "spa"], beach: 250, operator: "Rainbow", departureCity: "Wrocław", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(23), photo: G.tr },
  { id: "pl-titanic-lara", name: "Titanic Beach Lara", country: "Turcja", region: "Antalya, Lara", stars: 5, rating: 8.8, reviews: 4010, freshDays: 5, price: 5290, board: "All Inclusive", cap: 4, tags: ["rodzina", "plaza", "spa", "para"], beach: 120, operator: "TUI", departureCity: "Katowice", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(16), photo: G.tr2 },

  // ---------------- GRECJA ----------------
  { id: "pl-mitsis-alila", name: "Mitsis Alila Resort & Spa", country: "Grecja", region: "Rodos, Faliraki", stars: 5, rating: 8.9, reviews: 2640, freshDays: 6, price: 5390, board: "All Inclusive", cap: 4, tags: ["para", "spa", "plaza", "rodzina"], beach: 50, operator: "Grecos", departureCity: "Warszawa", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(24), photo: G.gr },
  { id: "pl-atlantica-aegean", name: "Atlantica Aegean Blue", country: "Grecja", region: "Rodos, Kolymbia", stars: 5, rating: 8.6, reviews: 1980, freshDays: 9, price: 5590, board: "All Inclusive", cap: 4, tags: ["rodzina", "plaza", "para"], beach: 400, operator: "TUI", departureCity: "Katowice", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(20), photo: G.gr2 },

  // ---------------- TUNEZJA ----------------
  { id: "pl-iberostar-kuriat", name: "Iberostar Selection Kuriat Palace", country: "Tunezja", region: "Monastir, Skanes", stars: 5, rating: 8.5, reviews: 1740, freshDays: 7, price: 3190, board: "All Inclusive", cap: 4, tags: ["rodzina", "plaza", "spa"], beach: 60, operator: "Coral Travel", departureCity: "Wrocław", transport: "Samolot", transferIncluded: true, nights: 7, departDate: futureDate(26), photo: G.tn },
];

export const meta = { id: "pl-packages", label: "Oferty PL (demo)", needsKeys: false };

// eslint-disable-next-line no-unused-vars
export async function search(crit) {
  // Provider zwraca pełną listę pakietów; filtrowanie/ranking robi warstwa wspólna.
  // source = touroperator, żeby na karcie widać było, kto organizuje wyjazd.
  return DATA.map((h) => ({ ...h, type: "package", source: h.operator, photos: [h.photo] }));
}

export function isEnabled() {
  return true; // seed demo działa zawsze — do czasu podpięcia MerlinX
}
