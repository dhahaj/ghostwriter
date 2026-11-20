// Ghostwriter client: ghost-text autocomplete over a plain textarea.
const $ = (id) => document.getElementById(id);
const ta = $('text');
const mirror = $('mirror');

// ---------- persisted state ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('gw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gw.' + k, JSON.stringify(v)); return true; } catch { return false; } },
};
const settings = Object.assign(
  { enabled: true, length: 'sentence', delay: 300, model: '', apiKey: '', instructions: '' },
  store.get('settings', {}),
);
let docs = store.get('docs', []); // [{ id, name, text, on }]

// ---------- suggestion state ----------
let ghost = '';          // text currently suggested
let ghostPos = -1;       // caret index the ghost is anchored to
let timer = 0;
let inflight = null;     // AbortController
let reqSeq = 0;
let accepting = false;
const cache = new Map(); // prefix-key -> completion (small LRU)

// ---------- rendering ----------
function render() {
  const v = ta.value;
  mirror.textContent = '';
  if (ghost && ghostPos >= 0 && ghostPos <= v.length) {
    const span = document.createElement('span');
    span.className = 'ghost';
    span.textContent = ghost;
    mirror.append(v.slice(0, ghostPos), span, v.slice(ghostPos) + '​');
  } else {
    mirror.append(v + '​');
  }
}

function setGhost(text, pos) {
  ghost = text || '';
  ghostPos = ghost ? pos : -1;
  render();
}

function clearGhost() {
  if (ghost) setGhost('');
}

// ---------- when to suggest ----------
function caret() {
  return ta.selectionStart === ta.selectionEnd ? ta.selectionStart : -1;
}

function canSuggest(pos) {
  if (!settings.enabled || pos < 0) return false;
  const v = ta.value;
  const before = v.slice(0, pos);
  if (before.trim().length < 2 && !docs.some((d) => d.on)) return false;
  // Only at the end of a line (or before closing punctuation), like Copilot.
  const restOfLine = v.slice(pos).split('\n')[0];
  return /^[\s)\]}"'”’.,;:!?]*$/.test(restOfLine);
}

function schedule(immediate = false) {
  clearTimeout(timer);
  if (inflight) { inflight.abort(); inflight = null; }
  const pos = caret();
  if (!canSuggest(pos)) return setStatus('idle');
  timer = setTimeout(() => request(pos), immediate ? 0 : settings.delay);
}

function cacheKey(before, after) {
  return before.slice(-400) + '\u0000' + after.slice(0, 80) + '\u0000' + settings.length;
}

