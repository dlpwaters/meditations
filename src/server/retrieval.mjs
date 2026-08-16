const RRF_OFFSET = 60;

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    throw new TypeError('Vectors must have matching dimensions');
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let position = 0; position < left.length; position += 1) {
    dotProduct += left[position] * right[position];
    leftMagnitude += left[position] ** 2;
    rightMagnitude += right[position] ** 2;
  }

  return leftMagnitude === 0 || rightMagnitude === 0
    ? 0
    : dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function lexicalScore(query, text) {
  const queryTokens = new Set(tokenize(query));
  const documentTokens = new Set(tokenize(text));
  return [...queryTokens].filter((token) => documentTokens.has(token)).length;
}

export function mergeRankings(...rankings) {
  const scores = new Map();
  const firstSeen = new Map();
  let sequence = 0;

  for (const ranking of rankings) {
    const uniqueRanking = [...new Set(ranking)];
    uniqueRanking.forEach((id, rank) => {
      if (!firstSeen.has(id)) firstSeen.set(id, sequence++);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_OFFSET + rank + 1));
    });
  }

  return [...scores.keys()].sort((left, right) => (
    scores.get(right) - scores.get(left)
    || firstSeen.get(left) - firstSeen.get(right)
  ));
}

function requireFiniteVector(vector, id) {
  if (!Array.isArray(vector) || vector.length === 0 || !vector.every(Number.isFinite)) {
    throw new TypeError(`Vector for ${id} must contain finite values`);
  }
}

export function validateRetrievalIndex(pages, index) {
  if (!Array.isArray(pages) || !Array.isArray(index?.entries)) {
    throw new TypeError('Pages and index entries are required');
  }

  const pageIds = new Set();
  for (const page of pages) {
    if (!page?.id || pageIds.has(page.id)) throw new TypeError('Pages must have unique IDs');
    pageIds.add(page.id);
  }

  const entriesById = new Map();
  let dimensions;
  for (const entry of index.entries) {
    if (!entry?.id || entriesById.has(entry.id)) {
      throw new TypeError('Index must contain exactly one entry per ID');
    }
    requireFiniteVector(entry.vector, entry.id);
    if (dimensions === undefined) dimensions = entry.vector.length;
    if (entry.vector.length !== dimensions) throw new TypeError('Index vectors must have consistent dimensions');
    entriesById.set(entry.id, entry);
  }

  if (entriesById.size !== pageIds.size || [...pageIds].some((id) => !entriesById.has(id))) {
    throw new TypeError('Corpus and index IDs must exactly match');
  }

  return entriesById;
}

export function retrieveCandidates({ query, queryVector, pages, index, limit }) {
  const entriesById = validateRetrievalIndex(pages, index);
  if (!Number.isInteger(limit) || limit < 0) throw new TypeError('Limit must be a non-negative integer');
  if (pages.length === 0) return [];
  requireFiniteVector(queryVector, 'query');
  const dimensions = index.entries[0]?.vector.length;
  if (queryVector.length !== dimensions) throw new TypeError('Query and index vectors must have consistent dimensions');

  const semanticRanking = pages
    .map((page, position) => ({ id: page.id, position, score: cosineSimilarity(queryVector, entriesById.get(page.id).vector) }))
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .map(({ id }) => id);
  const lexicalRanking = pages
    .map((page, position) => ({ id: page.id, position, score: lexicalScore(query, page.text) }))
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .map(({ id }) => id);
  const pagesById = new Map(pages.map((page) => [page.id, page]));

  return mergeRankings(semanticRanking, lexicalRanking)
    .slice(0, Math.min(limit, pages.length))
    .map((id) => pagesById.get(id));
}
