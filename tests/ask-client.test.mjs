import assert from 'node:assert/strict';
import test from 'node:test';

import { createAskController, submitMarcusQuestion } from '../src/ask-marcus.js';
import { createAppController, createAppState } from '../src/app.js';

function element() {
  const listeners = {};
  return { textContent: '', value: '', disabled: false, hidden: false, innerHTML: '', addEventListener(type, listener) { listeners[type] = listener; }, fire(type) { return listeners[type]?.({ preventDefault() {} }); } };
}

class DomElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.listeners = {};
    this._text = '';
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  fire(type) { return this.listeners[type]?.({ preventDefault() {} }); }
  append(child) { this._text = ''; this.children.push(child); }
  replaceChildren(...children) { this._text = ''; this.children = [...children]; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get innerHTML() { return this.children.map((child) => child.outerHTML).join(''); }
  get outerHTML() { return `<${this.tagName.toLowerCase()}>${this.innerHTML || this._text}</${this.tagName.toLowerCase()}>`; }
  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      const [tag, className] = selector.split('.');
      if ((!tag || node.tagName === tag.toUpperCase()) && (!className || node.className.split(/\s+/).includes(className))) matches.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }
}

class DomDocument {
  createElement(tagName) { return new DomElement(tagName, this); }
}

test('Ask client posts in-memory input and returns trusted guidance', async () => {
  const requests = [];
  const result = await submitMarcusQuestion({ input: '  Help me focus. ', fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ message: 'Guidance', sections: [] }) }; } });
  assert.deepEqual(result, { message: 'Guidance', sections: [] });
  assert.deepEqual(requests, [{ url: '/api/ask-marcus', options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: '  Help me focus. ' }) } }]);
});

test('Ask controller renders loading, trusted results, retry, back, and the exact recommended order', async () => {
  const form = element(); const input = element(); const counter = element(); const status = element(); const submit = element(); const retry = element(); const results = element(); const back = element(); const explore = element();
  let resolveRequest;
  const calls = [];
  const controller = createAskController({ form, input, counter, status, submitButton: submit, retryButton: retry, results, backButton: back, exploreButton: explore, fetchImpl: () => new Promise((resolve) => { resolveRequest = resolve; }), onBack: () => calls.push('back'), onExplore: (ids) => calls.push(ids) });
  input.value = 'A question';
  const pending = form.fire('submit');
  assert.equal(status.textContent, 'Asking Marcus…');
  assert.equal(submit.disabled, true);
  resolveRequest({ ok: true, json: async () => ({ safetyBanner: 'Safety first.', message: '<unsafe>', sections: [{ id: 'second', label: 'Second', lesson: 'Lesson', reason: 'Reason' }, { id: 'first', label: 'First', lesson: 'Lesson', reason: 'Reason' }] }) });
  await pending;
  assert.equal(status.textContent, '');
  assert.equal(results.textContent.includes('<unsafe>'), true);
  assert.equal(results.innerHTML, '');
  assert.equal(retry.hidden, true);
  await explore.fire('click');
  back.fire('click');
  assert.deepEqual(calls, [['second', 'first'], 'back']);
  assert.equal(input.value, 'A question');
  controller.destroyForTest?.();
});

test('Ask controller creates ordered text-only safety, message, and ten recommendation articles in a DOM', async () => {
  const document = new DomDocument();
  const form = document.createElement('form'); const input = document.createElement('textarea'); const counter = document.createElement('p'); const status = document.createElement('p'); const submit = document.createElement('button'); const retry = document.createElement('button'); const results = document.createElement('section'); const back = document.createElement('button'); const explore = document.createElement('button');
  const ids = Array.from({ length: 10 }, (_, index) => `book-${String(index + 1).padStart(2, '0')}-section-01`);
  const explored = [];
  createAskController({
    form, input, counter, status, submitButton: submit, retryButton: retry, results, backButton: back, exploreButton: explore,
    fetchImpl: async () => ({ ok: true, json: async () => ({
      safetyBanner: '<strong>Trusted safety</strong>',
      message: '<img src=x onerror=alert(1)>Marcus replies',
      sections: ids.map((id, index) => ({ id, label: `<b>Section ${index + 1}</b>`, lesson: 'Lesson', reason: 'Reason' })),
    }) }),
    onBack() {}, onExplore: (orderedIds) => explored.push(orderedIds),
  });
  input.value = 'How should I meet today?';

  await form.fire('submit');

  assert.equal(results.children[0].className, 'ask-safety');
  assert.equal(results.children[1].className, 'ask-message');
  assert.equal(results.children[0].textContent, '<strong>Trusted safety</strong>');
  assert.equal(results.children[1].textContent, '<img src=x onerror=alert(1)>Marcus replies');
  assert.equal(results.querySelectorAll('article.ask-card').length, 10);
  assert.equal(results.querySelectorAll('strong').length, 0);
  assert.equal(results.querySelectorAll('img').length, 0);
  await explore.fire('click');
  assert.deepEqual(explored, [ids]);
});

