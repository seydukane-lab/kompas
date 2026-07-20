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

const ALL = [travellead, merlinx, hotelbeds, plPackages, mock]; // kolejność = priorytet przy scalaniu

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
      offers.push(...r.value);
      sources.push({ id: prov.meta.id, label: prov.meta.label, count: r.value.length });
    } else if (r.status === "rejected") {
      console.warn(`[${prov.meta.id}] search error:`, r.reason?.message || r.reason);
      sources.push({ id: prov.meta.id, label: prov.meta.label, count: 0, error: true });
    }
  });
  return { offers, sources };
}
