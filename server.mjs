import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { hasOpenAIKey, loadOpenAIKey, persistOpenAIKey, validateOpenAIKey } from './src/server/config.mjs';
import { createAskMarcusService } from './src/server/ask-marcus.mjs';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

const MAX_JSON_BODY_BYTES = 8 * 1024;

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request, limit = MAX_JSON_BODY_BYTES) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        request.resume();
        rejectBody(Object.assign(new Error('Request body too large'), { code: 'request_too_large' }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        rejectBody(Object.assign(new Error('Invalid JSON'), { code: 'invalid_json' }));
      }
    });
    request.on('error', rejectBody);
  });
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === `http://${request.headers.host}`;
}

function isDotPath(requestPath) {
  return requestPath.split('/').some((segment) => segment.startsWith('.'));
}

async function routeApi(request, response, configService) {
  const requestPath = new URL(request.url, 'http://localhost').pathname;
  if (requestPath === '/api/setup-status') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
      return true;
    }
    try {
      const configured = await configService.hasOpenAIKey();
      sendJson(response, 200, { configured: Boolean(configured) });
    } catch {
      sendJson(response, 500, { error: 'setup_status_unavailable' });
    }
    return true;
  }
  if (requestPath === '/api/setup-key') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      return true;
    }
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { error: 'invalid_origin' });
      return true;
    }
    try {
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.key !== 'string') {
        sendJson(response, 400, { error: 'invalid_request' });
        return true;
      }
      const validation = await configService.validateOpenAIKey({ key: body.key });
      if (!validation?.validated) {
        sendJson(response, 401, { error: 'invalid_key' });
        return true;
      }
      await configService.persistOpenAIKey({ key: body.key });
      sendJson(response, 200, { configured: true });
    } catch (error) {
      const code = error?.code === 'invalid_json' || error?.code === 'request_too_large'
        ? error.code
        : 'setup_failed';
      sendJson(response, code === 'request_too_large' ? 413 : 400, { error: code });
    }
    return true;
  }
  if (requestPath === '/api/ask-marcus') {
    if (request.method !== 'POST') { sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'POST' }); return true; }
    if (!isSameOrigin(request)) { sendJson(response, 403, { error: 'invalid_origin' }); return true; }
    try {
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.input !== 'string') { sendJson(response, 400, { error: 'invalid_request' }); return true; }
      const key = await configService.loadOpenAIKey();
      if (!key) { sendJson(response, 409, { code: 'key_required' }); return true; }
      const [pages, index] = await Promise.all([configService.loadAskCorpus(), configService.loadRetrievalIndex()]);
      const client = configService.createOpenAIClient({ apiKey: key });
      sendJson(response, 200, await configService.createAskMarcusService({ client, pages, index }).ask({ input: body.input }));
    } catch (error) {
      const code = error?.code;
      if (code === 'invalid_json' || code === 'request_too_large') sendJson(response, code === 'request_too_large' ? 413 : 400, { error: code });
      else if (code === 'invalid_input') sendJson(response, 400, { code });
      else if (code === 'key_required' || code === 'invalid_key') sendJson(response, 409, { code: 'key_required' });
      else if (code === 'rate_limited') sendJson(response, 429, { code });
      else if (code === 'invalid_model_output') sendJson(response, 502, { code: 'invalid_response' });
      else sendJson(response, 503, { code: 'service_unavailable' });
    }
    return true;
  }
  if (requestPath.startsWith('/api/')) {
    sendJson(response, 404, { error: 'not_found' });
    return true;
  }
  return false;
}

export function createServer({ root, port = 4173, configService } = {}) {
  const projectRoot = resolve(root ?? fileURLToPath(new URL('.', import.meta.url)));
  const services = {
    hasOpenAIKey: () => hasOpenAIKey({ projectRoot, env: process.env }),
    validateOpenAIKey,
    persistOpenAIKey: ({ key }) => persistOpenAIKey({ projectRoot, key }),
    loadOpenAIKey: () => loadOpenAIKey({ projectRoot, env: process.env }),
    createOpenAIClient: ({ apiKey }) => new OpenAI({ apiKey }),
    loadAskCorpus: async () => JSON.parse(await readFile(resolve(projectRoot, 'data/meditations.pages.json'), 'utf8')).pages,
    loadRetrievalIndex: async () => JSON.parse(await readFile(resolve(projectRoot, 'data/meditations.retrieval.json'), 'utf8')),
    createAskMarcusService,
    ...configService,
  };
  const server = createHttpServer(async (request, response) => {
    try {
      if (await routeApi(request, response, services)) return;
      const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (isDotPath(requestPath)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const relativePath = requestPath === '/' ? '/index.html' : normalize(requestPath);
      const filePath = resolve(projectRoot, `.${relativePath}`);
      if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}/`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) throw new Error('Not a file');
      const contentType = CONTENT_TYPES[extname(filePath)];
      if (!contentType) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': contentType });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  server.on('listening', () => {
    if (process.env.MEDITATIONS_QUIET !== '1') {
      const address = server.address();
      console.log(`Meditations reader listening at http://127.0.0.1:${address.port}`);
    }
  });
  server.port = port;
  return server;
}

export function startServer(server, port) {
  return server.listen(port, '127.0.0.1');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  startServer(createServer({ port }), port);
}
