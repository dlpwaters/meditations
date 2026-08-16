import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

import { createAskMarcusService } from '../src/server/ask-marcus.mjs';
import { loadOpenAIKey } from '../src/server/config.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REQUIRED_CASE_IDS = new Set(['grief', 'conflict', 'uncertainty', 'failure', 'anger', 'loneliness', 'responsibility', 'mortality', 'unfair-treatment', 'loss-of-direction']);
const MIN_RELEVANCE_RATE = 0.8;
const MIN_THEME_MATCHES = 3;
const MIN_SELECTION_DIVERSITY_RATE = 0.8;
const MIN_AUTOMATED_STYLE_RATE = 0.8;
const FORBIDDEN_STYLE_PATTERNS = /\b(?:thou|thee|thy|hast|canst|verily)\b|\b(?:oh|o)\s+(?:man|mortal)\b|\b(?:as|according to)\s+marcus(?:\s+aurelius)?\b|\bmarcus\s+aurelius\b|\broman\s+emperor\b/i;
const PERSPECTIVE_PATTERNS = /\b(?:you|your|we|our|us|one)\b/i;
const PRACTICAL_ACTION_PATTERNS = /\b(?:choose|begin|focus|notice|act|speak|return|ask|do|can)\b/i;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function assertValidResponse(response, trustedIds) {
  if (!response || typeof response !== 'object' || typeof response.message !== 'string') throw new TypeError('Response schema is invalid');
  if (/\n\s*\n/.test(response.message) || wordCount(response.message) < 60 || wordCount(response.message) > 180) throw new TypeError('Response message is invalid');
  if (!Array.isArray(response.sections) || response.sections.length !== 10) throw new TypeError('Response must contain exactly ten sections');
  const selected = new Set();
  for (const section of response.sections) {
    if (!section || typeof section.id !== 'string' || typeof section.reason !== 'string') throw new TypeError('Response section schema is invalid');
    if (!trustedIds.has(section.id)) throw new TypeError('Response contains an ID outside the trusted corpus');
    if (selected.has(section.id)) throw new TypeError('Response section IDs must be unique');
    if (!section.reason.trim() || wordCount(section.reason) > 60) throw new TypeError('Response section reason is invalid');
    selected.add(section.id);
  }
}

