import { retrieveCandidates } from './retrieval.mjs';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const RESPONSE_MODEL = 'gpt-5.6-luna';
const CANDIDATE_LIMIT = 32;
const SECTION_COUNT = 10;

export const MARCUS_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'sections'],
  properties: {
    message: { type: 'string' },
    sections: {
      type: 'array', minItems: SECTION_COUNT, maxItems: SECTION_COUNT,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'reason'],
        properties: { id: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
};

export function buildMarcusResponseSchema(candidateIds) {
  return {
    ...MARCUS_RESPONSE_SCHEMA,
    properties: {
      ...MARCUS_RESPONSE_SCHEMA.properties,
      sections: {
        ...MARCUS_RESPONSE_SCHEMA.properties.sections,
        items: {
          ...MARCUS_RESPONSE_SCHEMA.properties.sections.items,
          properties: {
            ...MARCUS_RESPONSE_SCHEMA.properties.sections.items.properties,
            id: { type: 'string', enum: [...candidateIds] },
          },
        },
      },
    },
  };
}

function normalizedInput(input) {
  if (typeof input !== 'string') throw requestError('invalid_input', 'A question is required');
  const value = input.replace(/\r\n?/g, '\n').trim();
  if (!value || value.length > 4000) throw requestError('invalid_input', 'Question must be between 1 and 4,000 characters');
  return value;
}

function requestError(code, message) {
  return Object.assign(new Error(message), { code });
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function buildMarcusInstructions() {
  return 'Write as a thoughtful modern voice carrying Marcus Aurelius\'s perspective, not as Marcus in costume. Be compassionate, plainspoken, Stoic, specific, warm, restrained, practical, non-archaic, and non-diagnostic. Do not invent quotations, role-play an emperor, imitate Marcus cheesily, or use theatrical language. Respond with exactly one paragraph of 60 to 180 words. Choose exactly ten distinct IDs only from the supplied candidates. Give each selection a concise reason of at most 60 words. Never supply labels, lessons, passages, or other corpus fields.';
}

export function buildCandidateInput(candidates) {
  return { candidates: candidates.map(({ id, label, lesson, text, modernVersion }) => ({ id, label, lesson, text, modernVersion })) };
}

export function validateMarcusResponse(value, allowedIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Response must be an object');
  if (typeof value.message !== 'string' || /\n\s*\n/.test(value.message) || wordCount(value.message) < 60 || wordCount(value.message) > 180) {
    throw new TypeError('Message must be one paragraph of 60 to 180 words');
  }
  if (!Array.isArray(value.sections) || value.sections.length !== SECTION_COUNT) throw new TypeError('Response must contain exactly ten sections');
  const selected = new Set();
  for (const section of value.sections) {
    if (!section || typeof section !== 'object' || typeof section.id !== 'string' || typeof section.reason !== 'string') throw new TypeError('Each section requires an ID and reason');
    if (!allowedIds.has(section.id)) throw new TypeError('Section ID is not a trusted candidate');
    if (selected.has(section.id)) throw new TypeError('Section IDs must be unique');
    if (!section.reason.trim() || wordCount(section.reason) > 60) throw new TypeError('Section reason must be at most 60 words');
    selected.add(section.id);
  }
  return { message: value.message.trim(), sections: value.sections.map(({ id, reason }) => ({ id, reason: reason.trim() })) };
}

export function enrichMarcusResponse(response, pages) {
  const trusted = new Map(pages.map((page) => [page.id, page]));
  return {
    message: response.message,
    sections: response.sections.map(({ id, reason }) => {
      const page = trusted.get(id);
      if (!page) throw new TypeError('Selected page is not trusted');
      return { id, label: page.label, lesson: page.lesson, text: page.text, modernVersion: page.modernVersion, reason };
    }),
  };
}

function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  throw new TypeError('Response did not include JSON output');
}

function safetyBanner(moderation) {
  const categories = moderation?.results?.[0]?.categories ?? {};
  if (categories['self-harm'] || categories.violence) {
    return 'If you may hurt yourself or someone else, contact local emergency services now. In the US or Canada, call or text 988 for immediate crisis support. Reach out to a trusted person and stay with others if you can.';
  }
  return undefined;
}

function classifyRemoteError(error) {
  if (error?.status === 429) return requestError('rate_limited', 'The service is temporarily busy. Please try again shortly.');
  if (error?.status === 401 || error?.status === 403) return requestError('invalid_key', 'The configured service key could not be accepted.');
  return requestError('service_unavailable', 'The guidance service is unavailable. Please try again later.');
}

export function createAskMarcusService({ client, pages, index } = {}) {
  async function ask({ input }) {
    if (!client?.embeddings?.create || !client?.moderations?.create || !client?.responses?.create) throw requestError('key_required', 'Guidance is not configured');
    const question = normalizedInput(input);
    try {
      const moderation = await client.moderations.create({ model: 'omni-moderation-latest', input: question });
      const embedding = await client.embeddings.create({ model: EMBEDDING_MODEL, input: question });
      const queryVector = embedding?.data?.[0]?.embedding;
      const candidates = retrieveCandidates({ query: question, queryVector, pages, index, limit: CANDIDATE_LIMIT });
      const allowedIds = new Set(candidates.map(({ id }) => id));
      const responseSchema = buildMarcusResponseSchema(allowedIds);
      const request = {
        model: RESPONSE_MODEL, reasoning: { effort: 'low' }, store: false,
        instructions: buildMarcusInstructions(),
        input: [{ role: 'user', content: question }, { role: 'user', content: JSON.stringify(buildCandidateInput(candidates)) }],
        text: { format: { type: 'json_schema', name: 'marcus_guidance', strict: true, schema: responseSchema } },
      };
      let validationProblem;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await client.responses.create(attempt === 0 ? request : {
          ...request,
          input: [...request.input, { role: 'user', content: `Validation errors: ${validationProblem}. Return corrected JSON using the same candidate IDs only.` }],
        });
        try {
          const validated = validateMarcusResponse(JSON.parse(outputText(response)), allowedIds);
          const banner = safetyBanner(moderation);
          return { ...enrichMarcusResponse(validated, pages), ...(banner ? { safetyBanner: banner } : {}) };
        } catch (error) {
          validationProblem = error.message;
        }
      }
      throw requestError('invalid_model_output', 'The guidance response could not be validated');
    } catch (error) {
      if (error?.code) throw error;
      throw classifyRemoteError(error);
    }
  }
  return { ask };
}
