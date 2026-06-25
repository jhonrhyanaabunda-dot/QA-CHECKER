// ───────────────────────────────────────────────────────────────────────────
// NHTSA vPIC verifier — the official US vehicle catalog API.
// Public, no API key required. Docs: https://vpic.nhtsa.dot.gov/api/
//
// Used to confirm that a (make, model) referenced in content is a real vehicle
// NHTSA recognizes for the given year — a cheap sanity check that catches
// fabricated or misspelled model names in dealership copy.
// ───────────────────────────────────────────────────────────────────────────

const BASE = "https://vpic.nhtsa.dot.gov/api";
const cache = new Map<string, boolean>();

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

/** Returns true if NHTSA lists `model` under `make` (year-independent catalog). */
export async function vehicleExists(
  make: string,
  model: string,
): Promise<boolean> {
  const key = `${make}|${model}`.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  const data = await getJson(
    `${BASE}/vehicles/GetModelsForMake/${encodeURIComponent(make)}?format=json`,
  );
  const results: any[] = data?.Results ?? [];
  const exists = results.some((r) =>
    String(r.Model_Name || "")
      .toLowerCase()
      .includes(model.toLowerCase()),
  );
  cache.set(key, exists);
  return exists;
}

/** All makes NHTSA recognizes (cached). Used to validate the make token. */
let makesCache: Set<string> | null = null;
export async function knownMake(make: string): Promise<boolean> {
  if (!makesCache) {
    const data = await getJson(`${BASE}/vehicles/GetAllMakes?format=json`);
    const results: any[] = data?.Results ?? [];
    makesCache = new Set(
      results.map((r) => String(r.Make_Name || "").toLowerCase()),
    );
  }
  return makesCache.has(make.toLowerCase());
}