async function request(pos) {
  const v = ta.value;
  const before = v.slice(0, pos);
  const after = v.slice(pos);
  const key = cacheKey(before, after);
  if (cache.has(key)) {
    const hit = cache.get(key);
    if (hit) setGhost(hit, pos);
    return setStatus('ok', 'cached');
  }

  const seq = ++reqSeq;
  const ac = new AbortController();
  inflight = ac;
  setStatus('busy');
  try {
    const headers = { 'content-type': 'application/json' };
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
    const res = await fetch('/api/complete', {
      method: 'POST',
      signal: ac.signal,
      headers,
      body: JSON.stringify({
        before, after,
        docs: docs.filter((d) => d.on).map(({ name, text }) => ({ name, text })),
        instructions: settings.instructions,
        length: settings.length,
        model: settings.model,
        title: $('title').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    remember(key, data.text);
    // Drop stale answers: the text or caret moved while we waited.
    if (seq !== reqSeq || ta.value !== v || caret() !== pos) return;
    setGhost(data.text, pos);
    setStatus('ok', data.text ? `${data.ms} ms${data.cachedTokens ? ` · ${data.cachedTokens} cached tokens` : ''}` : 'no suggestion');
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus('err', err.message);
  } finally {
    if (inflight === ac) inflight = null;
  }
}

function remember(key, text) {
  cache.set(key, text);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
}

// ---------- accepting ----------
function insert(text) {
  accepting = true;
  ta.focus();
  // execCommand keeps the native undo stack (Ctrl+Z undoes an accept).
  const ok = document.execCommand && document.execCommand('insertText', false, text);
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  accepting = false;
}

function acceptAll() {
  const text = ghost;
  setGhost('');
  insert(text);
  autosize();
  schedule(); // chain the next suggestion
}

function acceptWord() {
  const m = ghost.match(/^\s*\S+/);
  if (!m) return acceptAll();
  const part = m[0];
  const rest = ghost.slice(part.length);
  const pos = ghostPos + part.length;
  ghost = '';
  insert(part);
  if (rest) setGhost(rest, pos); else schedule();
  autosize();
}

// ---------- events ----------
ta.addEventListener('keydown', (e) => {
  if (ghost && caret() === ghostPos) {
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); return acceptAll(); }
    if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return acceptWord(); }
    if (e.key === 'Escape') { e.preventDefault(); clearGhost(); clearTimeout(timer); inflight?.abort(); return; }
  }
  if (e.key === '\\' && e.altKey) { e.preventDefault(); return schedule(true); }
  if (e.key === 'Tab' && !ghost && !e.shiftKey) { e.preventDefault(); insert('\t'); }
});

ta.addEventListener('input', (e) => {
  if (accepting) return;
  // Typing through the suggestion keeps it alive (no new request).
  if (ghost && e.inputType === 'insertText' && e.data && ghost.startsWith(e.data) && caret() === ghostPos + e.data.length) {
    const rest = ghost.slice(e.data.length);
    setGhost(rest, caret());
    autosize();
    save();
    if (!rest) schedule();
    return;
  }
  ghost = '';
  ghostPos = -1;
  render();
  autosize();
  save();
  schedule();
});

document.addEventListener('selectionchange', () => {
  if (document.activeElement !== ta || accepting) return;
  if (ghost && caret() !== ghostPos) { clearGhost(); schedule(); }
});
ta.addEventListener('mousedown', () => { clearGhost(); });
ta.addEventListener('blur', () => { clearGhost(); clearTimeout(timer); inflight?.abort(); });
ta.addEventListener('focus', () => schedule());

function autosize() {
  // Mirror is in normal flow and defines the height; textarea fills it.
  // Nothing to do beyond rendering, but keep caret visible while typing.
  const r = ta.getBoundingClientRect();
  if (r.bottom > innerHeight) {
    const lineBottom = caretY();
    if (lineBottom > innerHeight - 80) scrollBy({ top: lineBottom - innerHeight + 120 });
  }
}

function caretY() {
  // Measure caret position using the mirror.
  const pos = ta.selectionEnd;
  const v = ta.value;
  const probe = document.createElement('span');
  probe.textContent = '​';
  const saved = [...mirror.childNodes];
  mirror.textContent = '';
  mirror.append(v.slice(0, pos), probe, v.slice(pos));
  const y = probe.getBoundingClientRect().bottom;
  mirror.textContent = '';
  mirror.append(...saved);
  return y;
}

// ---------- draft persistence ----------
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.set('draft', { title: $('title').value, text: ta.value });
    updateWords();
  }, 300);
}
function updateWords() {
  const n = (ta.value.match(/\S+/g) || []).length;
  $('words').textContent = `${n.toLocaleString()} word${n === 1 ? '' : 's'}`;
}
$('title').addEventListener('input', save);
$('title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.focus(); } });

$('btnSave').onclick = () => {
  const name = ($('title').value.trim() || 'untitled').replace(/[^\w\- ]+/g, '').trim() || 'untitled';
  const body = ($('title').value.trim() ? `# ${$('title').value.trim()}\n\n` : '') + ta.value;
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([body], { type: 'text/markdown' })),
    download: `${name}.md`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
};
$('btnOpen').onclick = () => $('fileOpen').click();
$('fileOpen').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  let text = await f.text();
  const h = text.match(/^# (.+)\n+/);
  $('title').value = h ? h[1] : f.name.replace(/\.[^.]+$/, '');
  if (h) text = text.slice(h[0].length);
  ta.value = text;
  clearGhost();
  render();
  save();
  e.target.value = '';
};

