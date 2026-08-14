// ============================================================
//  Scalanie ofert z wielu źródeł, cache wyszukiwania i limity czasu
//
//  Dedupe jest cichym miejscem na błędy: gdy ten sam hotel przychodzi
//  z trzech źródeł, łatwo zgubić realne opinie albo pokazać ten sam
//  obiekt trzy razy. Jedno i drugie widać dopiero u klienta.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { dedupeOffers, searchAll, clearSearchCache, providerStatus } from "../src/providers/index.js";
import { withDeadline } from "../src/http.js";
import { search as searchPackages } from "../src/providers/packages.js";
import { hasAttribute } from "../src/ranking.js";

function offer(over = {}) {
  return {
    name: "Blue Lagoon", country: "Egipt", region: "Hurghada",
    price: 3500, rating: 8.4, reviews: 0, stars: 4, source: "demo", __prio: 5,
    ...over,
  };
}

test("ten sam hotel z dwóch źródeł zostaje jedną ofertą", () => {
  const out = dedupeOffers([
    offer({ source: "A", __prio: 1 }),
    offer({ source: "B", __prio: 5 }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].mergedFrom.sort(), ["A", "B"]);
});

test("nazwy różniące się wielkością liter i spacjami to ten sam hotel", () => {
  const out = dedupeOffers([
    offer({ name: "Blue  Lagoon", __prio: 1 }),
    offer({ name: "BLUE LAGOON", __prio: 5 }),
  ]);
  assert.equal(out.length, 1);
});

test("ten sam hotel w innym kraju to inny hotel", () => {
  const out = dedupeOffers([offer({ country: "Egipt" }), offer({ country: "Turcja" })]);
  assert.equal(out.length, 2);
});

test("reprezentantem zostaje źródło o wyższym priorytecie", () => {
  const out = dedupeOffers([
    offer({ source: "gorsze", __prio: 9, price: 9999 }),
    offer({ source: "lepsze", __prio: 1, price: 3000 }),
  ]);
  assert.equal(out[0].source, "lepsze");
  assert.equal(out[0].price, 3000);
});

test("realne opinie wygrywają z oszacowanymi", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, reviews: 0, rating: 9.9 }),          // reprezentant bez opinii
    offer({ __prio: 5, reviews: 2400, rating: 8.1, freshDays: 3 }), // źródło z opiniami
  ]);
  assert.equal(out[0].reviews, 2400, "liczba opinii musi przyjść ze źródła, które je ma");
  assert.equal(out[0].rating, 8.1, "razem z oceną, żeby nie zestawić 9,9 z 2400 opiniami");
  assert.equal(out[0].freshDays, 3);
});

test("brakujące fakty o obiekcie dobierane są z bogatszego źródła", () => {
  const out = dedupeOffers([
    offer({ __prio: 1 }), // reprezentant bez szczegółów
    offer({ __prio: 5, beach: 120, roomType: "Standard Room", airport: 8000, yearRenov: 2024, adultsOnly: true }),
  ]);
  assert.equal(out[0].beach, 120);
  assert.equal(out[0].roomType, "Standard Room");
  assert.equal(out[0].airport, 8000);
  assert.equal(out[0].yearRenov, 2024);
  assert.equal(out[0].adultsOnly, true);
});

test("dane reprezentanta nie są nadpisywane przez słabsze źródło", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, beach: 50, roomType: "Suite" }),
    offer({ __prio: 5, beach: 900, roomType: "Standard" }),
  ]);
  assert.equal(out[0].beach, 50);
  assert.equal(out[0].roomType, "Suite");
});

test("link do rezerwacji dobierany jest z dowolnego źródła, które go ma", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, bookingUrl: "" }),
    offer({ __prio: 5, bookingUrl: "https://example.com/oferta" }),
  ]);
  assert.equal(out[0].bookingUrl, "https://example.com/oferta");
});

test("różne terminy tego samego hotelu zostają jako warianty", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, departDate: "2026-08-15", price: 3690, departureCity: "Katowice" }),
    offer({ __prio: 1, departDate: "2026-08-22", price: 3200, departureCity: "Katowice" }),
    offer({ __prio: 1, departDate: "2026-08-29", price: 4100, departureCity: "Warszawa" }),
  ]);
  assert.equal(out.length, 1, "to jeden hotel, nie trzy");
  assert.equal(out[0].variants.length, 3, "ale trzy wyloty do wyboru");
  assert.equal(out[0].variants[0].price, 3200, "warianty od najtańszego");
});