function rootToken(token) {
  const value = token.toLowerCase();
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`;
  if (value.endsWith('sses')) return value.slice(0, -2);
  if (value.endsWith('ance') || value.endsWith('ence')) return value.slice(0, -4);
  if (value.endsWith('ing')) return value.slice(0, -3);
  if (value.endsWith('ed')) return value.slice(0, -2);
  if (value.endsWith('es')) return value.slice(0, -2);
  if (value.endsWith('s') && !value.endsWith('ss')) return value.slice(0, -1);
  return value;
}

function rootsFor(value) {
  return new Set(String(value ?? '').toLowerCase().match(/[a-z0-9]+/g)?.map(rootToken));
}

function themeMatches(page, themes) {
  const trustedReading = [page.label, page.lesson, page.text, page.modernVersion].join(' ');
  const pageRoots = rootsFor(trustedReading);
  return themes.some((theme) => [...rootsFor(theme)].every((root) => pageRoots.has(root)));
}

function bookNumber(page) {
  return Number.isInteger(page.book) ? page.book : Number(/^book-(\d+)-section-\d+$/.exec(page.id)?.[1]);
}

function passesAutomatedStyleScreen(message) {
  return PERSPECTIVE_PATTERNS.test(message) && PRACTICAL_ACTION_PATTERNS.test(message) && !FORBIDDEN_STYLE_PATTERNS.test(message);
}

function usageSummary(capture) {
  return capture?.available ? capture : 'unavailable';
}

function addUsage(capture, usage) {
  if (!usage || typeof usage !== 'object') return;
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens;
  const totalTokens = usage.total_tokens;
  const values = [inputTokens, outputTokens, totalTokens];
  if (!values.some((value) => Number.isFinite(value) && value >= 0)) return;
  capture.available = true;
  if (Number.isFinite(inputTokens) && inputTokens >= 0) capture.inputTokens += inputTokens;
  if (Number.isFinite(outputTokens) && outputTokens >= 0) capture.outputTokens += outputTokens;
  if (Number.isFinite(totalTokens) && totalTokens >= 0) capture.totalTokens += totalTokens;
}

export function createUsageCapturingClient(client, capture) {
  return {
    ...client,
    responses: {
      ...client.responses,
      create: async (request) => {
        const response = await client.responses.create.call(client.responses, request);
        addUsage(capture, response?.usage);
        return response;
      },
    },
  };
}

export function validateEvaluationFixture(fixture) {
  if (!fixture || !Array.isArray(fixture.cases) || fixture.cases.length !== 10) throw new TypeError('Fixture must contain exactly ten unique synthetic cases');
  const ids = new Set();
  for (const entry of fixture.cases) {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || typeof entry.question !== 'string' || !entry.question.trim() || !Array.isArray(entry.acceptableBooks) || !entry.acceptableBooks.length || !Array.isArray(entry.acceptableThemes) || !entry.acceptableThemes.length) {
      throw new TypeError('Fixture must contain exactly ten unique synthetic cases');
    }
    ids.add(entry.id);
  }
  if (ids.size !== REQUIRED_CASE_IDS.size || [...REQUIRED_CASE_IDS].some((id) => !ids.has(id))) throw new TypeError('Fixture must cover grief, conflict, uncertainty, failure, anger, loneliness, responsibility, mortality, unfair treatment, and loss of direction');
  return fixture;
}

export async function evaluateCases({ fixture, pages, ask, now = () => performance.now() }) {
  if (!Array.isArray(fixture?.cases) || !Array.isArray(pages) || typeof ask !== 'function') throw new TypeError('Evaluation inputs are required');
  const trustedPages = new Map(pages.map((page) => [page.id, page]));
  if (trustedPages.size !== pages.length) throw new TypeError('Corpus IDs must be unique');
  const caseSections = [];
  const caseScores = [];
  let totalLatencyMs = 0;
  let relevantCases = 0;
  let automatedStyleCases = 0;
  const selectionSignatures = new Set();
  let duplicateSelections = 0;
  for (const entry of fixture.cases) {
    const started = now();
    const response = await ask({ input: entry.question });
    totalLatencyMs += Math.max(0, now() - started);
    assertValidResponse(response, trustedPages);
    const selectedPages = response.sections.map(({ id }) => trustedPages.get(id));
    const themeMatchCount = selectedPages.filter((page) => themeMatches(page, entry.acceptableThemes)).length;
    const cappedBookMatches = Math.min(2, selectedPages.filter((page) => entry.acceptableBooks.includes(bookNumber(page))).length);
    const relevant = themeMatchCount >= MIN_THEME_MATCHES;
    if (relevant) relevantCases += 1;
    if (passesAutomatedStyleScreen(response.message)) automatedStyleCases += 1;
    const signature = response.sections.map(({ id }) => id).sort().join(',');
    if (selectionSignatures.has(signature)) duplicateSelections += 1;
    selectionSignatures.add(signature);
    const caseScore = { id: entry.id, themeMatches: themeMatchCount, cappedBookMatches, relevant };
    caseSections.push({ id: entry.id, sectionIds: response.sections.map(({ id }) => id) });
    caseScores.push(caseScore);
  }
  const totalCases = fixture.cases.length;
  return {
    totalCases,
    validCases: totalCases,
    relevantCases,
    relevanceRate: totalCases ? relevantCases / totalCases : 0,
    automatedStyleCases,
    duplicateSelections,
    selectionDiversityRate: totalCases ? selectionSignatures.size / totalCases : 0,
    averageLatencyMs: totalCases ? Math.round(totalLatencyMs / totalCases) : 0,
    caseScores,
    caseSections,
  };
}

export function assertEvaluationQuality(result) {
  const automatedStyleRate = result.totalCases ? result.automatedStyleCases / result.totalCases : 0;
  if (result.relevanceRate < MIN_RELEVANCE_RATE || result.selectionDiversityRate < MIN_SELECTION_DIVERSITY_RATE || automatedStyleRate < MIN_AUTOMATED_STYLE_RATE) {
    throw Object.assign(new Error('Quality threshold not met'), { code: 'quality_insufficient' });
  }
}

export function formatAggregateSummary(result) {
  const lines = [
    `Quality: valid=${result.validCases}/${result.totalCases} relevant=${result.relevantCases}/${result.totalCases} automatedStyle=${result.automatedStyleCases}/${result.totalCases} duplicateSelections=${result.duplicateSelections}`,
    `Latency: averageMs=${result.averageLatencyMs}`,
    `Usage: ${result.usage === 'unavailable' ? 'unavailable' : `inputTokens=${result.usage.inputTokens} outputTokens=${result.usage.outputTokens} totalTokens=${result.usage.totalTokens}`}`,
    'Section IDs by synthetic case:',
    ...result.caseSections.map(({ id, sectionIds }) => `${id}: ${sectionIds.join(', ')}`),
  ];
  return lines.join('\n');
}

export async function runLiveEvaluation({ root = ROOT } = {}) {
  const fixture = validateEvaluationFixture(JSON.parse(await readFile(resolve(root, 'tests/fixtures/ask-marcus-evals.json'), 'utf8')));
  const key = await loadOpenAIKey({ projectRoot: root, env: process.env });
  if (!key) throw Object.assign(new Error('Key is not configured'), { code: 'key_required' });
  const [corpus, index] = await Promise.all([
    readFile(resolve(root, 'data/meditations.pages.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'data/meditations.retrieval.json'), 'utf8').then(JSON.parse),
  ]);
  const usageCapture = { inputTokens: 0, outputTokens: 0, totalTokens: 0, available: false };
  const client = createUsageCapturingClient(new OpenAI({ apiKey: key }), usageCapture);
  const service = createAskMarcusService({ client, pages: corpus.pages, index });
  const result = await evaluateCases({ fixture, pages: corpus.pages, ask: service.ask });
  const completed = { ...result, usage: usageSummary(usageCapture) };
  try {
    assertEvaluationQuality(completed);
  } catch (error) {
    error.result = completed;
    throw error;
  }
  return completed;
}

export async function runEvaluationMain({ run = runLiveEvaluation, log = console.log, error = console.error } = {}) {
  try {
    log(formatAggregateSummary(await run()));
    return 0;
  } catch (failure) {
    if (failure?.code === 'quality_insufficient' && failure.result) log(formatAggregateSummary(failure.result));
    error(`Evaluation failed: ${failure?.code === 'quality_insufficient' ? 'quality_insufficient' : failure?.code === 'key_required' ? 'key_required' : 'service_unavailable'}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runEvaluationMain();
}
