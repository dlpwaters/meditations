import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

import { loadOpenAIKey } from '../src/server/config.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA_PATH = resolve(ROOT, 'data/meditations.pages.json');
const INDEX_PATH = resolve(ROOT, 'data/meditations.retrieval.json');
const KEY_LIKE_PATTERN = /(?:sk-(?:proj-)?|rk-|pk-|bearer\s+|openai_api_key\s*[=:])/i;

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_BATCH_SIZE = 32;

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Page ${field} is required`);
  return value.trim();
}

function validVector(vector) {
  return Array.isArray(vector)
    && vector.length === EMBEDDING_DIMENSIONS
    && vector.every(Number.isFinite);
}

function assertNoKeyLikeStrings(value) {
  if (KEY_LIKE_PATTERN.test(JSON.stringify(value))) {
    throw new TypeError('Saved index must not contain key-like strings');
  }
}

export function embeddingTextForPage(page) {
  const label = requiredText(page?.label, 'label');
  const lesson = requiredText(page?.lesson, 'lesson');
  const text = requiredText(page?.text, 'original text');
  const modernVersion = requiredText(page?.modernVersion, 'familiar reading');
  return `${label}\n\nLesson: ${lesson}\n\nOriginal text:\n${text}\n\nFamiliar reading:\n${modernVersion}`;
}

export function validateSavedIndex(pages, index) {
  if (!Array.isArray(pages) || !index || typeof index !== 'object' || !Array.isArray(index.entries)) {
    throw new TypeError('Corpus pages and index entries are required');
  }
  if (index.model !== EMBEDDING_MODEL) throw new TypeError('Saved index model is invalid');
  if (index.dimensions !== EMBEDDING_DIMENSIONS) throw new TypeError('Saved index dimensions are invalid');
  if (index.entries.length !== pages.length) throw new TypeError('Saved index must contain every corpus ID');
  assertNoKeyLikeStrings(index);

  const ids = new Set();
  for (let position = 0; position < pages.length; position += 1) {
    const id = pages[position]?.id;
    if (typeof id !== 'string' || !id || ids.has(id)) throw new TypeError('Corpus pages must have unique IDs');
    ids.add(id);
    const entry = index.entries[position];
    if (entry?.id !== id) throw new TypeError('Saved index IDs must match corpus order');
    if (!validVector(entry.vector)) throw new TypeError(`Saved index vector for ${id} must be finite and 1536-dimensional`);
  }
  return index;
}

function validCheckpointEntries(pages, checkpoint) {
  if (checkpoint?.model !== EMBEDDING_MODEL || checkpoint?.dimensions !== EMBEDDING_DIMENSIONS || !Array.isArray(checkpoint.entries)) {
    return new Map();
  }
  assertNoKeyLikeStrings(checkpoint);
  const knownIds = new Set(pages.map(({ id }) => id));
  const entries = new Map();
  for (const entry of checkpoint.entries) {
    if (knownIds.has(entry?.id) && !entries.has(entry.id) && validVector(entry.vector)) {
      entries.set(entry.id, entry.vector);
    }
  }
  return entries;
}

function savedIndexFor(pages, vectorsById) {
  return {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    generatedAt: new Date().toISOString(),
    entries: pages
      .filter(({ id }) => vectorsById.has(id))
      .map(({ id }) => ({ id, vector: vectorsById.get(id) })),
  };
}

async function writeAtomic(path, value) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(temporary, path);
}

async function loadCheckpoint(indexPath) {
  try {
    return JSON.parse(await readFile(indexPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) throw new Error('Existing retrieval index is not valid JSON');
    throw error;
  }
}

function batches(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

export async function generateRetrievalIndex({ pages, indexPath, embedBatch, onCheckpoint = () => {} }) {
  if (!Array.isArray(pages)) throw new TypeError('Corpus pages are required');
  if (typeof indexPath !== 'string' || !indexPath) throw new TypeError('Index path is required');
  if (typeof embedBatch !== 'function') throw new TypeError('An embedding function is required');

  const vectorsById = validCheckpointEntries(pages, await loadCheckpoint(indexPath));
  const pending = pages.filter(({ id }) => !vectorsById.has(id));
  for (const batch of batches(pending, EMBEDDING_BATCH_SIZE)) {
    const vectors = await embedBatch(batch.map(embeddingTextForPage));
    if (!Array.isArray(vectors) || vectors.length !== batch.length || !vectors.every(validVector)) {
      throw new Error('Embedding response did not contain one finite 1536-dimensional vector per requested page');
    }
    batch.forEach(({ id }, index) => vectorsById.set(id, vectors[index]));
    const checkpoint = savedIndexFor(pages, vectorsById);
    await writeAtomic(indexPath, checkpoint);
    onCheckpoint({ entries: checkpoint.entries.length, model: checkpoint.model, dimensions: checkpoint.dimensions });
  }

  const completed = savedIndexFor(pages, vectorsById);
  validateSavedIndex(pages, completed);
  await writeAtomic(indexPath, completed);
  return completed;
}

function safeRemoteError(error) {
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  return new Error(status ? `Embedding request failed (HTTP ${status})` : 'Embedding request failed (network error)');
}

async function requestEmbeddings(client, input) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        input,
      });
      return response.data.map(({ embedding }) => embedding);
    } catch (error) {
      lastError = error;
      const transient = error?.status === 429 || (Number.isInteger(error?.status) && error.status >= 500 && error.status <= 599);
      if (!transient || attempt === 4) throw safeRemoteError(error);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * (2 ** attempt)));
    }
  }
  throw safeRemoteError(lastError);
}

async function run() {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  const key = await loadOpenAIKey({ projectRoot: ROOT, env: process.env });
  if (!key) throw new Error('OpenAI API key is not configured');
  const client = new OpenAI({ apiKey: key });
  const index = await generateRetrievalIndex({
    pages: data.pages,
    indexPath: INDEX_PATH,
    embedBatch: (input) => requestEmbeddings(client, input),
    onCheckpoint: ({ entries, model, dimensions }) => console.log(`Retrieval checkpoint: entries=${entries} model=${model} dimensions=${dimensions}`),
  });
  console.log(`Retrieval index: entries=${index.entries.length} model=${index.model} dimensions=${index.dimensions}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
