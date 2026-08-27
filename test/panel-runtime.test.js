// ============================================================
//  Panel musi dać się WYKONAĆ, nie tylko sparsować
//
//  test/front.test.js sprawdza składnię całego skryptu i uruchamia pojedyncze
//  funkcje wyjęte z pliku przez dopasowanie tekstu. To dużo, ale zostaje dziura:
//  błąd NAZWY wewnątrz funkcji, której żaden test nie woła, przechodzi przez
//  składnię, przechodzi przez testy — i wywala cały panel u konsultanta przy
//  pierwszym wyszukiwaniu. Zdrowy backend niczego tu nie ratuje.
//
//  Ten plik wykonuje CAŁY skrypt panelu na atrapie DOM (Proxy, który odpowiada
//  na wszystko), a potem woła ścieżki, które konsultant przechodzi realnie:
//  render pustej listy, render z ofertą, koszyk, raport, pasek pokrycia atrybutów.
//  Nie sprawdza wyglądu — sprawdza, że kod się wykonuje.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NL = String.fromCharCode(10);

// Bez wyrażeń regularnych: granice bloku wycinamy po znacznikach, żeby test
// nie przewracał się o własny wzorzec przy zmianie atrybutów w <script>.
function skryptPanelu() {
  const html = readFileSync(join(ROOT, "public/index.html"), "utf8");
  const otw = html.indexOf("<script>");
  const zam = html.indexOf("</script>", otw);
  assert.ok(otw > -1 && zam > otw, "nie znalazłem inline'owego skryptu panelu");
  return html.slice(otw + "<script>".length, zam);
}

// Atrapa odpowiadająca na wszystko: każda właściwość to znowu atrapa, każde
// wywołanie zwraca atrapę. Celowo NIE udaje przeglądarki — chodzi wyłącznie o to,
// czy skrypt da się wykonać, a nie co narysuje.
function atrapa(nazwa, pola) {
  const f = function () { return atrapa(nazwa); };
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => "";
      if (k === Symbol.iterator) return [][Symbol.iterator].bind([]);
      if (k === "length") return 0;
      if (k === "then") return undefined; // niech nikt nie bierze atrapy za Promise
      // getElementById zwraca atrapę PODPISANĄ id-em, żeby dało się podać wartość
      // konkretnego pola. Bez tego `nm` w render() jest zawsze puste i gałąź
      // szukania po nazwie hotelu nigdy się nie wykonuje — sabotaż w niej przechodził.
      if (k === "getElementById") return (id) => atrapa(String(id), pola);
      if (k === "value") return (pola && pola[nazwa]) || "";
      if (k === "textContent" || k === "innerHTML") return "";
      return atrapa(String(k), pola);
    },
    set() { return true; },
    apply() { return atrapa(nazwa); },
    has() { return true; },
  });
}

// Cały panel to jedno IIFE, więc dopisek musi trafić DO ŚRODKA — dopisany na końcu
// nie widziałby żadnej funkcji. Wstawiamy go tuż przed domknięciem wyrażenia.
function wykonaj(dopisek, pola) {
  const skrypt = skryptPanelu();
  const zamkniecie = skrypt.lastIndexOf("})();");
  assert.ok(zamkniecie > -1, "skrypt panelu przestał być pojedynczym wyrażeniem IIFE");
  const kod = dopisek
    ? skrypt.slice(0, zamkniecie) + NL + dopisek + NL + skrypt.slice(zamkniecie)
    : skrypt;
  const fn = new Function(
    "document", "window", "localStorage", "sessionStorage", "fetch",
    "location", "navigator", "setTimeout", "setInterval", "clearInterval",
    "clearTimeout", "console", "requestAnimationFrame", "alert", "matchMedia",
    kod,
  );
  fn(
    atrapa("document", pola), atrapa("window"), atrapa("localStorage"), atrapa("sessionStorage"),
    () => new Promise(() => {}),          // żadne żądanie się nie kończy
    atrapa("location"), atrapa("navigator"),
    () => 0, () => 0, () => {}, () => {},
    { log() {}, warn() {}, error() {} },
    () => 0, () => {}, () => atrapa("mql"),
  );
}

test("skrypt panelu wykonuje się w całości, nie tylko parsuje", () => {
  wykonaj("");
});

test("ścieżki, które konsultant przechodzi realnie, dają się wywołać", () => {
  // UWAGA na stan startowy: bez wybranego kierunku render() wchodzi w gałąź
  // „Zacznij od kierunku" i NIE dotyka ani zeroNaglowek(), ani podpowiedzi.
  // Pierwsza wersja tego testu właśnie tak przechodziła obok — wykonywała się,
  // niczego nie sprawdzając. Stan trzeba ustawić jawnie, inaczej test daje
  // fałszywe poczucie bezpieczeństwa.
  const kierunek = "activeCountries=['Grecja'];";

  // Zero wyników przy wybranym kierunku — gałąź „nic nie pasuje" / „jeszcze nie wiemy".
  wykonaj(kierunek + "render([]);");

  // To samo, ale ze źródłem, które nie odpowiedziało — druga gałąź nagłówka.
  wykonaj(kierunek + "ostatnieZrodla=[{id:'hb',label:'Hotelbeds',ok:false,count:0}];render([]);");

  // Szukanie po nazwie bez trafienia — trzecia gałąź pustego ekranu.
  wykonaj(kierunek + "render([]);");

  // Szukanie po NAZWIE bez trafienia — gałąź osobna od dwóch powyższych i do
  // 27.08.2026 jedyna, która dalej twierdziła „nie znaleziono". Wchodzi się w nią
  // wyłącznie wtedy, gdy pole nazwy hotelu NIE jest puste.
  wykonaj(kierunek + "render([]);", { hotelName: "Jaz Aquamarine" });
  wykonaj(kierunek + "ostatnieZrodla=[{id:'hb',label:'Hotelbeds',ok:false}];render([]);",
    { hotelName: "Jaz Aquamarine" });

  // Lista z ofertą — karta, plakietki, znaczniki braków danych. `terminDomyslny`
  // i `attrUnknown` są USTAWIONE celowo: bez nich gałęzie znaczników się nie wykonują.
  const oferta = "{id:'x',name:'Hotel',region:'R',country:'K',price:1000,priceTotal:2000,"
    + "priceTotalPax:2,stars:4,rating:8.2,reviews:120,freshDays:5,nights:7,board:'All Inclusive',"
    + "tags:[],attrUnknown:['plaza'],demo:true,filtrRozproszony:true,amenities:['basen'],"
    + "terminOd:'2026-09-01',terminDo:'2026-09-08',terminDomyslny:true,departDate:'2026-09-01',"
    + "transport:'Samolot',departureCity:'Katowice',operator:'TUI',beach:150,cap:4}";
  wykonaj(kierunek + "render([" + oferta + "]);");

  // Koszyk i oba raporty — tam wchodzą flagi uczciwości przepisane przez cartSnap.
  wykonaj("cart=[cartSnap(" + oferta + ")];renderCart();buildAdvisorReport();");

  // Wydruk dla klienta — dokument, który ogląda osoba podejmująca decyzję.
  wykonaj("cart=[cartSnap(" + oferta + ")];printCart();");

  wykonaj("renderAttrCover([{key:'plaza',confirmed:3,unknown:1}],['nieznane-kryterium']);");
});
