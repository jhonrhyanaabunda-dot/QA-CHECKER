// ───────────────────────────────────────────────────────────────────────────
// FuelEconomy.gov verifier — the official EPA fuel-economy web service.
// Public, no API key required. Docs: https://www.fueleconomy.gov/feg/ws/
//
// We resolve year → make → model → options menus, then fetch the vehicle record
// to read EPA city / highway / combined MPG. Results are cached in-process for
// the lifetime of the server to avoid hammering the API across paragraphs.
// ───────────────────────────────────────────────────────────────────────────

const BASE = "https://www.fueleconomy.gov/ws/rest";

const cache = new Map<string, EpaMpg | null>();

export interface EpaMpg {
  year: number;
  make: string;
  model: string;
  trim: string;
  cityMpg: number;
  highwayMpg: number;
  combinedMpg: number;
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Look up EPA MPG for a vehicle. Make/model matching is fuzzy (case-insensitive
 * substring) and picks the first matching trim, which is sufficient for the
 * common "2025 Toyota Prius LE gets 57 MPG" style claims.
 */
export async function lookupMpg(
  year: number,
  make: string,
  model: string,
): Promise<EpaMpg | null> {
  const key = `${year}|${make}|${model}`.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  const result = await resolve(year, make, model);
  cache.set(key, result);
  return result;
}

async function resolve(
  year: number,
  make: string,
  model: string,
): Promise<EpaMpg | null> {
  // 1) makes for the year
  const makesData = await getJson(`${BASE}/vehicle/menu/make?year=${year}`);
  const makes = asArray<any>(makesData?.menuItem);
  const makeMatch = makes.find(
    (m) => String(m.value).toLowerCase() === make.toLowerCase(),
  );
  if (!makeMatch) return null;

  // 2) models for year+make
  const modelsData = await getJson(
    `${BASE}/vehicle/menu/model?year=${year}&make=${encodeURIComponent(makeMatch.value)}`,
  );
  const models = asArray<any>(modelsData?.menuItem);
  const modelMatch =
    models.find((m) => String(m.value).toLowerCase() === model.toLowerCase()) ||
    models.find((m) =>
      String(m.value).toLowerCase().includes(model.toLowerCase()),
    );
  if (!modelMatch) return null;

  // 3) option/trim menu → vehicle id
  const optsData = await getJson(
    `${BASE}/vehicle/menu/options?year=${year}&make=${encodeURIComponent(
      makeMatch.value,
    )}&model=${encodeURIComponent(modelMatch.value)}`,
  );
  const opts = asArray<any>(optsData?.menuItem);
  if (!opts.length) return null;
  const first = opts[0];

  // 4) vehicle record
  const veh = await getJson(`${BASE}/vehicle/${first.value}`);
  if (!veh) return null;

  const city = Number(veh.city08 ?? veh.city08U ?? 0);
  const highway = Number(veh.highway08 ?? veh.highway08U ?? 0);
  const combined = Number(veh.comb08 ?? veh.comb08U ?? 0);
  if (!city && !highway && !combined) return null;

  return {
    year,
    make: makeMatch.value,
    model: modelMatch.value,
    trim: String(first.text || ""),
    cityMpg: Math.round(city),
    highwayMpg: Math.round(highway),
    combinedMpg: Math.round(combined),
  };
}
