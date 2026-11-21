// Suggestion log: one JSON object per line in logs/suggestions.jsonl.
// Entries are { type: 'suggest', ... } for every response and
// { type: 'accept', id, text } when the writer takes one with Tab.
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

// Rough token estimate: ~4 characters per token for English prose.
export function estimateTokens(text) {
  return text ? Math.max(1, Math.round(String(text).length / 4)) : 0;
}

// Add up provider usage objects (Gemini usageMetadata shape).
export function sumUsage(list) {
  const out = { input: 0, output: 0, cached: 0, known: false };
  for (const u of list) {
    if (!u) continue;
    out.known = true;
    out.input += u.promptTokenCount || 0;
    out.output += u.candidatesTokenCount || 0;
    out.cached += u.cachedContentTokenCount || 0;
  }
  return out;
}

export function createLog(file) {
  let ready = mkdir(dirname(file), { recursive: true }).catch(() => {});
  let queue = Promise.resolve();

  return {
    file,
    append(entry) {
      // Serialise writes so lines never interleave.
      queue = queue.then(async () => {
        await ready;
        await appendFile(file, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
      }).catch((err) => console.error('log write failed:', err.message));
      return queue;
    },
    // Newest first, accept events folded into their suggestion entries.
    async read(limit = 300) {
      await queue;
      let raw = '';
      try {
        const s = await stat(file);
        // Only the last 8 MB, so a huge log never stalls the server.
        raw = await readFile(file, 'utf8');
        if (s.size > 8_000_000) raw = raw.slice(-8_000_000).replace(/^[^\n]*\n/, '');
      } catch { return { entries: [], totals: emptyTotals() }; }

      const byId = new Map();
      const entries = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'suggest') { e.accepted = []; byId.set(e.id, e); entries.push(e); }
        else if (e.type === 'accept' && byId.has(e.id)) byId.get(e.id).accepted.push(e.text);
      }
      const totals = emptyTotals();
      for (const e of entries) {
        totals.requests++;
        totals.suggestions += e.suggestions.length;
        totals.accepted += e.accepted.length ? 1 : 0;
        totals.inputTokens += e.inputTokens || 0;
        totals.outputTokens += e.outputTokens || 0;
      }
      return { entries: entries.slice(-limit).reverse(), totals };
    },
  };
}

function emptyTotals() {
  return { requests: 0, suggestions: 0, accepted: 0, inputTokens: 0, outputTokens: 0 };
}
