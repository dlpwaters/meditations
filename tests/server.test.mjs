import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { createServer, startServer } from '../server.mjs';

const ROOT = resolve('.');
const SECRET_KEY = 'sk-never-return-this-value';

async function withServer(configService, run) {
  const server = createServer({ root: ROOT, port: 0, configService });
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
}

test('serves the reader shell and generated pages', async () => {
  const server = createServer({ root: ROOT, port: 0 });
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  const { port } = server.address();

  try {
    const html = await fetch(`http://127.0.0.1:${port}/index.html`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);

    const pages = await fetch(`http://127.0.0.1:${port}/data/meditations.pages.json`);
    assert.equal(pages.status, 200);
    assert.match(pages.headers.get('content-type'), /application\/json/);

    const illustration = await fetch(`http://127.0.0.1:${port}/assets/illustrations/book-01-section-01.png`);
    assert.equal(illustration.status, 200);
    assert.match(illustration.headers.get('content-type'), /image\/png/);

    const missing = await fetch(`http://127.0.0.1:${port}/missing.txt`);
    assert.equal(missing.status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
});

test('reports whether local setup is configured without caching personal state', async () => {
  await withServer({ hasOpenAIKey: async () => true }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/setup-status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { configured: true });
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  await withServer({ hasOpenAIKey: async () => false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/setup-status`);
    assert.deepEqual(await response.json(), { configured: false });
  });
});

test('returns a safe non-cacheable API error when setup status lookup fails', async () => {
  await withServer({ hasOpenAIKey: async () => { throw new Error('local configuration read failed'); } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/setup-status`);
    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'setup_status_unavailable' });
  });
});

test('accepts a validated setup key, persists it afterward, and never returns it', async () => {
  const calls = [];
  await withServer({
    validateOpenAIKey: async ({ key }) => {
      calls.push(['validate', key]);
      return { validated: true };
    },
    persistOpenAIKey: async ({ key }) => {
      calls.push(['persist', key]);
      return { configured: true };
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/setup-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: SECRET_KEY }),
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(body), { configured: true });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.includes(SECRET_KEY), false);
  });
  assert.deepEqual(calls, [['validate', SECRET_KEY], ['persist', SECRET_KEY]]);
});

test('rejects malformed setup requests without exposing submitted keys', async () => {
  await withServer({ validateOpenAIKey: async () => ({ validated: false }) }, async (baseUrl) => {
    const cases = [
      { body: '{', status: 400, code: 'invalid_json' },
      { body: JSON.stringify({ wrong: SECRET_KEY }), status: 400, code: 'invalid_request' },
      { body: JSON.stringify({ key: SECRET_KEY }), origin: 'http://example.test', status: 403, code: 'invalid_origin' },
      { body: JSON.stringify({ key: SECRET_KEY }), status: 401, code: 'invalid_key' },
      { body: JSON.stringify({ key: 'x'.repeat(10_000) }), status: 413, code: 'request_too_large' },
    ];
    for (const entry of cases) {
      const response = await fetch(`${baseUrl}/api/setup-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(entry.origin ? { Origin: entry.origin } : {}) },
        body: entry.body,
      });
      const body = await response.text();
      assert.equal(response.status, entry.status);
      assert.deepEqual(JSON.parse(body), { error: entry.code });
      assert.equal(body.includes(SECRET_KEY), false);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });
});

test('rejects unsupported API methods with the route allowlist', async () => {
  await withServer({ hasOpenAIKey: async () => false }, async (baseUrl) => {
    const status = await fetch(`${baseUrl}/api/setup-status`, { method: 'POST' });
    assert.equal(status.status, 405);
    assert.equal(status.headers.get('allow'), 'GET');

    const setup = await fetch(`${baseUrl}/api/setup-key`);
    assert.equal(setup.status, 405);
    assert.equal(setup.headers.get('allow'), 'POST');
  });
});

test('Ask Marcus requires a configured key and never exposes configuration detail', async () => {
  await withServer({ loadOpenAIKey: async () => undefined }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ask-marcus`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'What can I do today?' }),
    });
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { code: 'key_required' });
  });
});

test('Ask Marcus returns only trusted guidance and maps safe request failures', async () => {
  const guidance = {
    safetyBanner: 'Trusted safety guidance.', message: 'A trusted answer.',
    sections: [{ id: 'book-01-section-01', label: 'Book 1, Section 1', lesson: 'Begin', reason: 'A trusted reason.' }],
  };
  const seen = [];
  await withServer({
    loadOpenAIKey: async () => SECRET_KEY,
    createOpenAIClient: ({ apiKey }) => ({ apiKey }),
    loadAskCorpus: async () => [{ id: 'book-01-section-01' }],
    loadRetrievalIndex: async () => ({ entries: [] }),
    createAskMarcusService: ({ client, pages, index }) => ({ ask: async ({ input }) => { seen.push({ client, pages, index, input }); return guidance; } }),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ask-marcus`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'What can I do today?' }),
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(body), guidance);
    assert.equal(body.includes(SECRET_KEY), false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  assert.deepEqual(seen.map(({ input, pages, index }) => ({ input, pages, index })), [{ input: 'What can I do today?', pages: [{ id: 'book-01-section-01' }], index: { entries: [] } }]);

  await withServer({ loadOpenAIKey: async () => SECRET_KEY, createOpenAIClient: () => ({}), loadAskCorpus: async () => [], loadRetrievalIndex: async () => ({}), createAskMarcusService: () => ({ ask: async () => { throw Object.assign(new Error('upstream detail'), { code: 'rate_limited' }); } }) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ask-marcus`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'Please help.' }) });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { code: 'rate_limited' });
  });
});

test('Ask Marcus preserves API method, origin, JSON size, and input protections', async () => {
  const services = { loadOpenAIKey: async () => SECRET_KEY, createOpenAIClient: () => ({}), loadAskCorpus: async () => [], loadRetrievalIndex: async () => ({}), createAskMarcusService: () => ({ ask: async ({ input }) => { if (typeof input !== 'string' || !input.trim() || input.length > 4000) throw Object.assign(new Error('invalid'), { code: 'invalid_input' }); return {}; } }) };
  await withServer(services, async (baseUrl) => {
    const cases = [
      { options: {}, status: 405, body: { error: 'method_not_allowed' } },
      { options: { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://example.test' }, body: JSON.stringify({ input: 'Question' }) }, status: 403, body: { error: 'invalid_origin' } },
      { options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }, status: 400, body: { error: 'invalid_json' } },
      { options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: '' }) }, status: 400, body: { code: 'invalid_input' } },
      { options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'x'.repeat(4001) }) }, status: 400, body: { code: 'invalid_input' } },
      { options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'x'.repeat(10_000) }) }, status: 413, body: { error: 'request_too_large' } },
    ];
    for (const entry of cases) {
      const response = await fetch(`${baseUrl}/api/ask-marcus`, entry.options);
      assert.equal(response.status, entry.status);
      assert.deepEqual(await response.json(), entry.body);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });
});

test('denies dotfiles while preserving static reader content', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/.env.example`);
    assert.equal(response.status, 403);
  });
});

test('starts the executable server on the loopback host', () => {
  const calls = [];
  const server = { listen: (...args) => calls.push(args) };
  startServer(server, 9876);
  assert.deepEqual(calls, [[9876, '127.0.0.1']]);
});
