# DealerQA AI

AI-powered quality assurance for **dealership blog content**. Paste a page URL
(typically a Vercel preview), and DealerQA AI crawls the page and runs a full,
paragraph-by-paragraph audit for **factual accuracy, compliance, content
quality, broken links, and dealership-specific claims** — like Grammarly +
Ahrefs Site Audit + Originality.ai, built for automotive QA.

> Built for the workflow of a single QA reviewer covering multiple dealership
> clients: brand-safe, accurate, publish-ready content.

---

## ✨ What it does

| Capability | Details |
|---|---|
| **Crawl & extract** | Headings (H1–H6), paragraphs, lists, tables, buttons, CTAs, phone numbers, links, images + captions, ratings, prices |
| **Paragraph-by-paragraph audit** | Each paragraph gets a number, detected claims, verification result, confidence, **PASS / WARNING / FAIL**, and a suggested correction |
| **Fact verification** | MPG & fuel economy verified against **EPA FuelEconomy.gov**; makes/models validated against **NHTSA vPIC**; pricing/lease/warranty/incentives flagged as time-sensitive for manual confirmation |
| **Link checker** | Real HTTP checks for 404s, broken/unreachable links, invalid URLs, and redirect chains |
| **Google rating verification** | Detects displayed rating + review count, cross-checks the live Google Business Profile (when a Places key is set) |
| **Grammar & style QA** | Spelling, grammar, readability, AI-generated-sounding tone, keyword stuffing, repetition |
| **Compliance checker** | Flags unsupported superlatives — "best dealership", "lowest prices", "#1 dealer", "industry-leading", "game-changing", absolute guarantees |
| **Source validation** | Detects statistics with no citation and recommends an authoritative source |
| **Dealership detection** | Identifies which dealership the page belongs to and its **main website** (e.g. *Galaxy Toyota of Riverside → galaxytoyota.com*) from the page's own nav/footer links and title |
| **Direct source links** | Every finding that isn't verified-accurate (every WARNING/FAIL correction) includes a **direct, clickable verify link** — and for dealership-specific facts (pricing, lease, incentives, warranty, rating, phone, specs) the link points at **the audited dealership's own main website** (`site:daltontoyota.com …`), not the OEM brand site. Objective vehicle data keeps its authoritative source (EPA FuelEconomy.gov for MPG); compliance links to FTC guidance |
| **Visual QA** | Optional full-page screenshot (Playwright) + image/alt-text inspection |
| **Scoring** | Overall score (0–100) across **Facts / Grammar / Links / Compliance / SEO** |
| **Review workflow** | Reviewer checklist: Fact Verified, Grammar Checked, Links Checked, Compliance Checked, Approved |
| **Admin dashboard** | Total audits, failed audits, average QA score, reviewer performance, recent history |
| **Auto-fix & developer handoff** | One click generates **corrected revisions** that fix each error to the *correct value*: MPG → the EPA figure; **lease payment, incentive, phone, rating, and review count → the live value fetched from the dealership's own main website**; spelling fixed; unsupported superlatives neutralized. Shown as before→after (each dealer-sourced fix links to the page it came from), then sent straight to the developer via **email, copy, or a downloadable Markdown revision sheet**. Genuinely ambiguous money figures (e.g. MSRP vs down payment) are surfaced with the dealer-site value as a *suggestion to confirm* rather than auto-overwritten, so a wrong number never ships. Uses the LLM to polish prose when configured; fully deterministic otherwise |
| **Export** | CSV (opens in Excel), JSON, and print-to-PDF report view |

---

## 🚀 Quick start (zero setup)

```bash
npm install
npm run dev          # http://localhost:3000
```

That's it. **No accounts or API keys required.** Out of the box you get:

- Real page crawling, extraction, and link checking
- Live MPG/spec verification via the public EPA & NHTSA APIs
- Claim detection, compliance, grammar, and scoring (deterministic engine)
- Audits persisted to a local JSON store at `./.data/audits.json`

Click **Try an example URL →** on the home page to audit the bundled sample
dealership post (`/public/sample-dealership-post.html`).

> **Node 18.17+ / 20+ recommended** (developed on Node 24). Uses the App Router,
> `fetch`, and `AbortSignal.timeout`.

---

## 🔌 Optional integrations (add keys to light up)

Copy `.env.example` → `.env.local` and fill in what you want. Everything below
is optional and degrades gracefully when absent.

### AI provider (default: **Claude**)
The analysis engine is provider-agnostic. Without a key it uses the built-in
rule-based analyzer; with a key it adds LLM-powered grammar/tone review.

