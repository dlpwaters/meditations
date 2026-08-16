import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MARCUS_RESPONSE_SCHEMA,
  buildCandidateInput,
  createAskMarcusService,
  enrichMarcusResponse,
  validateMarcusResponse,
} from '../src/server/ask-marcus.mjs';

const pages = Array.from({ length: 32 }, (_, index) => ({
  id: `book-01-section-${String(index + 1).padStart(2, '0')}`,
  label: `Book 1, Section ${index + 1}`,
  lesson: `Lesson ${index + 1}`,
  text: `Trusted original passage ${index + 1}.`,
  modernVersion: `Trusted familiar passage ${index + 1}.`,
}));
const index = { entries: pages.map((page, position) => ({ id: page.id, vector: [position + 1, 1] })) };
const selections = pages.slice(0, 10).map((page, position) => ({
  id: page.id,
  reason: `This passage gives a practical perspective on concern ${position + 1}.`,
}));
const validOutput = () => JSON.stringify({
  message: 'When the mind is crowded, begin with the next honest action instead of trying to settle your whole future at once. Notice what is yours to choose today: the care you give, the words you use, and the attention you bring to the task in front of you. Let the rest wait its turn. This is not denial; it is a steadier way to meet uncertainty without lending it more power than it has.',
  sections: selections,
});

function clientWith({ outputs = [validOutput()], moderation = { results: [{ flagged: false, categories: {} }] }, error } = {}) {
  const calls = { embeddings: [], moderations: [], responses: [], order: [] };
  return {
    calls,
    client: {
      embeddings: { create: async (request) => { calls.order.push('embedding'); calls.embeddings.push(request); if (error) throw error; return { data: [{ embedding: [1, 1] }] }; } },
      moderations: { create: async (request) => { calls.order.push('moderation'); calls.moderations.push(request); return moderation; } },
      responses: { create: async (request) => { calls.order.push('response'); calls.responses.push(request); if (error) throw error; return { output_text: outputs.shift() }; } },
    },
  };
}

test('normalizes input and rejects text over 4,000 characters', async () => {
  const { client, calls } = clientWith();
  const service = createAskMarcusService({ client, pages, index });
  await service.ask({ input: '  I\r\nam worried.  ' });
  assert.equal(calls.moderations[0].input, 'I\nam worried.');
  await assert.rejects(() => service.ask({ input: `x${'y'.repeat(4000)}` }), { code: 'invalid_input' });
});

test('uses the binding embedding and response contracts with 32 local candidates', async () => {
  const { client, calls } = clientWith();
  const result = await createAskMarcusService({ client, pages, index }).ask({ input: 'I am anxious about work.' });
  assert.equal(calls.embeddings[0].model, 'text-embedding-3-small');
  assert.equal(calls.moderations[0].model, 'omni-moderation-latest');
  assert.equal(calls.responses[0].model, 'gpt-5.6-luna');
  assert.deepEqual(calls.responses[0].reasoning, { effort: 'low' });
  assert.equal(calls.responses[0].store, false);
  assert.equal(JSON.parse(calls.responses[0].input.at(-1).content).candidates.length, 32);
  assert.equal(result.sections.length, 10);
});

test('builds the request schema with only supported structural constraints', async () => {
  const { client, calls } = clientWith();
  await createAskMarcusService({ client, pages, index }).ask({ input: 'I am anxious about work.' });
  const schema = calls.responses[0].text.format.schema;
  assert.notEqual(schema, MARCUS_RESPONSE_SCHEMA);
  assert.deepEqual(schema.required, ['message', 'sections']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.sections.minItems, 10);
  assert.equal(schema.properties.sections.maxItems, 10);
  assert.equal(schema.properties.sections.items.additionalProperties, false);
  assert.deepEqual(schema.properties.sections.items.required, ['id', 'reason']);
  assert.deepEqual(schema.properties.sections.items.properties.id.enum, pages.map(({ id }) => id));
  assert.equal('minLength' in schema.properties.message, false);
  assert.equal('maxLength' in schema.properties.message, false);
  assert.equal('minLength' in schema.properties.sections.items.properties.reason, false);
  assert.equal('maxLength' in schema.properties.sections.items.properties.reason, false);
  assert.equal('uniqueItems' in schema.properties.sections, false);
});