test("oferty bez nazwy nie są scalane ze sobą", () => {
  const out = dedupeOffers([offer({ name: "", country: "" }), offer({ name: "", country: "" })]);
  assert.equal(out.length, 2, "brak nazwy to nie powód, żeby uznać dwa obiekty za ten sam");
});

test("pole techniczne __prio nie wychodzi na zewnątrz", () => {
  const out = dedupeOffers([offer()]);
  assert.ok(!("__prio" in out[0]));
});

// Amenities przy scalaniu: analogicznie do beach/roomType — reprezentant bez
// wiedzy o amenities dostaje ją z bogatszego źródła, ale własnej (nawet pustej)
// tablicy nie tracimy. Regresja do błędu z 30.07.2026 (filtry Obiekt/Aktywność
// nic nie robiły) — nie może się powtórzyć na etapie scalania duplikatów.
test("amenities dobierane są z bogatszego źródła, gdy reprezentant ich nie zna", () => {
  const out = dedupeOffers([
    offer({ __prio: 1 }), // reprezentant bez amenities
    offer({ __prio: 5, amenities: ["basen", "wifi"] }),
  ]);
  assert.deepEqual(out[0].amenities, ["basen", "wifi"]);
});

test("pusta (ale znana) tablica amenities reprezentanta nie jest nadpisywana", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, amenities: [] }), // sprawdzone: reprezentant nic nie ma
    offer({ __prio: 5, amenities: ["basen"] }),
  ]);
  assert.deepEqual(out[0].amenities, [], "wiedza reprezentanta 'sprawdzone, brak' nie może zniknąć");
});

test("gdy żadne źródło nie zna amenities, wynik zostaje undefined, nie []", () => {
  const out = dedupeOffers([offer({ __prio: 1 }), offer({ __prio: 5 })]);
  assert.equal(out[0].amenities, undefined, "brak danych nie może cicho zamienić się w pustą tablicę");
});

// Seed demo (packages.js) musi też realnie zasilać filtr Obiekt/Aktywność —
// inaczej konsultant bez klucza API do Hotelbeds w ogóle nie zobaczy, że działa.
test("oferty demo z packages.js mają amenities i realną wariancję między hotelami", async () => {
  const oferty = await searchPackages({});
  assert.ok(oferty.length > 10, "za mało ofert demo, żeby cokolwiek zweryfikować");
  assert.ok(oferty.every((o) => Array.isArray(o.amenities)), "każda oferta demo powinna mieć znane amenities");
  const zBasenem = oferty.filter((o) => o.amenities.includes("basen"));
  const zeSpa = oferty.filter((o) => o.amenities.includes("spa"));
  assert.ok(zBasenem.length > 0 && zBasenem.length < oferty.length, "basen musi różnicować ofertę, nie być stały dla wszystkich");
  assert.ok(zeSpa.length > 0 && zeSpa.length < oferty.length, "spa musi różnicować ofertę, nie być stały dla wszystkich");
});

test("demo nigdy nie zgaduje dostępności dla niepełnosprawnych — tej informacji tu po prostu nie ma", async () => {
  const oferty = await searchPackages({});
  assert.ok(
    oferty.every((o) => !o.amenities.includes("niepelnosprawni")),
    "seed demo nie zawiera realnej informacji o dostępności — nie wolno jej zmyślać"
  );
  // Sam brak klucza w tablicy to za mało: skoro deriveAmenities() zwraca tablicę dla
  // KAŻDEJ oferty (każdy hotel łapie choćby wifi), stara reguła czytała ten brak jako
  // "sprawdziliśmy, nie ma" i dawała jawne `false` dla 91/91 ofert. Konsultant szukający
  // hotelu dla klienta na wózku dostawał zaprzeczenie zamiast niewiedzy.
  assert.ok(
    oferty.every((o) => hasAttribute(o, "niepelnosprawni") === undefined),
    "brak informacji o dostępności musi być brakiem danych, a nie odpowiedzią 'nie ma'"
  );
  // Kontrola, że deklaracja zasięgu nie wyłączyła wiedzy, którą seed REALNIE ma —
  // inaczej „naprawa" zamieniłaby wszystkie osiem udogodnień w jedno wielkie „nie wiemy".
  assert.ok(
    oferty.some((o) => hasAttribute(o, "basen") === true) && oferty.some((o) => hasAttribute(o, "basen") === false),
    "udogodnienia w zasięgu seeda muszą dawać realne true/false, nie undefined"
  );
});

