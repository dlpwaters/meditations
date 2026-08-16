# Meditations Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free local reader containing the complete public-domain George Long translation of *Meditations*, split into stable JSON pages with a CSS 3D book-page turn and a `meditations` launcher.

**Architecture:** A Node source pipeline downloads and parses the Project Gutenberg text into `data/meditations.pages.json`. A small Node static server serves `index.html`, the generated JSON, and `src/` assets. Browser JavaScript owns only the current page index and turn state; CSS supplies the two-sided 3D page animation.

**Tech Stack:** Node.js built-in `http`, `fs`, `path`, and `node:test`; browser ES modules; HTML/CSS; Project Gutenberg plain text; no runtime dependencies.

## Global Constraints

- Use George Long’s public-domain Project Gutenberg eBook 2680 as the bundled source.
- Preserve Book and numbered-section coordinates and use `book-##-section-##` as the stable page ID.
- Keep `modernVersion` and `illustration` fields present but empty/pending; do not generate paraphrases or images.
- Keep the page-turn effect native CSS/JavaScript with no page-flip dependency.
- Navigation must support previous/next controls, ArrowLeft/ArrowRight, and reduced-motion behavior.
- Every parser and reader behavior change must have a failing test before implementation.
- Verify the real `meditations` command and a browser session before claiming completion.

---

### Task 1: Establish the Node project and source metadata

**Files:**
- Create: `package.json`
- Create: `docs/sources.md`
- Create: `data/source/.gitkeep`
- Create: `scripts/fetch-source.mjs`

**Interfaces:**
- `npm run fetch-source` downloads the exact Gutenberg plain-text URL to `data/source/meditations-long.txt`.
- `fetch-source.mjs` exports `SOURCE_URL`, `SOURCE_PATH`, and `async function fetchSource()` for tests and CLI use.
- `docs/sources.md` records the source URL, translator, retrieval purpose, and the fact that modern copyrighted translations are not bundled.

- [ ] **Step 1: Write the failing source-path test**

Create `tests/source-config.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_URL, SOURCE_PATH } from '../scripts/fetch-source.mjs';

test('source configuration points at the reproducible Gutenberg plain text', () => {
  assert.equal(SOURCE_URL, 'https://www.gutenberg.org/files/2680/2680-0.txt');
  assert.match(SOURCE_PATH, /data[\\/]source[\\/]meditations-long\.txt$/);
});
```

- [ ] **Step 2: Run the test and verify the expected missing-module failure**

Run: `node --test tests/source-config.test.mjs`

Expected: FAIL because `scripts/fetch-source.mjs` does not exist.

- [ ] **Step 3: Implement the source module and package scripts**

Create `package.json` with scripts:

```json
{
  "name": "meditations-reader",
  "private": true,
  "type": "module",
  "scripts": {
    "fetch-source": "node scripts/fetch-source.mjs",
    "parse": "node scripts/parse-meditations.mjs",
    "test": "node --test",
    "start": "node server.mjs"
  }
}
```

Implement `fetch-source.mjs` using Node’s built-in `fetch`, create the parent directory with `fs.mkdir({ recursive: true })`, reject non-OK responses, and write UTF-8 text. Keep the network action behind `if (import.meta.url === ...)` so importing the module never downloads.

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/source-config.test.mjs`

Expected: PASS.

- [ ] **Step 5: Add source documentation and commit the task**

Document the source and retrieval command in `docs/sources.md`, add the empty source directory marker, then run `git add package.json scripts/fetch-source.mjs tests/source-config.test.mjs docs/sources.md data/source/.gitkeep && git commit -m "chore: add Meditations source pipeline"`.

### Task 2: Parse the complete source into stable JSON pages

**Files:**
- Create: `scripts/parse-meditations.mjs`
- Create: `tests/fixtures/mini-meditations.txt`
- Create: `tests/parser.test.mjs`
- Create: `data/meditations.pages.json`

**Interfaces:**
- `parseText(text)` returns `{ source, pages }` and never performs I/O.
- `parseSourceFile(inputPath, outputPath)` reads UTF-8 text, calls `parseText`, and writes pretty-printed JSON ending with a newline.
- `parse-meditations.mjs` accepts optional CLI arguments `--input <path>` and `--output <path>` and defaults to `data/source/meditations-long.txt` and `data/meditations.pages.json`.

- [ ] **Step 1: Create a fixture and failing parser tests**

Make the fixture contain the real heading style and wrapped prose:

```text
THE FIRST BOOK

I. First section text that wraps
across a line.

II. Second section text.

