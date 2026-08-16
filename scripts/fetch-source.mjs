import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_URL = 'https://www.gutenberg.org/files/2680/2680-0.txt';
export const SOURCE_PATH = resolve(PROJECT_ROOT, 'data/source/meditations-long.txt');

export async function fetchSource() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Source download failed: ${response.status} ${response.statusText}`);
  }

  await mkdir(dirname(SOURCE_PATH), { recursive: true });
  await writeFile(SOURCE_PATH, await response.text(), 'utf8');
  return SOURCE_PATH;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchSource()
    .then((path) => console.log(`Downloaded source to ${path}`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
