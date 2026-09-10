// ───────────────────────────────────────────────────────────────────────────
// Link checker — verifies every hyperlink with real HTTP requests.
// Detects 404s, broken/unreachable links, invalid URLs, and redirect chains.
// Uses HEAD first (cheap) and falls back to GET for servers that reject HEAD.
// Runs with bounded concurrency so a page with 100 links stays responsive.
// ───────────────────────────────────────────────────────────────────────────

import { genId } from "../utils";
import type { LinkCheck } from "./types";

// A real browser UA. The point is to see what a customer sees; a bot string
// gets blocked or 404'd by sites that serve the page fine to a browser, which
// produces failures that are artefacts of the checker rather than the page.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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

/** Signs that a page is a "not found" page whatever status it returned. */
const NOT_FOUND_TITLE = /(page|file)?\s*not\s*found|404|doesn'?t exist|no longer available/i;

/** Pull the <title> from a response body, as evidence for the reviewer. */
async function readTitle(res: Response): Promise<string | undefined> {
  try {
    // Skip only what is definitely not markup. Requiring text/html loses the
    // evidence on servers that send no content-type at all — including the
    // dealership 404 pages this exists to prove.
    const ct = res.headers.get("content-type") || "";
    if (/^(image|video|audio|font)\//i.test(ct) || /application\/(pdf|zip|octet)/i.test(ct)) {
      return undefined;
    }
    const body = (await res.text()).slice(0, 200_000);
    const m = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    return m ? m[1].replace(/\s+/g, " ").trim() : undefined;
  } catch {
    return undefined;
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
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

  try {
    let res = await doFetch("HEAD");
    // HEAD is unreliable: plenty of servers answer it with 404/405/403 while
    // serving the page perfectly over GET. Any error status gets a real GET
    // before we call a link broken.
    if (res.status >= 400) res = await doFetch("GET");

    const redirected = res.redirected || res.url !== link.url;
    const httpStatus = res.status;

    if (httpStatus >= 400) {
      // Capture the destination's title. A dealership 404 is often a fully
      // branded page, so a reviewer who opens it sees a normal-looking site
      // and assumes the checker was wrong. The title settles it.
      const destinationTitle = await readTitle(res);

      // A block is not proof of breakage. Bot protection answers automated
      // requests with 401/403/429 while the page works fine in a browser, so
      // this is reported as unverified rather than broken.
      const blocked = httpStatus === 401 || httpStatus === 403 || httpStatus === 429;
      return {
        ...base,
        status: blocked ? "warning" : "fail",
        httpStatus,
        destinationTitle,
        blocked,
        error: blocked
          ? `HTTP ${httpStatus} — the site blocked the automated check, so this link could not be verified. Open it to confirm by eye.`
          : httpStatus === 404
            ? "404 Not Found"
            : `HTTP ${httpStatus}`,
        redirectedTo: redirected ? res.url : undefined,
      };
    }

    // A 200 that is really a "not found" page — the opposite mistake, and one
    // a status-only check misses entirely.
    if (res.status === 200) {
      const destinationTitle = await readTitle(res);
      if (destinationTitle && NOT_FOUND_TITLE.test(destinationTitle)) {
        return {
          ...base,
          status: "warning",
          httpStatus,
          destinationTitle,
          error: `Returned HTTP 200 but the page is titled "${destinationTitle}" — likely a soft 404.`,
          redirectedTo: redirected ? res.url : undefined,
        };
      }
      if (redirected) {
        return {
          ...base,
          status: "warning",
          httpStatus,
          destinationTitle,
          redirectedTo: res.url,
          redirectChain: 1,
          error: "Redirected — verify destination is intended.",
        };
      }
      return { ...base, status: "pass", httpStatus, destinationTitle };
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

/**
 * A deep link back to the audited page, scrolled to this link's anchor text.
 * Uses a scroll-to-text fragment, so the reviewer lands on the exact spot and
 * the browser highlights it — no hunting through a long pillar page.
 */
function locateOnPage(pageUrl: string, anchorText: string): string | undefined {
  const t = anchorText.trim();
  // Very short or very long anchors make unreliable fragments.
  if (!pageUrl || t.length < 3 || t.length > 300) return undefined;
  if (/^https?:\/\//i.test(t)) return undefined;
  try {
    // Strip any existing fragment before appending our own.
    const base = pageUrl.split("#")[0];
    return `${base}#:~:text=${encodeURIComponent(t)}`;
  } catch {
    return undefined;
  }
}

export async function checkLinks(
  links: {
    url: string;
    text: string;
    section?: string;
    paragraphIndex?: number;
  }[],
  /** The audited page, used to build "jump to this link" deep links. */
  pageUrl = "",
): Promise<LinkCheck[]> {
  const results: LinkCheck[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < links.length) {
      const i = cursor++;
      const link = links[i];
      const checked = await checkOne(link);
      results[i] = {
        ...checked,
        section: link.section,
        paragraphIndex: link.paragraphIndex,
        locateUrl: locateOnPage(pageUrl, link.text),
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, links.length) }, worker),
  );
  return results;
}