test("oferta bez własnych amenities przejmuje zasięg wiedzy dawcy, a nie samą listę", () => {
  // Scalanie duplikatów: gdy reprezentant nie ma amenities, bierze je z innego źródła.
  // Gdyby przejął samą tablicę bez `amenityCoverage`, lista z ograniczonego źródła
  // czytałaby się jako pełna wiedza i cechy spoza jego zakresu znowu wyszłyby jako "nie ma".
  const bogaty = offer({ source: "hotelbeds", __prio: 1 });
  const ubogi = offer({ source: "demo", __prio: 5, amenities: ["basen"], amenityCoverage: ["basen", "spa"] });
  const [scalona] = dedupeOffers([bogaty, ubogi]);

  assert.deepEqual(scalona.amenities, ["basen"], "lista udogodnień ma się przenieść");
  assert.equal(hasAttribute(scalona, "spa"), false, "cecha w zasięgu dawcy nadal daje realną odpowiedź");
  assert.equal(
    hasAttribute(scalona, "niepelnosprawni"), undefined,
    "po scaleniu cecha spoza zasięgu dawcy nie może się zamienić w zaprzeczenie"
  );
});

// Regresja: cała pula cap===4+"rodzina" kiedyś dostawała identyczną nazwę pokoju
// ("Pokój rodzinny (2 sypialnie)"), więc hasAttribute(..., "pokoje-polaczone")
// wychodziło `false` dla KAŻDEJ oferty demo (roomType zawsze ustawiony -> nigdy
// `undefined`) i filtr „Pokoje połączone" bez klucza Hotelbeds zawsze zwracał
// 0 wyników — martwy klik w panelu, mimo że sam mechanizm filtra działał poprawnie.
test("demo z packages.js daje realne potwierdzenia OBU układów pokoju, nie tylko dzielonego", async () => {
  const oferty = await searchPackages({});
  const dzielone = oferty.filter((o) => hasAttribute(o, "pokoj-dzielony") === true);
  const polaczone = oferty.filter((o) => hasAttribute(o, "pokoje-polaczone") === true);
  assert.ok(dzielone.length > 0, "filtr 'Osobna sypialnia' nie może być martwy w demo");
  assert.ok(polaczone.length > 0, "filtr 'Pokoje połączone' nie może być martwy w demo");
  const oboje = oferty.filter(
    (o) => hasAttribute(o, "pokoj-dzielony") === true && hasAttribute(o, "pokoje-polaczone") === true
  );
  assert.equal(oboje.length, 0, "to dwa różne produkty — żadna oferta nie powinna potwierdzać obu naraz");
});

// Konsultant nie wybiera „oferty" — wybiera HOTEL, a potem przebiera w wariantach
// (operator × lotnisko × termin × cena). Do 15.08.2026 seed dawał jeden rekord na
// hotel, więc filtry operatora i wylotu nie miały czym operować, a panel pokazywał
// produkt, którego w tej formie nikt nie sprzedaje.
test("demo generuje wiele wariantów na hotel, a dedupe składa je w jeden wynik", async () => {
  const surowe = await searchPackages({});
  const po = dedupeOffers(surowe);

  assert.ok(surowe.length > po.length * 2,
    "seed nie generuje rodzeństwa — jeden hotel dalej daje jedną ofertę");
  assert.ok(po.every((o) => (o.variants || []).length >= 2),
    "po scaleniu każdy hotel ma mieć co najmniej dwa warianty do wyboru");

  const v = po[0].variants[0];
  for (const pole of ["operator", "departureCode", "arrivalCode", "carrier", "flightNo", "days"]) {
    assert.ok(v[pole] !== undefined, `wariant nie niesie pola ${pole} — UI nie pokaże szczegółów przelotu`);
  }
});

