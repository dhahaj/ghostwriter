// Tiny zero-dependency server: serves the editor and proxies completions so the
// API key stays out of the page unless you choose to paste one in Settings.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProvider } from './src/providers/index.js';
import { buildPrompt, cleanCompletion } from './src/prompt.js';

const root = fileURLToPath(new URL('.', import.meta.url));
loadDotEnv(join(root, '.env'));

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const provider = createProvider(process.env.PROVIDER);
const PUBLIC = join(root, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 2_000_000;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/complete') return await handleComplete(req, res);
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, { provider: provider.name, model: provider.model, hasServerKey: provider.name !== 'gemini' || !!process.env.GEMINI_API_KEY });
    }
    if (req.method === 'GET') return await serveStatic(url.pathname, res);
    json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
  }
});

async function handleComplete(req, res) {
  const body = await readJson(req);
  // Cancel the upstream call if the browser aborts (user kept typing).
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });

  const prompt = buildPrompt(body);
  const t0 = performance.now();
  try {
    const out = await provider.complete({
      ...prompt,
      signal: ac.signal,
      apiKey: req.headers['x-api-key'] || undefined,
      model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
    });
    const text = cleanCompletion(out.text, { before: body.before, after: body.after, maxWords: prompt.maxWords });
    json(res, 200, { text, ms: Math.round(performance.now() - t0), cachedTokens: out.usage?.cachedContentTokenCount || 0 });
  } catch (err) {
    if (ac.signal.aborted || err.name === 'AbortError') return; // client is gone
    json(res, err.status || 500, { error: err.message || 'Completion failed' });
  }
}

async function serveStatic(pathname, res) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

server.listen(PORT, HOST, () => {
  console.log(`Ghostwriter on http://${HOST}:${PORT}  (provider: ${provider.name}, model: ${provider.model})`);
  if (provider.name === 'gemini' && !process.env.GEMINI_API_KEY) {
    console.log('No GEMINI_API_KEY set. Add it to .env, or paste a key in the app\'s Settings.');
  }
});
