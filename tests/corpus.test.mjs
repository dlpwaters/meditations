import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseText } from '../scripts/parse-meditations.mjs';

test('complete corpus is reproducible and future-generation ready', async () => {
  const source = await readFile('data/source/meditations-long.txt', 'utf8');
  const first = parseText(source);
  const second = parseText(source);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(new Set(first.pages.map((page) => page.book)).size, 12);
  assert.equal(first.pages.length, 415);
  assert.equal(new Set(first.pages.map((page) => page.id)).size, first.pages.length);
  assert.ok(first.pages.every((page) => page.text.length > 0));
  assert.ok(first.pages.every((page) => page.modernVersion === null));
  assert.ok(first.pages.every((page) => page.illustration.status === 'pending'));
});
