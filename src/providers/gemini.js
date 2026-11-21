// Gemini provider (REST, no SDK). Reads the key from the request or GEMINI_API_KEY.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function createGeminiProvider({ apiKey, model }) {
  const defaultModel = model || 'gemini-2.5-flash-lite';

  return {
    name: 'gemini',
    model: defaultModel,
    async complete({ system, user, maxTokens, signal, apiKey: keyOverride, model: modelOverride, n = 1, temperature }) {
      const key = keyOverride || apiKey;
      if (!key) throw httpError(401, 'No Gemini API key. Set GEMINI_API_KEY in .env or paste a key in Settings.');
      const m = modelOverride || defaultModel;
      const call = (count, temperature) => generate({ key, m, system, user, maxTokens, signal, count, temperature });
      if (n <= 1) return call(1, temperature ?? 0.4);
      // Alternatives: ask for several candidates in one call (higher temperature
      // for variety). Some models reject candidateCount > 1; fall back to
      // parallel single calls.
      try {
        return await call(n, 0.9);
      } catch (err) {
        // Any 400 here (e.g. "multiple candidates not supported") -> fall back.
        if (err.name === 'AbortError' || (err.status !== 400 && !/candidate/i.test(err.message))) throw err;
        const outs = await Promise.all(Array.from({ length: n }, () => call(1, 0.9)));
        return { texts: outs.flatMap((o) => o.texts), usage: addUsage(outs.map((o) => o.usage)) };
      }
    },
  };
}

async function generate({ key, m, system, user, maxTokens, signal, count, temperature }) {
  const generationConfig = {
    temperature,
    topP: 0.95,
    maxOutputTokens: maxTokens,
    candidateCount: count,
  };
  // Thinking adds latency we don't want for autocomplete.
  if (/2\.5/.test(m)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await fetch(`${BASE}/${encodeURIComponent(m)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig,
    }),
  });

  if (!res.ok) {
    let msg = `Gemini error ${res.status}`;
    try { msg = (await res.json())?.error?.message || msg; } catch {}
    throw httpError(res.status === 400 || res.status === 403 ? res.status : 502, msg);
  }
  const data = await res.json();
  const texts = (data?.candidates || []).map((c) =>
    (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join(''));
  return { texts, usage: data?.usageMetadata };
}

function addUsage(list) {
  const keys = ['promptTokenCount', 'candidatesTokenCount', 'cachedContentTokenCount', 'totalTokenCount'];
  const out = {};
  for (const u of list) for (const k of keys) if (u?.[k]) out[k] = (out[k] || 0) + u[k];
  return Object.keys(out).length ? out : undefined;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
