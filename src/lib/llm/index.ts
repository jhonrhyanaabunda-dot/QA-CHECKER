// ───────────────────────────────────────────────────────────────────────────
// LLM layer — provider-agnostic text + JSON completion.
//
// Default provider is Anthropic Claude (strongest for the factual-reasoning and
// QA judgement this app does). OpenAI and Gemini are drop-in alternates. When no
// key is configured for the active provider, calls return `null` and every
// caller falls back to deterministic rule-based logic — so the app is fully
// functional with zero AI configuration.
//
// Switch providers with LLM_PROVIDER=anthropic|openai|gemini and the matching
// *_API_KEY. See .env.example.
// ───────────────────────────────────────────────────────────────────────────

export type Provider = "anthropic" | "openai" | "gemini" | "rules";

export interface LlmRequest {
  system?: string;
  prompt: string;
  /** Ask the model to return strict JSON (object). */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export function activeProvider(): Provider {
  const p = (process.env.LLM_PROVIDER || "anthropic").toLowerCase() as Provider;
  if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (p === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (p === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  return "rules";
}

export function providerLabel(): string {
  const p = activeProvider();
  if (p === "anthropic") return `Claude (${process.env.ANTHROPIC_MODEL || "claude-opus-4-8"})`;
  if (p === "openai") return `OpenAI (${process.env.OPENAI_MODEL || "gpt-4o"})`;
  if (p === "gemini") return `Gemini (${process.env.GEMINI_MODEL || "gemini-2.0-flash"})`;
  return "Rule-based (no LLM key configured)";
}

/** Returns model text, or null when no provider is configured / call fails. */
export async function complete(req: LlmRequest): Promise<string | null> {
  const provider = activeProvider();
  try {
    if (provider === "anthropic") return await callAnthropic(req);
    if (provider === "openai") return await callOpenAI(req);
    if (provider === "gemini") return await callGemini(req);
    return null;
  } catch (err) {
    console.warn(`[llm] ${provider} call failed:`, (err as Error).message);
    return null;
  }
}

/** Convenience: complete + parse JSON, returning null on any failure. */
export async function completeJson<T>(req: LlmRequest): Promise<T | null> {
  const raw = await complete({ ...req, json: true });
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to salvage the first {...} block.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── Anthropic Claude ───────────────────────────────────────────────────────
async function callAnthropic(req: LlmRequest): Promise<string | null> {
  // @ts-ignore — optional dependency; may be absent in some deployments.
  const mod = await import("@anthropic-ai/sdk").catch(() => null);
  if (!mod) return null;
  const Anthropic = mod.default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const system =
    (req.system || "") +
    (req.json ? "\nRespond with ONLY valid minified JSON. No prose, no code fences." : "");
  const msg = await client.messages.create({
    model,
    max_tokens: req.maxTokens ?? 1500,
    temperature: req.temperature ?? 0.2,
    system: system.trim() || undefined,
    messages: [{ role: "user", content: req.prompt }],
  });
  const block = msg.content.find((b: any) => b.type === "text");
  return block ? (block as any).text : null;
}

// ── OpenAI ─────────────────────────────────────────────────────────────────
async function callOpenAI(req: LlmRequest): Promise<string | null> {
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 1500,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        { role: "user", content: req.prompt },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

// ── Google Gemini ──────────────────────────────────────────────────────────
async function callGemini(req: LlmRequest): Promise<string | null> {
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: req.system
        ? { parts: [{ text: req.system }] }
        : undefined,
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxTokens ?? 1500,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}
