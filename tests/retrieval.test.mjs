import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  cosineSimilarity,
  lexicalScore,
  mergeRankings,
  retrieveCandidates,
  tokenize,
  validateRetrievalIndex,
} from '../src/server/retrieval.mjs';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  embeddingTextForPage,
  generateRetrievalIndex,
  validateSavedIndex,
} from '../scripts/generate-retrieval-index.mjs';

const index = JSON.parse(await readFile('tests/fixtures/retrieval-index.json', 'utf8'));
const pages = [
  { id: 'change', title: 'On Change', text: 'Change is the work of nature.', source: 'corpus' },
  { id: 'control', title: 'On Control', text: 'You cannot control the future.', source: 'corpus' },
  { id: 'fear', title: 'On Fear', text: 'Worrying gives fear more room.', source: 'corpus' },
  { id: 'duty', title: 'On Duty', text: 'Do the work before you.', source: 'corpus' },
];

test('tokenize normalizes case, punctuation, and repeated whitespace', () => {
  assert.deepEqual(tokenize('  Change—WORRYING,  cannot!  '), ['change', 'worrying', 'cannot']);
});

test('tokenize keeps ASCII I locale-independent', () => {
  const original = String.prototype.toLocaleLowerCase;
  String.prototype.toLocaleLowerCase = () => 'locale-dependent';
  try {
    assert.deepEqual(tokenize('I'), ['i']);
  } finally {
    String.prototype.toLocaleLowerCase = original;
  }
});

test('cosineSimilarity returns the hand-computable vector similarity', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [3, 4, 0]), 0.6);
  assert.equal(cosineSimilarity([0, 0, 0], [3, 4, 0]), 0);
});

test('lexicalScore counts normalized query-token matches once per document token', () => {
  assert.equal(lexicalScore('Cannot stop worrying', 'WORRYING, worrying cannot.'), 2);
});

test('mergeRankings uses reciprocal-rank fusion and breaks equal scores by first ranking', () => {
  assert.deepEqual(
    mergeRankings(['change', 'control', 'fear'], ['change', 'fear', 'control']),
    ['change', 'control', 'fear'],
  );
});

test('validateRetrievalIndex rejects non-aligned, duplicate, non-finite, and inconsistent vectors', () => {
  assert.throws(() => validateRetrievalIndex(pages, { entries: index.entries.slice(0, 3) }), /exactly match/);
  assert.throws(() => validateRetrievalIndex(pages, { entries: [...index.entries, index.entries[0]] }), /exactly one entry/);
  assert.throws(() => validateRetrievalIndex(pages, { entries: [{ id: 'change', vector: [1, 0, 0] }, { id: 'control', vector: [Infinity, 0, 0] }, ...index.entries.slice(2)] }), /finite/);
  assert.throws(() => validateRetrievalIndex(pages, { entries: [{ id: 'change', vector: [1, 0] }, ...index.entries.slice(1)] }), /consistent dimensions/);
});

test('retrieveCandidates returns unique trusted pages in deterministic reciprocal-rank order', () => {
  const candidates = retrieveCandidates({
    query: 'I cannot stop worrying about change',
    queryVector: [1, 0, 0],
    pages,
    index,
    limit: 3,
  });

  assert.deepEqual(candidates.map(({ id }) => id), ['change', 'control', 'fear']);
  assert.equal(candidates[0], pages[0]);
  assert.equal(Object.hasOwn(candidates[0], 'vector'), false);
});

test('retrieveCandidates caps results exactly at the corpus size', () => {
  assert.equal(retrieveCandidates({ query: 'change', queryVector: [1, 0, 0], pages, index, limit: 99 }).length, 4);
  assert.equal(retrieveCandidates({ query: 'change', queryVector: [1, 0, 0], pages, index, limit: 2 }).length, 2);
});

test('retrieveCandidates returns exactly min(limit, 0) for an empty aligned corpus', () => {
  const candidates = retrieveCandidates({
    query: 'change',
    queryVector: [1, 0, 0],
    pages: [],
    index: { entries: [] },
    limit: 32,
  });

  assert.deepEqual(candidates, []);
  assert.equal(candidates.length, Math.min(32, 0));
});

