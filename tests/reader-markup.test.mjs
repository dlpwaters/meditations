import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('application shell provides four accessible views and start controls', async () => {
  const html = await readFile('index.html', 'utf8');
  const viewTags = [...html.matchAll(/<section[^>]*data-view="([^"]+)"[^>]*>/g)];
  const views = viewTags.map((match) => match[1]);
  assert.deepEqual(views, ['setup', 'start', 'ask', 'reader']);
  assert.equal(viewTags.filter((match) => !/\shidden(?:\s|>)/.test(match[0])).length, 1);
  assert.match(html, /<label[^>]*for="setup-key"/);
  assert.match(html, /<input[^>]*id="setup-key"[^>]*type="password"/);
  assert.match(html, /<input[^>]*id="setup-key"[^>]*autocomplete="off"/);
  assert.match(html, /<form[^>]*id="setup-form"/);
  assert.match(html, /<button[^>]*id="save-setup-key"[^>]*type="submit"/);
  assert.match(html, /<button[^>]*id="skip-setup"[^>]*type="button"/);
  assert.match(html, /id="setup-status"[^>]*role="status"/);
  assert.match(html, /<button[^>]*id="read-meditations"[^>]*type="button"/);
  assert.match(html, /<button[^>]*id="ask-marcus"[^>]*type="button"/);
  assert.match(html, /<button[^>]*id="replace-key"[^>]*type="button"/);
  assert.match(html, /<div[^>]*class="primary-actions"[^>]*>/);
  assert.match(html, /id="read-meditations"[^>]*class="primary-action"/);
  assert.match(html, /id="ask-marcus"[^>]*class="primary-action"/);
  assert.match(html, /id="replace-key"[^>]*class="secondary-action"/);
  assert.match(html, /<form[^>]*id="ask-form"/);
  assert.match(html, /<label[^>]*for="ask-input"/);
  assert.match(html, /<textarea[^>]*id="ask-input"/);
  assert.match(html, /<textarea[^>]*id="ask-input"[^>]*aria-describedby="ask-counter"/);
  assert.match(html, /id="ask-counter"/);
  assert.match(html, /id="ask-status"[^>]*role="status"/);
  assert.match(html, /<section[^>]*id="ask-results"[^>]*aria-live="polite"[^>]*>[\s\S]*?class="ask-empty"[\s\S]*?<\/section>/);
  assert.match(html, /id="retry-ask"[^>]*hidden/);
  assert.match(html, /id="explore-sections"[^>]*hidden/);
  assert.match(html, /<button[^>]*id="back-to-start"[^>]*type="button"/);
  assert.match(html, /<button[^>]*id="full-book"[^>]*type="button"/);
});

test('finished shell styles preserve action hierarchy and accessible interaction hooks', async () => {
  const [html, shared, start] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('src/styles.css', 'utf8'),
    readFile('src/start.css', 'utf8'),
  ]);
  assert.match(html, /href="\/src\/start\.css"/);
  assert.equal((html.match(/class="primary-action"/g) ?? []).length, 2);
  assert.match(start, /\.primary-actions\s*\{/);
  assert.match(start, /\.primary-action\s*\{/);
  assert.match(start, /\.secondary-action\s*\{/);
  assert.match(start, /\.ask-empty\s*\{/);
  assert.match(start, /assets\/illustrations\/book-[^)'"\s]+\.png/);
  assert.match(shared, /:focus-visible/);
  assert.match(shared, /prefers-reduced-motion:\s*reduce/);
});

test('reader contains StPageFlip open-book hooks and reduced-motion styling', async () => {
  const [html, css, reader] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('src/reader.css', 'utf8'),
    readFile('src/reader.js', 'utf8'),
  ]);
  assert.match(html, /id="book-pages"/);
  assert.match(html, /page-flip\.browser\.js/);
  assert.match(html, /id="contents-button"/);
  assert.match(html, /id="original-mode"/);
  assert.match(html, /id="familiar-mode"/);
  assert.match(html, /id="random-page"[^>]*aria-pressed="false"/);
  assert.match(html, /id="fullscreen-toggle"/);
  assert.match(html, /id="previous-page"/);
  assert.match(html, /id="next-page"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /spread-page/);
  assert.match(css, /\.art-page\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.art-page img\s*\{[^}]*position:\s*absolute[^}]*inset:\s*clamp/);
  assert.match(reader, /pageFlip\.flipNext\(\)/);
  assert.match(reader, /pageFlip\.flipPrev\(\)/);
  assert.match(reader, /requestFullscreen\(\)/);
  assert.match(reader, /bookShell\.requestFullscreen\(\)/);
  assert.match(reader, /ResizeObserver/);
  assert.match(reader, /exitFullscreen\(\)/);
  assert.match(css, /\.book-shell:fullscreen/);
  assert.match(css, /grid-template-rows:\s*auto auto minmax/);
});
