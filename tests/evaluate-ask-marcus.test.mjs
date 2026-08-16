import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertEvaluationQuality,
  createUsageCapturingClient,
  evaluateCases,
  formatAggregateSummary,
  runEvaluationMain,
  validateEvaluationFixture,
} from '../scripts/evaluate-ask-marcus.mjs';

const cases = [
  { id: 'grief', question: 'Synthetic grief question.', acceptableBooks: [2], acceptableThemes: ['acceptance'] },
  { id: 'anger', question: 'Synthetic anger question.', acceptableBooks: [6], acceptableThemes: ['patience'] },
];
const fixture = { cases };
const pages = Array.from({ length: 20 }, (_, index) => ({
  id: `book-${String(index < 10 ? 2 : 6).padStart(2, '0')}-section-${String(index + 1).padStart(2, '0')}`,
  book: index < 10 ? 2 : 6,
  label: `Section ${index + 1}`,
  lesson: index < 10 ? 'Acceptance in action' : 'Patience in action',
}));
const message = 'You can begin with one honest action today, then return your attention to what is within reach. Let the next choice be clear and modest rather than dramatic. Notice the feeling without making it a command. Speak carefully, act fairly, and allow time to do its work. This does not erase difficulty, but it gives you a practical way to meet it with steadiness and care.';
const responseFor = (selectedPages) => ({ message, sections: selectedPages.map(({ id }) => ({ id, reason: 'A brief synthetic reason.' })) });
const griefResponse = responseFor(pages.slice(0, 10));
const angerResponse = responseFor(pages.slice(10, 20));

test('fixture validation rejects duplicated or incomplete synthetic evaluation coverage', () => {
  assert.throws(() => validateEvaluationFixture({ cases: [cases[0], cases[0]] }), /exactly ten unique synthetic cases/);
  assert.throws(() => validateEvaluationFixture({ cases: Array.from({ length: 10 }, (_, index) => ({ ...cases[0], id: `case-${index}` })) }), /cover grief, conflict/);
});

test('evaluation accepts case-specific selections with multiple matching themes', async () => {
  let call = 0;
  const result = await evaluateCases({ fixture, pages, ask: async () => [griefResponse, angerResponse][call++], now: (() => { let time = 0; return () => (time += 25); })() });
  assert.equal(result.relevantCases, 2);
  assert.equal(result.caseScores[0].themeMatches, 10);
  assert.equal(result.automatedStyleCases, 2);
  assert.doesNotThrow(() => assertEvaluationQuality(result));
});

test('evaluation counts inflected theme evidence from trusted original and familiar readings', async () => {
  const fullTextPages = pages.map((page, index) => ({
    ...page,
    lesson: 'General reflection',
    text: index < 3 ? 'The losses can be met without adding another judgment.' : 'A general passage.',
    modernVersion: index < 3 ? 'You can keep accepting what cannot be changed.' : 'A general familiar reading.',
  }));
  const result = await evaluateCases({ fixture: { cases: [cases[0]] }, pages: fullTextPages, ask: async () => responseFor(fullTextPages.slice(0, 10)) });
  assert.equal(result.caseScores[0].themeMatches, 3);
  assert.equal(result.relevantCases, 1);
});

test('a fixed generic ten-section selection cannot pass quality gates', async () => {
  const genericPages = pages.map((page) => ({ ...page, lesson: 'General reflection' }));
  const genericResponse = responseFor(genericPages.slice(0, 10));
  const result = await evaluateCases({ fixture, pages: genericPages, ask: async () => genericResponse });
  assert.equal(result.relevantCases, 0);
  assert.equal(result.duplicateSelections, 1);
  assert.throws(() => assertEvaluationQuality(result), /Quality threshold/);
});

test('evaluation rejects invalid paragraph and section contracts', async () => {
  const invalidResponses = [
    { ...griefResponse, message: 'too short' },
    { ...griefResponse, message: `${message}\n\nAnother paragraph.` },
    { ...griefResponse, sections: griefResponse.sections.slice(0, 9) },
    { ...griefResponse, sections: [...griefResponse.sections.slice(0, 9), griefResponse.sections[0]] },
    { ...griefResponse, sections: [{ ...griefResponse.sections[0], reason: ' ' }, ...griefResponse.sections.slice(1)] },
    { ...griefResponse, sections: [{ ...griefResponse.sections[0], reason: 'word '.repeat(61) }, ...griefResponse.sections.slice(1)] },
  ];
  for (const response of invalidResponses) {
    await assert.rejects(() => evaluateCases({ fixture: { cases: [cases[0]] }, pages, ask: async () => response }), /invalid|exactly ten|unique/);
  }
});

