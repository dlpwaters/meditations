import test from 'node:test';
import assert from 'node:assert/strict';
import { createReaderState, nextReaderIndex, randomFlipDirection, reduceReaderState, readingForMode, randomIndex } from '../src/reader.js';

test('starts in Original mode and changes reading mode without losing location', () => {
  const state = { ...createReaderState(3), index: 2 };
  const changed = reduceReaderState(state, { type: 'SET_MODE', mode: 'familiar' });
  assert.equal(changed.mode, 'familiar');
  assert.equal(changed.index, 2);
  assert.equal(readingForMode({ text: 'Original', modernVersion: 'Familiar' }, 'original'), 'Original');
  assert.equal(readingForMode({ text: 'Original', modernVersion: 'Familiar' }, 'familiar'), 'Familiar');
});

test('opens contents and selects a section directly', () => {
  let state = createReaderState(3);
  state = reduceReaderState(state, { type: 'TOGGLE_CONTENTS' });
  assert.equal(state.contentsOpen, true);
  state = reduceReaderState(state, { type: 'SELECT_INDEX', index: 2 });
  assert.equal(state.index, 2);
  assert.equal(state.contentsOpen, false);
});

test('selects a different section for Random mode', () => {
  assert.equal(randomIndex(4, 1, () => 0), 0);
  assert.equal(randomIndex(4, 1, () => 0.99), 3);
  assert.equal(randomIndex(1, 0, () => 0.5), 0);
});

test('keeps Random mode on and chooses a different section for each forward reading intent', () => {
  let state = { ...createReaderState(4), index: 1 };
  assert.equal(state.randomMode, false);
  assert.equal(nextReaderIndex(state, () => 0.99), 2);

  state = reduceReaderState(state, { type: 'TOGGLE_RANDOM_MODE' });
  assert.equal(state.randomMode, true);
  assert.equal(nextReaderIndex(state, () => 0), 0);
  assert.notEqual(nextReaderIndex(state, () => 0.99), state.index);

  state = reduceReaderState(state, { type: 'TOGGLE_RANDOM_MODE' });
  assert.equal(state.randomMode, false);
  assert.equal(nextReaderIndex(state, () => 0), 2);
});

test('uses a physical page turn before revealing a Random section', () => {
  assert.equal(randomFlipDirection({ pageCount: 4, index: 1 }), 'next');
  assert.equal(randomFlipDirection({ pageCount: 4, index: 3 }), 'previous');
});
