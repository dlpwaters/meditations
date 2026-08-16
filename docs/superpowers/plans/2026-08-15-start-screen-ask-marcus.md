# Start Screen and Ask Marcus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional secure OpenAI setup flow, a polished start screen, hybrid RAG guidance from Marcus, and an ordered ten-section reading path without weakening the existing full-book reader.

**Architecture:** Keep the browser client framework-free and move all secret-bearing and OpenAI work into the loopback Node server. Commit a reproducible, non-secret embedding index for the 415 public passages; retrieve 32 candidates locally, then use `gpt-5.6-luna` with strict structured output to select ten and write the response. Split the current reader from top-level app/setup/Ask concerns so full-book and curated-path modes share one StPageFlip implementation.

**Tech Stack:** Node.js ESM, built-in `node:http`, official `openai` JavaScript SDK, vanilla HTML/CSS/JavaScript, Nodlik StPageFlip, Node test runner.

**Specification:** `docs/superpowers/specs/2026-08-15-start-screen-ask-marcus-design.md`

**Version-control note:** This directory is not currently a Git repository. Perform the listed verification after each task; create the suggested commits only after the user initializes or connects the repository.

## File map

### New files

- `.gitignore` — excludes all real environment files and local runtime artifacts.
- `.env.example` — documents only the empty `OPENAI_API_KEY` variable.
- `src/server/config.mjs` — loads, validates, and atomically persists the local key.
- `src/server/retrieval.mjs` — loads the corpus/index and performs hybrid candidate retrieval.
- `src/server/ask-marcus.mjs` — OpenAI prompt, moderation, structured output, validation, and enrichment.
- `src/reader.js` — extracted StPageFlip reader with full-corpus and curated-path modes.
- `src/setup.js` — setup status, optional skip, key submission, and replacement UI.
- `src/ask-marcus.js` — Ask form, result rendering, retry behavior, and path launch.
- `src/start.css` — Setup, Start, and Ask presentation.
- `src/reader.css` — reader/page-flip styles moved from the existing stylesheet.
- `scripts/save-existing-api-key.mjs` — safely persists an already exported key without printing it.
- `scripts/generate-retrieval-index.mjs` — batches corpus embeddings and writes the public index atomically.
- `data/meditations.retrieval.json` — generated 415-section public embedding index.
- `tests/config.test.mjs` — local secret behavior and permissions.
- `tests/retrieval.test.mjs` — deterministic hybrid retrieval behavior.
- `tests/ask-marcus.test.mjs` — prompt, response contract, moderation, repair, and enrichment.
- `tests/app-state.test.mjs` — setup/start/Ask/reader state transitions.
- `tests/recommended-reader.test.mjs` — ten-section path and Full Book transitions.
- `tests/fixtures/retrieval-index.json` — tiny hand-checked vectors for retrieval tests.

### Modified files

- `package.json` and `package-lock.json` — official OpenAI SDK and generation command.
- `server.mjs` — loopback-only listen, JSON APIs, safe routing, dependency injection.
- `index.html` — semantic containers for Setup, Start, Ask, and Reader.
- `src/app.js` — top-level controller only; existing reader functions move to `src/reader.js`.
- `src/styles.css` — shared tokens/reset/base shell.
- `tests/server.test.mjs` — API/status/method/cache/loopback coverage.
- `tests/reader-markup.test.mjs`, `tests/reader-spread.test.mjs`, `tests/reader-state.test.mjs` — import and markup updates after reader extraction.
- `README.md` — optional AI, privacy, setup, replacement, and index maintenance.

## Task 1: Establish the secret-safe local configuration boundary

**Files:** `.gitignore`, `.env.example`, `src/server/config.mjs`, `scripts/save-existing-api-key.mjs`, `tests/config.test.mjs`, `package.json`

- [ ] Write failing configuration tests using a temporary project directory. Cover environment precedence, absent key, atomic `.env.local` creation, mode `0600`, replacement without duplicate variables, rejection of empty keys, and no returned plaintext.

