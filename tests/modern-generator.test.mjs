import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchPrompt, validateModernBatch } from '../scripts/generate-modern-readings.mjs';

const pages = [{ id: 'book-01-section-01', text: 'Keep your temper.' }];

test('builds a prompt for faithful familiar-language readings', () => {
  assert.match(buildBatchPrompt(pages), /do not explain/i);
  assert.match(buildBatchPrompt(pages), /book-01-section-01/);
});

test('accepts exactly one non-empty reading per requested id', () => {
  const result = validateModernBatch([{ id: pages[0].id, modernVersion: 'Stay calm when someone pushes you.' }], pages);
  assert.equal(result.get(pages[0].id), 'Stay calm when someone pushes you.');
  assert.throws(() => validateModernBatch([], pages), /missing/i);
  assert.throws(() => validateModernBatch([{ id: 'other', modernVersion: 'x' }], pages), /unexpected/i);
});