test("suma za grupę nie jest zawsze dwukrotnością ceny za osobę", async () => {
  // To nie jest usterka danych, tylko realny mechanizm rynkowy: część operatorów
  // promuje „drugą osobę taniej", więc oferta droższa „od" bywa tańsza w sumie.
  // Gdyby seed tego nie odtwarzał, sortowanie po sumie wyglądałoby na zbędne —
  // a to jest jedyne sortowanie, któremu konsultant może ufać.
  const surowe = await searchPackages({});
  const zPromocja = surowe.filter((o) => o.priceTotal !== o.price * 2);
  assert.ok(zPromocja.length > 0,
    "żaden wariant nie ma promocji drugiej osoby — porównywanie po sumie traci sens");
  assert.ok(zPromocja.every((o) => o.priceTotal > o.price),
    "suma za grupę nie może wyjść niższa niż cena za jedną osobę");
});

test("brak informacji o wolnych miejscach zostaje brakiem, nie zerem", async () => {
  // W realnym panelu wolne miejsca bywają podane tylko dla lotu tam, a powrót
  // pokazuje „*". Zero znaczyłoby „brak miejsc" — czyli dokładnie odwrotność prawdy.
  const surowe = await searchPackages({});
  assert.ok(surowe.some((o) => o.seatsLeft === undefined),
    "seed nie odtwarza przypadku nieznanej liczby miejsc");
  assert.ok(surowe.every((o) => o.seatsLeft === undefined || o.seatsLeft > 0),
    "wolne miejsca nie mogą być zerem — brak danych ma być undefined");
  assert.ok(surowe.every((o) => o.seatsLeftReturn === undefined),
    "liczba miejsc na powrót nie jest w tym seedzie znana i nie wolno jej zmyślać");
});

test("historia ceny daje realny argument sprzedażowy, nie płaską linię", async () => {
  const surowe = await searchPackages({});
  const h = surowe[0].priceHistory;
  assert.ok(h && Array.isArray(h.byDate) && h.byDate.length >= 5,
    "brak rozbicia ceny po dniach wylotu");
  const ceny = h.byDate.map((d) => d.price);
  assert.ok(Math.max(...ceny) > Math.min(...ceny),
    "ceny w kolejnych dniach są identyczne — wykres nie pokazywałby niczego");
  assert.ok(h.byDate.some((d) => d.offset === h.cheapestOffset && d.price === Math.min(...ceny)),
    "wskazany najtańszy termin nie zgadza się z najniższą ceną w rozbiciu");
});

test("słupek dla wybranego terminu równa się cenie wariantu", async () => {
  // Wykres stoi w modalu tuż pod tabelą wariantów. Gdyby słupek „termin" pokazywał
  // inną liczbę niż wiersz nad nim, konsultant zobaczyłby dwie różne ceny tej samej
  // oferty w jednym widoku — i słusznie przestałby ufać obu.
  const surowe = await searchPackages({});
  for (const o of surowe.slice(0, 40)) {
    const zero = o.priceHistory.byDate.find((d) => d.offset === 0);
    assert.equal(zero.price, o.price,
      `wariant ${o.id}: cena na wykresie (${zero.price}) ≠ cena oferty (${o.price})`);
  }
});

test("warianty tego samego hotelu są powtarzalne między wywołaniami", async () => {
  // Generator jest zasiany id hotelu. Gdyby losował za każdym razem od nowa,
  // ta sama oferta zmieniałaby cenę między wyszukaniem a pokazaniem jej klientowi.
  const a = await searchPackages({});
  const b = await searchPackages({});
  assert.deepEqual(a.map((o) => o.id + ":" + o.price), b.map((o) => o.id + ":" + o.price),
    "seed nie jest deterministyczny — cena zmienia się między wywołaniami");
});

test("withDeadline przepuszcza to, co zdąży", async () => {
  const wynik = await withDeadline(Promise.resolve("gotowe"), 1000, "szybkie");
  assert.equal(wynik, "gotowe");
});

test("withDeadline przerywa to, co się nie wyrabia", async () => {
  await assert.rejects(
    withDeadline(new Promise((r) => setTimeout(r, 5000)), 50, "wolne-zrodlo"),
    /wolne-zrodlo.*limit/
  );
});

test("każdy dostawca deklaruje komplet metadanych", () => {
  for (const p of providerStatus()) {
    assert.ok(p.id, "dostawca bez id");
    assert.ok(p.label, `dostawca ${p.id} bez etykiety`);
    assert.equal(typeof p.enabled, "boolean");
  }
});

