import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';

import {
  hasOpenAIKey,
  loadOpenAIKey,
  persistOpenAIKey,
  validateOpenAIKey,
} from '../src/server/config.mjs';

async function createProjectRoot() {
  return mkdtemp(join(tmpdir(), 'meditations-config-'));
}

test('prefers the environment key over the local configuration', async () => {
  const root = await createProjectRoot();
  await writeFile(join(root, '.env.local'), 'OPENAI_API_KEY=local-key\n');

  assert.equal(
    await loadOpenAIKey({ projectRoot: root, env: { OPENAI_API_KEY: 'environment-key' } }),
    'environment-key',
  );
});

test('reports absent configuration without exposing a key', async () => {
  const root = await createProjectRoot();

  assert.equal(await loadOpenAIKey({ projectRoot: root, env: {} }), undefined);
  assert.equal(await hasOpenAIKey({ projectRoot: root, env: {} }), false);
});

test('persists the key with owner-only permissions without returning it', async () => {
  const root = await createProjectRoot();
  const result = await persistOpenAIKey({ projectRoot: root, key: 'sk-test-secret' });

  assert.deepEqual(result, { configured: true });
  assert.equal((await stat(join(root, '.env.local'))).mode & 0o777, 0o600);
  assert.equal(await loadOpenAIKey({ projectRoot: root, env: {} }), 'sk-test-secret');
});

test('creates local configuration atomically without leaving a temporary key file', async () => {
  const root = await createProjectRoot();

  await persistOpenAIKey({ projectRoot: root, key: 'sk-test-secret' });

  assert.deepEqual(await readdir(root), ['.env.local']);
  assert.equal(await readFile(join(root, '.env.local'), 'utf8'), 'OPENAI_API_KEY=sk-test-secret\n');
});

test('replaces existing key entries without duplicate OPENAI_API_KEY variables', async () => {
  const root = await createProjectRoot();
  await writeFile(
    join(root, '.env.local'),
    'OTHER_SETTING=kept\nOPENAI_API_KEY=old-key\nOPENAI_API_KEY=older-key\n',
  );

  await persistOpenAIKey({ projectRoot: root, key: 'sk-test-secret' });

  assert.equal(
    await readFile(join(root, '.env.local'), 'utf8'),
    'OTHER_SETTING=kept\nOPENAI_API_KEY=sk-test-secret\n',
  );
});

test('rejects an empty key before creating local configuration', async () => {
  const root = await createProjectRoot();

  await assert.rejects(
    persistOpenAIKey({ projectRoot: root, key: '   ' }),
    /OPENAI_API_KEY must not be empty/,
  );
  assert.deepEqual(await readdir(root), []);
});

test('validates the configured model through the injected SDK without returning key material', async () => {
  class SuccessfulOpenAI {
    models = {
      retrieve: async (model) => {
        assert.equal(model, 'gpt-5.6-luna');
        return { id: model };
      },
    };
  }

  const result = await validateOpenAIKey({ key: 'sk-test-secret', OpenAIClass: SuccessfulOpenAI });

  assert.deepEqual(result, { validated: true });
  assert.equal(JSON.stringify(result).includes('sk-test-secret'), false);
});

test('returns a safe invalid status when model validation fails', async () => {
  class FailingOpenAI {
    models = {
      retrieve: async () => {
        throw new Error('remote failure');
      },
    };
  }

  const result = await validateOpenAIKey({ key: 'sk-test-secret', OpenAIClass: FailingOpenAI });

  assert.deepEqual(result, { validated: false });
  assert.equal(JSON.stringify(result).includes('sk-test-secret'), false);
});