test('validation requires one 60-180 word paragraph and ten unique allowed IDs with short reasons', () => {
  assert.throws(() => validateMarcusResponse({ message: 'Too short.', sections: selections }, new Set(pages.map(({ id }) => id))), /60 to 180 words/);
  assert.throws(() => validateMarcusResponse({ message: validOutput() && JSON.parse(validOutput()).message, sections: [...selections.slice(0, 9), selections[0]] }, new Set(pages.map(({ id }) => id))), /unique/);
  assert.throws(() => validateMarcusResponse({ message: JSON.parse(validOutput()).message, sections: selections.map((section, index) => index === 0 ? { ...section, id: 'invented-id' } : section) }, new Set(pages.map(({ id }) => id))), /candidate/);
  assert.throws(() => validateMarcusResponse({ message: JSON.parse(validOutput()).message, sections: selections.map((section, index) => index === 0 ? { ...section, reason: 'word '.repeat(61) } : section) }, new Set(pages.map(({ id }) => id))), /60 words/);
});

test('enrichment discards model corpus fields in favor of trusted local pages', () => {
  const enriched = enrichMarcusResponse({ message: JSON.parse(validOutput()).message, sections: [{ ...selections[0], label: 'Untrusted', lesson: 'Untrusted', text: 'Untrusted' }, ...selections.slice(1)] }, pages);
  assert.deepEqual(enriched.sections[0], { id: pages[0].id, label: pages[0].label, lesson: pages[0].lesson, text: pages[0].text, modernVersion: pages[0].modernVersion, reason: selections[0].reason });
  assert.equal(buildCandidateInput(pages).candidates[0].text, pages[0].text);
});

test('repairs malformed output once then rejects a second invalid response', async () => {
  const { client, calls } = clientWith({ outputs: ['not json', validOutput()] });
  const result = await createAskMarcusService({ client, pages, index }).ask({ input: 'Help me focus.' });
  assert.equal(result.sections.length, 10);
  assert.equal(calls.responses.length, 2);
  assert.match(calls.responses[1].input.at(-1).content, /Validation errors/);
  const failed = clientWith({ outputs: ['not json', 'still not json'] });
  await assert.rejects(() => createAskMarcusService({ client: failed.client, pages, index }).ask({ input: 'Help me focus.' }), { code: 'invalid_model_output' });
  assert.equal(failed.calls.responses.length, 2);
});

test('classifies missing keys and rate limits without leaking upstream details', async () => {
  await assert.rejects(() => createAskMarcusService({ pages, index }).ask({ input: 'Help.' }), { code: 'key_required' });
  const { client } = clientWith({ error: Object.assign(new Error('secret upstream detail'), { status: 429 }) });
  await assert.rejects(() => createAskMarcusService({ client, pages, index }).ask({ input: 'Help.' }), (error) => error.code === 'rate_limited' && !error.message.includes('secret'));
});

test('moderates before embeddings and responses, then returns a separate trusted safety banner for self-harm and violence', async () => {
  for (const categories of [{ 'self-harm': true, violence: false }, { 'self-harm': false, violence: true }]) {
    const { client, calls } = clientWith({ moderation: { results: [{ flagged: true, categories }] } });
    const result = await createAskMarcusService({ client, pages, index }).ask({ input: 'I may hurt someone.' });
    assert.deepEqual(calls.order, ['moderation', 'embedding', 'response']);
    assert.match(result.safetyBanner, /local emergency services/i);
    assert.match(result.safetyBanner, /US.*Canada.*988/i);
    assert.equal(typeof result.message, 'string');
    assert.ok(Array.isArray(result.sections));
  }
});

test('does not start generation before moderation resolves', async () => {
  let releaseModeration;
  const moderation = new Promise((resolve) => { releaseModeration = resolve; });
  const { client, calls } = clientWith({ moderation });
  const pending = createAskMarcusService({ client, pages, index }).ask({ input: 'I need help.' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.order, ['moderation']);
  releaseModeration({ results: [{ flagged: false, categories: {} }] });
  await pending;
  assert.deepEqual(calls.order, ['moderation', 'embedding', 'response']);
});