THE SECOND BOOK

I. Another section.
```

Create tests asserting that `parseText` emits two Books, three pages, IDs `book-01-section-01`, `book-01-section-02`, and `book-02-section-01`, normalized prose without embedded line breaks, and the exact `modernVersion: null` plus pending illustration object.

- [ ] **Step 2: Run the parser tests and verify failure**

Run: `node --test tests/parser.test.mjs`

Expected: FAIL because `parse-meditations.mjs` does not exist.

- [ ] **Step 3: Implement minimal deterministic parsing**

Normalize CRLF to LF, isolate `THE FIRST BOOK` through `THE TWELFTH BOOK`, map the heading to Book numbers, and split each Book body on lines matching `/^([IVXLCDM]+)\.\s*(.*)$/`. Convert Roman section labels with a dedicated `romanToNumber()` helper. Join wrapped lines with spaces, collapse repeated whitespace, and preserve paragraph boundaries as single spaces inside a section. Reject missing Book headings, duplicate section numbers, empty sections, or a source with fewer than twelve Books.

Generate each page with the approved schema and source metadata. The JSON top level must be `{ "source": ..., "pages": [...] }` so future generators can read provenance without scanning every page.

- [ ] **Step 4: Run focused parser tests**

Run: `node --test tests/parser.test.mjs`

Expected: PASS.

- [ ] **Step 5: Download and generate the complete corpus**

Run: `npm run fetch-source && npm run parse`.

Then run `node --test tests/parser.test.mjs` against the generated JSON and assert the real output contains all twelve Books, non-empty text, and unique IDs.

- [ ] **Step 6: Add reproducibility coverage and commit**

Add a test that parses the checked-in source twice into memory and compares `JSON.stringify` results. Commit `scripts/parse-meditations.mjs`, fixture/tests, generated JSON, and the source snapshot with `git commit -m "feat: build structured Meditations pages"`.

### Task 3: Add the local server and reader shell

**Files:**
- Create: `server.mjs`
- Create: `index.html`
- Create: `src/app.js`
- Create: `tests/server.test.mjs`

**Interfaces:**
- `server.mjs` exports `createServer({ root, port })` and serves only files inside the project root with correct content types.
- `src/app.js` loads `/data/meditations.pages.json`, renders one page, and exposes navigation through DOM events rather than global mutable APIs.
- The HTML contains `#reader-status`, `#page-front`, `#page-back`, `#previous-page`, `#next-page`, and `#progress` hooks.

- [ ] **Step 1: Write the failing server test**

Create a test that starts `createServer({ root: projectRoot, port: 0 })`, fetches `/index.html` and `/data/meditations.pages.json`, asserts HTTP 200 and expected content types, then closes the server. Assert a missing path returns 404.

- [ ] **Step 2: Run the server test and verify failure**

Run: `node --test tests/server.test.mjs`

Expected: FAIL because `server.mjs` does not exist.

- [ ] **Step 3: Implement the minimal static server**

Resolve requested paths against the project root, decode the URL, map `/` to `index.html`, prevent traversal by checking the resolved path prefix, and serve known extensions (`.html`, `.js`, `.css`, `.json`). Start on `PORT` or 4173 when run directly.

- [ ] **Step 4: Run the server test and add the HTML shell**

Run: `node --test tests/server.test.mjs` and expect PASS. Add semantic markup for the app title, book frame, page faces, navigation buttons, loading/error status, and progress text. Load `src/app.js` as a module.

- [ ] **Step 5: Write the failing reader-state test**

Create `tests/reader-state.test.mjs` around an exported pure `createReaderState(pageCount)` / `reduceReaderState(state, action)` pair. Assert `NEXT` increments within bounds, `PREVIOUS` decrements within bounds, and navigation actions are ignored while `turning` is true.

- [ ] **Step 6: Run the reader-state test, implement state, and rerun**

Run: `node --test tests/reader-state.test.mjs` to observe failure. Implement the pure state functions in `src/app.js`, rerun until PASS, then wire click and keyboard events to dispatch `NEXT` or `PREVIOUS`.

- [ ] **Step 7: Commit the functional reader shell**

Run the full Node suite and commit with `git commit -m "feat: add local Meditations reader shell"`.

### Task 4: Implement the book page-turn animation and responsive styling

**Files:**
- Create: `src/styles.css`
- Modify: `index.html`
- Modify: `src/app.js`
- Create: `tests/reader-markup.test.mjs`

