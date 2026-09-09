// ───────────────────────────────────────────────────────────────────────────
// Link checker — verifies every hyperlink with real HTTP requests.
// Detects 404s, broken/unreachable links, invalid URLs, and redirect chains.
// Uses HEAD first (cheap) and falls back to GET for servers that reject HEAD.
// Runs with bounded concurrency so a page with 100 links stays responsive.
// ───────────────────────────────────────────────────────────────────────────

import { genId } from "../utils";
import type { LinkCheck } from "./types";

const UA = "DealerQA-AI/0.1 (+link-checker)";
const CONCURRENCY = 8;

/**
 * Cheap liveness check for a single URL. Used to verify sources a model
 * supplies: told not to invent URLs it still does, and a citation the reviewer
 * cannot open is worse than no citation at all.
 */
export async function urlResolves(url: string): Promise<boolean> {
  try {
    const p = new URL(url);
    if (!/^https?:$/.test(p.protocol)) return false;
  } catch {
    return false;
  }
  const doFetch = (method: "HEAD" | "GET") =>
    fetch(url, {
      method,
      headers: { "user-agent": UA, accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
  try {
    let res = await doFetch("HEAD");
    if (res.status === 405 || res.status === 403 || res.status === 501) res = await doFetch("GET");
    return res.status < 400;
  } catch {
    return false;
  }
}

async function checkOne(link: { url: string; text: string }): Promise<LinkCheck> {
  const base: LinkCheck = {
    id: genId("link"),
    url: link.url,
    text: link.text || link.url,
    status: "pass",
  };

  // Validate URL shape first.
  let parsed: URL;
  try {
    parsed = new URL(link.url);
  } catch {
    return { ...base, status: "fail", error: "Invalid URL" };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ...base, status: "fail", error: `Unsupported protocol ${parsed.protocol}` };
  }

  const doFetch = (method: "HEAD" | "GET") =>
    fetch(link.url, {
      method,
      headers: { "user-agent": UA, accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

  try {
    let res = await doFetch("HEAD");
    // Many servers return 405/403 for HEAD — retry with GET.
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await doFetch("GET");
    }
    const redirected = res.redirected || res.url !== link.url;
    const httpStatus = res.status;

    if (httpStatus >= 400) {
      return {
        ...base,
        status: "fail",
        httpStatus,
        error: httpStatus === 404 ? "404 Not Found" : `HTTP ${httpStatus}`,
        redirectedTo: redirected ? res.url : undefined,
      };
    }
    if (redirected) {
      return {
        ...base,
        status: "warning",
        httpStatus,
        redirectedTo: res.url,
        redirectChain: 1,
        error: "Redirected — verify destination is intended.",
      };
    }
    return { ...base, status: "pass", httpStatus };
  } catch (err) {
    const msg = (err as Error).name === "TimeoutError" ? "Timed out" : (err as Error).message;
    return { ...base, status: "fail", error: msg || "Unreachable" };
  }
}

export async function checkLinks(
  links: { url: string; text: string }[],
): Promise<LinkCheck[]> {
  const results: LinkCheck[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < links.length) {
      const i = cursor++;
      results[i] = await checkOne(links[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, links.length) }, worker),
  );
  return results;
}
