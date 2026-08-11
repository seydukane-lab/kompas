// ============================================================
//  Hotelbeds: wybór destynacji i składu grupy
//
//  Test regresyjny do błędu z 29.07.2026: `resolveTargets` nie obsługiwał
//  pola `countries`, więc wybór kraju w Multiroomie był po cichu ignorowany
//  i system pytał o destynacje sandboxa. Zapytanie kończyło się sukcesem —
//  tylko dotyczyło zupełnie innego kierunku, niż zaznaczył konsultant.
//  Takiego błędu nie widać w logach ani w interfejsie; widać go dopiero
//  wtedy, gdy klient pyta, czemu dostał oferty z Majorki zamiast z Turcji.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { resolveTargets, normalizeRoomsInput, MAX_POKOI, mapAmenities, mapBoard, mapStars, search as hbSearch, searchMultiroom } from "../src/providers/hotelbeds.js";

// Atrapa API Hotelbeds: jeden hotel (kod 100) dostępny dla każdego zapytania
// o dostępność (osobne pokoje i jeden duży pokój na cały skład), z prostą
// wyceną — wystarcza do sprawdzenia LOGIKI trybów multiroom bez sieci.
function mockHotelbedsFetch() {
  return async (url) => {
    const u = String(url);
    if (u.includes("/hotel-api/1.0/hotels")) {
      return new Response(JSON.stringify({
        hotels: { hotels: [
          { code: 100, name: "Test Hotel", categoryCode: "4EST",
            rooms: [{ name: "DOUBLE ROOM", rates: [{ net: "50", boardCode: "BB", boardName: "Bed & Breakfast" }] }] },
        ] },
      }), { status: 200 });
    }
    if (u.includes("/hotel-content-api/1.0/hotels")) {
      return new Response(JSON.stringify({
        hotels: [{ code: 100, name: { content: "Test Hotel" }, categoryCode: "4EST" }],
      }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };
}

function facility(text, extra = {}) {
  return { description: { content: text }, ...extra };
}

test("wybór jednego kraju trafia w kod jego destynacji", () => {
  assert.deepEqual(resolveTargets({ countries: ["Turcja"] }), ["AYT"]);
  assert.deepEqual(resolveTargets({ countries: ["Egipt"] }), ["SSH"]);
  assert.deepEqual(resolveTargets({ countries: ["Hiszpania"] }), ["PMI"]);
});

test("wybór kilku krajów naraz daje kilka destynacji", () => {
  const cele = resolveTargets({ countries: ["Egipt", "Turcja", "Grecja"] });
  assert.deepEqual(cele, ["SSH", "AYT", "CHQ"]);
});

test("kraj bez zmapowanego kodu jest pomijany, a nie wysyłany jako śmieć", () => {
  const cele = resolveTargets({ countries: ["Egipt", "Wakanda"] });
  assert.deepEqual(cele, ["SSH"]);
});

test("liczba destynacji na jedno wyszukiwanie jest ograniczona", () => {
  const cele = resolveTargets({ countries: ["Hiszpania", "Grecja", "Egipt", "Turcja", "Włochy", "Tunezja"] });
  assert.ok(cele.length <= 4, `poszło ${cele.length} destynacji — to mnoży zapytania do dostawcy`);
});

test("zaznaczone regiony mają pierwszeństwo przed krajem", () => {
  const cele = resolveTargets({ countries: ["Egipt"], regions: ["Kreta"] });
  assert.ok(!cele.includes("SSH"), "skoro konsultant wskazał region, nie pytamy o cały inny kraj");
});

test("pojedynczy kierunek ze starego pola `dest` nadal działa", () => {
  assert.deepEqual(resolveTargets({ dest: "Turcja" }), ["AYT"]);
});

test("brak kierunku spada na destynacje z danymi, a nie na pustkę", () => {
  const cele = resolveTargets({});
  assert.ok(cele.length > 0, "puste cele oznaczałyby ciche zero wyników");
});

test("pusta lista krajów zachowuje się jak brak wyboru", () => {
  assert.deepEqual(resolveTargets({ countries: [] }), resolveTargets({}));
});

test("skład grupy z panelu jest przepisywany wiernie", () => {
  const rooms = normalizeRoomsInput({
    rooms: [
      { adults: 2, children: 2, ages: [5, 8] },
      { adults: 2, children: 0, ages: [] },
    ],
  });
  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms[0], { adults: 2, children: 2, ages: [5, 8] });
  assert.deepEqual(rooms[1], { adults: 2, children: 0, ages: [] });
});

test("pokój bez dorosłych jest niemożliwy — zawsze co najmniej jedna osoba", () => {
  const rooms = normalizeRoomsInput({ rooms: [{ adults: 0, children: 2 }] });
  assert.equal(rooms[0].adults, 1, "zapytanie o pokój dla zera dorosłych nie ma sensu");
});

test("ujemne i śmieciowe wartości nie idą do dostawcy", () => {
  const rooms = normalizeRoomsInput({ rooms: [{ adults: -3, children: -1 }] });
  assert.equal(rooms[0].adults, 1);
  assert.equal(rooms[0].children, 0);

  const smieci = normalizeRoomsInput({ rooms: [{ adults: "dwa", children: null }] });
  assert.equal(smieci[0].adults, 1);
  assert.equal(smieci[0].children, 0);
});

test("brak listy pokoi spada na zwykły skład z formularza", () => {
  const rooms = normalizeRoomsInput({ adults: 3, kids: 1, childAges: [7] });
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].adults, 3);
  assert.equal(rooms[0].children, 1);
  assert.deepEqual(rooms[0].ages, [7]);
});

