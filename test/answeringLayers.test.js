import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFromKnowledge, answerGeneralWithOpenAI } from '../src/answering.js';

test('knowledge_web uses web only when internal retrieval is empty', async () => {
  let webSearchEnabled = false;
  const result = await answerFromKnowledge({
    query: 'Какие экскурсии доступны сегодня?',
    knowledgeService: {
      retrieve: async () => ({ found: false, results: [] }),
      noEvidenceAnswer: () => 'Нет данных'
    },
    catalogService: null,
    answerProvider: async () => { throw new Error('must not be called'); },
    generalAnswerProvider: async (args) => {
      webSearchEnabled = args.enableWebSearch;
      return {
        text: 'Сегодня доступны две экскурсии.',
        model: 'test',
        webSources: [{ id: 'https://example.com', type: 'web', title: 'Official', sourceUrl: 'https://example.com' }]
      };
    },
    apiKey: 'test',
    model: 'test',
    mode: 'knowledge_web',
    assistantSettings: {}
  });

  assert.equal(webSearchEnabled, true);
  assert.equal(result.answerLayer, 'web');
  assert.equal(result.sources.length, 1);
  assert.equal(result.grounded, true);
});

test('knowledge_web prefers internal knowledge when retrieval is found', async () => {
  let generalCalled = false;
  const result = await answerFromKnowledge({
    query: 'Что такое Viorica?',
    knowledgeService: {
      retrieve: async () => ({
        found: true,
        results: [{ id: '1', type: 'book', title: 'Guide', text: 'Viorica is a grape.', metadata: {} }]
      })
    },
    catalogService: null,
    answerProvider: async () => ({ text: 'Viorica — сорт винограда.', model: 'test' }),
    generalAnswerProvider: async () => { generalCalled = true; return { text: 'wrong', model: 'test' }; },
    apiKey: 'test',
    model: 'test',
    mode: 'knowledge_web',
    assistantSettings: {}
  });

  assert.equal(generalCalled, false);
  assert.equal(result.answerLayer, 'knowledge');
  assert.equal(result.sources[0].title, 'Guide');
});

test('web answer request enables official Responses API web_search tool', async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output_text: 'Готовый ответ.',
        output: [{
          type: 'web_search_call',
          action: { sources: [{ type: 'url', url: 'https://example.com', title: 'Official source' }] }
        }]
      })
    };
  };

  const result = await answerGeneralWithOpenAI({
    query: 'Актуальное расписание',
    apiKey: 'test',
    model: 'test',
    fetchImpl,
    enableWebSearch: true,
    assistantSettings: { answerLength: 'medium' }
  });

  assert.deepEqual(body.tools, [{ type: 'web_search' }]);
  assert.equal(result.webSources[0].sourceUrl, 'https://example.com');
});
