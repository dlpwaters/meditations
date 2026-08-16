import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA_PATH = resolve(ROOT, 'data/meditations.pages.json');
const BATCH_SIZE = 25;

export function buildLessonPrompt(pages) {
  return `Return JSON only as {"lessons":[...]}. For each familiar-language Meditations reading, provide a neutral, memorable one-to-three-word topic label for a contents menu. Name the lesson; do not explain it, use punctuation, quote the reading, mention technology, or repeat the book/section. Output one object per exact input ID: {"id":"...","lesson":"..."}.\n\n${JSON.stringify(pages.map(({ id, modernVersion }) => ({ id, modernVersion })))} `;
}

export function validateLessonBatch(result, pages) {
  if (!Array.isArray(result)) throw new Error('Generation response must be an array');
  const expected = new Set(pages.map(({ id }) => id));
  const lessons = new Map();
  for (const item of result) {
    if (!expected.has(item?.id)) throw new Error(`Unexpected id: ${item?.id}`);
    if (lessons.has(item.id)) throw new Error(`Duplicate id: ${item.id}`);
    const lesson = item?.lesson?.trim();
    if (!lesson) throw new Error(`Empty lesson: ${item?.id}`);
    if (lesson.split(/\s+/).length > 3) throw new Error(`Lesson must be one to three words: ${item.id}`);
    lessons.set(item.id, lesson);
  }
  for (const id of expected) if (!lessons.has(id)) throw new Error(`Missing id: ${id}`);
  return lessons;
}

async function writeAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function run() {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  const pending = data.pages.filter((page) => !page.lesson);
  const workdir = await mkdtemp(join(tmpdir(), 'meditations-lessons-'));
  const schemaPath = join(workdir, 'schema.json');
  await writeFile(schemaPath, JSON.stringify({ type: 'object', required: ['lessons'], properties: { lessons: { type: 'array', items: { type: 'object', required: ['id', 'lesson'], properties: { id: { type: 'string' }, lesson: { type: 'string' } }, additionalProperties: false } } }, additionalProperties: false }));
  try {
    for (let index = 0; index < pending.length; index += BATCH_SIZE) {
      const batch = pending.slice(index, index + BATCH_SIZE);
      const outputPath = join(workdir, `batch-${index}.json`);
      const child = spawnSync('codex', ['exec', '-m', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="medium"', '--skip-git-repo-check', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], { input: buildLessonPrompt(batch), encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] });
      if (child.status !== 0) throw new Error(`Codex failed for batch ${index / BATCH_SIZE + 1}`);
      const lessons = validateLessonBatch(JSON.parse(await readFile(outputPath, 'utf8')).lessons, batch);
      for (const page of data.pages) if (lessons.has(page.id)) page.lesson = lessons.get(page.id);
      await writeAtomic(DATA_PATH, data);
    }
  } finally { await rm(workdir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
