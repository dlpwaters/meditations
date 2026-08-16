# Start Screen and Ask Marcus Design

## Objective

Add a beautiful entry experience and an optional, secure AI-guided reading workflow to the existing local Meditations reader. A user can read the complete book without configuring AI, or describe a life situation and receive a compassionate response plus an ordered set of ten relevant passages.

## Product principles

- The complete book remains available offline after installation.
- AI is optional and never blocks the reader.
- The OpenAI API key remains on the local server and is never returned to browser code.
- Questions and responses are ephemeral and are not written to local storage.
- “Marcus” is a restrained literary voice, not theatrical role-play or a claim that the historical person is literally responding.
- Recommendations must cite stable IDs from the existing 415-section corpus.

## Application states and navigation

The application has four top-level views:

1. **Setup** appears only when no API key is configured and the user has not previously skipped setup in that browser.
2. **Start** is the default destination after setup, after skipping setup, and on future launches when a key is configured.
3. **Ask Marcus** collects a situation, shows progress, and presents the structured recommendation.
4. **Reader** displays either the complete corpus or a temporary ordered recommendation path.

Setup provides two actions:

- **Save key and continue** validates and stores the key, then opens Start.
- **Continue without AI** stores only a browser-local skipped flag, then opens Start.

The Start view provides exactly two primary actions:

- **Read Meditations** opens the complete book at the first section.
- **Ask Marcus** opens the Ask view when a key exists; otherwise it opens the optional key form.

The Reader retains Original, Familiar, Random, Contents, Full screen, Previous, and Next. It adds **Full Book**. In a recommendation path, Previous and Next traverse the ten recommended sections in their returned order while preserving the realistic page-turn transition. Full Book restores the complete 415-section sequence at the current section when possible.

## Start-screen visual direction

The visual language extends the existing parchment, umber, charcoal, and restrained gold palette. The screen should resemble the quiet threshold of a carefully preserved private edition rather than a software dashboard.

- Use a centered editorial composition with generous negative space.
- Use the existing serif voice for the title and a restrained system sans-serif for controls.
- Use subtle paper grain, warm directional light, fine rules, and slow opacity/position transitions.
- Reuse an existing completed illustration as a softly cropped atmospheric layer so no new generated asset is required.
- Present two clear actions without secondary navigation clutter.
- Respect reduced-motion preferences and maintain readable contrast.

The Ask view uses one generous writing area, not chat bubbles. The response is laid out as a brief personal letter followed by ten compact passage cards. Each card shows the book and section label, its one-to-three-word lesson, and the model’s short reason for selecting it.

## Key setup and secret handling

The current local build may reuse the already available `OPENAI_API_KEY`. The persistent local destination is `.env.local`, with file mode `0600`.

Repository safeguards:

- Add `.env`, `.env.*`, and other local secret files to `.gitignore`.
- Explicitly allow a committed `.env.example` containing only an empty `OPENAI_API_KEY=` placeholder.
- Never place a key in HTML, client JavaScript, generated JSON, tests, screenshots, logs, or documentation.
- Before any future GitHub publication, verify ignored and tracked files for accidental secret inclusion.

Runtime safeguards:

- Bind the HTTP server explicitly to `127.0.0.1`.
- Load `.env.local` only in server-side Node code.
- Accept key setup only through a local JSON POST endpoint with request-size limits and same-origin validation.
- Render key inputs as password fields and never echo the submitted value.
- Validate the key against an authenticated OpenAI endpoint before saving it.
- Write the file atomically with owner-only permissions.
- Return only `{ configured: boolean }` from setup-status APIs.
- Provide a later Replace Key action without exposing the existing value.

Skipping setup persists in browser `localStorage` because it is a non-secret preference. It does not create a server-side identity or account.

## Retrieval architecture

Use hybrid local retrieval followed by model reranking and response generation.

### Offline corpus index

A generation script creates a committed, non-secret retrieval index from every page’s stable ID, lesson, original text, and familiar reading. It stores one default 1,536-dimension `text-embedding-3-small` vector per section plus the embedding model and dimensions used. The script validates that all 415 unique page IDs are present before writing atomically.

The generated vectors are safe to publish because they contain no API key or user content. They eliminate the need for each installed copy to upload the book or build a hosted vector store.

### Request-time retrieval

For each Ask Marcus request:

1. Validate and normalize the user’s text, with a maximum length of 4,000 characters.
2. Create one query embedding using `text-embedding-3-small`.
3. Compute cosine similarity against the committed vectors locally.
4. Compute a lightweight lexical score over lessons, original text, and familiar readings.
5. Merge semantic and lexical ranks into a diverse candidate set of 32 sections.
6. Send only the user situation and those candidate sections to `gpt-5.6-luna` through the Responses API.
7. Use low reasoning effort initially for latency, with representative evaluation fixtures determining whether medium provides a meaningful quality gain.
8. Set `store: false` and require strict structured output.

This approach is preferred over sending all 415 sections on every request because it reduces latency, token usage, and cost. It is preferred over hosted file search because it avoids per-user vector-store setup and persistent cloud corpus state.

## Model contract

The server requires a JSON object with this logical shape:

```json
{
  "message": "A concise, compassionate paragraph in the restrained voice of Marcus Aurelius.",
  "selections": [
    {
      "id": "book-02-section-01",
      "reason": "A brief explanation of why this passage is useful now."
    }
  ]
}
```