test('Ask controller removes the initial empty state when loading begins and does not restore it on error', async () => {
  const document = new DomDocument();
  const form = document.createElement('form'); const input = document.createElement('textarea'); const counter = document.createElement('p'); const status = document.createElement('p'); const submit = document.createElement('button'); const retry = document.createElement('button'); const results = document.createElement('section'); const back = document.createElement('button'); const explore = document.createElement('button');
  const emptyState = document.createElement('p');
  emptyState.className = 'ask-empty';
  emptyState.textContent = 'Initial editorial guidance';
  results.append(emptyState);
  let resolveRequest;
  createAskController({
    form, input, counter, status, submitButton: submit, retryButton: retry, results, backButton: back, exploreButton: explore,
    fetchImpl: () => new Promise((resolve) => { resolveRequest = resolve; }),
    onBack() {}, onExplore() {},
  });
  input.value = 'A private question';

  const pending = form.fire('submit');

  assert.equal(results.querySelectorAll('.ask-empty').length, 0);
  assert.equal(results.children.length, 0);
  resolveRequest({ ok: false, json: async () => ({ code: 'service_unavailable' }) });
  await pending;
  assert.equal(results.querySelectorAll('.ask-empty').length, 0);
  assert.notEqual(status.textContent, '');
  assert.equal(retry.hidden, false);
});

test('Ask controller keeps the question for a retry after a safe error', async () => {
  const form = element(); const input = element(); const counter = element(); const status = element(); const submit = element(); const retry = element(); const results = element(); const back = element(); const explore = element();
  let attempts = 0;
  createAskController({ form, input, counter, status, submitButton: submit, retryButton: retry, results, backButton: back, exploreButton: explore, fetchImpl: async () => ({ ok: false, json: async () => ({ code: attempts++ === 0 ? 'rate_limited' : 'service_unavailable' }) }), onBack() {}, onExplore() {} });
  input.value = 'Keep this question';
  await form.fire('submit');
  assert.equal(input.value, 'Keep this question');
  assert.equal(retry.hidden, false);
  assert.match(status.textContent, /try again/i);
  await retry.fire('click');
  assert.equal(input.value, 'Keep this question');
});

test('Ask controller routes a key-required response to Setup without passing on the question', async () => {
  const form = element(); const input = element(); const counter = element(); const status = element(); const submit = element(); const retry = element(); const results = element(); const back = element(); const explore = element();
  const views = ['setup', 'start', 'ask', 'reader'].map((view) => ({ dataset: { view }, hidden: true }));
  const app = createAppController({ views, state: { ...createAppState({ configured: true, skipped: false }), view: 'ask' } });
  const callbackArguments = [];
  createAskController({ form, input, counter, status, submitButton: submit, retryButton: retry, results, backButton: back, exploreButton: explore, fetchImpl: async () => ({ ok: false, json: async () => ({ code: 'key_required' }) }), onBack() {}, onExplore() {}, onKeyRequired: (...args) => { callbackArguments.push(args); app.transition({ type: 'OPEN_SETUP' }); } });
  input.value = 'A private question';

  await form.fire('submit');

  assert.equal(app.getState().view, 'setup');
  assert.deepEqual(callbackArguments, [[]]);
  assert.equal(input.value, 'A private question');
  assert.equal(retry.hidden, true);
});
