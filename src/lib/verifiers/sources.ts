// ───────────────────────────────────────────────────────────────────────────
// Source URLs — builds DIRECT, clickable links to the authoritative source for
// every kind of correction, so a reviewer can verify or fix a flagged claim in
// one click. Where a stable deep link exists (EPA FuelEconomy.gov "bymodel"
// pages) we link straight to it; where the source blocks bots or has no stable
// per-item URL (NHTSA, OEM offer pages, Google profiles, FTC guidance) we use a
// source-scoped Google query, which always resolves and lands on the right page.
//
// Every URL form here was verified to return HTTP 200 in a browser.
// ───────────────────────────────────────────────────────────────────────────

/** A Google search scoped to the given query — always-valid direct link. */
export function googleSearch(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Direct link to verify a wrong fact on the AUDITED DEALERSHIP's own main site.
 * If we know the dealer's domain we scope the search to it (lands on the exact
 * page on their site, e.g. site:daltontoyota.com 2025 Prius lease); otherwise we
 * search the dealership by name, which surfaces their main website. This is the
 * authoritative place to confirm the dealer's real pricing, offers, and contact
 * info — never the OEM brand site.
 */
export function dealerVerifyUrl(
  dealer: { name?: string; domain?: string } | undefined,
  detail: string,
): string {
  if (dealer?.domain) return googleSearch(`site:${dealer.domain} ${detail}`);
  if (dealer?.name) return googleSearch(`${dealer.name} ${detail}`);
  return googleSearch(detail);
}

/** Direct EPA FuelEconomy.gov page for a specific year/make/model. */
export function epaModelUrl(year: number, make: string, model: string): string {
  const slug = `${year}_${make}_${model}`
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "");
  return `https://www.fueleconomy.gov/feg/bymodel/${slug}.shtml`;
}

/** NHTSA info for a vehicle (scoped search — nhtsa.gov blocks direct bots). */
export function nhtsaUrl(make: string, model: string, year?: number): string {
  return googleSearch(
    `${year ? year + " " : ""}${make} ${model} specifications site:nhtsa.gov`,
  );
}

/** Live Google Business Profile / reviews for a dealership (by name). */
export function googleReviewsUrl(dealershipName: string): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(dealershipName + " reviews")}`;
}

/** FTC truth-in-advertising guidance for unsupported dealer claims. */
export function ftcGuidanceUrl(rule: string): string {
  return googleSearch(`FTC dealer advertising substantiation ${rule}`);
}
