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
  /** Override the configured model (diagnostics: probing an alternative). */
  model?: string;
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
  if (p === "gemini") return `Gemini (${process.env.GEMINI_MODEL || "gemini-2.5-flash"})`;
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

/**
 * Live provider check. `complete` deliberately swallows failures so callers can
 * fall back to rule-based logic, which means a broken key or a bad model name
 * is invisible. This surfaces the actual error for diagnostics.
 */
export async function llmPing(opts: { json?: boolean; model?: string } = {}): Promise<{
  ok: boolean;
  provider: Provider;
  error?: string;
}> {
  const provider = activeProvider();
  if (provider === "rules") return { ok: false, provider, error: "no provider configured" };
  const base: Partial<LlmRequest> = opts.model ? { model: opts.model } : {};
  const req: LlmRequest = opts.json
    ? {
        ...base,
        system:
          "You are a QA fact-checker for dealership content. Answer each item with the correct figure, the model year and trim it applies to, and the condition attached to it. Never invent a URL.",
        prompt:
          'Answer each item. Return JSON {"answers":[{"id":"a","answer":"...","basis":"...","confidence":0.5,"unresolved":false}]}. ' +
          JSON.stringify([{ id: "a", type: "mpg", published_value: "36 mpg", sentence: "The 2024 Volkswagen Jetta gets 36 mpg highway." }]),
        json: true,
        maxTokens: 3000,
      }
    : { ...base, prompt: "Reply with exactly: ok", maxTokens: 16 };
  try {
    const text =
      provider === "anthropic"
        ? await callAnthropic(req)
        : provider === "openai"
          ? await callOpenAI(req)
          : await callGemini(req);
    return text
      ? { ok: true, provider }
      : { ok: false, provider, error: "provider returned an empty response" };
  } catch (e) {
    return { ok: false, provider, error: (e as Error).message };
  }
}

/**
 * List the models this key can actually call. Free-tier quotas differ sharply
 * per model, so when one is exhausted this says which alternatives exist.
 * ListModels is a metadata call and does not spend generate_content quota.
 */
export async function listGeminiModels(): Promise<{ models?: string[]; error?: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "no GEMINI_API_KEY" };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const body = await res.text();
    if (!res.ok) return { error: `ListModels ${res.status}: ${body.slice(0, 300)}` };
    const data = JSON.parse(body);
    const models: string[] = (data.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) =>
        (m.supportedGenerationMethods ?? []).includes("generateContent"),
      )
      .map((m: { name: string }) => m.name.replace(/^models\//, ""));
    return { models };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** complete + parse JSON, surfacing the failure reason instead of just null. */
export async function completeJsonDetailed<T>(
  req: LlmRequest,
): Promise<{ data: T | null; error?: string }> {
  const provider = activeProvider();
  if (provider === "rules") return { data: null, error: "no provider configured" };
  try {
    const r: LlmRequest = { ...req, json: true };
    const raw =
      provider === "anthropic"
        ? await callAnthropic(r)
        : provider === "openai"
          ? await callOpenAI(r)
          : await callGemini(r);
    if (!raw) return { data: null, error: "empty response" };
    const parsed = parseJsonLoose<T>(raw);
    return parsed === null ? { data: null, error: "unparseable JSON response" } : { data: parsed };
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }
}

/** Parse a model reply that may be fenced or wrapped in prose. */
function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
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
async function callGemini(req: LlmRequest, attempt = 0): Promise<string | null> {
  const model = req.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
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
        // Gemini 2.5+ spends "thinking" tokens out of maxOutputTokens. On a
        // structured request the reasoning can consume the entire budget and
        // return a candidate with no text part at all (finishReason
        // MAX_TOKENS) — which is exactly how every answer came back empty.
        // We want the answer, not the reasoning trace.
        thinkingConfig: { thinkingBudget: 0 },
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Free-tier keys rate-limit on bursts. The API tells us how long to wait,
    // so honour it once rather than dropping the whole batch of answers.
    if (res.status === 429 && attempt < 1) {
      const m = body.match(/"retryDelay"\s*:\s*"(\d+)(?:\.\d+)?s"/);
      const waitMs = Math.min(20_000, Math.max(1000, (m ? Number(m[1]) : 15) * 1000));
      await new Promise((r) => setTimeout(r, waitMs));
      return callGemini(req, attempt + 1);
    }
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 600)}`);
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  const parts: { text?: string }[] = cand?.content?.parts ?? [];
  const text = parts.map((p) => p?.text ?? "").join("").trim();
  if (!text) {
    // Say why rather than returning null into a silent rule-based fallback.
    const reason =
      cand?.finishReason || data.promptFeedback?.blockReason || "no text part in response";
    throw new Error(`Gemini returned no text (${reason})`);
  }
  return text;
}
