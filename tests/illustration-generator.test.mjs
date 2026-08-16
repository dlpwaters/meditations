import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIllustrationPrompt, markIllustrationComplete, isVerifiedIllustration } from '../scripts/generate-illustrations.mjs';

const page = { id: 'book-01-section-01', text: 'Original', modernVersion: 'A familiar reading.', illustration: { status: 'pending', path: null, prompt: null } };

test('creates a consistent timeless illustration prompt', () => {
  const prompt = buildIllustrationPrompt(page);
  assert.match(prompt, /pen-and-ink/i);
  assert.match(prompt, /watercolor/i);
  assert.match(prompt, /no text/i);
  assert.match(prompt, /A familiar reading/);
});

test('marks only the generated illustration fields complete', () => {
  const result = markIllustrationComplete({ pages: [structuredClone(page)] }, page.id, '/assets/illustrations/book-01-section-01.png', 'prompt');
  assert.equal(result.pages[0].text, 'Original');
  assert.deepEqual(result.pages[0].illustration, { status: 'complete', path: '/assets/illustrations/book-01-section-01.png', prompt: 'prompt' });
});

test('accepts only a complete illustration with the expected local asset path', () => {
  assert.equal(isVerifiedIllustration({ ...page, illustration: { status: 'complete', path: '/assets/illustrations/book-01-section-01.png', prompt: 'prompt' } }, new Set(['/assets/illustrations/book-01-section-01.png'])), true);
  assert.equal(isVerifiedIllustration({ ...page, illustration: { status: 'complete', path: '/assets/illustrations/other.png', prompt: 'prompt' } }, new Set(['/assets/illustrations/other.png'])), false);
  assert.equal(isVerifiedIllustration(page, new Set(['/assets/illustrations/book-01-section-01.png'])), false);
});