**Interfaces:**
- The page layer uses `.page`, `.page-face`, `.page-front`, `.page-back`, `.is-turning-forward`, and `.is-turning-backward` class hooks.
- `renderPage(page, face)` writes the label, source text, and optional modern text only when `modernVersion` is non-null; it never renders image placeholders as broken media.
- `beginTurn(direction)` prepares the destination face, adds the animation class, and commits the index on `transitionend`; reduced motion commits immediately.

- [ ] **Step 1: Write failing markup and motion tests**

Assert the HTML contains both page faces, the navigation controls, and a `prefers-reduced-motion` rule exists in CSS. In the browser-facing logic test, assert an `END_TURN` action clears the turning state and sets the requested index.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/reader-markup.test.mjs tests/reader-state.test.mjs`.

Expected: FAIL because the style sheet and animation hooks do not exist.

- [ ] **Step 3: Implement the visual system**

Use a warm dark background, a restrained paper palette, subtle paper grain via layered gradients, a centered responsive book frame, readable serif typography, and focus-visible controls. Set the page transform origin at the spine, add `perspective` on the frame, preserve 3D children, hide the reverse face, and animate `rotateY` with a shadow/gradient change. Add a mobile layout that keeps the page within the viewport and moves controls below it.

- [ ] **Step 4: Implement the two-sided turn lifecycle**

Render the current page on the front face and the destination page on the back face. For forward turns add `.is-turning-forward`; for backward turns add `.is-turning-backward`. Listen for `transitionend` on the page layer, commit the destination index once, remove animation classes, and re-render the stable front face. Ignore clicks while turning and support `prefers-reduced-motion: reduce`.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`.

Expected: all parser, server, state, and markup tests pass. Commit with `git commit -m "feat: add CSS book page turns"`.

### Task 5: Add the Bash launcher and project documentation

**Files:**
- Create: `bin/meditations`
- Create: `README.md`
- Modify: `package.json`

**Interfaces:**
- `bin/meditations` resolves its repository directory from its own location, starts `node server.mjs`, and opens the reader URL with `xdg-open` when available; `--no-open` suppresses browser launch for tests.
- `README.md` documents `npm run fetch-source`, `npm run parse`, `npm test`, `npm start`, and the installed `meditations` command.

- [ ] **Step 1: Write the failing launcher test**

Create `tests/launcher.test.mjs` that checks `bin/meditations` exists, is executable, contains `--no-open` handling, and references `server.mjs`.

- [ ] **Step 2: Run the launcher test and verify failure**

Run: `node --test tests/launcher.test.mjs`

Expected: FAIL because `bin/meditations` does not exist.

- [ ] **Step 3: Implement and test the launcher**

Create a Bash script with `set -euo pipefail`, determine `PROJECT_DIR`, choose `node`, start the server in the project directory, wait for the listening URL only as needed, and launch `http://127.0.0.1:4173`. Keep `--no-open` for headless verification.

Run: `chmod +x bin/meditations && node --test tests/launcher.test.mjs` and expect PASS.

- [ ] **Step 4: Add documentation and install the command**

Document the local workflow and explain that generated JSON includes only the Long translation plus empty future-generation fields. Install the command with `install -Dm755 bin/meditations "$HOME/.local/bin/meditations"` if that directory is already on `PATH`; otherwise report the exact PATH addition needed. This system-level write requires explicit authorization at execution time.

- [ ] **Step 5: Commit the launcher task**

Run `npm test` and commit with `git commit -m "feat: add Meditations launcher"`.

### Task 6: Perform end-to-end verification and visual review

**Files:**
- Modify only files required by verified defects.
- Create: `docs/verification/2026-08-11-reader-check.md`

- [ ] **Step 1: Run the complete reproducibility check**

Run `npm run fetch-source && npm run parse && npm test`. Verify the generated JSON has twelve Books, stable unique IDs, sequential sections, no empty text, and pending illustration fields on every page.

- [ ] **Step 2: Run the real launcher**

Run `meditations --no-open`, fetch the actual URL, and confirm it serves the reader. Stop the foreground server cleanly after the check.

- [ ] **Step 3: Verify the visible browser interaction**

Start the app through the launcher and inspect it in the browser. Confirm the first section is visible, next/previous controls work, ArrowLeft/ArrowRight work, the page visibly rotates around the spine, the progress label changes, and no console errors appear. Check a narrow viewport and reduced-motion behavior.

- [ ] **Step 4: Record evidence and check the final diff**

Write commands and observed results in `docs/verification/2026-08-11-reader-check.md`, run `git diff --check`, inspect `git status`, and only then report the implemented scope and any unverified system-level launcher state.