test("powtórzone wyszukiwanie idzie z cache i jest wyraźnie szybsze", async () => {
  clearSearchCache();
  const crit = { dest: "Egipt", adults: 2, pax: 2 };

  const t0 = Date.now();
  const pierwsze = await searchAll(crit);
  const czasPierwszego = Date.now() - t0;

  const t1 = Date.now();
  const drugie = await searchAll(crit);
  const czasDrugiego = Date.now() - t1;

  assert.ok(drugie.cached, "drugie zapytanie musi być oznaczone jako z cache");
  assert.equal(drugie.offers.length, pierwsze.offers.length);
  // Porównanie czasów jest chwiejne, gdy oba zapytania trwają pojedyncze
  // milisekundy (dostawcy demo odpowiadają natychmiast) — dlatego pilnujemy
  // twardego progu, a nie tego, który przebieg był szybszy o ułamek.
  assert.ok(czasDrugiego < 100, `odczyt z cache trwał ${czasDrugiego} ms`);
  if (czasPierwszego > 50) {
    assert.ok(czasDrugiego <= czasPierwszego, "przy wolnym dostawcy cache musi realnie skracać czas");
  }
});

test("inne kryteria to inne zapytanie, nie cache", async () => {
  clearSearchCache();
  await searchAll({ dest: "Egipt", adults: 2 });
  const inne = await searchAll({ dest: "Grecja", adults: 2 });
  assert.ok(!inne.cached, "zmiana kierunku nie może zwrócić poprzedniego wyniku");
});

test("kolejność pól w kryteriach nie tworzy osobnego wpisu w cache", async () => {
  clearSearchCache();
  await searchAll({ dest: "Egipt", adults: 2, nights: 7 });
  const drugie = await searchAll({ nights: 7, adults: 2, dest: "Egipt" });
  assert.ok(drugie.cached, "te same kryteria zapisane w innej kolejności to to samo pytanie");
});

// ------------------------------------------------------------------
//  Trzy stany źródła: odpowiedziało (z ofertami), odpowiedziało zerem
//  (uczciwe "nic nie ma"), padło (wyjątek/timeout/HTTP 4xx-5xx).
//  Bez tego rozróżnienia awaria dostawcy i realny brak ofert wyglądają
//  dla konsultanta identycznie: count: 0.
// ------------------------------------------------------------------
function atrapa(id, impl) {
  return { meta: { id, label: id }, isEnabled: () => true, search: impl };
}

test("dostawca, który rzuca wyjątkiem, jest oznaczony jako ok:false z powodem", async () => {
  clearSearchCache();
  const padajacy = atrapa("padajacy", async () => {
    const err = new Error("availability HTTP 403");
    err.status = 403;
    throw err;
  });
  const { sources } = await searchAll({ dest: "test-padajacy" }, [padajacy]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].ok, false);
  assert.equal(sources[0].count, 0);
  assert.match(sources[0].reason, /403/);
});

test("dostawca, który uczciwie nie znalazł nic, jest oznaczony jako ok:true", async () => {
  clearSearchCache();
  const pusty = atrapa("pusty", async () => []);
  const { sources } = await searchAll({ dest: "test-pusty" }, [pusty]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].ok, true);
  assert.equal(sources[0].count, 0);
  assert.equal(sources[0].reason, undefined);
});

test("dostawca z ofertami jest oznaczony jako ok:true z niezerowym count", async () => {
  clearSearchCache();
  const zOfertami = atrapa("zofertami", async () => [offer(), offer({ name: "Drugi Hotel" })]);
  const { sources } = await searchAll({ dest: "test-zofertami" }, [zOfertami]);
  assert.equal(sources[0].ok, true);
  assert.equal(sources[0].count, 2);
});

test("awaria jednego źródła nie trafia do cache — kolejne zapytanie próbuje ponownie", async () => {
  clearSearchCache();
  let wywolania = 0;
  const padajacy = atrapa("padajacy2", async () => {
    wywolania++;
    throw new Error("padlo");
  });
  const crit = { dest: "test-nocache" };
  const pierwsze = await searchAll(crit, [padajacy]);
  assert.equal(pierwsze.cached, undefined);
  const drugie = await searchAll(crit, [padajacy]);
  assert.equal(drugie.cached, undefined);
  assert.equal(wywolania, 2, "awaria nie może zostać zamrożona w cache");
});
