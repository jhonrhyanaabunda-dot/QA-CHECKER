// ───────────────────────────────────────────────────────────────────────────
// Correct-value resolver — fetches the AUDITED DEALERSHIP's own main website and
// extracts the authoritative current values (pricing, lease, incentives,
// warranty, rating, review count, phone) so the auto-fix engine can correct a
// wrong value on the audited page to the right one found on the dealer's site.
//
// Crawls the dealer homepage plus a couple of likely offer/specials/contact
// pages (bounded), then reuses the same claim detectors used on the audited
// page. Best-effort and fully degradable: any fetch failure → no correction is
// applied (the item falls back to "needs developer confirmation").
// ───────────────────────────────────────────────────────────────────────────

import { crawl } from "./crawler";
import { extract } from "./extractor";
import { detectClaims, parseVehicle } from "./claims";
import type { ClaimType, ExtractedContent } from "./types";
import type { Dealership } from "./dealership";

export interface CorrectValue {
  type: ClaimType;
  /** The exact string to insert into the corrected copy. */
  value: string;
  /** Vehicle model the value applies to, when relevant (e.g. "Prius"). */
  vehicleModel?: string;
  /** Page on the dealer's site the value was found on. */
  sourceUrl: string;
}

const OFFER_KEYWORDS = /special|offer|lease|deal|incentive|finance|pricing|inventory|contact|about|review/i;
const MAX_PAGES = 3;

function sameRegistrable(a: string, b: string): boolean {
  const reg = (h: string) => h.split(".").slice(-2).join(".");
  try {
    return reg(new URL(a).hostname) === reg(new URL(b).hostname);
  } catch {
    return false;
  }
}

/** Pull authoritative correct values from one dealer-site page's content. */
function collectFromContent(content: ExtractedContent, sourceUrl: string): CorrectValue[] {
  const out: CorrectValue[] = [];
  const blob = [
    content.text,
    ...content.lists.flatMap((l) => l.items),
    ...content.tables.flatMap((t) => t.rows.flat()),
  ].join(". ");

  for (const c of detectClaims(blob)) {
    if (!c.value) continue;
    if (["pricing", "lease", "incentive", "warranty", "mpg", "fuel_economy"].includes(c.type)) {
      const veh = parseVehicle(c.text);
      out.push({ type: c.type, value: c.value, vehicleModel: veh?.model, sourceUrl });
    }
  }

  // Phone — the dealer's primary published number.
  if (content.phones[0]) {
    out.push({ type: "phone", value: content.phones[0], sourceUrl });
  }

  // Rating + review count from the dealer site's own text.
  const rating = blob.match(/(\d(?:\.\d)?)\s*(?:\/\s*5|stars?|out of 5)/i);
  if (rating) out.push({ type: "rating", value: rating[1], sourceUrl });
  const reviews = blob.match(/([\d,]{2,})\+?\s*(?:google\s+)?reviews?/i);
  if (reviews) out.push({ type: "review_count", value: reviews[1].replace(/,/g, ""), sourceUrl });

  return out;
}

export async function resolveFromDealerSite(
  dealer: Dealership | undefined,
): Promise<CorrectValue[]> {
  if (!dealer?.website) return [];
  const values: CorrectValue[] = [];
  const visited = new Set<string>();

  async function visit(url: string) {
    if (visited.size >= MAX_PAGES || visited.has(url)) return;
    visited.add(url);
    try {
      const res = await crawl(url);
      if (!res.ok || !res.html) return;
      const content = extract(res.html, res.finalUrl);
      values.push(...collectFromContent(content, res.finalUrl));
      // Queue up a couple of likely offer/contact pages on the same domain.
      if (visited.size < MAX_PAGES) {
        const candidates = content.links
          .filter((l) => sameRegistrable(l.url, url) && OFFER_KEYWORDS.test(l.url + " " + l.text))
          .map((l) => l.url)
          .filter((u) => !visited.has(u))
          .slice(0, MAX_PAGES - visited.size);
        for (const c of candidates) await visit(c);
      }
    } catch {
      /* unreachable / blocked — degrade silently */
    }
  }

  await visit(dealer.website);
  return values;
}

const INCENTIVE_KW = /cash back|rebate|bonus|apr|off|savings/i;
const MONTHLY = /\/mo|per month|a month|month/i;

/**
 * Pick the best dealer-site value for a claim — conservatively, to avoid
 * mismatching semantically different figures (e.g. a down payment vs MSRP).
 */
export function pickCorrectValue(
  claim: { type: ClaimType; text: string; value?: string },
  values: CorrectValue[],
): CorrectValue | undefined {
  const sameType = values.filter((v) => v.type === claim.type);
  if (!sameType.length) return undefined;

  // Lease: only correct an actual monthly payment ("$X/mo"), matched to a
  // monthly value on the dealer site — never a down payment / due-at-signing
  // figure. Prefer the same vehicle model.
  if (claim.type === "lease") {
    if (!MONTHLY.test(claim.value || "")) return undefined;
    const monthly = sameType.filter((v) => MONTHLY.test(v.value));
    if (!monthly.length) return undefined;
    const model = parseVehicle(claim.text)?.model?.toLowerCase();
    return (model && monthly.find((v) => v.vehicleModel?.toLowerCase() === model)) || monthly[0];
  }

  // Incentive: only a value of the SAME kind matches (cash back ≠ APR).
  if (claim.type === "incentive") {
    const kw = claim.value?.match(INCENTIVE_KW)?.[0]?.toLowerCase();
    if (!kw) return undefined;
    return sameType.find((v) => v.value.match(INCENTIVE_KW)?.[0]?.toLowerCase() === kw);
  }

  // Other vehicle-bound (pricing, mpg): prefer same model, else only if unique.
  if (["pricing", "mpg", "fuel_economy"].includes(claim.type)) {
    const model = parseVehicle(claim.text)?.model?.toLowerCase();
    return (
      (model && sameType.find((v) => v.vehicleModel?.toLowerCase() === model)) ||
      (sameType.length === 1 ? sameType[0] : undefined)
    );
  }

  // Single-valued facts (phone, rating, review_count, warranty).
  return sameType[0];
}
