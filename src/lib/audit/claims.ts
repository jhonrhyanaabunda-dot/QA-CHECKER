// ───────────────────────────────────────────────────────────────────────────
// Claim detection — deterministic, regex/heuristic extraction of every claim
// type the engine reasons about (MPG, pricing, lease, warranty, ratings, review
// counts, incentives, specs, manufacturer claims, phones, uncited statistics).
//
// Detection is intentionally LLM-free so it is fast, free, and reproducible.
// The LLM layer (optional) later enriches reasoning, but never gates detection.
// ───────────────────────────────────────────────────────────────────────────

import { genId } from "../utils";
import type { Claim, ClaimType } from "./types";

const MAKES = [
  "toyota", "honda", "ford", "chevrolet", "chevy", "nissan", "hyundai", "kia",
  "subaru", "mazda", "volkswagen", "vw", "jeep", "ram", "gmc", "buick",
  "cadillac", "lexus", "acura", "infiniti", "bmw", "mercedes", "mercedes-benz",
  "audi", "volvo", "porsche", "tesla", "dodge", "chrysler", "mitsubishi",
  "genesis", "lincoln", "land rover", "jaguar", "mini", "fiat", "alfa romeo",
];

const MAKE_RE = new RegExp(`\\b(${MAKES.join("|")})\\b`, "i");

export interface VehicleRef {
  year?: number;
  make: string;
  model: string;
  raw: string;
}

/** Pull the first "YYYY Make Model[ Trim]" reference from a text fragment. */
export function parseVehicle(text: string): VehicleRef | null {
  const re = new RegExp(
    `\\b(20\\d{2})\\s+(${MAKES.join("|")})\\s+([A-Z0-9][\\w-]+(?:\\s+[A-Z0-9][\\w-]+)?)`,
    "i",
  );
  const m = text.match(re);
  if (m) {
    return {
      year: Number(m[1]),
      make: normalizeMake(m[2]),
      model: m[3].trim().split(/\s+/)[0], // primary model token
      raw: m[0],
    };
  }
  // Make + model without a year (still verifiable against NHTSA catalog).
  // The make is matched case-insensitively, but the model token must be a real
  // proper noun: start with an uppercase letter/digit and not be a stopword
  // (avoids "Toyota is", "Honda the", "Ford Financial Services" false hits).
  const re2 = new RegExp(`\\b(${MAKES.join("|")})\\s+([A-Za-z0-9][\\w-]{1,})`, "i");
  const m2 = text.match(re2);
  if (m2 && /^[A-Z0-9]/.test(m2[2]) && !MODEL_STOPWORDS.has(m2[2].toLowerCase())) {
    return { make: normalizeMake(m2[1]), model: m2[2], raw: m2[0] };
  }
  return null;
}

// Capitalized words that follow a make but are never model names.
const MODEL_STOPWORDS = new Set([
  "is", "the", "and", "of", "financial", "motor", "motors", "dealership",
  "dealer", "service", "certified", "genuine", "parts", "credit", "care",
  "safety", "connect", "owners", "owner", "for", "with", "offers", "today",
]);