```js
test('persists the key with owner-only permissions without returning it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meditations-config-'));
  const result = await persistOpenAIKey({ projectRoot: root, key: 'sk-test-secret' });
  assert.deepEqual(result, { configured: true });
  assert.equal((await stat(join(root, '.env.local'))).mode & 0o777, 0o600);
  assert.equal(await loadOpenAIKey({ projectRoot: root, env: {} }), 'sk-test-secret');
});
```

- [ ] Run `rtk test node --test tests/config.test.mjs` and confirm failure because the module does not exist.
- [ ] Implement `loadOpenAIKey({ projectRoot, env })`, `hasOpenAIKey(...)`, and `persistOpenAIKey({ projectRoot, key })`. Parse only the one expected variable, use a same-directory temporary file plus rename, never log key material, and return safe metadata only.
- [ ] Add `.gitignore` rules for `.env`, `.env.*`, `!.env.example`, temporary key files, logs, and local runtime state. Add `.env.example` containing exactly `OPENAI_API_KEY=`.
- [ ] Add `scripts/save-existing-api-key.mjs`, which requires `process.env.OPENAI_API_KEY`, calls `persistOpenAIKey`, and prints only the destination and permission status.
- [ ] Add `npm run setup:key` for that script.
- [ ] Install the official SDK with `rtk npm install openai`; preserve the resulting lockfile. Add `validateOpenAIKey({ key, OpenAIClass })`, using `models.retrieve('gpt-5.6-luna')` and returning only safe validation status.
- [ ] Run the focused test until green, then run `rtk npm test` and resolve regressions.
- [ ] Once implementation is approved and the existing environment key is available, run `rtk npm run setup:key`; verify only file existence, mode, and ignored status—never content.

## Task 2: Make the local HTTP server API-safe and loopback-only

**Files:** `server.mjs`, `tests/server.test.mjs`

- [ ] Extend `tests/server.test.mjs` first. Start with injected services and assert:
  - `GET /api/setup-status` returns exactly `{ "configured": true|false }`.
  - Personal API responses carry `Cache-Control: no-store`.
  - Unsupported methods return `405`.
  - Oversized JSON returns `413`.
  - Invalid JSON returns `400`.
  - Setup errors never contain the submitted key or a stack trace.
  - The executable entrypoint listens on `127.0.0.1`, not an unspecified interface.
- [ ] Run `rtk test node --test tests/server.test.mjs` and confirm the new assertions fail for missing API routing.
- [ ] Add small server utilities: `sendJson`, `readJsonBody`, `isSameOrigin`, and `routeApi`. Inject `configService` and `askMarcusService` into `createServer` so tests use real routing without live OpenAI calls.
- [ ] Implement `GET /api/setup-status` and `POST /api/setup-key`. Validate origin/host, body shape, key length, and key authenticity through the injected validator before persistence.
- [ ] Block all dotfiles and unknown sensitive runtime paths from static serving even if a content type is later added.
- [ ] Change the executable listen call to `server.listen(port, '127.0.0.1')`. Preserve port `0` support in tests.
- [ ] Run the focused server tests and then `rtk npm test`.

## Task 3: Build the setup/start application state and semantic shell

**Files:** `index.html`, `src/app.js`, `src/setup.js`, `tests/app-state.test.mjs`, `tests/reader-markup.test.mjs`

- [ ] Write failing pure-state tests for `initialView({ configured, skipped })` and transitions among `setup`, `start`, `ask`, and `reader`.

```js
assert.equal(initialView({ configured: false, skipped: false }), 'setup');
assert.equal(initialView({ configured: false, skipped: true }), 'start');
assert.equal(initialView({ configured: true, skipped: false }), 'start');
```

