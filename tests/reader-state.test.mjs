import test from 'node:test';
import assert from 'node:assert/strict';

import { createReaderState, reduceReaderState } from '../src/reader.js';

test('moves through bounded spreads', () => {
  let state = createReaderState(3);
  state = reduceReaderState(state, { type: 'NEXT' });
  assert.equal(state.index, 1);
  const first = createReaderState(3);
  assert.equal(reduceReaderState(first, { type: 'PREVIOUS' }).index, 0);
});

test('ignores unknown actions', () => {
  const state = createReaderState(3);
  assert.deepEqual(reduceReaderState(state, { type: 'UNKNOWN' }), state);
});
