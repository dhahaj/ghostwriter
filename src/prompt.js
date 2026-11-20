// Builds the autocomplete prompt and cleans up model output.
// Provider-agnostic: every provider gets the same { system, user } pair.

const LENGTHS = {
  short: { words: 8, tokens: 24, hint: 'a few words (finish the current phrase)' },
  sentence: { words: 25, tokens: 60, hint: 'at most one sentence' },
  long: { words: 70, tokens: 140, hint: 'one to three sentences' },
};

export function lengthConfig(name) {
  return LENGTHS[name] || LENGTHS.sentence;
}

const MAX_BEFORE = 6000;   // chars of the draft before the cursor
const MAX_AFTER = 1500;    // chars after the cursor
const MAX_DOCS = 120_000;  // total chars of reference documents

export function buildPrompt({ before = '', after = '', docs = [], instructions = '', length }) {
  const cfg = lengthConfig(length);

  // Reference docs go in the system prompt so they form a stable prefix
  // across keystrokes, which lets Gemini's implicit caching kick in.
  let budget = MAX_DOCS;
  const docBlocks = [];
  for (const d of docs) {
    if (!d?.text || budget <= 0) continue;
    const text = d.text.slice(0, budget);
    budget -= text.length;
    docBlocks.push(`<document name="${escapeAttr(d.name || 'untitled')}">\n${text}\n</document>`);
  }

  const system = [
    'You are an inline autocomplete engine inside a writing app, like code completion but for prose.',
    'You receive the author\'s draft with a <CURSOR/> marker. Reply with ONLY the text that should be inserted at the cursor.',
    'Rules:',
    `- Length: ${cfg.hint}. Shorter and right beats longer and generic.`,
    '- Continue seamlessly in the author\'s voice, tense, tone and formatting. Never repeat text that is already before the cursor.',
    '- If the cursor is in the middle of a word, finish that word first (no leading space).',
    '- If a space is needed before your text, start with the space. Do not add a trailing newline.',
    '- Make sure your text flows into whatever comes after the cursor, and do not duplicate it.',
    '- No quotes around the answer, no explanations, no markdown fences, no commentary.',
    '- Use the reference documents for facts, names, terminology and style. Do not invent facts that contradict them.',
    instructions ? `Author's standing instructions: ${instructions}` : '',
    docBlocks.length ? `\nReference documents:\n${docBlocks.join('\n\n')}` : '',
  ].filter(Boolean).join('\n');

  const b = before.slice(-MAX_BEFORE);
  const a = after.slice(0, MAX_AFTER);
  const user = `<draft>\n${b.length < before.length ? '…' : ''}${b}<CURSOR/>${a}${a.length < after.length ? '…' : ''}\n</draft>`;

  return { system, user, maxTokens: cfg.tokens, maxWords: cfg.words };
}

export function cleanCompletion(raw, { before = '', after = '', maxWords = 40 } = {}) {
  if (!raw) return '';
  let s = raw.replace(/\r/g, '');
  s = s.replace(/^```[a-z]*\n?|\n?```$/g, '');
  s = s.replace(/<\/?CURSOR\/?>/g, '');
  s = s.replace(/^<\/?draft>|<\/?draft>$/g, '');

  // Strip wrapping quotes the model sometimes adds.
  const m = s.match(/^\s*["“](.*)["”]\s*$/s);
  if (m && !/["“”]/.test(m[1])) s = (s.startsWith(' ') ? ' ' : '') + m[1];

  // If the model echoed the tail of the draft, drop the echo.
  s = dropOverlap(before, s);

  // Fix spacing at the seam.
  const prev = before.slice(-1);
  if (prev && /\s/.test(prev)) s = s.replace(/^[ \t]+/, '');

  // Don't run into text that follows the cursor.
  const nextLine = after.split('\n')[0].trim();
  if (nextLine.length >= 4) {
    const i = s.indexOf(nextLine.slice(0, Math.min(20, nextLine.length)));
    if (i > 0) s = s.slice(0, i);
  }

  // Keep it inline-sized: one paragraph and a word cap.
  s = s.split(/\n\s*\n/)[0].replace(/\s+$/, (ws) => (ws.includes('\n') ? '' : ws));
  s = capWords(s, maxWords);
  return s.trimEnd() === '' ? '' : s.replace(/\s+$/, '');
}

function dropOverlap(before, s) {
  const tail = before.slice(-200);
  for (let k = Math.min(tail.length, s.length); k >= 8; k--) {
    if (s.startsWith(tail.slice(-k))) return s.slice(k);
  }
  return s;
}

function capWords(s, max) {
  const parts = s.split(/(\s+)/);
  let words = 0;
  let out = '';
  for (const p of parts) {
    if (p.trim()) words++;
    if (words > max) break;
    out += p;
  }
  return out;
}

function escapeAttr(s) {
  return String(s).replace(/[<>"&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]));
}