- [ ] Add failing DOM-hook checks for four `[data-view]` containers, password input, Save, Skip, Read Meditations, Ask Marcus, Back, and Full Book controls. Check labels, status regions, and disabled/loading semantics rather than exact prose.
- [ ] Run the focused tests and confirm failures identify missing state and markup.
- [ ] Replace the single-screen shell with semantic Setup, Start, Ask, and Reader sections. Keep StPageFlip scripts loaded only once.
- [ ] Add top-level view orchestration around the existing reader code. On startup, fetch `/api/setup-status`, read the non-secret `meditations.setupSkipped` localStorage flag, and choose the initial view; complete the `src/app.js` reduction after reader extraction in Task 4.
- [ ] Implement `src/setup.js` with password-field submission, Save progress/error states, Skip persistence, and a Replace Key entrypoint. Clear the input immediately after a successful request.
- [ ] Ensure skipping never calls a key endpoint and Ask Marcus routes back to setup when status is unconfigured.
- [ ] Run focused tests and `rtk npm test`.

## Task 4: Extract and preserve the reader while adding curated paths

**Files:** `src/reader.js`, `src/app.js`, `src/reader.css`, `src/styles.css`, `tests/reader-state.test.mjs`, `tests/reader-spread.test.mjs`, `tests/reader-markup.test.mjs`, `tests/recommended-reader.test.mjs`

- [ ] Move existing reader-state tests to import from the wished-for `src/reader.js`, then add failing tests for:
  - `createReadingPath(allPages)` returning all 415 pages.
  - `createReadingPath(allPages, recommendedIds)` preserving the exact returned ID order.
  - Rejecting duplicate or unknown recommendation IDs.
  - `restoreFullBookIndex` locating the currently viewed recommended section in the full corpus.
  - Previous/Next and Random operating within the active path.
- [ ] Run the focused reader tests and confirm failure because `src/reader.js` does not exist.
- [ ] Extract the existing state reducer, rendering, StPageFlip setup, Random behavior, full-screen behavior, contents panel, and keyboard controls into `src/reader.js` without changing established behavior.
- [ ] Remove the extracted reader internals from `src/app.js`, leaving only top-level view orchestration and module wiring.
- [ ] Add `openFullBook({ startId })` and `openRecommendedPath(ids)` APIs. Rebuild physical pages from the active path so every curated transition uses real StPageFlip animation.
- [ ] Wire Full Book to leave recommendation mode and preserve the current section by stable ID. Hide or disable Full Book while already in full-book mode.
- [ ] Move all reader/page rules to `src/reader.css`; keep shared tokens and resets in `src/styles.css`.
- [ ] Run all reader tests and then `rtk npm test`.

## Task 5: Implement deterministic hybrid retrieval

**Files:** `src/server/retrieval.mjs`, `tests/retrieval.test.mjs`, `tests/fixtures/retrieval-index.json`

- [ ] Create a tiny fixture with four passages and hand-computable three-dimensional vectors. Write failing tests for normalized tokens, cosine similarity, lexical scoring, reciprocal-rank merging, uniqueness, stable tie-breaking, and exact candidate limits.

```js
const candidates = retrieveCandidates({
  query: 'I cannot stop worrying about change',
  queryVector: [1, 0, 0],
  pages,
  index,
  limit: 3,
});
assert.deepEqual(candidates.map(({ id }) => id), ['change', 'control', 'fear']);
```

- [ ] Run `rtk test node --test tests/retrieval.test.mjs` and confirm missing-module failure.
- [ ] Implement `cosineSimilarity`, `tokenize`, `lexicalScore`, `mergeRankings`, `validateRetrievalIndex`, and `retrieveCandidates` with no network dependencies.
- [ ] Require exact corpus/index ID alignment, finite vectors of consistent dimensions, one entry per ID, and deterministic ordering.
- [ ] Use reciprocal-rank fusion for semantic and lexical lists and return exactly `min(limit, pageCount)` unique trusted page objects.
- [ ] Run focused and full tests.

## Task 6: Generate and validate the public corpus embedding index

**Files:** `scripts/generate-retrieval-index.mjs`, `data/meditations.retrieval.json`, `package.json`, `tests/corpus.test.mjs`, `tests/retrieval.test.mjs`