// ---------- context documents ----------
function renderDocs() {
  const list = $('docs');
  list.textContent = '';
  for (const d of docs) {
    const li = document.createElement('li');
    li.className = d.on ? '' : 'off';
    const toggle = Object.assign(document.createElement('input'), { type: 'checkbox', checked: d.on, title: 'Use for predictions' });
    toggle.onchange = () => { d.on = toggle.checked; persistDocs(); };
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = '<div class="name"></div><div class="size"></div>';
    meta.firstChild.textContent = d.name;
    meta.lastChild.textContent = `${(d.text.match(/\S+/g) || []).length.toLocaleString()} words`;
    const del = Object.assign(document.createElement('button'), { textContent: '×', title: 'Remove' });
    del.onclick = () => { docs = docs.filter((x) => x !== d); persistDocs(); };
    li.append(toggle, meta, del);
    list.append(li);
  }
  const active = docs.filter((d) => d.on);
  $('ctxCount').textContent = active.length;
  const chars = active.reduce((n, d) => n + d.text.length, 0);
  $('ctxSize').textContent = docs.length
    ? `${chars.toLocaleString()} characters active${chars > 120000 ? ' (only the first 120,000 are sent)' : ''}.`
    : '';
}
function persistDocs() {
  cache.clear();
  if (!store.set('docs', docs)) setStatus('err', 'Context too large to save in this browser; it will last until you reload.');
  renderDocs();
}
async function addFiles(files) {
  for (const f of files) {
    if (f.size > 5_000_000) { setStatus('err', `${f.name} is over 5 MB`); continue; }
    const text = await f.text();
    docs.push({ id: crypto.randomUUID(), name: f.name, text, on: true });
  }
  persistDocs();
}
$('btnContext').onclick = () => { $('contextPanel').hidden = !$('contextPanel').hidden; };
$('contextPanel').querySelector('[data-close]').onclick = () => { $('contextPanel').hidden = true; ta.focus(); };
$('fileCtx').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
$('pasteAdd').onclick = () => {
  const text = $('pasteText').value.trim();
  if (!text) return;
  docs.push({ id: crypto.randomUUID(), name: $('pasteName').value.trim() || 'Pasted text', text, on: true });
  $('pasteText').value = '';
  $('pasteName').value = '';
  persistDocs();
};

// ---------- settings ----------
const dlg = $('settings');
function syncSettingsForm() {
  $('optEnabled').value = settings.enabled ? 'on' : 'off';
  $('optLength').value = settings.length;
  $('optDelay').value = settings.delay;
  $('delayVal').textContent = `(${settings.delay} ms)`;
  $('optModel').value = settings.model;
  $('optKey').value = settings.apiKey;
  $('optInstr').value = settings.instructions;
}
$('btnSettings').onclick = () => { syncSettingsForm(); dlg.showModal(); };
$('optDelay').oninput = () => { $('delayVal').textContent = `(${$('optDelay').value} ms)`; };
dlg.addEventListener('close', () => {
  Object.assign(settings, {
    enabled: $('optEnabled').value === 'on',
    length: $('optLength').value,
    delay: Number($('optDelay').value),
    model: $('optModel').value.trim(),
    apiKey: $('optKey').value.trim(),
    instructions: $('optInstr').value.trim(),
  });
  store.set('settings', settings);
  cache.clear();
  refreshStatus();
  ta.focus();
});

// ---------- status ----------
let serverInfo = null;
function setStatus(kind, detail = '') {
  const el = $('status');
  el.className = 'status ' + (kind === 'idle' ? (serverInfo ? 'ok' : '') : kind);
  const label = serverInfo ? `${serverInfo.provider} · ${settings.model || serverInfo.model}` : 'Offline';
  const text = kind === 'busy' ? `${label} · thinking…`
    : kind === 'err' ? detail
    : !settings.enabled ? 'Suggestions off'
    : detail ? `${label} · ${detail}` : label;
  $('statusText').textContent = text;
  el.title = text;
}
async function refreshStatus() {
  try {
    serverInfo = await (await fetch('/api/status')).json();
    if (serverInfo.provider === 'gemini' && !serverInfo.hasServerKey && !settings.apiKey) {
      return setStatus('err', 'Add a Gemini API key in .env or Settings');
    }
    setStatus('idle');
  } catch {
    serverInfo = null;
    setStatus('err', 'Server not reachable');
  }
}

// ---------- boot ----------
const draft = store.get('draft', null);
if (draft) { $('title').value = draft.title || ''; ta.value = draft.text || ''; }
render();
updateWords();
renderDocs();
refreshStatus();
ta.focus();
ta.setSelectionRange(ta.value.length, ta.value.length);

// For tests and debugging.
window.__gw = { get ghost() { return ghost; }, get ghostPos() { return ghostPos; } };
