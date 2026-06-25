// ───────────────────────────────────────────────────────────────────────────
// Fact-check engine — verifies detected claims against authoritative sources.
//
//   • MPG / fuel economy → FuelEconomy.gov (EPA official figures)
//   • vehicle specs / manufacturer claims → NHTSA vPIC catalog existence check
//   • uncited statistics → flagged for a citation (source missing)
//   • ratings/review counts → handled by ratings.ts (Google cross-check)
//   • pricing / lease / warranty / incentive → flagged as time-sensitive,
//     requiring reviewer confirmation against the live OEM/dealer offer
//
// Every claim ends as pass / warning / fail with a confidence and, where the
// engine can compute one, a concrete suggested correction.
// ───────────────────────────────────────────────────────────────────────────

import type { Claim } from "./types";
import type { Dealership } from "./dealership";
import { parseVehicle } from "./claims";
import { lookupMpg } from "../verifiers/fueleconomy";
import { knownMake, vehicleExists } from "../verifiers/nhtsa";
import {
  dealerVerifyUrl,
  epaModelUrl,
  googleSearch,
  nhtsaUrl,
} from "../verifiers/sources";

export async function verifyClaim(
  claim: Claim,
  dealer?: Dealership,
): Promise<Claim> {
  switch (claim.type) {
    case "mpg":
    case "fuel_economy":
      return verifyMpg(claim);
    case "vehicle_spec":
    case "manufacturer_claim":
      return verifyVehicle(claim, dealer);
    case "statistic":
      return verifyStatistic(claim, dealer);
    case "pricing":
    case "lease":
    case "warranty":
    case "incentive":
      return verifyTimeSensitive(claim, dealer);
    case "phone":
      return verifyPhone(claim, dealer);
    case "rating":
    case "review_count":
      return {
        ...claim,
        status: "warning",
        confidence: 0.5,
        verification:
          `Rating/review figure detected — confirm it against ${dealer?.name || "the dealership"}'s own site and live Google profile (see the Google Rating Verification panel).`,
        source: dealer?.domain ? `${dealer.name} website` : "Dealership website",
        sourceUrl: dealerVerifyUrl(dealer, `${claim.value ?? claim.text} reviews rating`),
      };
    default:
      return { ...claim, status: "warning", confidence: 0.4 };
  }
}

async function verifyMpg(claim: Claim): Promise<Claim> {
  const veh = parseVehicle(claim.text);
  const claimed = Number((claim.value || claim.text).match(/\d{1,3}/)?.[0] || 0);
  if (!veh || !veh.year || !claimed) {
    return {
      ...claim,
      status: "warning",
      confidence: 0.35,
      verification:
        "MPG figure detected but no specific year/make/model nearby to verify against EPA data.",
      source: "FuelEconomy.gov",
      sourceUrl: googleSearch(`${claim.value ?? claim.text} site:fueleconomy.gov`),
    };
  }

  const epa = await lookupMpg(veh.year, veh.make, veh.model);
  if (!epa) {
    return {
      ...claim,
      status: "warning",
      confidence: 0.4,
      verification: `Could not find ${veh.year} ${veh.make} ${veh.model} in EPA FuelEconomy.gov data to verify ${claimed} MPG.`,
      source: "FuelEconomy.gov",
      sourceUrl: epaModelUrl(veh.year, veh.make, veh.model),
      sourceMissing: true,
    };
  }

  const epaUrl = epaModelUrl(veh.year, epa.make, epa.model);

  const isCity = /city/i.test(claim.text);
  const isHwy = /highway|hwy/i.test(claim.text);
  const official = isCity ? epa.cityMpg : isHwy ? epa.highwayMpg : epa.combinedMpg;
  const officialLabel = isCity ? "city" : isHwy ? "highway" : "combined";
  const diff = Math.abs(claimed - official);

  if (diff === 0) {
    return {
      ...claim,
      status: "pass",
      confidence: 0.97,
      verification: `EPA confirms ${claimed} MPG ${officialLabel} for ${veh.year} ${epa.make} ${epa.model}.`,
      officialValue: `${official} MPG ${officialLabel}`,
      source: "FuelEconomy.gov",
      sourceUrl: epaUrl,
    };
  }
  if (diff <= 1) {
    return {
      ...claim,
      status: "warning",
      confidence: 0.7,
      verification: `Claimed ${claimed} MPG ${officialLabel}; EPA lists ${official} MPG ${officialLabel} (off by ${diff}). Likely trim-dependent — confirm trim.`,
      officialValue: `${official} MPG ${officialLabel}`,
      suggestedCorrection: `${official} MPG ${officialLabel}`,
      source: "FuelEconomy.gov",
      sourceUrl: epaUrl,
    };
  }
  return {
    ...claim,
    status: "fail",
    confidence: 0.9,
    verification: `Claimed ${claimed} MPG ${officialLabel}, but EPA lists ${official} MPG ${officialLabel} for ${veh.year} ${epa.make} ${epa.model}.`,
    officialValue: `${official} MPG ${officialLabel}`,
    suggestedCorrection: `${official} MPG ${officialLabel}`,
    source: "FuelEconomy.gov",
    sourceUrl: epaUrl,
  };
}