test('automated style screen rejects archaic, theatrical, and meta guidance', async () => {
  for (const invalidMessage of [message.replace('You can', 'Thou canst'), message.replace('You can', 'O mortal, you can'), message.replace('You can', 'As Marcus Aurelius, I say you can')]) {
    const result = await evaluateCases({ fixture: { cases: [cases[0]] }, pages, ask: async () => ({ ...griefResponse, message: invalidMessage }) });
    assert.equal(result.automatedStyleCases, 0);
  }
});

test('automated style accepts practical collective guidance and rejects modern abstract guidance', async () => {
  const collectivePractical = 'We can begin with one fair task and notice where attention has wandered. Our next step is to speak plainly, return to the work at hand, and act without adding drama. Let us focus on what can be chosen now, then ask what serves the people involved. This is a modest practice, but it gives the day a direction and keeps judgment from becoming a performance. We do not need a grand theory before taking that next useful step together.';
  const modernAbstract = 'We are part of a wider pattern in which meaning, identity, and experience remain connected across changing circumstances. Our shared condition contains many perspectives, and each perspective belongs to an ongoing whole. This reflection is held quietly as an idea about the relation between inner life, time, and the world, without requiring any immediate conclusion or concrete response. The pattern remains broad, continuous, and open to further interpretation from every point within it.';
  const practicalResult = await evaluateCases({ fixture: { cases: [cases[0]] }, pages, ask: async () => ({ ...griefResponse, message: collectivePractical }) });
  assert.equal(practicalResult.automatedStyleCases, 1);
  assert.doesNotThrow(() => assertEvaluationQuality(practicalResult));
  const abstractResult = await evaluateCases({ fixture: { cases: [cases[0]] }, pages, ask: async () => ({ ...griefResponse, message: modernAbstract }) });
  assert.equal(abstractResult.automatedStyleCases, 0);
  assert.throws(() => assertEvaluationQuality(abstractResult), /Quality threshold/);
});

test('quality gate requires the automated style screen to pass at the case rate', async () => {
  const result = await evaluateCases({ fixture: { cases: [cases[0]] }, pages, ask: async () => ({ ...griefResponse, message: message.replace('You can', 'Thou canst') }) });
  assert.equal(result.relevantCases, 1);
  assert.equal(result.automatedStyleCases, 0);
  assert.throws(() => assertEvaluationQuality(result), /Quality threshold/);
});

test('usage capture sums numeric provider metadata and formatter omits model prose', async () => {
  const captured = { inputTokens: 0, outputTokens: 0, totalTokens: 0, available: false };
  const client = createUsageCapturingClient({
    responses: { create: async () => ({ output_text: '{"safe":true}', usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } }) },
    embeddings: {}, moderations: {},
  }, captured);
  await client.responses.create({});
  assert.deepEqual(captured, { inputTokens: 12, outputTokens: 8, totalTokens: 20, available: true });
  const output = formatAggregateSummary({ totalCases: 1, validCases: 1, relevantCases: 1, automatedStyleCases: 1, duplicateSelections: 0, averageLatencyMs: 2, usage: captured, caseSections: [{ id: 'grief', sectionIds: ['book-02-section-01'] }], modelProse: 'must not appear' });
  assert.match(output, /Usage: inputTokens=12 outputTokens=8 totalTokens=20/);
  assert.equal(output.includes('must not appear'), false);
});

test('quality-insufficient main output prints only the safe aggregate before failing', async () => {
  const aggregate = { totalCases: 1, validCases: 1, relevantCases: 0, automatedStyleCases: 1, duplicateSelections: 0, averageLatencyMs: 2, usage: 'unavailable', caseSections: [{ id: 'grief', sectionIds: ['book-02-section-01'] }] };
  const qualityError = Object.assign(new Error('quality'), { code: 'quality_insufficient', result: aggregate });
  const output = [];
  const exitCode = await runEvaluationMain({ run: async () => { throw qualityError; }, log: (value) => output.push(value), error: (value) => output.push(value) });
  assert.equal(exitCode, 1);
  assert.match(output[0], /Quality: valid=1\/1 relevant=0\/1/);
  assert.match(output[0], /grief: book-02-section-01/);
  assert.equal(output[0].includes('quality'), false);
  assert.equal(output[1], 'Evaluation failed: quality_insufficient');
});
