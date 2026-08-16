# Complete Reading Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add all familiar-language readings, matching local illustrations, a StPageFlip open-book reader, reading-mode toggle, and contents navigation.

**Architecture:** A validated Codex CLI generator enriches the existing page JSON in small restartable batches. Illustration metadata and files are generated from the resulting adaptation. The frontend renders paired left/right HTML pages through StPageFlip and owns selection, mode, and contents-panel state.

**Tech Stack:** Node.js, `codex exec`, `gpt-5.6-luna`, `page-flip`, built-in OpenAI image generation, HTML/CSS/JavaScript, Node test runner.

## Global Constraints

- Preserve all existing source data and stable page IDs.
- Original mode is the reader default.
- Familiar readings are adaptations, never explanations or technology analogies.
- Use `gpt-5.6-luna` with medium reasoning for local reading generation.
- Store illustrations in `assets/illustrations/<page-id>.png` and mark only verified assets complete.
- Use StPageFlip for the user-visible page turn.
- Generation is restartable and never overwrites completed valid content.

---

### Task 1: Add a strict local familiar-reading generator

**Files:**
- Create: `scripts/generate-modern-readings.mjs`
- Create: `tests/modern-generator.test.mjs`
- Modify: `package.json`

**Interfaces:**
- `buildBatchPrompt(pages)` returns the fixed style prompt plus `{id,text}` batch input.
- `validateModernBatch(result, requestedPages)` returns a Map keyed by ID or throws.
- `npm run generate:modern` processes pending pages through `codex exec -m gpt-5.6-luna -c model_reasoning_effort="medium" --output-schema`.

- [ ] Write tests that reject a missing, duplicate, unknown, or empty ID and accept an exact valid batch.
- [ ] Run `node --test tests/modern-generator.test.mjs` and observe the missing-module failure.
- [ ] Implement JSON-schema constrained CLI invocation, batch checkpoints, merge-only `modernVersion` updates, and atomic writes.
- [ ] Run the focused tests and then generate all pending readings.

### Task 2: Add the illustration manifest and generation worker

**Files:**
- Create: `scripts/generate-illustrations.mjs`
- Create: `tests/illustration-generator.test.mjs`
- Create: `assets/illustrations/.gitkeep`

**Interfaces:**
- `buildIllustrationPrompt(page)` returns the shared visual direction plus a section-specific scene request grounded in `modernVersion`.
- `markIllustrationComplete(data, id, imagePath, prompt)` preserves immutable fields and sets only the illustration object.
- The worker skips complete valid image paths and leaves unsuccessful pages pending.

- [ ] Write failing tests for prompt invariants, asset path, and non-destructive metadata merge.
- [ ] Implement manifest creation, asset validation, and checkpoint iteration.
- [ ] Generate one representative illustration with the built-in image generator, inspect it, save it to the required asset path, and verify JSON linkage before processing the remaining pages.
- [ ] Generate every pending illustration iteratively, validating each local file and persisting each completed page immediately.

### Task 3: Replace the reader with an open StPageFlip spread

**Files:**
- Modify: `package.json`
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Create: `tests/reader-spread.test.mjs`

**Interfaces:**
- `createReaderState(pageCount)` additionally stores `mode: 'original' | 'familiar'` and `contentsOpen: boolean`.
- `renderSpread(page, mode)` emits one text page and one image page for StPageFlip.
- Page-flip events commit the exact selected section index.

- [ ] Write failing tests for Original default, mode switch retaining index, direct index selection, and required reader hooks.
- [ ] Install `page-flip` and implement a two-page HTML spread with dynamic loading and reduced-motion fallback.
- [ ] Wire previous/next, arrows, drag/click flip events, and illustration paths.
- [ ] Run all reader tests.

### Task 4: Add the accessible contents panel

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `tests/reader-spread.test.mjs`

- [ ] Write a failing test for Book-grouped section controls and panel state actions.
- [ ] Implement an accessible dialog/drawer, Book headings, per-section controls, Escape close, focus restoration, and selection navigation.
- [ ] Run the targeted tests.

### Task 5: Verify the complete experience

**Files:**
- Modify: `docs/verification/2026-08-11-reader-check.md`

- [ ] Run the full generator validation and confirm every page has a non-empty familiar reading and a locally existing complete illustration.
- [ ] Run `npm test` and the installed `meditations --no-open` endpoint check.
- [ ] Use the browser to verify original/familiar switching, contents selection, an open-spread turn, illustration fit, and no console errors.
- [ ] Record evidence and any environment limitation in the verification note.
