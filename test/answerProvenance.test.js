import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFromKnowledge, answerWithOpenAI } from '../src/answering.js';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

test('answerWithOpenAI parses claim-level source attribution', async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.instructions, /валидный JSON/);
    return response({
      output_text: JSON.stringify({
        answer: 'Vinăria Somma находится в Чумай. Для утки это интересный вариант.',
        claims: [
          { text: 'Vinăria Somma находится в Чумай.', sourceNumbers: [1], kind: 'fact', confidence: 'high' },
          { text: 'Для утки это интересный вариант.', sourceNumbers: [], kind: 'recommendation', confidence: 'medium', note: 'Гастрономический вывод.' }
        ]
      })
    });
  };

  const result = await answerWithOpenAI({
    query: 'Где находится Somma и с чем сочетать?',
    evidence: [{ id: 'a', title: 'Guide', type: 'book', text: 'Somma is in Ciumai.', metadata: { page: 84 } }],
    apiKey: 'test',
    fetchImpl,
    assistantSettings: { answerLength: 'medium' },
    allowInference: true
  });

  assert.equal(result.text, 'Vinăria Somma находится в Чумай. Для утки это интересный вариант.');
  assert.equal(result.claims.length, 2);
  assert.deepEqual(result.claims[0].sourceNumbers, [1]);
  assert.equal(result.claims[1].kind, 'recommendation');
});

test('answerFromKnowledge attaches claims to documents and separates AI inference', async () => {
  const knowledgeService = {
    retrieve: async () => ({
      found: true,
      results: [{
        id: 'chunk-1', type: 'book', title: 'Ghid Vin-Divin Moldova', sourceUrl: null, score: 0.91,
        text: 'Somma is in Ciumai.', metadata: { documentId: 'doc-1', page: 84, chunkIndex: 12 }
      }]
    }),
    noEvidenceAnswer: () => 'Нет ответа.'
  };
  const answerProvider = async () => ({
    text: 'Somma находится в Чумай. Я бы рекомендовал начать с белого вина.',
    model: 'test-model',
    claims: [
      { text: 'Somma находится в Чумай.', sourceNumbers: [1], kind: 'fact', confidence: 'high', note: '' },
      { text: 'Я бы рекомендовал начать с белого вина.', sourceNumbers: [], kind: 'recommendation', confidence: 'medium', note: 'Вывод по стилю.' }
    ]
  });

  const result = await answerFromKnowledge({
    query: 'Расскажи про Somma', knowledgeService, catalogService: null, answerProvider,
    apiKey: 'test', model: 'test', mode: 'expert', assistantSettings: {}
  });

  assert.equal(result.sources[0].title, 'Ghid Vin-Divin Moldova');
  assert.deepEqual(result.sources[0].claimTexts, ['Somma находится в Чумай.']);
  const inference = result.sources.find((item) => item.type === 'inference');
  assert.ok(inference);
  assert.deepEqual(inference.claimTexts, ['Я бы рекомендовал начать с белого вина.']);
});

test('web fallback keeps web citations separate from the spoken answer', async () => {
  const knowledgeService = { retrieve: async () => ({ found: false, results: [] }), noEvidenceAnswer: () => 'Нет ответа.' };
  const generalAnswerProvider = async () => ({
    text: 'Экскурсии начинаются в 10:00.', model: 'test-model',
    webSources: [{ id: 'https://example.com', type: 'web', title: 'Official winery', sourceUrl: 'https://example.com', claimTexts: ['Экскурсии начинаются в 10:00.'] }]
  });

  const result = await answerFromKnowledge({
    query: 'Во сколько экскурсия?', knowledgeService, catalogService: null,
    answerProvider: async () => { throw new Error('not used'); }, generalAnswerProvider,
    apiKey: 'test', model: 'test', mode: 'knowledge_web', assistantSettings: {}
  });

  assert.equal(result.answer, 'Экскурсии начинаются в 10:00.');
  assert.equal(result.answerLayer, 'web');
  assert.equal(result.sources[0].type, 'web');
  assert.deepEqual(result.sources[0].claimTexts, ['Экскурсии начинаются в 10:00.']);
});
