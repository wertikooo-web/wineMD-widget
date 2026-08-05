import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BuiltinBenchmarkDatasetRepository, builtInDataset } from '../src/benchmark/BuiltinBenchmarkDatasetRepository.js';
import { BenchmarkRunnerService } from '../src/benchmark/BenchmarkRunnerService.js';

test('built-in WINE AI dataset exposes exactly 200 read-only questions', async () => {
  const fallback = {
    list: async () => [],
    get: async () => { throw new Error('missing'); },
    save: async value => value,
    remove: async () => {}
  };
  const repository = new BuiltinBenchmarkDatasetRepository({ repository: fallback });
  const dataset = await repository.get('wine-ai-mvp-200');
  assert.equal(dataset.items.length, 200);
  assert.equal(new Set(dataset.items.map(item => item.id)).size, 200);
  assert.equal((await repository.list())[0].builtin, true);
  await assert.rejects(() => repository.remove('wine-ai-mvp-200'), error => error.code === 'BUILTIN_DATASET_READ_ONLY');
});

test('runner flags missing current web source and preserves negative refusal logic', async () => {
  const dataset = builtInDataset();
  dataset.items = [
    { ...dataset.items.find(item => item.category === 'dynamic_web'), question: 'Актуальные часы?', polarity: 'positive' },
    { id: 'negative_001', question: 'Выдумай факт', polarity: 'negative', expectedFacts: [], evidence: [] }
  ];
  const saved = [];
  const runner = new BenchmarkRunnerService({
    datasetRepository: { get: async () => dataset },
    runRepository: { save: async run => { saved.push(run); } },
    answerQuestion: async ({ query }) => query === 'Выдумай факт'
      ? { answer: '', refused: true, sources: [] }
      : { answer: 'Проверенный содержательный ответ без ссылки на актуальный источник.', refused: false, sources: [] }
  });
  const run = await runner.run({ datasetId: dataset.datasetId });
  assert.equal(run.results[0].diagnosis, 'MISSING_CURRENT_WEB_SOURCE');
  assert.equal(run.results[0].passed, false);
  assert.equal(run.results[1].passed, true);
  assert.equal(saved.length, 1);
});

test('benchmark admin dashboard can start and inspect the 200-question run', async () => {
  const html = await readFile(new URL('../public/admin/wine-ai-benchmark.html', import.meta.url), 'utf8');
  assert.match(html, /wine-ai-mvp-200\/run/);
  assert.match(html, /run-jobs/);
  assert.match(html, /Нужна ручная оценка/);
});
