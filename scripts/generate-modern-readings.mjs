import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA_PATH = resolve(ROOT, 'data/meditations.pages.json');
const BATCH_SIZE = 10;

export function buildBatchPrompt(pages) {
  return `Return JSON only as {"readings":[...]}. Adapt each Marcus Aurelius passage into a faithful familiar-language reading. Do not explain, summarize, preach, mention technology, or quote the source. Keep its emotional force and approximate length. Use ordinary contemporary human situations only when they clarify the same lesson. Output one object per exact input ID: {"id":"...","modernVersion":"..."}.\n\n${JSON.stringify(pages.map(({ id, text }) => ({ id, text })))} `;
}

export function validateModernBatch(result, pages) {
  if (!Array.isArray(result)) throw new Error('Generation response must be an array');
  const expected = new Set(pages.map(({ id }) => id));
  const readings = new Map();
  for (const item of result) {
    if (!expected.has(item?.id)) throw new Error(`Unexpected id: ${item?.id}`);
    if (readings.has(item.id)) throw new Error(`Duplicate id: ${item.id}`);
    if (typeof item.modernVersion !== 'string' || !item.modernVersion.trim()) throw new Error(`Empty reading: ${item.id}`);
    readings.set(item.id, item.modernVersion.trim());
  }
  for (const id of expected) if (!readings.has(id)) throw new Error(`Missing id: ${id}`);
  return readings;
}

async function writeAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function run() {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  const pending = data.pages.filter((page) => !page.modernVersion);
  const workdir = await mkdtemp(join(tmpdir(), 'meditations-modern-'));
  const schemaPath = join(workdir, 'schema.json');
  await writeFile(schemaPath, JSON.stringify({ type: 'object', required: ['readings'], properties: { readings: { type: 'array', items: { type: 'object', required: ['id', 'modernVersion'], properties: { id: { type: 'string' }, modernVersion: { type: 'string' } }, additionalProperties: false } } }, additionalProperties: false }));
  try {
    for (let index = 0; index < pending.length; index += BATCH_SIZE) {
      const batch = pending.slice(index, index + BATCH_SIZE);
      const outputPath = join(workdir, `batch-${index}.json`);
      const child = spawnSync('codex', ['exec', '-m', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="medium"', '--skip-git-repo-check', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], { input: buildBatchPrompt(batch), encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] });
      if (child.status !== 0) throw new Error(`Codex failed for batch ${index / BATCH_SIZE + 1}`);
      const readings = validateModernBatch(JSON.parse(await readFile(outputPath, 'utf8')).readings, batch);
      for (const page of data.pages) if (readings.has(page.id)) page.modernVersion = readings.get(page.id);
      await writeAtomic(DATA_PATH, data);
    }
  } finally { await rm(workdir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
