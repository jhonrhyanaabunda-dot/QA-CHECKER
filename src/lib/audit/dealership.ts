// ───────────────────────────────────────────────────────────────────────────
// Dealership detection — figures out WHICH dealership a page belongs to and,
// crucially, the dealership's MAIN website. Correction/verify links for wrong
// facts point at this main site (e.g. Dalton Toyota → daltontoyota.com), because
// that is the authoritative place to confirm the dealer's real pricing, offers,
// phone, hours, rating, and vehicle pages — not the OEM brand site.
//
// The main site is found by (1) matching a linked domain against a distinctive
// token of the dealership name, then (2) falling back to the most-linked
// external domain that isn't social media, an OEM site, a marketplace, or a
// utility/host domain.
// ───────────────────────────────────────────────────────────────────────────

import type { ExtractedContent } from "./types";

export interface Dealership {
  name: string;
  /** Origin of the dealership's main website, e.g. https://www.daltontoyota.com */
  website?: string;
  /** Registrable domain, e.g. daltontoyota.com */
  domain?: string;
}

const MAKE_DOMAINS = [
  "toyota.com", "honda.com", "ford.com", "chevrolet.com", "nissanusa.com",
  "hyundaiusa.com", "kia.com", "subaru.com", "mazdausa.com", "vw.com",
  "jeep.com", "ramtrucks.com", "gmc.com", "buick.com", "cadillac.com",
  "lexus.com", "acura.com", "infinitiusa.com", "bmwusa.com", "mbusa.com",
  "audiusa.com", "volvocars.com", "porsche.com", "tesla.com", "dodge.com",
  "chrysler.com", "mitsubishicars.com", "genesis.com", "lincoln.com",
];

// Host substrings that are never a dealership's own site (match subdomains too).
const EXCLUDED_PATTERNS = [
  "facebook.", "instagram.", "twitter.", "youtube.", "youtu.be", "tiktok.",
  "linkedin.", "pinterest.", "google.", "goo.gl", "vercel.app", "netlify.app",
  "cookielaw.", "onetrust.", "fonts.", "gstatic.", "googleapis.", "cloudflare.",
  "doubleclick.",
];
// Exact registrable domains that are never a dealership's own site. Matched on
// the registrable domain (NOT substring) so "galaxytoyota.com" is NOT excluded
// just because it ends with "toyota.com".
const EXCLUDED_DOMAINS = new Set([
  "x.com", "yelp.com", "apple.com", "cargurus.com", "cars.com", "autotrader.com",
  "kbb.com", "edmunds.com", "carfax.com", "dealerrater.com", "truecar.com",
  "carvana.com", "schema.org", "w3.org", "wp.com", "gravatar.com",
  ...MAKE_DOMAINS,
]);

// Generic words that don't uniquely identify a dealership in a domain.
const GENERIC = new Set([
  "auto", "autos", "motor", "motors", "car", "cars", "dealer", "dealership",
  "group", "the", "of", "and", "inc", "llc", "new", "used", "sales", "service",
  "toyota", "honda", "ford", "chevrolet", "chevy", "nissan", "hyundai", "kia",
  "subaru", "mazda", "jeep", "ram", "gmc", "buick", "cadillac", "lexus",
  "acura", "bmw", "mercedes", "audi", "volvo", "dodge", "chrysler", "lincoln",
]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Last two labels of a host — a good-enough registrable domain. */
function registrable(host: string): string {
  const parts = host.split(".");
  return parts.slice(-2).join(".");
}

function isExcluded(host: string): boolean {
  if (EXCLUDED_PATTERNS.some((e) => host.includes(e))) return true;
  if (EXCLUDED_DOMAINS.has(registrable(host))) return true;
  return false;
}

/** Pull the dealership name from the page title (segment with a brand/place). */
export function dealershipName(content: ExtractedContent): string {
  const segments = content.title.split(/[|–—\-]/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return content.title.trim();
  // The dealer name is usually the segment mentioning a make or "of <city>".
  // Titles read "Topic | Dealer Name", so prefer the LAST matching segment and
  // skip segments that are obviously the article topic (lead with a model year).
  const brandRe =
    /\b(toyota|honda|ford|chevrolet|chevy|nissan|hyundai|kia|subaru|mazda|jeep|ram|gmc|buick|cadillac|lexus|acura|bmw|mercedes|audi|volvo|dodge|chrysler|lincoln|of)\b/i;
  const branded = [...segments]
    .reverse()
    .find((s) => brandRe.test(s) && !/^\s*20\d{2}\b/.test(s));
  return branded || segments[segments.length - 1];
}

export function detectDealership(content: ExtractedContent): Dealership {
  const name = dealershipName(content);
  const auditedHost = hostOf(content.finalUrl);

  // Distinctive name tokens (drop generic make/place-agnostic words).
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERIC.has(t));

  // Candidate hosts from the page's links, keeping the real URLs so we preserve
  // scheme/port and can pick a representative homepage to crawl later.
  const byHost = new Map<string, { count: number; urls: string[] }>();
  for (const link of content.links) {
    const host = hostOf(link.url);
    if (!host || isExcluded(host)) continue;
    if (auditedHost && host === auditedHost && /vercel\.app|netlify\.app/.test(host)) continue;
    const entry = byHost.get(host) || { count: 0, urls: [] };
    entry.count += 1;
    entry.urls.push(link.url);
    byHost.set(host, entry);
  }

  // 1) A linked domain that contains a distinctive token of the dealer name.
  let match: string | undefined;
  for (const host of byHost.keys()) {
    if (tokens.some((t) => registrable(host).includes(t))) {
      match = host;
      break;
    }
  }
  // 2) Otherwise the most-linked external host (often the main site nav/footer).
  if (!match && byHost.size) {
    match = [...byHost.entries()].sort((a, b) => b[1].count - a[1].count)[0][0];
  }
  // 3) If the audited page itself is a real (non-preview) dealer domain, use it.
  if (!match && auditedHost && !isExcluded(auditedHost)) {
    return {
      name,
      domain: registrable(auditedHost),
      website: new URL(content.finalUrl).origin,
    };
  }
  if (!match) return { name };

  // Representative homepage URL on the matched host: prefer path "/", else the
  // shortest path. Preserves the real origin (scheme + port).
  const urls = byHost.get(match)!.urls;
  const homepage = [...urls].sort((a, b) => {
    const pa = new URL(a).pathname;
    const pb = new URL(b).pathname;
    if ((pa === "/") !== (pb === "/")) return pa === "/" ? -1 : 1;
    return pa.length - pb.length;
  })[0];

  return {
    name,
    domain: registrable(match),
    website: homepage || `https://${match}`,
  };
}
