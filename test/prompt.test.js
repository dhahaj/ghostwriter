import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, cleanCompletion } from '../src/prompt.js';

test('prompt marks the cursor and includes docs in the system prompt', () => {
  const p = buildPrompt({ before: 'Hello wor', after: '\nNext', docs: [{ name: 'notes.md', text: 'Facts here' }] });
  assert.match(p.user, /Hello wor<CURSOR\/>\nNext/);
  assert.match(p.system, /<document name="notes.md">\nFacts here/);
});

test('cleanCompletion strips echoes, quotes and fences', () => {
  assert.equal(cleanCompletion('sat on the mat.', { before: 'The cat sat on the' }), ' mat.');
  assert.equal(cleanCompletion('"over the hill"', { before: 'ran ' }), 'over the hill');
  assert.equal(cleanCompletion('```\nld and more\n```', { before: 'Hello wor' }), 'ld and more');
});

test('cleanCompletion avoids a double space and stops before following text', () => {
  assert.equal(cleanCompletion(' quickly home.', { before: 'She walked ' }), 'quickly home.');
  assert.equal(cleanCompletion(' a red one. The end is near', { before: 'I bought', after: 'The end is near' }), ' a red one.');
});

test('cleanCompletion keeps one paragraph and caps words', () => {
  assert.equal(cleanCompletion(' one two\n\nthree', { before: 'x' }), ' one two');
  assert.equal(cleanCompletion(' a b c d e f', { before: 'x', maxWords: 3 }), ' a b c');
});
