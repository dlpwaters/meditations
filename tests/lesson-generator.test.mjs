import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLessonBatch } from '../scripts/generate-lesson-tags.mjs';

const pages = [{ id: 'book-01-section-01', modernVersion: 'Keep your temper.' }];

test('accepts one concise lesson label for each requested page', () => {
  const result = validateLessonBatch([{ id: pages[0].id, lesson: 'Steady Temper' }], pages);
  assert.equal(result.get(pages[0].id), 'Steady Temper');
  assert.throws(() => validateLessonBatch([{ id: pages[0].id, lesson: 'This has four separate words' }], pages), /one to three words/i);
  assert.throws(() => validateLessonBatch([], pages), /missing/i);
});