test("liczba pokoi w jednym wyszukiwaniu jest ograniczona", () => {
  // Każdy pokój to osobne, płatne zapytanie do dostawcy, mnożone przez liczbę
  // destynacji — bez limitu jedno kliknięcie wysyła kilkadziesiąt zapytań.
  const duzo = Array.from({ length: 30 }, () => ({ adults: 2, children: 0 }));
  assert.equal(normalizeRoomsInput({ rooms: duzo }).length, MAX_POKOI);
});

test("typowy wspólny wyjazd mieści się w limicie", () => {
  const trzyRodziny = Array.from({ length: 3 }, () => ({ adults: 2, children: 1, ages: [7] }));
  assert.equal(normalizeRoomsInput({ rooms: trzyRodziny }).length, 3);
});

test("domyślnie pytamy o dwie osoby", () => {
  const rooms = normalizeRoomsInput({});
  assert.deepEqual(rooms, [{ adults: 2, children: 0, ages: [] }]);
});

// Test regresyjny do błędu z 30.07.2026: filtry "Obiekt"/"Aktywność" były
// zbudowane, ale amenities nigdzie się nie liczyło — 241 ofert przed filtrem
// i 241 po. Ten zestaw testów pilnuje, żeby mapAmenities() naprawdę rozpoznawało
// udogodnienia z opisu facility, ORAZ żeby brak danych nigdy nie stawał się
// milczącą pustą tablicą (ANTY-PRZEKOLORYZACJA).

test("brak facilities w ogóle daje undefined, nie pustą tablicę", () => {
  assert.equal(mapAmenities(undefined), undefined);
  assert.equal(mapAmenities([]), undefined);
});

test("facilities bez trafień to legalna pusta tablica — sprawdziliśmy, nic nie pasuje", () => {
  const out = mapAmenities([facility("Free parking on site")]);
  assert.deepEqual(out, []);
});