- [ ] Add failing tests for the generator’s pure input text builder and saved-index validator. Assert stable page order, model metadata, dimensions, 415 IDs, finite vectors, and no key-like strings.
- [ ] Run focused tests and confirm failure because generator exports are missing.
- [ ] Implement `embeddingTextForPage(page)` using label, lesson, original text, and familiar reading. Implement batches of 32 with retry/backoff for transient 429/5xx responses, checkpoint progress after each batch, skip already valid IDs, and atomically finalize the index.
- [ ] Add `npm run generate:retrieval`.
- [ ] Run generator unit tests.
- [ ] Run `rtk npm run generate:retrieval` with the configured key until all 415 entries are complete. Do not print request headers, environment values, or page vectors.
- [ ] Run index validation and `rtk npm test`.

## Task 7: Implement the Ask Marcus model contract and safety boundary

**Files:** `src/server/ask-marcus.mjs`, `tests/ask-marcus.test.mjs`

- [ ] Write failing tests against an injected OpenAI-compatible client. Test the real prompt/validation/enrichment logic while faking only network methods. Cover:
  - Input normalization and the 4,000-character limit.
  - Query embedding request with `text-embedding-3-small`.
  - Retrieval limited to 32 trusted candidates.
  - Responses request using `gpt-5.6-luna`, `reasoning: { effort: 'low' }`, and `store: false`.
  - Strict schema requiring one 60–180 word paragraph and exactly ten unique candidate IDs.
  - Reasons limited to 60 words.
  - Local enrichment overriding any untrusted model fields.
  - One repair request after malformed output and failure after the second invalid result.
  - Missing/invalid-key and rate-limit classification without upstream secret leakage.
  - A moderation result in self-harm or violence categories adding a trusted immediate-safety banner before the Marcus content.
- [ ] Run `rtk test node --test tests/ask-marcus.test.mjs` and confirm missing-module failure.
- [ ] Implement `buildMarcusInstructions`, `buildCandidateInput`, `validateMarcusResponse`, `enrichMarcusResponse`, and `createAskMarcusService`.
- [ ] Define the strict JSON schema in one exported constant. Instruct the model to be compassionate, plainspoken, Stoic, non-archaic, non-diagnostic, and specific; prohibit invented quotations and theatrical emperor language.
- [ ] Use `client.moderations.create({ model: 'omni-moderation-latest', input })` before guidance generation. Keep the safety banner application-authored and location-neutral, mentioning local emergency services and 988 only for the US/Canada context.
- [ ] Implement one bounded repair using the validation errors plus the same candidate IDs. Never accept an ID outside the retrieved candidate set.
- [ ] Run focused and full tests.

## Task 8: Connect `/api/ask-marcus` and implement the Ask interface

**Files:** `server.mjs`, `src/ask-marcus.js`, `src/app.js`, `index.html`, `tests/server.test.mjs`, `tests/app-state.test.mjs`, `tests/reader-markup.test.mjs`

- [ ] Add failing server tests for missing key (`409` with `code: 'key_required'`), valid Ask response, input validation, no-store headers, rate-limit mapping, and schema-failure mapping.
- [ ] Add failing client state tests for submit/loading/success/error/retry and opening a recommendation path from returned IDs.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement `POST /api/ask-marcus`, obtaining the current key at request time and constructing the OpenAI client server-side.
- [ ] Implement the Ask form with a 4,000-character counter, accessible progress status, retained in-memory text on errors, Retry, and Back to Start.
- [ ] Render the trusted message as text, not HTML. Render ten cards with label, lesson, and reason. Render any safety banner before the letter.
- [ ] Wire Explore These Sections to pass the exact returned ID order into `openRecommendedPath` and show Reader.
- [ ] Ensure no user question or response is written to localStorage, files, URLs, analytics, or console logs.
- [ ] Run focused and full tests.

## Task 9: Apply the finished visual system and responsive behavior

**Files:** `src/styles.css`, `src/start.css`, `src/reader.css`, `index.html`, `tests/reader-markup.test.mjs`

