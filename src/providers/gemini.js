// Gemini provider (REST, no SDK). Reads the key from the request or GEMINI_API_KEY.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function createGeminiProvider({ apiKey, model }) {
  const defaultModel = model || 'gemini-2.5-flash-lite';

  return {
    name: 'gemini',
    model: defaultModel,
    async complete({ system, user, maxTokens, signal, apiKey: keyOverride, model: modelOverride }) {
      const key = keyOverride || apiKey;
      if (!key) throw httpError(401, 'No Gemini API key. Set GEMINI_API_KEY in .env or paste a key in Settings.');
      const m = modelOverride || defaultModel;

      const generationConfig = {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: maxTokens,
        candidateCount: 1,
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
      const parts = data?.candidates?.[0]?.content?.parts || [];
      return {
        text: parts.filter((p) => !p.thought).map((p) => p.text || '').join(''),
        usage: data?.usageMetadata,
      };
    },
  };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
