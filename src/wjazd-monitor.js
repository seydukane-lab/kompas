// ============================================================
//  Monitor warunków wjazdowych (gov.pl / MSZ)
//
//  Warunki wjazdu — wizy, ważność paszportu, wymogi zdrowotne — konsultant czyta
//  klientowi jako fakt i nikt ich nie zweryfikuje przed wyjazdem. Zmieniają się
//  w ciągu roku (Egipt podniósł opłatę wizową w III 2026), a dane w countries.js
//  zbierane są ręcznie. Bez przypomnienia po prostu się starzeją.
//
//  ⛔ CZEGO TEN MODUŁ ŚWIADOMIE NIE ROBI: nie podmienia treści przepisów tym,
//  co znajdzie w sieci. Zły parse strony = błędna informacja prawna podana
//  klientowi jako pewnik — dokładnie ta klasa błędu, której pilnujemy w całym
//  projekcie. Automat WYKRYWA ZMIANĘ i oznacza kraj do weryfikacji; treść
//  aktualizuje człowiek, świadomie, po przeczytaniu źródła.
//
//  Dodatkowe ograniczenie, zmierzone 18.08.2026: gov.pl nie oddaje treści
//  merytorycznej w HTML (renderuje ją JavaScriptem), więc porównywanie samego
//  tekstu jest niemożliwe bez przeglądarki. Zostaje sygnatura odpowiedzi
//  (ETag / Last-Modified / rozmiar) — słabsza, ale uczciwa: mówi „coś się na tej
//  stronie ruszyło, sprawdź", a nie „przepisy brzmią teraz tak".
// ============================================================

import { createHash } from "node:crypto";
import { COUNTRIES } from "./countries.js";

// Strona MSZ dla każdego kraju z naszej listy. Slug bierzemy z nazwy kraju —
// nie z ręcznej mapy, żeby dodanie kraju do COUNTRIES nie wymagało pamiętania
// o drugim miejscu. Wyjątki (nazwy wielowyrazowe, inne slugi) dopisujemy tutaj.
const SLUG_WYJATKI = {};

export function slugKraju(nazwa) {
  if (SLUG_WYJATKI[nazwa]) return SLUG_WYJATKI[nazwa];
  return String(nazwa)
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
}

export function urlKraju(nazwa) {
  return `https://www.gov.pl/web/dyplomacja/${slugKraju(nazwa)}`;
}

export function monitorowaneKraje() {
  return Object.keys(COUNTRIES);
}

// Sygnatura odpowiedzi: to, co serwer daje BEZ renderowania JS. ETag zmienia się
// przy każdej edycji treści; gdy go brak, schodzimy na Last-Modified, a w ostatniej
// kolejności na rozmiar odpowiedzi. Kolejność ma znaczenie — rozmiar sam w sobie
// jest sygnałem słabym (ta sama długość przy innej treści), więc używamy go tylko
// wtedy, gdy nie ma nic lepszego, i mówimy o tym wprost w raporcie.
export function sygnatura({ etag, lastModified, dlugosc }) {
  if (etag) return { rodzaj: "etag", wartosc: String(etag).replace(/^W\//, "").replace(/"/g, "") };
  if (lastModified) return { rodzaj: "last-modified", wartosc: String(lastModified) };
  if (typeof dlugosc === "number") return { rodzaj: "rozmiar", wartosc: String(dlugosc) };
  return { rodzaj: "brak", wartosc: "" };
}

export function odcisk(sygn) {
  return createHash("sha256").update(sygn.rodzaj + "|" + sygn.wartosc).digest("hex").slice(0, 16);
}

// Porównanie ze stanem zapisanym w repo. Zwraca DANE, nie ocenę — o tym, co z tym
// zrobić, decyduje skrypt (raport) albo panel (oznaczenie kraju).
export function porownaj(stan, wyniki) {
  const zmienione = [];
  const bezZmian = [];
  const niedostepne = [];

  for (const w of wyniki) {
    if (w.blad) { niedostepne.push({ kraj: w.kraj, powod: w.blad }); continue; }
    const poprzedni = (stan.kraje || {})[w.kraj];
    if (!poprzedni) { zmienione.push({ kraj: w.kraj, powod: "pierwsze sprawdzenie", rodzaj: w.sygnatura.rodzaj }); continue; }
    if (poprzedni.odcisk !== w.odcisk) {
      zmienione.push({ kraj: w.kraj, powod: "strona MSZ zmieniła się od ostatniego sprawdzenia", rodzaj: w.sygnatura.rodzaj, poprzednioSprawdzone: poprzedni.sprawdzone });
    } else {
      bezZmian.push({ kraj: w.kraj, poprzednioSprawdzone: poprzedni.sprawdzone });
    }
  }
  return { zmienione, bezZmian, niedostepne };
}

// Nowy stan do zapisania. `zweryfikowane` (data ostatniego ludzkiego sprawdzenia
// TREŚCI) celowo NIE jest ruszane przez automat — automat wie tylko tyle, że
// strona się zmieniła, nie że ktoś to przeczytał i przepisał do countries.js.
export function nowyStan(stan, wyniki, teraz = new Date()) {
  const kraje = { ...(stan.kraje || {}) };
  const dzis = teraz.toISOString().slice(0, 10);
  for (const w of wyniki) {
    if (w.blad) continue;
    const poprzedni = kraje[w.kraj] || {};
    kraje[w.kraj] = {
      odcisk: w.odcisk,
      rodzaj: w.sygnatura.rodzaj,
      sprawdzone: dzis,
      zweryfikowane: poprzedni.zweryfikowane || null,
      ...(poprzedni.odcisk && poprzedni.odcisk !== w.odcisk ? { zmienioneOd: dzis } : (poprzedni.zmienioneOd ? { zmienioneOd: poprzedni.zmienioneOd } : {})),
    };
  }
  return { ostatnieSprawdzenie: dzis, kraje };
}

// Które kraje czekają na ludzką weryfikację: strona MSZ ruszyła się PO tym, jak
// ostatni raz ktoś przepisał treść do countries.js.
export function doWeryfikacji(stan) {
  const out = [];
  for (const [kraj, k] of Object.entries(stan.kraje || {})) {
    if (!k.zmienioneOd) continue;
    if (!k.zweryfikowane || k.zweryfikowane < k.zmienioneOd) out.push({ kraj, zmienioneOd: k.zmienioneOd, zweryfikowane: k.zweryfikowane || null });
  }
  return out;
}
