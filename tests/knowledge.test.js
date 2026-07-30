import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KnowledgeService } from '../src/knowledge/KnowledgeService.js';
import { LocalKnowledgeProvider } from '../src/knowledge/providers/LocalKnowledgeProvider.js';
import { KosKnowledgeProvider } from '../src/knowledge/providers/KosKnowledgeProvider.js';
import { answerFromKnowledge } from '../src/answering.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(__dirname, '../src/knowledge/data/winemd.sample.json');

test('local provider finds relevant Wine.md evidence', async () => {
  const service = new KnowledgeService({
    provider: new LocalKnowledgeProvider({ dataFile }),
    minScore: 0.2,
    maxResults: 3
  });
  const result = await service.retrieve('Какое сухое белое вино подойдёт к рыбе?');
  assert.equal(result.found, true);
  assert.ok(result.results.length > 0);
  assert.match(result.results[0].text, /рыб|бел/i);
});

test('closed retrieval returns no evidence for unrelated question', async () => {
  const service = new KnowledgeService({
    provider: new LocalKnowledgeProvider({ dataFile }),
    minScore: 0.34,
    maxResults: 5
  });
  const result = await service.retrieve('Какая сегодня погода в Кишинёве?');
  assert.equal(result.found, false);
  assert.deepEqual(result.results, []);
});

test('answer generation is not called when evidence is absent', async () => {
  let generatorCalled = false;
  const knowledgeService = new KnowledgeService({
    provider: { search: async () => [] },
    minScore: 0.1,
    maxResults: 5
  });
  const result = await answerFromKnowledge({
    query: 'Как у тебя дела?',
    knowledgeService,
    answerProvider: async () => { generatorCalled = true; return { text: 'Недопустимо' }; },
    apiKey: 'test-key',
    model: 'test-model'
  });
  assert.equal(generatorCalled, false);
  assert.equal(result.refused, true);
  assert.match(result.answer, /нет точной информации/i);
});

test('answer generator receives only retrieved evidence', async () => {
  let receivedEvidence;
  const knowledgeService = new KnowledgeService({
    provider: { search: async () => [{ id: '1', type: 'wine', title: 'Wine A', text: 'Только подтверждённый факт.', score: 0.9 }] },
    minScore: 0.3,
    maxResults: 5
  });
  const result = await answerFromKnowledge({
    query: 'Расскажи о Wine A',
    knowledgeService,
    answerProvider: async ({ evidence }) => {
      receivedEvidence = evidence;
      return { text: 'Только подтверждённый факт.', model: 'mock' };
    },
    apiKey: 'test-key',
    model: 'mock'
  });
  assert.equal(result.refused, false);
  assert.equal(receivedEvidence.length, 1);
  assert.equal(receivedEvidence[0].id, '1');
  assert.equal(result.sources[0].title, 'Wine A');
});

test('KOS provider can replace local provider through the same contract', async () => {
  const provider = new KosKnowledgeProvider({
    searchClient: {
      search: async () => ({
        results: [{ id: 'kos-1', title: 'KOS result', text: 'KOS fact', score: 0.95, type: 'wine' }]
      })
    }
  });
  const service = new KnowledgeService({ provider, minScore: 0.3, maxResults: 5 });
  const result = await service.retrieve('KOS wine');
  assert.equal(result.found, true);
  assert.equal(result.results[0].id, 'kos-1');
});