```env
LLM_PROVIDER=anthropic            # anthropic | openai | gemini | rules
ANTHROPIC_API_KEY=sk-ant-...      # default, recommended for factual reasoning
ANTHROPIC_MODEL=claude-opus-4-8
# OPENAI_API_KEY=...  OPENAI_MODEL=gpt-4o
# GEMINI_API_KEY=...  GEMINI_MODEL=gemini-2.0-flash
```

> The Anthropic SDK is an **optional dependency** — installed by default, but the
> app builds and runs fine without it.

### Google rating cross-check (live)
```env
GOOGLE_PLACES_API_KEY=...         # enables live Google Business Profile rating check
GOOGLE_CSE_API_KEY=...            # optional, improves source lookups
GOOGLE_CSE_CX=...
```

### Persistence — Supabase (optional, replaces the local JSON store)
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```
Apply [`src/lib/db/schema.sql`](src/lib/db/schema.sql) in the Supabase SQL editor
first. When these vars are present, all reads/writes go to Supabase Postgres
instead of the local file — no other code changes needed.

### Full-page screenshots (optional)
```bash
npm install playwright
npx playwright install chromium
```
Then tick **"Capture full-page screenshot"** when starting an audit.

---

## 🏗️ Architecture

```
src/
├─ app/
│  ├─ page.tsx                  New-audit screen (SSE live progress)
│  ├─ audits/[id]/page.tsx      Full audit report
│  ├─ audits/page.tsx           Audit history
│  ├─ dashboard/page.tsx        Admin dashboard
│  └─ api/
│     ├─ audit/route.ts         POST → runs pipeline, streams progress (SSE)
│     ├─ audit/[id]/route.ts    GET audit · PATCH reviewer checklist
│     ├─ audits/route.ts        GET audit list
│     └─ export/[id]/route.ts   CSV / JSON download
├─ lib/
│  ├─ audit/
│  │  ├─ pipeline.ts            Orchestrator (async generator → progress events)
│  │  ├─ crawler.ts             Fetch + optional Playwright screenshot
│  │  ├─ extractor.ts           Cheerio → structured content
│  │  ├─ claims.ts              Claim & vehicle detection (regex/heuristics)
│  │  ├─ fact-check.ts          Verification routing
│  │  ├─ link-check.ts          Concurrent HTTP link checker
│  │  ├─ compliance.ts          Superlative / unsupported-claim rules
│  │  ├─ grammar.ts             Grammar/style/AI-tone (+ optional LLM)
│  │  ├─ ratings.ts             Google rating cross-check
│  │  ├─ scoring.ts             5-dimension + overall scoring
│  │  └─ types.ts               Shared domain types
│  ├─ verifiers/                FuelEconomy.gov · NHTSA vPIC clients
│  ├─ llm/index.ts              Provider-agnostic LLM (Claude/OpenAI/Gemini)
│  ├─ db/                       File store (default) · Supabase adapter · schema
│  └─ export.ts                 CSV / JSON serializers
└─ components/                  shadcn-style UI kit, report, dashboard widgets
```

**Pipeline flow:** `crawl → extract → detect claims → verify (EPA/NHTSA/LLM) →
check links → compliance → grammar → ratings → screenshot → score → persist`.
Progress is streamed to the browser over Server-Sent Events for real-time UI.

---

## 🧱 Tech stack

- **Next.js 15** (App Router) · **TypeScript** · **Tailwind CSS** · shadcn/ui-style components
- **Cheerio** for HTML parsing · **Playwright** (optional) for screenshots
- **Anthropic Claude** (default) / OpenAI / Gemini — provider-agnostic
- **Supabase Postgres** (optional) or local JSON store
- **FuelEconomy.gov** + **NHTSA vPIC** public verification APIs (no key)

---

## 👥 Multi-user / Auth

A lightweight reviewer identity (persisted in the browser) tags every audit for
dashboard attribution. To add real multi-user auth, wire **Supabase Auth** in
`src/components/reviewer.tsx` and gate the API routes with a session check — the
data layer is already Supabase-ready.

---

## 📦 Scripts

```bash
npm run dev        # dev server
npm run build      # production build
npm run start      # serve production build
npm run typecheck  # tsc --noEmit
```

---

## ⚠️ Notes & limits

- Link checking is capped at **300 links/page** (surfaced in progress) so a
  pathological page can't stall an audit; dealership posts are well under this.
- Pricing, lease, warranty, and incentive figures are **time-sensitive** and
  flagged for manual confirmation against the live OEM/dealer offer rather than
  auto-passed.
- Pages that render content entirely client-side may extract less without the
  optional Playwright path.