async function verifyVehicle(claim: Claim, dealer?: Dealership): Promise<Claim> {
  const veh = parseVehicle(claim.value || claim.text);
  if (!veh) {
    return { ...claim, status: "warning", confidence: 0.4, verification: "No resolvable vehicle reference to validate." };
  }
  const makeOk = await knownMake(veh.make);
  if (!makeOk) {
    return {
      ...claim,
      status: "fail",
      confidence: 0.85,
      verification: `NHTSA does not recognize make "${veh.make}". Possible typo or fabricated brand.`,
      source: "NHTSA vPIC",
      sourceUrl: nhtsaUrl(veh.make, veh.model, veh.year),
    };
  }
  const modelOk = await vehicleExists(veh.make, veh.model);
  if (!modelOk) {
    return {
      ...claim,
      status: "warning",
      confidence: 0.6,
      verification: `NHTSA lists ${veh.make} but no model matching "${veh.model}". Verify model/trim naming.`,
      source: "NHTSA vPIC",
      sourceUrl: nhtsaUrl(veh.make, veh.model, veh.year),
      sourceMissing: true,
    };
  }
  return {
    ...claim,
    status: "pass",
    confidence: 0.8,
    verification: `${veh.make} ${veh.model} is a valid vehicle per NHTSA. Confirm the spec figures on ${dealer?.name || "the dealership"}'s own ${veh.model} page.`,
    source: dealer?.domain ? `${dealer.name} website` : "NHTSA vPIC",
    sourceUrl: dealer?.domain
      ? dealerVerifyUrl(dealer, `${veh.year ?? ""} ${veh.model} specifications`)
      : nhtsaUrl(veh.make, veh.model, veh.year),
  };
}

function verifyStatistic(claim: Claim, dealer?: Dealership): Claim {
  return {
    ...claim,
    status: "warning",
    confidence: 0.7,
    verification: `Statistic "${claim.value ?? claim.text}" has no nearby citation.`,
    sourceMissing: true,
    source: dealer?.domain ? `${dealer.name} website` : "Missing",
    sourceUrl: dealerVerifyUrl(dealer, `${claim.value ?? claim.text}`),
    suggestedCorrection: "Add an authoritative citation (e.g. the dealership's own data, FuelEconomy.gov, EPA.gov, or NHTSA).",
  };
}

function verifyTimeSensitive(claim: Claim, dealer?: Dealership): Claim {
  const labels: Record<string, string> = {
    pricing: "Pricing",
    lease: "Lease offer",
    warranty: "Warranty terms",
    incentive: "Incentive/rebate",
  };
  const label = labels[claim.type] ?? "Offer";
  const veh = parseVehicle(claim.text);
  const detail = veh
    ? `${veh.year ?? ""} ${veh.model} ${claim.value ?? ""}`.trim()
    : claim.value ?? claim.text.slice(0, 60);
  return {
    ...claim,
    status: "warning",
    confidence: 0.5,
    verification: `${label} "${claim.value ?? claim.text}" is time-sensitive and can't be auto-verified. Confirm it against ${dealer?.name || "the dealership"}'s current offer on their main website, and ensure the disclaimer/expiration is present.`,
    source: dealer?.domain ? `${dealer.name} website` : "Dealership website",
    sourceUrl: dealerVerifyUrl(dealer, detail),
  };
}

function verifyPhone(claim: Claim, dealer?: Dealership): Claim {
  const digits = (claim.value || claim.text).replace(/\D/g, "");
  const valid = digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
  return {
    ...claim,
    status: valid ? "pass" : "fail",
    confidence: valid ? 0.8 : 0.85,
    verification: valid
      ? `Phone number is well-formed. Confirm it matches ${dealer?.name || "the dealership"}'s published number on their main website.`
      : `Phone number "${claim.value}" is malformed (${digits.length} digits).`,
    source: dealer?.domain ? `${dealer.name} website` : "Format check",
    sourceUrl: dealerVerifyUrl(dealer, `${claim.value ?? ""} contact phone`),
  };
}
