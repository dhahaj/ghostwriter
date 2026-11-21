# Ghostwriter

A distraction-free writing app with inline AI predictions. As you type, a grey
suggestion appears after the cursor, like Copilot in VS Code. Press **Tab** to
accept it. Add your own documents as context so suggestions use your names,
facts and voice.

No dependencies: just Node 18.17 or newer.

## Run it

```bash
cp .env.example .env      # then paste your key into GEMINI_API_KEY
npm start                 # http://127.0.0.1:5173
```

Get a key at https://aistudio.google.com/apikey. The key stays on your machine:
the browser talks to the local server, and only the server calls Gemini.
(You can also paste a key in Settings; it is kept in that browser's storage.)

Try the UI without a key: `npm run mock`.

## Keys

| Key | Action |
| --- | --- |
| Tab | Accept the whole suggestion |
| Ctrl/⌘ + → | Accept the next word |
| Alt + ] / Alt + [ | Next / previous alternative suggestion |
| Esc | Dismiss |
| Ctrl + Space (or Alt + \) | Ask for a suggestion now, anywhere in the text |
| Ctrl/⌘ + Z | Undo an accept |

Typing the same characters as the suggestion keeps it on screen without a new request.

The first Alt + ] fetches a few alternatives in one call (Gemini `candidateCount`),
so normal typing stays a single fast request. The ghost's badge shows which one
you're on, e.g. `2/4`.

## Context documents

Open **Context** to add `.txt`/`.md` files or paste text (outlines, earlier
chapters, a style guide, notes). Active documents are sent with every request,
up to 120,000 characters. They sit at the front of the prompt so Gemini's
implicit caching can reuse them between keystrokes, which cuts cost and latency.

## Keeping it fast

- Requests wait for a pause in typing (300 ms by default, adjustable).
- Each new keystroke aborts the in-flight request, in the browser and upstream.
- Answers that arrive after the text or cursor moved are thrown away.
- Completions are short (Settings → length) and thinking is disabled on 2.5 models.
- Recent completions are cached by prefix.
- Suggestions only trigger at the end of a line, so mid-paragraph edits stay quiet.

## Settings

Suggestions on/off, when to suggest (automatically as you type, or only on
Ctrl + Space), length (phrase, sentence, a few sentences), delay, model
override (default `GEMINI_MODEL`, else `gemini-2.5-flash-lite`), an optional
browser-side API key, and standing instructions such as "British spelling,
warm tone".

## Suggestion log

Every suggestion the model returns is appended to `logs/suggestions.jsonl`
(git-ignored; set `LOG_FILE` to put it elsewhere). Each line records the time,
model, latency, the last bit of text before the cursor, every suggestion with a
rough token size, and the request's input/output tokens. Gemini reports real
token counts; when a provider doesn't, they're estimated at ~4 characters per
token and marked `estimated`. Pressing Tab adds an `accept` line, so you can see
which suggestions you actually used.

Open **Log** in the app to browse recent entries and totals, or download the
whole file. The status bar also shows each request's token count.

## Swapping the model provider

Providers live in `src/providers/`. Each exports a factory returning
`{ name, model, complete({ system, user, maxTokens, signal, apiKey, model }) }`
that resolves to `{ text }`. Register it in `src/providers/index.js` and set
`PROVIDER=<name>`. The prompt and output cleanup in `src/prompt.js` are shared
by every provider.

## Layout

```
server.js              static files + POST /api/complete
src/prompt.js          prompt building and output cleanup
src/log.js             suggestion log (JSONL) and token estimates
src/providers/         gemini.js, mock.js, index.js (registry)
public/                index.html, app.js (editor + ghost text), style.css
test/                  npm test
```
