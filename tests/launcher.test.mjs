import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

test('launcher is executable and supports headless use', async () => {
  await access('bin/meditations', constants.X_OK);
  const launcher = await readFile('bin/meditations', 'utf8');
  assert.match(launcher, /readlink -f/);
  assert.match(launcher, /--no-open/);
  assert.match(launcher, /server\.mjs/);
});
