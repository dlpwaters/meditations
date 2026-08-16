import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseText, romanToNumber } from '../scripts/parse-meditations.mjs';

const fixturePath = resolve('tests/fixtures/mini-meditations.txt');

test('parses numbered sections into stable future-ready pages', async () => {
  const result = parseText(await readFile(fixturePath, 'utf8'), { requireComplete: false });

  assert.equal(result.pages.length, 3);
  assert.deepEqual(result.pages.map((page) => page.id), [
    'book-01-section-01',
    'book-01-section-03',
    'book-02-section-01',
  ]);
  assert.equal(result.pages[0].text, 'First section text that wraps across a line.');
  assert.equal(result.pages[1].label, 'Book I · Section 3');
  assert.equal(result.pages[0].modernVersion, null);
  assert.deepEqual(result.pages[0].illustration, {
    status: 'pending',
    path: null,
    prompt: null,
  });
});

test('converts subtractive Roman numerals', () => {
  assert.equal(romanToNumber('IV'), 4);
  assert.equal(romanToNumber('IX'), 9);
  assert.equal(romanToNumber('XII'), 12);
});

test('rejects an incomplete source', () => {
  assert.throws(
    () => parseText('THE FIRST BOOK\n\nI. Only one book.', { requireComplete: true }),
    /twelve Books/i,
  );
});