- [ ] Add failing accessibility/markup checks for one visible main view, keyboard-focus styles, status regions, textarea labeling, password autocomplete behavior, and reduced-motion hooks.
- [ ] Run the markup test and confirm failures for the missing presentation hooks.
- [ ] Implement shared parchment/umber/charcoal/gold tokens, textured gradients, editorial type scale, focus rings, and view transitions in `src/styles.css`.
- [ ] Build the Start composition in `src/start.css`, reusing one existing completed illustration as a low-contrast atmospheric layer with a readable overlay. Keep exactly two primary actions.
- [ ] Style Setup as a quiet first-page inscription and Ask as a private writing desk/letter rather than a chat transcript.
- [ ] Style the ten recommendations as compact editorial cards and provide clear loading/error states.
- [ ] Preserve the current open-book layout and full-screen behavior in `src/reader.css`; verify no regression to illustration sizing or page-turn shadows.
- [ ] Add responsive rules for narrow portrait screens and `prefers-reduced-motion: reduce`.
- [ ] Run focused and full tests.

## Task 10: Evaluate guidance quality and verify the live application

**Files:** `tests/fixtures/ask-marcus-evals.json`, `scripts/evaluate-ask-marcus.mjs`, `package.json`

- [ ] Add an evaluation fixture for grief, conflict, uncertainty, failure, anger, loneliness, responsibility, mortality, unfair treatment, and loss of direction. Each case lists acceptable passage themes/books rather than a single exact answer.
- [ ] Implement a non-secret evaluation runner that calls the local service, validates ten IDs and schema, records latency/token metadata, and prints only aggregate quality results plus section IDs—not user secrets or API credentials.
- [ ] Add `npm run evaluate:marcus` and a clearly opt-in `npm run test:live` command.
- [ ] Run deterministic tests first. Then run the live suite with the configured key and inspect relevance, Marcus voice, duplication, latency, and failure handling.
- [ ] Keep Luna with low reasoning if representative results are sound. Change to medium only if the eval demonstrates a clear relevance/voice improvement worth the added latency and cost; record the measured decision in README.
- [ ] Start with `rtk proxy meditations --no-open` and verify Setup skip, Start, Read Meditations, Ask Marcus, Explore, curated page turning, Original/Familiar, Random, Full screen, Full Book, and Escape behavior in a real browser.

## Task 11: Document distribution and perform the secret audit

**Files:** `README.md`, `.gitignore`, `.env.example`, all project files

- [ ] Update README with offline reading, optional setup, exact data sent to OpenAI, `store: false`, local key location, replacement/removal, index regeneration, and GitHub safety.
- [ ] Add a setup note that skipping AI leaves the entire book available and that Ask Marcus can configure a key later.
- [ ] Run `rtk npm test` with zero failures.
- [ ] Run `rtk npm run test:live` once with non-sensitive fixture text.
- [ ] Verify `.env.local` exists with mode `0600` and is ignored once Git is initialized. Confirm `.env.example` contains no key.
- [ ] Scan tracked/publishable files for key patterns using a redacting secret scanner; do not print any matching secret. Fail the release check if a real credential is detected.
- [ ] Verify the launcher starts on loopback, a hydrated browser shows the intended initial view, and no browser network response contains `OPENAI_API_KEY` or key material.
- [ ] Confirm `data/meditations.retrieval.json` has exactly 415 vectors and contains no user questions, responses, or credentials.

## Final acceptance checklist

- [ ] A first-time user can securely add a key or skip AI.
- [ ] A configured or skipped user opens directly to the Start screen.
- [ ] Read Meditations preserves all existing reader features.
- [ ] Ask Marcus returns one restrained paragraph and exactly ten valid, relevant sections.
- [ ] Explore opens those ten sections in returned order with real page-turn animations.
- [ ] Full Book restores the complete corpus.
- [ ] No key or personal question is exposed, logged, committed, or persisted as application content.
- [ ] The complete automated suite, live API smoke test, and browser flow pass with fresh evidence.
