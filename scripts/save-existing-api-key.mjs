import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

import { persistOpenAIKey } from '../src/server/config.mjs';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY must be set before running setup:key');
}

const projectRoot = resolve(import.meta.dirname, '..');
await persistOpenAIKey({ projectRoot, key: process.env.OPENAI_API_KEY });
await chmod(resolve(projectRoot, '.env.local'), 0o600);
console.log('Saved .env.local with owner-only (0600) permissions.');