test("mapAmenities rozpoznaje realne udogodnienia z opisu", () => {
  const out = mapAmenities([
    facility("Outdoor swimming pool"),
    facility("Wellness & Spa centre"),
    facility("Free WiFi in lobby"),
    facility("Fully accessible for wheelchair users"),
    facility("Daily animation programme"),
    facility("Water sports centre nearby"),
    facility("Kids' club for 4-12 years"),
    facility("Fitness / gym room"),
  ]);
  assert.deepEqual(out.sort(), [
    "animacje", "basen", "klub-dzieci", "niepelnosprawni",
    "silownia", "sporty-wodne", "spa", "wifi",
  ].sort());
});

test("mapAmenities nie zgaduje udogodnień, których opis nie wspomina", () => {
  const out = mapAmenities([facility("Outdoor swimming pool")]);
  assert.deepEqual(out, ["basen"]);
});

// ------------------------------------------------------------------
//  Wyżywienie to element UMOWY z klientem, nie kosmetyka karty oferty.
//  Zmierzone 11.08.2026 na 13 196 realnych stawkach (PMI/BCN/AGP): stary
//  mapBoard kończył się `return "BB"`, więc 34,7% stawek dostawało wymyślone
//  „Śniadania" — w tym 3418 stawek ROOM ONLY i 743 SELF CATERING. Konsultant
//  sprzedawał śniadania, których w rezerwacji nie było.
// ------------------------------------------------------------------

test("ROOM ONLY i SELF CATERING nie udają śniadań", () => {
  assert.equal(mapBoard("RO", "Room Only"), "Bez wyżywienia");
  assert.equal(mapBoard("SC", "Self Catering"), "Bez wyżywienia");
  assert.notEqual(mapBoard("RO", "Room Only"), "BB", "RO jako 'BB' to sprzedaż nieistniejącego posiłku");
});

test("kody wyżywienia nie schodzą w dół do 'BB'", () => {
  // Błąd działał w obie strony: AS (All Inclusive Premium) i MB (HB z napojami)
  // lądowały jako „BB", czyli oferta była pokazywana gorzej, niż jest naprawdę.
  assert.equal(mapBoard("AS", "All Inclusive Premium"), "Ultra All Inclusive");
  assert.equal(mapBoard("MB", "Half board with beverages"), "HB");
  assert.equal(mapBoard("FB", "Full Board"), "FB", "FB nie może być mylone z HB");
  assert.equal(mapBoard("AI", "All Inclusive"), "All Inclusive");
  assert.equal(mapBoard("AI", "Ultra All Inclusive Resort"), "Ultra All Inclusive");
});

test("wszystkie warianty śniadania trafiają do jednej etykiety", () => {
  for (const kod of ["BB", "AB", "CB", "DB", "GB", "IB", "LB", "SB", "B1", "B2"]) {
    assert.equal(mapBoard(kod, ""), "BB", `${kod} to śniadanie wg słownika dostawcy`);
  }
});

test("nieznany kod wyżywienia to brak danych, a nie 'BB'", () => {
  // Dostawca ma 54 kody i dokłada kolejne; te o niejednoznacznym opisie
  // (CE „dinner included", CO „lunch included" — jeden posiłek, ani BB, ani HB)
  // muszą wracać jako niewiadoma, nie jako zgadnięta wartość.
  assert.equal(mapBoard("CE", "Dinner included"), undefined);
  assert.equal(mapBoard("ZZZ", "Kod, którego jeszcze nie ma"), undefined);
  assert.equal(mapBoard("", ""), undefined);
  assert.equal(mapBoard(null, null), undefined);
  // Sama nazwa bez potwierdzonego kodu nie wystarcza do postawienia tezy.
  assert.equal(mapBoard("ZZZ", "Ultra All Inclusive"), undefined,
    "nazwa stawki może doprecyzować znany kod, ale nie zastąpić go");
});

