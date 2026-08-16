import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import OpenAI from 'openai';

const KEY_NAME = 'OPENAI_API_KEY';
const LOCAL_ENV_NAME = '.env.local';

function nonEmptyKey(key) {
  return typeof key === 'string' && key.trim() !== '' ? key : undefined;
}

function keyFromLocalEnvironment(contents) {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^OPENAI_API_KEY=(.*)$/);
    if (match) return nonEmptyKey(match[1]);
  }
  return undefined;
}

async function readLocalEnvironment(projectRoot) {
  try {
    return await readFile(join(projectRoot, LOCAL_ENV_NAME), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export async function loadOpenAIKey({ projectRoot, env }) {
  const environmentKey = nonEmptyKey(env?.OPENAI_API_KEY);
  if (environmentKey) return environmentKey;

  return keyFromLocalEnvironment(await readLocalEnvironment(projectRoot));
}

export async function hasOpenAIKey({ projectRoot, env }) {
  return Boolean(await loadOpenAIKey({ projectRoot, env }));
}

export async function persistOpenAIKey({ projectRoot, key }) {
  if (!nonEmptyKey(key) || /[\r\n]/.test(key)) {
    throw new Error('OPENAI_API_KEY must not be empty or contain line breaks');
  }

  const existing = await readLocalEnvironment(projectRoot);
  const retainedLines = existing
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith(`${KEY_NAME}=`));
  const destination = join(projectRoot, LOCAL_ENV_NAME);
  const temporary = join(projectRoot, `${LOCAL_ENV_NAME}.tmp-${randomUUID()}`);
  const contents = `${retainedLines.join('\n')}${retainedLines.length ? '\n' : ''}${KEY_NAME}=${key}\n`;

  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);

  return { configured: true };
}

export async function validateOpenAIKey({ key, OpenAIClass = OpenAI }) {
  if (!nonEmptyKey(key)) return { validated: false };

  try {
    const client = new OpenAIClass({ apiKey: key });
    await client.models.retrieve('gpt-5.6-luna');
    return { validated: true };
  } catch {
    return { validated: false };
  }
}
