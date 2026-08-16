import test from 'node:test';
import assert from 'node:assert/strict';

import { createReader, createReadingPath, createReaderState, nextReaderIndex, restoreFullBookIndex } from '../src/reader.js';

const pages = [
  { id: 'book-01-section-01' },
  { id: 'book-01-section-02' },
  { id: 'book-02-section-01' },
  { id: 'book-02-section-02' },
];

test('uses the complete corpus when no recommendations are supplied', () => {
  assert.deepEqual(createReadingPath(pages), pages);
});

test('preserves the exact recommendation order for an active reading path', () => {
  assert.deepEqual(
    createReadingPath(pages, ['book-02-section-02', 'book-01-section-01']),
    [pages[3], pages[0]],
  );
});

test('rejects duplicate and unknown recommendation ids', () => {
  assert.throws(() => createReadingPath(pages, ['book-01-section-01', 'book-01-section-01']), /duplicate/i);
  assert.throws(() => createReadingPath(pages, ['book-99-section-99']), /unknown/i);
});

test('restores the full-book index for the visible recommended section', () => {
  assert.equal(restoreFullBookIndex(pages, 'book-02-section-01'), 2);
});

test('previous next and random targets remain bounded to the active path', () => {
  const state = { ...createReaderState(2), index: 1 };
  assert.equal(nextReaderIndex(state, () => 0), 1);
  assert.equal(nextReaderIndex({ ...state, randomMode: true }, () => 0), 0);
});

function createElement() {
  const listeners = new Map();
  return {
    attributes: {},
    disabled: false,
    hidden: false,
    innerHTML: '',
    textContent: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    click() { listeners.get('click')?.({ target: this }); },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function createReaderHarness() {
  const originalDocument = globalThis.document;
  const originalSt = globalThis.St;
  const calls = { construct: 0, load: [], update: [], turns: [], next: 0 };
  const contentsList = createElement();
  const book = { ...createElement(), querySelectorAll() { return [{ html: this.innerHTML }]; }, requestFullscreen: async () => {} };
  const elements = {
    status: createElement(), book, progress: createElement(), previous: createElement(), next: createElement(), fullBook: createElement(),
    contentsButton: createElement(), contents: { ...createElement(), querySelector() { return contentsList; } }, originalButton: createElement(),
    familiarButton: createElement(), randomButton: createElement(), fullscreenButton: createElement(),
  };
  class FakePageFlip {
    constructor() { calls.construct += 1; this.listeners = new Map(); }
    on(type, listener) { this.listeners.set(type, listener); }
    loadFromHTML(nodes) { calls.load.push(nodes[0].html); }
    updateFromHtml(nodes) { calls.update.push(nodes[0].html); }
    turnToPage(index) { calls.turns.push(index); }
    flipNext() { calls.next += 1; }
    flipPrev() {}
  }
  globalThis.document = {
    fullscreenElement: null,
    addEventListener() {},
    exitFullscreen: async () => {},
    createElement() {
      let markup = '';
      return {
        get innerHTML() { return markup; },
        set innerHTML(value) { markup = value; },
        content: { querySelectorAll() { return [{ html: markup }]; } },
      };
    },
  };
  globalThis.St = { PageFlip: FakePageFlip };
  return {
    calls,
    elements,
    reader: createReader(elements),
    restore() { globalThis.document = originalDocument; globalThis.St = originalSt; },
  };
}

test('queues a recommended path until the reader is visible and initialised', (t) => {
  const harness = createReaderHarness();
  t.after(() => harness.restore());
  const corpus = pages.map((page, index) => ({ ...page, book: index < 2 ? 1 : 2, section: (index % 2) + 1, label: `Section ${index + 1}`, text: `Text ${index + 1}` }));

  harness.reader.setPages(corpus);
  harness.reader.openRecommendedPath(['book-02-section-02', 'book-01-section-01']);

  assert.equal(harness.calls.construct, 0);
  assert.equal(harness.calls.load.length, 0);

  harness.reader.initialise();

  assert.equal(harness.calls.construct, 1);
  assert.equal(harness.calls.load.length, 1);
  assert.equal(harness.calls.update.length, 0);
  assert.match(harness.calls.load[0], /data-page-id="book-02-section-02"[\s\S]*data-page-id="book-01-section-01"/);
  assert.equal(harness.elements.progress.textContent, '1 of 2');
});

test('public reading-path APIs update one PageFlip instance with ordered pages and full-book anchoring', (t) => {
  const harness = createReaderHarness();
  t.after(() => harness.restore());
  const corpus = pages.map((page, index) => ({ ...page, book: index < 2 ? 1 : 2, section: (index % 2) + 1, label: `Section ${index + 1}`, text: `Text ${index + 1}` }));

  harness.reader.setPages(corpus);
  harness.reader.initialise();
  harness.elements.familiarButton.click();
  harness.reader.openRecommendedPath(['book-02-section-02', 'book-01-section-01']);

  assert.equal(harness.calls.load.length, 1);
  assert.equal(harness.calls.update.length, 2);
  assert.match(harness.calls.update[1], /data-page-id="book-02-section-02"[\s\S]*data-page-id="book-02-section-02"[\s\S]*data-page-id="book-01-section-01"/);
  assert.equal(harness.elements.progress.textContent, '1 of 2');
  assert.equal(harness.elements.previous.disabled, true);
  assert.equal(harness.elements.next.disabled, false);
  harness.elements.next.click();
  assert.equal(harness.calls.next, 1);

  harness.reader.openFullBook({ startId: 'book-02-section-01' });

  assert.equal(harness.calls.load.length, 1);
  assert.equal(harness.calls.update.length, 3);
  assert.equal(harness.reader.getState().index, 2);
  assert.equal(harness.elements.progress.textContent, '3 of 4');
  assert.equal(harness.elements.fullBook.hidden, true);
});