test("nieznana kategoria hotelu to brak gwiazdek, a nie ciche trzy", () => {
  // 32 z 582 hoteli (5,5%) mają kategorię bez cyfry: SUP, HS, SPC, AG, BOU, ALBER.
  // Stary kod dawał im 3 gwiazdki, więc minStars=3 wpuszczał je jak potwierdzone.
  assert.equal(mapStars("4EST"), 4);
  assert.equal(mapStars("APTH3"), 3);
  assert.equal(mapStars("SUP"), undefined);
  assert.equal(mapStars("BOU"), undefined);
  assert.equal(mapStars(""), undefined);
  assert.equal(mapStars(null), undefined);
});

// ------------------------------------------------------------------
//  Zaobserwowane 31.07.2026: Hotelbeds zaczął zwracać HTTP 403 na WSZYSTKIE
//  destynacje (wyczerpana pula dobowa sandboxa). search() łapał ten błąd
//  per-destynacja i cicho zwracał [] — dla warstwy wyżej wyglądało to
//  identycznie jak uczciwy brak ofert. search() musi rzucić dalej, gdy
//  KAŻDE zapytanie padło, żeby providers/index.js mogło to odróżnić.
// ------------------------------------------------------------------
test("search() rzuca, gdy WSZYSTKIE odpytane destynacje padły", async () => {
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 403 });
  try {
    await assert.rejects(
      () => hbSearch({ dest: "Hiszpania", adults: 2 }),
      /403/
    );
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test("search() nie rzuca, gdy choć jedna destynacja odpowiedziała (nawet pusto)", async () => {
  const oryginalny = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.destination.code === "PMI") return new Response("", { status: 403 });
    return new Response(JSON.stringify({ hotels: { hotels: [] } }), { status: 200 });
  };
  try {
    // Brak `dest`/`regions` -> SANDBOX_DESTS (PMI, BCN, AGP) — kilka celów naraz.
    const wynik = await hbSearch({ adults: 2 });
    assert.deepEqual(wynik, [], "PMI pada, ale BCN/AGP odpowiadają uczciwym zerem — to nie jest awaria");
  } finally {
    globalThis.fetch = oryginalny;
  }
});

