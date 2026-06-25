// ───────────────────────────────────────────────────────────────────────────
// Extractor — turns raw HTML into structured `ExtractedContent` using Cheerio.
// Pulls headings, paragraphs, lists, tables, buttons, CTAs, phone numbers,
// links, and images/captions. Strips boilerplate (script/style/nav/footer) so
// claim detection and grammar checks operate on real editorial content.
// ───────────────────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";
import type { ExtractedContent } from "./types";

const PHONE_RE =
  /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function extract(html: string, finalUrl: string): ExtractedContent {
  const $ = cheerio.load(html);

  // Drop non-content nodes before reading text.
  $("script, style, noscript, svg, template, iframe").remove();

  const title = clean($("title").first().text()) || clean($("h1").first().text());
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim();

  // Headings
  const headings: ExtractedContent["headings"] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = Number(el.tagName.replace("h", ""));
    const text = clean($(el).text());
    if (text) headings.push({ level, text });
  });

  // Paragraphs — keep substantive <p> blocks only (lists handled separately).
  const paragraphs: string[] = [];
  $("p").each((_, el) => {
    const text = clean($(el).text());
    if (text && text.split(" ").length >= 4) paragraphs.push(text);
  });

  // Lists
  const lists: ExtractedContent["lists"] = [];
  $("ul, ol").each((_, el) => {
    const ordered = el.tagName === "ol";
    const items: string[] = [];
    $(el)
      .children("li")
      .each((_, li) => {
        const t = clean($(li).text());
        if (t) items.push(t);
      });
    if (items.length) lists.push({ ordered, items });
  });

  // Tables
  const tables: ExtractedContent["tables"] = [];
  $("table").each((_, el) => {
    const rows: string[][] = [];
    $(el)
      .find("tr")
      .each((_, tr) => {
        const cells: string[] = [];
        $(tr)
          .find("th, td")
          .each((_, cell) => {
            cells.push(clean($(cell).text()));
          });
        if (cells.length) rows.push(cells);
      });
    if (rows.length) tables.push({ rows });
  });

  // Buttons & CTAs
  const buttons: string[] = [];
  $("button, a.btn, a.button, [role=button], .cta a, a.cta").each((_, el) => {
    const t = clean($(el).text());
    if (t) buttons.push(t);
  });

  const ctas: string[] = [];
  $("[class*=cta], [class*=Cta], [id*=cta], [class*=hero] a").each((_, el) => {
    const t = clean($(el).text());
    if (t && t.length < 120) ctas.push(t);
  });

  // Links
  const linkMap = new Map<string, string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const abs = resolveUrl(href, finalUrl);
    if (!abs) return;
    if (!linkMap.has(abs)) linkMap.set(abs, clean($(el).text()) || abs);
  });
  const links = Array.from(linkMap, ([url, text]) => ({ url, text }));

  // Images + captions (alt text + nearby <figcaption>)
  const images: ExtractedContent["images"] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (!src) return;
    const abs = resolveUrl(src, finalUrl) || src;
    const alt = clean($(el).attr("alt") || "");
    const caption = clean($(el).closest("figure").find("figcaption").text());
    images.push({ src: abs, alt, caption: caption || undefined });
  });

  // Whole-page visible text + phones
  const bodyText = clean($("body").text());
  const phones = Array.from(new Set(bodyText.match(PHONE_RE) || [])).map(clean);

  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  return {
    url: finalUrl,
    finalUrl,
    title,
    metaDescription,
    headings,
    paragraphs,
    lists,
    tables,
    buttons: Array.from(new Set(buttons)),
    ctas: Array.from(new Set(ctas)).slice(0, 12),
    phones,
    links,
    images,
    text: bodyText,
    wordCount,
  };
}
