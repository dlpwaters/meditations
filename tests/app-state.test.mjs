import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController, createAppState, initialView, reduceAppState } from '../src/app.js';

test('initial view requires setup only for an unconfigured user who has not skipped it', () => {
  assert.equal(initialView({ configured: false, skipped: false }), 'setup');
  assert.equal(initialView({ configured: false, skipped: true }), 'start');
  assert.equal(initialView({ configured: true, skipped: false }), 'start');
});

test('app state carries configuration and setup request state', () => {
  assert.deepEqual(createAppState({ configured: false, skipped: false }), {
    view: 'setup',
    configured: false,
    skipped: false,
    setup: { status: 'idle', error: '' },
  });
});

test('state reducer opens each application view', () => {
  const state = createAppState({ configured: true, skipped: false });
  assert.equal(reduceAppState(state, { type: 'OPEN_START' }).view, 'start');
  assert.equal(reduceAppState(state, { type: 'OPEN_ASK' }).view, 'ask');
  assert.equal(reduceAppState(state, { type: 'OPEN_READER' }).view, 'reader');
  assert.equal(reduceAppState(state, { type: 'OPEN_SETUP' }).view, 'setup');
});

test('state reducer records setup success, failure, and skip transitions', () => {
  const initial = createAppState({ configured: false, skipped: false });
  assert.deepEqual(reduceAppState(initial, { type: 'SETUP_SUCCESS' }), {
    view: 'start',
    configured: true,
    skipped: false,
    setup: { status: 'success', error: '' },
  });
  assert.deepEqual(reduceAppState(initial, { type: 'SETUP_FAILURE', error: 'Key could not be saved.' }), {
    view: 'setup',
    configured: false,
    skipped: false,
    setup: { status: 'error', error: 'Key could not be saved.' },
  });
  assert.deepEqual(reduceAppState(initial, { type: 'SKIP_SETUP' }), {
    view: 'start',
    configured: false,
    skipped: true,
    setup: { status: 'idle', error: '' },
  });
});

test('state reducer returns the original state for unknown actions', () => {
  const state = createAppState({ configured: false, skipped: true });
  assert.equal(reduceAppState(state, { type: 'NO_SUCH_ACTION' }), state);
});

test('reader initialization runs only after the reader view is revealed', () => {
  const reader = { dataset: { view: 'reader' }, hidden: true };
  const start = { dataset: { view: 'start' }, hidden: false };
  const hiddenValuesAtInitialisation = [];
  const controller = createAppController({
    views: [start, reader],
    state: createAppState({ configured: true, skipped: false }),
    onReaderVisible: () => hiddenValuesAtInitialisation.push(reader.hidden),
  });

  controller.transition({ type: 'OPEN_READER' });

  assert.deepEqual(hiddenValuesAtInitialisation, [false]);
});

test('initial setup-status completion cannot replace a completed local setup decision', () => {
  const views = ['setup', 'start', 'ask', 'reader'].map((view) => ({ dataset: { view }, hidden: true }));
  const controller = createAppController({
    views,
    state: createAppState({ configured: false, skipped: false }),
  });

  controller.transition({ type: 'SETUP_SUCCESS' });
  controller.applyInitialSetupStatus({ configured: false, skipped: false });

  assert.deepEqual(controller.getState(), {
    view: 'start',
    configured: true,
    skipped: false,
    setup: { status: 'success', error: '' },
  });
});

test('initial setup-status completion cannot replace a local skip decision', () => {
  const views = ['setup', 'start', 'ask', 'reader'].map((view) => ({ dataset: { view }, hidden: true }));
  const controller = createAppController({
    views,
    state: createAppState({ configured: false, skipped: false }),
  });

  controller.transition({ type: 'SKIP_SETUP' });
  controller.applyInitialSetupStatus({ configured: false, skipped: false });

  assert.deepEqual(controller.getState(), {
    view: 'start',
    configured: false,
    skipped: true,
    setup: { status: 'idle', error: '' },
  });
});