// ------------------------------------------------------------------
//  Multiroom — tryb "compare": dwa pokoje 2-osobowe kontra jeden 4-osobowy
//  to realne pytanie klienta, dziś wymagające dwóch osobnych wyszukiwań.
//  Tryb "any" już wybierał automatycznie tańszą opcję — "compare" ma
//  zwrócić OBIE, żeby konsultant (albo klient) mógł wybrać świadomie.
// ------------------------------------------------------------------
test("tryb compare zwraca obie konfiguracje (osobne pokoje i jeden duży) obok siebie", async () => {
  const oryginalny = globalThis.fetch;
  globalThis.fetch = mockHotelbedsFetch();
  try {
    const offers = await searchMultiroom({
      dest: "Hiszpania", // -> jedna destynacja (PMI), żeby uniknąć duplikatów z atrapy
      rooms: [{ adults: 2, children: 0 }, { adults: 2, children: 0 }],
      roomsMode: "compare",
    });
    assert.equal(offers.length, 1);
    const h = offers[0];
    assert.ok(Array.isArray(h.compareConfigs), "brak compareConfigs w trybie compare");
    assert.equal(h.compareConfigs.length, 2, "oczekiwano obu opcji: osobne pokoje i jeden duży");
    assert.deepEqual(h.compareConfigs.map((c) => c.layout).sort(), ["single", "split"]);
    const min = Math.min(...h.compareConfigs.map((c) => c.priceTotal));
    assert.equal(h.priceTotal, min, "cena reprezentanta musi być tańszą z dwóch opcji (do sortowania listy)");
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test("tryb any nadal wybiera automatycznie tańszą opcję, bez compareConfigs", async () => {
  const oryginalny = globalThis.fetch;
  globalThis.fetch = mockHotelbedsFetch();
  try {
    const offers = await searchMultiroom({
      dest: "Hiszpania",
      rooms: [{ adults: 2, children: 0 }, { adults: 2, children: 0 }],
      roomsMode: "any",
    });
    assert.equal(offers.length, 1);
    assert.equal(offers[0].compareConfigs, undefined, "tryb any nie powinien zwracać compareConfigs");
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test("tryb split (domyślny) liczy tylko osobne pokoje, bez zapytania o jeden duży", async () => {
  const oryginalny = globalThis.fetch;
  let zapytaniaDostepnosci = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/hotel-api/1.0/hotels")) {
      zapytaniaDostepnosci++;
      return mockHotelbedsFetch()(url, init);
    }
    return mockHotelbedsFetch()(url, init);
  };
  try {
    await searchMultiroom({
      dest: "Hiszpania",
      rooms: [{ adults: 2, children: 0 }, { adults: 2, children: 0 }],
      roomsMode: "split",
    });
    // 1 destynacja x 2 pokoje = 2 zapytania o dostępność; tryb split NIE dokłada
    // trzeciego zapytania o "jeden duży pokój" (to koszt tylko any/compare).
    assert.equal(zapytaniaDostepnosci, 2);
  } finally {
    globalThis.fetch = oryginalny;
  }
});

// ------------------------------------------------------------------
//  Formularz "Wspólny wyjazd" pozwala podać LICZBĘ dzieci per pokój, ale do
//  01.08.2026 nie zbierał ICH WIEKU — a wiek decyduje o cenie (progi
//  "gratis"/zniżka) i o tym, czy pokój w ogóle przyjmie taki skład. Front
//  wysyła teraz rooms[].ages; tu sprawdzamy, że backend niesie ten wiek aż
//  do zapytania o dostępność (paxes), a nie tylko przez normalizeRoomsInput.
// ------------------------------------------------------------------
test("wiek dzieci z pokoju multiroom trafia do zapytania o dostępność (paxes)", async () => {
  const oryginalny = globalThis.fetch;
  const zapytania = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/hotel-api/1.0/hotels")) {
      zapytania.push(JSON.parse(init.body));
    }
    return mockHotelbedsFetch()(url, init);
  };
  try {
    await searchMultiroom({
      dest: "Hiszpania",
      rooms: [
        { adults: 2, children: 2, ages: [3, 15] },
        { adults: 1, children: 1, ages: [8] },
      ],
      roomsMode: "split",
    });
    assert.equal(zapytania.length, 2, "jedna destynacja x dwa pokoje = dwa zapytania o dostępność");
    assert.deepEqual(
      zapytania[0].occupancies[0].paxes,
      [{ type: "CH", age: 3 }, { type: "CH", age: 15 }],
      "wiek pierwszego pokoju musi dotrzeć do paxes, nie zgubić się po drodze"
    );
    assert.deepEqual(zapytania[1].occupancies[0].paxes, [{ type: "CH", age: 8 }]);
  } finally {
    globalThis.fetch = oryginalny;
  }
});

test("brak wieku dzieci w pokoju multiroom nie wywraca zapytania", async () => {
  const oryginalny = globalThis.fetch;
  const zapytania = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/hotel-api/1.0/hotels")) {
      zapytania.push(JSON.parse(init.body));
    }
    return mockHotelbedsFetch()(url, init);
  };
  try {
    const offers = await searchMultiroom({
      dest: "Hiszpania",
      // Konsultant podał liczbę dzieci, ale nie zdążył (albo nie musiał)
      // wybrać wieku — pole `ages` w ogóle nie przyszło z formularza.
      rooms: [{ adults: 2, children: 1 }],
      roomsMode: "split",
    });
    assert.equal(offers.length, 1, "brak wieku nie może ubić całego wyszukiwania");
    assert.deepEqual(
      zapytania[0].occupancies[0].paxes,
      [{ type: "CH", age: 8 }],
      "bez podanego wieku leci przybliżenie (8 lat), nie awaria zapytania"
    );
  } finally {
    globalThis.fetch = oryginalny;
  }
});
