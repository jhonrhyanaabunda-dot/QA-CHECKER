// ───────────────────────────────────────────────────────────────────────────
// Crawler — fetches the target page HTML with a real browser-like UA, follows
// redirects, and returns the raw HTML plus the final resolved URL.
//
// Playwright is intentionally NOT required: a plain fetch handles the vast
// majority of dealership/Vercel-preview pages, keeping the app zero-setup.
// When a Playwright install IS present we use it to capture a full-page
// screenshot (see captureScreenshot); otherwise screenshots degrade silently.
// ───────────────────────────────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 DealerQA-AI/0.1";

export interface CrawlResult {
  html: string;
  finalUrl: string;
  ok: boolean;
  status: number;
}

export function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

export async function crawl(rawUrl: string): Promise<CrawlResult> {
  const url = normalizeUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const html = await res.text();
    return { html, finalUrl: res.url || url, ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Capture a full-page screenshot if Playwright is installed. Returns a data URL
 * (base64 PNG) or null. The import is dynamic + guarded so the dependency stays
 * optional — the app never fails to build or run because Playwright is absent.
 */
export async function captureScreenshot(url: string): Promise<string | null> {
  try {
    // Indirect specifier keeps the bundler from trying to resolve this optional
    // peer at build time; it's only loaded if the user ran `playwright install`.
    const pkg = ["play", "wright"].join("");
    const mod = await import(/* webpackIgnore: true */ pkg).catch(() => null);
    if (!mod) return null;
    const browser = await mod.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(normalizeUrl(url), { waitUntil: "networkidle", timeout: 30_000 });
      const buf = await page.screenshot({ fullPage: true, type: "png" });
      return `data:image/png;base64,${buf.toString("base64")}`;
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}
