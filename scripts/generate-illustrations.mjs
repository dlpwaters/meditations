import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA_PATH = resolve(ROOT, 'data/meditations.pages.json');

export function buildIllustrationPrompt(page) {
  return `Use case: illustration-story\nAsset type: right page of a contemplative Meditations reader\nPrimary request: Create one quiet human-scale scene inspired by this familiar-language reading: ${page.modernVersion}\nStyle/medium: timeless pen-and-ink with transparent watercolor washes\nLighting/mood: natural quiet light, reflective, humane\nColor palette: warm sepia, umber, charcoal, parchment\nComposition/framing: vertical book-page illustration with generous breathing room and no border\nConstraints: no text, lettering, logos, watermarks, screens, devices, technology emphasis, ancient-Rome costume, visual cliches, or caricature.`;
}

export function markIllustrationComplete(data, id, imagePath, prompt) {
  const page = data.pages.find((entry) => entry.id === id);
  if (!page) throw new Error(`Unknown page: ${id}`);
  page.illustration = { status: 'complete', path: imagePath, prompt };
  return data;
}

export function isVerifiedIllustration(page, assetPaths) {
  const expectedPath = `/assets/illustrations/${page.id}.png`;
  return page.illustration?.status === 'complete'
    && page.illustration.path === expectedPath
    && typeof page.illustration.prompt === 'string'
    && page.illustration.prompt.trim().length > 0
    && assetPaths.has(expectedPath);
}

async function writeAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function linkIllustration(id, file) {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  const page = data.pages.find((entry) => entry.id === id);
  if (!page) throw new Error(`Unknown page: ${id}`);
  const expectedFile = resolve(ROOT, 'assets/illustrations', `${id}.png`);
  if (resolve(file) !== expectedFile) throw new Error(`Illustration must be saved as ${expectedFile}`);
  const fileStats = await stat(expectedFile);
  if (!fileStats.isFile() || fileStats.size === 0) throw new Error(`Illustration asset is missing or empty: ${expectedFile}`);
  markIllustrationComplete(data, id, `/assets/illustrations/${id}.png`, buildIllustrationPrompt(page));
  await writeAtomic(DATA_PATH, data);
}

async function writeBatch(path) {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  const jobs = data.pages
    .filter((page) => page.illustration?.status !== 'complete')
    .map((page) => JSON.stringify({
      prompt: buildIllustrationPrompt(page),
      use_case: 'illustration-story',
      size: '1024x1536',
      quality: 'low',
      model: 'gpt-image-2',
      out: `${page.id}.png`,
    }));
  await writeFile(path, `${jobs.join('\n')}\n`);
}

async function linkAllVerified() {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  let linked = 0;
  for (const page of data.pages) {
    const assetPath = resolve(ROOT, 'assets/illustrations', `${page.id}.png`);
    try {
      const fileStats = await stat(assetPath);
      if (page.illustration?.status !== 'complete' && fileStats.isFile() && fileStats.size > 0) {
        markIllustrationComplete(data, page.id, `/assets/illustrations/${page.id}.png`, buildIllustrationPrompt(page));
        linked += 1;
      }
    } catch {}
  }
  if (linked) await writeAtomic(DATA_PATH, data);
  console.log(`Linked ${linked} verified illustrations.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, file] = process.argv.slice(2);
  if (id === '--write-batch' && file) {
    writeBatch(file).catch((error) => { console.error(error.message); process.exitCode = 1; });
  } else if (id === '--link-all' && !file) {
    linkAllVerified().catch((error) => { console.error(error.message); process.exitCode = 1; });
  } else if (!id || !file) {
    console.error('Usage: node scripts/generate-illustrations.mjs <page-id> <asset-file>');
    process.exitCode = 1;
  } else {
    linkIllustration(id, file).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
