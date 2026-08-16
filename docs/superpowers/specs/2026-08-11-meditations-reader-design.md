# Meditations Reader Design

## Goal

Build a local-first reader for the complete *Meditations* by Marcus Aurelius. The reader presents small wisdom sections as book-like pages, lets the user turn pages forward and backward, and keeps each page ready for later modern paraphrase and illustration generation.

This first phase includes source acquisition, deterministic JSON processing, the reader shell, and the page-turn interaction. It does not generate modern paraphrases or images.

## Source and rights

The initial corpus is George Long's public-domain translation from Project Gutenberg eBook 2680:

- Source page: https://www.gutenberg.org/ebooks/2680
- Plain text: https://www.gutenberg.org/files/2680/2680-0.txt
- Translator: George Long

The source is complete, divided into the twelve Books, and exposes numbered sections that can be parsed without reconstructing page layout. Modern translations such as Gregory Hays are not freely redistributable as complete text, so the application will not bundle one. The data model will support a later licensed modern translation or generated paraphrase without changing page IDs.

The repository will retain source attribution and the translator in both documentation and generated JSON metadata.

## Content pipeline

`fetch-source.mjs` downloads the exact plain-text source into `data/source/meditations-long.txt`. `parse-meditations.mjs` reads that file, ignores the Gutenberg wrapper and non-book front/back matter, identifies `FIRST BOOK` through `TWELFTH BOOK`, and emits one JSON page per numbered section.

The parser must be deterministic and fail loudly when a Book or numbered section is missing. It must preserve paragraph text, normalize line endings and wrapped source lines, and retain the original Book/section coordinates.

Each generated page has this shape:

```json
{
  "id": "book-01-section-01",
  "book": 1,
  "section": 1,
  "label": "Book I · Section 1",
  "source": {
    "title": "Meditations",
    "translator": "George Long",
    "url": "https://www.gutenberg.org/ebooks/2680"
  },
  "text": "...",
  "modernVersion": null,
  "illustration": {
    "status": "pending",
    "path": null,
    "prompt": null
  }
}
```

The `id` is the stable join key for future model-generated modern text and illustrations. No content generation runs in this phase.

## Reader architecture

The app is a dependency-free static frontend served by a small Node HTTP server:

```text
data/source/meditations-long.txt  source snapshot
data/meditations.pages.json       generated reader data
scripts/fetch-source.mjs          source download
scripts/parse-meditations.mjs     source-to-page transformation
src/app.js                        reader state and controls
src/styles.css                    book layout and page animation
index.html                        application shell
server.mjs                        local static server
bin/meditations                    launch wrapper
```

The browser loads the JSON once, starts at the first page, and maintains only the current page index and animation state. The UI provides previous/next buttons, clickable page regions where practical, keyboard ArrowLeft/ArrowRight controls, a Book/section label, and a progress indicator. It will show a clear error state if the JSON cannot be loaded.

## Page-turn interaction

The visible reader is a single centered book page with an outer book frame and a spine-oriented transform origin. A page layer has front and back faces. On forward navigation, the current page rotates around its left edge toward the next section; on backward navigation it rotates in the reverse direction. CSS `perspective`, `transform-style: preserve-3d`, `backface-visibility`, a paper gradient, and a changing shadow create depth while keeping the implementation small and controllable.

The next page is prepared before the transition begins. The committed index changes after `transitionend`, preventing content from changing halfway through the animation. Navigation is disabled while a turn is active. `prefers-reduced-motion: reduce` removes the 3D transition and swaps the page immediately.

## Testing and verification

- Node's built-in test runner checks that the parser emits all twelve Books, stable IDs, sequential section numbers within each Book, non-empty text, and the required future-facing fields.
- A browser smoke check verifies the reader loads the generated JSON, displays the first page, advances to the next section, reverses to the previous section, and exposes no console errors.
- The launch command is tested through the real `meditations` command, not only by invoking the server directly.
- The source and generated JSON are checked for reproducibility by running the parser twice and comparing output.

## Explicit non-goals for this phase

- No image generation or image assets.
- No modern paraphrase generation.
- No accounts, database, remote API, or cloud deployment.
- No heavy page-flip dependency; the effect remains native CSS and JavaScript.
