// ============================================================
//  Rejestr dostawców danych.
//  Dodanie nowego źródła = dopisanie jednego importu tutaj.
//  Każdy dostawca implementuje: meta, isEnabled(), search(crit).
// ============================================================

import * as mock from "./mock.js";
import * as hotelbeds from "./hotelbeds.js";
import * as merlinx from "./merlinx.js";
import * as travellead from "./travellead.js";
import * as plPackages from "./packages.js";
import { normalizeName } from "../ranking.js";

// Provider wakacje.js jest LOKALNY (gitignored) — na publicznym wdrożeniu (Render)
// tego pliku nie ma. Ładujemy go OPCJONALNIE, żeby build nie padał przy jego braku;
// bez pliku wakacje po prostu nie startuje (strona publiczna zostaje czysta).
let wakacje = null;
try {
  wakacje = await import("./wakacje.js");
} catch {
  /* brak lokalnego providera — produkcja/publiczne repo */
}

// Kolejność = priorytet przy scalaniu duplikatów (niżej = ważniejsze).
// wakacje (jeśli obecne) = realne oferty+oceny+link, więc na czele realnych źródeł.
const ALL = [wakacje, travellead, merlinx, hotelbeds, plPackages, mock].filter(Boolean);

export function activeProviders() {
  return ALL.filter((p) => p.isEnabled());
}

export function providerStatus() {
  return ALL.map((p) => ({
    id: p.meta.id,
    label: p.meta.label,
    needsKeys: p.meta.needsKeys,
    enabled: p.isEnabled(),
  }));
}

// Odpytuje wszystkich aktywnych dostawców równolegle i scala oferty.
export async function searchAll(crit) {
  const providers = activeProviders();
  const settled = await Promise.allSettled(providers.map((p) => p.search(crit)));

  const offers = [];
  const sources = [];
  settled.forEach((r, i) => {
    const prov = providers[i];
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      // Priorytet dostawcy = pozycja w ALL (niższa = ważniejsza). Przyda się przy scalaniu.
      const prio = ALL.indexOf(prov);
      offers.push(...r.value.map((o) => ({ ...o, __prio: prio })));
      sources.push({ id: prov.meta.id, label: prov.meta.label, count: r.value.length });
    } else if (r.status === "rejected") {
      console.warn(`[${prov.meta.id}] search error:`, r.reason?.message || r.reason);
      sources.push({ id: prov.meta.id, label: prov.meta.label, count: 0, error: true });
    }
  });

  return { offers: dedupeOffers(offers), sources };
}

// ---------------------------------------------------------------
//  Scalanie duplikatów między źródłami.
//  Gdy ten sam hotel przyjdzie z kilku źródeł (np. feed z bazy + pakiety
//  demo + Hotelbeds), łączymy go w JEDNĄ ofertę zamiast pokazywać kilka razy.
//  Reprezentanta wybiera priorytet dostawcy (realne źródła > demo), a brakujące
//  mocne pola (realne oceny, zdjęcia, link do rezerwacji) dobieramy z pozostałych.
// ---------------------------------------------------------------

// Tożsamość hotelu: znormalizowana nazwa + kraj. Region bywa różnie zapisany
// między źródłami ("Hurghada" vs "Hurghada, Sahl Hasheed"), więc go do klucza
// nie bierzemy — różnice regionu rozstrzyga wybór reprezentanta.
function identityKey(o) {
  return normalizeName(o.name) + "|" + normalizeName(o.country);
}

// Realne zdjęcie (URL) vs gradient-placeholder (CSS).
function hasRealPhoto(o) {
  const p = o.photo || (o.photos && o.photos[0]) || "";
  return /^https?:/i.test(p);
}

export function dedupeOffers(list) {
  const groups = new Map();
  for (const o of list) {
    const key = identityKey(o);
    if (!key.replace(/[|]/g, "").trim()) {
      // Brak nazwy/kraju — nie ryzykujemy scalania, przepuszczamy jako unikat.
      groups.set(Symbol(), [o]);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  const out = [];
  for (const grp of groups.values()) {
    if (grp.length === 1) {
      out.push(strip(grp[0]));
      continue;
    }
    // Reprezentant: najwyższy priorytet dostawcy (najniższy __prio).
    grp.sort((a, b) => (a.__prio ?? 99) - (b.__prio ?? 99));
    const primary = { ...grp[0] };
    const rest = grp.slice(1);

    // Realne oceny (reviews > 0) biją oszacowane — kluczowe dla anty-przekoloryzacji.
    if (!(primary.reviews > 0)) {
      const withReviews = rest.find((o) => o.reviews > 0);
      if (withReviews) {
        primary.rating = withReviews.rating;
        primary.reviews = withReviews.reviews;
        primary.freshDays = withReviews.freshDays;
      }
    }
    // Realne zdjęcia, jeśli reprezentant ma tylko placeholder.
    if (!hasRealPhoto(primary)) {
      const withPhoto = rest.find(hasRealPhoto);
      if (withPhoto) {
        primary.photo = withPhoto.photo;
        primary.photos = withPhoto.photos;
      }
    }
    // Link do rezerwacji (afiliacja) — bierzemy pierwszy dostępny.
    if (!primary.bookingUrl) {
      const withUrl = rest.find((o) => o.bookingUrl);
      if (withUrl) primary.bookingUrl = withUrl.bookingUrl;
    }
    // Ślad, że oferta łączy kilka źródeł (do ewentualnej plakietki na karcie).
    primary.mergedFrom = grp.map((o) => o.source).filter((s, i, a) => s && a.indexOf(s) === i);
    out.push(strip(primary));
  }
  return out;
}

function strip(o) {
  const { __prio, ...rest } = o;
  return rest;
}
