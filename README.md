# Meditations Reader

A local reader for the complete public-domain George Long translation of Marcus Aurelius’s *Meditations*. Read the complete book offline: each numbered section is a stable local JSON page, and the original text is always available without an API key.

## Read

Start the reader with:

```bash
meditations
```

It opens at `http://127.0.0.1:4173`. Use `meditations --no-open` to start only the loopback server.

The reader includes Original and Familiar versions, a contents view, Random, Previous and Next controls, and left/right arrow-key navigation. Use Fullscreen to enter fullscreen mode and `Escape` to leave it. Choose Full Book to read the complete text in one continuous view.

## First-run setup and Ask Marcus

On first run, API-key setup is optional. Select Skip to continue with all offline reading features; you can add or replace a key later through Setup. The key is stored only in `.env.local`, which must be owner-only (`0600`). To remove it, delete `.env.local` without opening or printing it, then use Setup again if you later want to add a replacement.

Ask Marcus offers a guided question flow plus a ten-section Explore path. For either a synthetic evaluation question or a question you enter, the server sends the question to OpenAI for moderation, query embedding, and a Responses-generation request. Final selection receives only 32 trusted local candidate passages. Responses requests use `store: false`, and the app does not persist questions or responses.

`.env.local` and other environment files are excluded from GitHub; `.env.example` contains only the empty `OPENAI_API_KEY=` variable. Do not place a key in any other project file.

## Data and maintenance

The source snapshot is `data/source/meditations-long.txt`; generated reader pages are `data/meditations.pages.json`. Regenerate the public retrieval index with:

```bash
npm run generate:retrieval
```

`data/meditations.retrieval.json` contains public, non-personal source vectors only. See `docs/sources.md` for attribution and rights information.

## Development and checks

```bash
npm install
npm run fetch-source
npm run parse
npm run generate:modern
npm run generate:lessons
npm run generate:retrieval
npm test
npm start
```

`npm run test:live` runs the approved live Ask Marcus evaluation and may use the configured API key; do not run it casually. The measured model decision is `gpt-5.6-luna` with low reasoning: the strengthened evaluation recorded 10/10 valid, 10/10 relevant, 8/10 automated modern/practical style, no duplicate sets, and about 5.6 seconds average. This automated quality gate is useful for regression checks, but it is not a substitute for human judgment.

## Manual acceptance checklist

- Start `meditations` and confirm the server remains loopback-only.
- Read Original and Familiar passages; use contents, Random, Previous/Next, arrow keys, fullscreen/`Escape`, and Full Book.
- Confirm first-run Setup can be skipped and reopened.
- With a deliberately configured key, try the Ask Marcus flow and all ten Explore sections.

Browser visual verification depends on an available interactive browser session and is not guaranteed by automated checks alone.