Validation rules:

- `message` is one non-empty paragraph of 60–180 words.
- `selections` contains exactly ten entries.
- Every ID is unique, exists in the candidate set, and resolves to the local corpus.
- Every reason is one or two sentences, no more than 60 words, specific to the user’s situation, and non-empty.
- The server enriches selections with trusted local labels, lessons, readings, and illustration paths rather than accepting those fields from the model.
- A malformed or invalid model response receives one bounded repair attempt; a second failure returns a calm retryable error without partial recommendations.

## Marcus voice and safety prompt

The system prompt directs the model to:

- Speak with warmth, composure, humility, clarity, and practical Stoic judgment.
- Sound as though Marcus were writing privately to another person, while avoiding faux-archaic language, grandiosity, quotations not present in the supplied text, and theatrical references to emperorship.
- Acknowledge the person’s experience before offering guidance.
- Avoid diagnosis, moralizing, certainty about facts not supplied, or suggesting that difficult emotions are personal failures.
- Explain why each selected passage applies without merely paraphrasing it.
- Prefer passages that collectively address distinct dimensions of the situation rather than ten near-duplicates.

If the text indicates imminent self-harm, harm to another person, abuse, or immediate danger, the application must display direct, modern safety guidance before philosophical content. Meditations is never presented as emergency, legal, or medical care. The model may still select passages only after the immediate safety message is clear.

## Server endpoints

- `GET /api/setup-status` returns whether the current server has a usable key loaded.
- `POST /api/setup-key` validates and stores a submitted key without echoing it.
- `POST /api/ask-marcus` validates input, retrieves candidates, calls OpenAI, validates structured output, and returns trusted enriched recommendations.

All other paths retain the existing static-file behavior. API responses use JSON, disable caching for personal content, enforce method checks, and avoid stack traces or sensitive upstream details.

## Client structure

Split the current client responsibilities rather than continuing to grow one file:

- `src/app.js` coordinates top-level view state and startup.
- `src/reader.js` owns the existing StPageFlip reader, full-book mode, and recommended-path mode.
- `src/setup.js` owns setup-status and key-submission interactions.
- `src/ask-marcus.js` owns the form, loading state, result rendering, and opening a recommendation path.
- `src/styles.css` contains shared design tokens and base layout.
- `src/start.css` owns Start, Setup, and Ask styling; `src/reader.css` owns the existing reader and page-flip styling.

No frontend framework is introduced; the application remains small, local, and dependency-light.

## Server structure

- `server.mjs` owns HTTP routing, static serving, loopback binding, and safe JSON response utilities.
- `src/server/config.mjs` owns environment loading and atomic key persistence.
- `src/server/retrieval.mjs` owns index loading, cosine scoring, lexical scoring, and candidate merging.
- `src/server/ask-marcus.mjs` owns prompt construction, Responses API calls, schema validation, and local result enrichment.
- `scripts/generate-retrieval-index.mjs` owns reproducible corpus embedding generation.

The server uses the official `openai` JavaScript SDK for Responses API structured outputs and embeddings. The key is read at request time from server configuration and never imported into browser modules.

## Failure behavior

- Missing key: Ask Marcus offers setup while full-book reading remains available.
- Invalid key during setup: show a concise inline error and do not persist it.
- Invalid or revoked configured key: show a reconfiguration action without deleting the full-reader state.
- Network or rate-limit failure: preserve the user’s unsaved textarea content in memory and offer Retry.
- Missing/corrupt retrieval index: disable Ask Marcus with a local configuration error while retaining the reader.
- Invalid model JSON: attempt one repair, then show a retryable response error.
- Unknown model IDs: reject them server-side rather than navigating incorrectly.

## Testing and evaluation

Automated tests cover:

- Setup routing for configured, skipped, and unconfigured states.
- Key files are ignored, stored with restrictive permissions, and never returned by endpoints.
- Server binds only to loopback.
- Retrieval index completeness and stable-ID alignment.
- Deterministic semantic/lexical rank merging with fixture vectors.
- Prompt construction and strict response validation.
- Exactly ten unique, valid recommended sections.
- Recommended-path traversal, Full Book restoration, mode toggles, keyboard navigation, and realistic page turns.
- API error, invalid-key, malformed-output, and retry behavior.
- Static start/setup/ask accessibility hooks and reduced-motion behavior.

Representative evaluation cases cover grief, conflict, anxiety about uncertainty, failure, anger, loneliness, responsibility, mortality, unfair treatment, and loss of direction. Each fixture records relevant passage families rather than one brittle exact ranking. A live opt-in smoke test confirms the configured model and schema against the user’s key without printing personal content or secrets.

## Distribution and documentation

The README documents:

- Full-reader operation without AI.
- Optional first-run key setup.
- What is sent to OpenAI when Ask Marcus is used.
- Local key location and replacement/removal instructions.
- The fact that `.env.local` must never be committed.
- Retrieval-index regeneration for maintainers.

The GitHub-ready project includes no generated user questions, responses, keys, API logs, or machine-specific paths.

## Official OpenAI basis

Current official guidance identifies `gpt-5.6-luna` as the efficient high-volume GPT-5.6 model, recommends the Responses API for reasoning workflows, and recommends low reasoning effort for latency-sensitive workloads:

- <https://developers.openai.com/api/docs/guides/latest-model#update-api-and-model-parameters>
