import test from 'node:test';
import assert from 'node:assert/strict';

import { SOURCE_PATH, SOURCE_URL } from '../scripts/fetch-source.mjs';

test('source configuration points at the reproducible Gutenberg plain text', () => {
  assert.equal(SOURCE_URL, 'https://www.gutenberg.org/files/2680/2680-0.txt');
  assert.match(SOURCE_PATH, /data[\\/]source[\\/]meditations-long\.txt$/);
});
