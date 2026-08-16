import test from 'node:test';
import assert from 'node:assert/strict';
import { SETUP_SKIP_KEY, createSetupController, fetchSetupStatus, submitSetupKey } from '../src/setup.js';

function control(value = '') {
  const listeners = new Map();
  return {
    value,
    disabled: false,
    textContent: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    async dispatch(type) { return listeners.get(type)({ preventDefault() {} }); },
  };
}

test('fetchSetupStatus projects only the configured flag', async () => {
  const calls = [];
  const result = await fetchSetupStatus(async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => ({ configured: true, ignored: 'value' }) };
  });
  assert.deepEqual(calls, [['/api/setup-status']]);
  assert.deepEqual(result, { configured: true });
});

test('submitSetupKey posts the supplied key as the JSON key payload', async () => {
  const calls = [];
  const result = await submitSetupKey({ key: 'key-for-test', fetchImpl: async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => ({ configured: true }) };
  } });
  assert.deepEqual(calls, [['/api/setup-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'key-for-test' }),
  }]]);
  assert.deepEqual(result, { configured: true });
});

test('setup controller clears a submitted key and renders fixed success text', async () => {
  const form = control(); const input = control('key-for-test'); const status = control(); const submitButton = control(); const skipButton = control();
  const storage = { setItem() {} };
  let succeeded = 0;
  createSetupController({ form, input, status, submitButton, skipButton, storage, onSuccess: () => { succeeded += 1; }, onFailure() {}, onSkip() {}, fetchImpl: async () => ({ ok: true, json: async () => ({ configured: true }) }) });

  await form.dispatch('submit');

  assert.equal(input.value, '');
  assert.equal(status.textContent, 'Key saved.');
  assert.equal(succeeded, 1);
});

test('setup controller clears a failed key request and renders fixed error text', async () => {
  const form = control(); const input = control('key-for-test'); const status = control(); const submitButton = control(); const skipButton = control();
  const storage = { setItem() {} };
  let failure;
  createSetupController({ form, input, status, submitButton, skipButton, storage, onSuccess() {}, onFailure: (message) => { failure = message; }, onSkip() {}, fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'server text must not render' }) }) });

  await form.dispatch('submit');

  assert.equal(input.value, '');
  assert.equal(status.textContent, 'Could not save that key. Please try again.');
  assert.equal(failure, 'Could not save that key. Please try again.');
});

test('setup controller skip stores only the skip preference and renders fixed text', async () => {
  const form = control(); const input = control(); const status = control(); const submitButton = control(); const skipButton = control();
  const stored = [];
  const storage = { setItem: (...entry) => stored.push(entry) };
  let skipped = 0;
  createSetupController({ form, input, status, submitButton, skipButton, storage, onSuccess() {}, onFailure() {}, onSkip: () => { skipped += 1; } });

  await skipButton.dispatch('click');

  assert.deepEqual(stored, [[SETUP_SKIP_KEY, 'true']]);
  assert.equal(status.textContent, 'You can add a key later.');
  assert.equal(skipped, 1);
});