test('embeddingTextForPage preserves the label, lesson, original, and familiar reading', () => {
  const page = {
    label: 'Book II · Section 1',
    lesson: 'Choose the Work',
    text: 'Do the work in front of you.',
    modernVersion: 'Give your attention to the useful task you can do now.',
  };

  assert.equal(
    embeddingTextForPage(page),
    'Book II · Section 1\n\nLesson: Choose the Work\n\nOriginal text:\nDo the work in front of you.\n\nFamiliar reading:\nGive your attention to the useful task you can do now.',
  );
});

test('validateSavedIndex accepts only a complete ordered production artifact without key-like strings', () => {
  const corpus = [{ id: 'first' }, { id: 'second' }];
  const index = {
    model: 'text-embedding-3-small',
    dimensions: 1536,
    entries: [
      { id: 'first', vector: Array.from({ length: 1536 }, () => 0.25) },
      { id: 'second', vector: Array.from({ length: 1536 }, () => -0.25) },
    ],
  };

  assert.deepEqual(validateSavedIndex(corpus, index), index);
  assert.throws(() => validateSavedIndex(corpus, { ...index, model: 'other' }), /model/i);
  assert.throws(() => validateSavedIndex(corpus, { ...index, dimensions: 1535 }), /dimensions/i);
  assert.throws(() => validateSavedIndex(corpus, { ...index, entries: [...index.entries].reverse() }), /order/i);
  assert.throws(() => validateSavedIndex(corpus, { ...index, provenance: 'sk-not-a-real-key' }), /key-like/i);
  assert.equal(EMBEDDING_MODEL, 'text-embedding-3-small');
  assert.equal(EMBEDDING_DIMENSIONS, 1536);
});

test('generateRetrievalIndex resumes from a valid checkpoint without re-embedding saved IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meditations-retrieval-'));
  const indexPath = join(directory, 'index.json');
  const pages = [
    { id: 'first', label: 'First', lesson: 'Begin', text: 'Original first.', modernVersion: 'Familiar first.' },
    { id: 'second', label: 'Second', lesson: 'Continue', text: 'Original second.', modernVersion: 'Familiar second.' },
  ];
  const firstVector = Array.from({ length: 1536 }, () => 0.25);
  const secondVector = Array.from({ length: 1536 }, () => -0.25);
  await writeFile(indexPath, JSON.stringify({
    model: 'text-embedding-3-small',
    dimensions: 1536,
    entries: [{ id: 'first', vector: firstVector }],
  }));
  const requests = [];

  try {
    const generated = await generateRetrievalIndex({
      pages,
      indexPath,
      embedBatch: async (inputs) => {
        requests.push(inputs);
        return [secondVector];
      },
    });

    assert.deepEqual(requests, [['Second\n\nLesson: Continue\n\nOriginal text:\nOriginal second.\n\nFamiliar reading:\nFamiliar second.']]);
    assert.deepEqual(generated.entries.map(({ id }) => id), ['first', 'second']);
    assert.deepEqual(JSON.parse(await readFile(indexPath, 'utf8')).entries.map(({ id }) => id), ['first', 'second']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('saved retrieval index is ordered for all 415 corpus IDs with production metadata and finite vectors', async () => {
  const corpus = JSON.parse(await readFile('data/meditations.pages.json', 'utf8')).pages;
  const savedIndex = JSON.parse(await readFile('data/meditations.retrieval.json', 'utf8'));

  assert.equal(corpus.length, 415);
  assert.deepEqual(validateSavedIndex(corpus, savedIndex), savedIndex);
  assert.deepEqual(savedIndex.entries.map(({ id }) => id), corpus.map(({ id }) => id));
  assert.equal(savedIndex.model, 'text-embedding-3-small');
  assert.equal(savedIndex.dimensions, 1536);
  assert.ok(savedIndex.entries.every(({ vector }) => vector.length === 1536 && vector.every(Number.isFinite)));
  assert.equal(/(?:sk-(?:proj-)?|rk-|pk-|bearer\s+|openai_api_key\s*[=:])/i.test(JSON.stringify(savedIndex)), false);
});
