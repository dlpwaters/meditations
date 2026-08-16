# Complete Reading Experience Design

## Goal

Extend the local *Meditations* reader into a complete reading experience: every stable section has the Long translation, a faithful familiar-language reading, and a matched illustration. The reader defaults to Long, lets the reader switch modes without changing location, provides a contents panel, and uses a realistic open-book page turn.

## Content generation

`scripts/generate-modern-readings.mjs` reads the existing JSON in batches of ten pages and invokes the local Codex CLI with `gpt-5.6-luna` and medium reasoning. The prompt requires JSON-only output keyed by the exact existing page IDs. It asks for a faithful contemporary scene or voice, not an explanation, summary, self-help commentary, technological analogy, or quotation of the source.

Each familiar-language reading retains the lesson, emotional force, and approximate reading length of its source section. It uses ordinary people, places, relationships, work, solitude, disagreement, loss, duty, and inner life where a contemporary setting makes the original clearer. It may be concise where Marcus is concise and extended where he is extended.

The generator validates a batch before merging: every requested ID appears exactly once, no unrequested IDs appear, every `modernVersion` is non-empty text, and the existing source fields remain unchanged. Checkpoint files make the process restartable; completed pages are skipped.

## Illustration generation

Every completed familiar-language reading becomes the semantic input to a corresponding art prompt. The illustration contract is consistent across the corpus:

```text
Timeless contemplative editorial illustration in pen-and-ink with transparent watercolor washes, warm sepia, umber, charcoal, and parchment tones. Quiet human-scale scene, natural light, generous uncluttered negative space, tactile paper texture, restrained detail, classical composition without depicting ancient Rome literally. No text, lettering, logos, watermarks, screens, devices, or technology emphasis. Avoid visual clichés and caricature.
```

The per-page scene reflects the familiar-language reading rather than literalizing every sentence. Art is stored at `assets/illustrations/<page-id>.png`; its path and prompt are saved in the page's `illustration` object. The image workflow uses the current OpenAI image-generation model and validates that each generated file exists before marking its status complete. A failed item remains pending and is retried without regenerating completed assets.

## Reader experience

The current single face is replaced with a realistic StPageFlip open-book spread. The left page carries the selected reading mode. The right page carries the illustration with a small unobtrusive source label. On page turns, both pages turn together as an open spread, preserving the section index as the unit of navigation.

The header has three controls: Contents, Original, and Familiar. Original is selected at startup. Switching modes re-renders only the left page for the current section and leaves the open book at the same section. The contents panel is an accessible modal/drawer that groups sections under the twelve Books; selecting a section closes the panel and navigates directly to that spread.

StPageFlip is installed from its maintained `page-flip` package. Its API drives click, drag, keyboard, and programmatic navigation. The current page, mode, and contents selection remain in application state; page-flip events update that state after a completed turn. A reduced-motion setting changes turns to immediate spread swaps.

## Data model

The existing page shape remains the source of truth. A fully generated page has:

```json
{
  "id": "book-01-section-01",
  "modernVersion": "...",
  "illustration": {
    "status": "complete",
    "path": "/assets/illustrations/book-01-section-01.png",
    "prompt": "..."
  }
}
```

No generated asset is referenced until its local file has been validated. Source text, source metadata, book number, section number, label, and ID are immutable through all generation passes.

## Verification

- Unit tests validate generation prompt construction, strict batch validation, idempotent merge behavior, and illustration-path updates.
- The corpus test verifies all sections eventually have non-empty `modernVersion` text and a complete locally existing illustration.
- Reader tests validate mode switching, Book/section contents navigation, and page-flip event synchronization.
- A browser pass verifies the open spread, modal contents panel, mode toggle, next/previous turn, drag turn where supported, and reduced motion.

## Scope exclusions

- The familiar-language reading remains an adaptation, not scholarly translation or commentary.
- The application remains local-first and does not expose generation controls to end readers.
- No images are generated before the validated source and familiar-language data are available.