function normalizeMake(make: string): string {
  const m = make.toLowerCase();
  if (m === "chevy") return "Chevrolet";
  if (m === "vw") return "Volkswagen";
  if (m === "mercedes") return "Mercedes-Benz";
  return make.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface RawClaim {
  type: ClaimType;
  text: string;
  value?: string;
}

/** Detect every claim in a single text fragment (paragraph or page text). */
export function detectClaims(text: string): RawClaim[] {
  const out: RawClaim[] = [];
  const seen = new Set<string>();
  const push = (c: RawClaim) => {
    const k = `${c.type}:${c.value ?? c.text}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };

  // MPG / fuel economy
  for (const m of text.matchAll(/(\d{1,3})\s*(?:mpg|miles per gallon)/gi)) {
    const ctx = context(text, m.index ?? 0, m[0].length);
    const isCity = /city/i.test(ctx);
    const isHwy = /highway|hwy/i.test(ctx);
    push({
      type: /electric|kwh|mpge/i.test(ctx) ? "fuel_economy" : "mpg",
      text: ctx,
      value: `${m[1]} MPG${isCity ? " city" : isHwy ? " highway" : ""}`,
    });
  }

  // Pricing — but skip dollar amounts that are actually incentives (e.g.
  // "$1,000 cash back"); those are captured by the incentive detector below so
  // they aren't double-classified as a price.
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{3,})(?:\.\d{2})?/g)) {
    const start = m.index ?? 0;
    const after = text.slice(start + m[0].length, start + m[0].length + 18).toLowerCase();
    if (/cash back|rebate|bonus|\boff\b|savings/.test(after)) continue;
    const ctx = context(text, start, m[0].length);
    const isLease = /lease|\/mo|per month|month/i.test(ctx);
    push({
      type: isLease ? "lease" : "pricing",
      text: ctx,
      value: m[0].replace(/\s/g, ""),
    });
  }

  // Lease "$X/mo for Y months" patterns even without $ matched above
  for (const m of text.matchAll(
    /\$?\d[\d,]*\s*(?:\/mo|per month|a month)[^.]*?(\d{2,3})\s*months?/gi,
  )) {
    push({ type: "lease", text: context(text, m.index ?? 0, m[0].length), value: m[0].trim() });
  }

  // Warranty
  for (const m of text.matchAll(
    /(\d{1,3})[-\s]?(?:year|yr)[\s/-]*(?:(\d{1,3}(?:,\d{3})?)[-\s]?(?:mile|mi))?[^.]{0,30}warranty/gi,
  )) {
    push({ type: "warranty", text: context(text, m.index ?? 0, m[0].length), value: m[0].trim() });
  }
  for (const m of text.matchAll(/warranty[^.]{0,40}/gi)) {
    push({ type: "warranty", text: m[0].trim() });
  }

  // Google rating
  for (const m of text.matchAll(/(\d(?:\.\d)?)\s*(?:\/\s*5|stars?|★|out of 5)/gi)) {
    const r = Number(m[1]);
    if (r >= 1 && r <= 5) {
      push({ type: "rating", text: context(text, m.index ?? 0, m[0].length), value: m[1] });
    }
  }

  // Review counts
  for (const m of text.matchAll(/([\d,]{2,})\+?\s*(?:google\s+)?reviews?/gi)) {
    push({
      type: "review_count",
      text: context(text, m.index ?? 0, m[0].length),
      value: m[1].replace(/,/g, ""),
    });
  }

  // Incentives / rebates
  for (const m of text.matchAll(
    /\$[\d,]+\s*(?:cash\s+back|rebate|bonus\s+cash|incentive|off|savings)/gi,
  )) {
    push({ type: "incentive", text: context(text, m.index ?? 0, m[0].length), value: m[0].trim() });
  }
  for (const m of text.matchAll(/(\d(?:\.\d+)?)\s*%\s*apr/gi)) {
    push({ type: "incentive", text: context(text, m.index ?? 0, m[0].length), value: `${m[1]}% APR` });
  }

  // Vehicle spec (horsepower, towing, seating, range)
  for (const m of text.matchAll(
    /(\d{2,4})\s*(?:hp|horsepower|lb-?ft|lbs?\s+towing|pounds|mile\s+range|seats?)/gi,
  )) {
    push({ type: "vehicle_spec", text: context(text, m.index ?? 0, m[0].length), value: m[0].trim() });
  }

  // Phones
  for (const m of text.matchAll(
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  )) {
    push({ type: "phone", text: m[0].trim(), value: m[0].trim() });
  }

  // Manufacturer/OEM claims (contains a make + an assertion verb)
  if (MAKE_RE.test(text) && /\b(offers?|includes?|features?|comes? with|delivers?|gets?)\b/i.test(text)) {
    const veh = parseVehicle(text);
    if (veh) push({ type: "manufacturer_claim", text: text.slice(0, 240), value: veh.raw });
  }

  return out;
}

/** Grab a sentence-ish window of context around a regex match. */
function context(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1);
  let end = text.indexOf(".", index + length);
  if (end === -1) end = text.length;
  const slice = text.slice(start, end + 1).trim();
  return slice.length > 6 ? slice : text.slice(index, index + length).trim();
}

/** Build a Claim record (pre-verification) from a raw detection. */
export function toClaim(raw: RawClaim, paragraphIndex: number): Claim {
  return {
    id: genId("claim"),
    type: raw.type,
    text: raw.text,
    value: raw.value,
    paragraphIndex,
    status: "warning",
    confidence: 0.5,
    verification: "Pending verification.",
  };
}

/** Heuristic: a statistic (number/percent) appearing without a nearby source. */
export function detectUncitedStats(text: string): RawClaim[] {
  const out: RawClaim[] = [];
  const hasCitation = /\b(source|according to|per |\.gov|\.org|cite|study|survey by)\b/i.test(text);
  if (hasCitation) return out;
  for (const m of text.matchAll(/\b(\d{1,3}(?:\.\d+)?\s*%|\d{2,}\s*(?:percent|customers|drivers|owners))\b/gi)) {
    out.push({ type: "statistic", text: context(text, m.index ?? 0, m[0].length), value: m[0].trim() });
  }
  return out;
}
