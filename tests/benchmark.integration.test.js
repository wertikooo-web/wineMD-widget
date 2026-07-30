import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BenchmarkDatasetRepository } from '../src/benchmark/BenchmarkDatasetRepository.js';
import { BenchmarkDatasetService } from '../src/benchmark/BenchmarkDatasetService.js';
import { DatasetValidator } from '../src/benchmark/DatasetValidator.js';
import { OpenAIQuestionGenerator } from '../src/benchmark/OpenAIQuestionGenerator.js';
import { BenchmarkJobService } from '../src/benchmark/BenchmarkJobService.js';

test('repository persists datasets atomically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wine-bench-'));
  const repo = new BenchmarkDatasetRepository({ directory: dir });
  await repo.save({ datasetId: 'test-1', title: 'T', createdAt: '2026-01-01', stats: {} });
  assert.equal((await repo.get('test-1')).title, 'T');
  assert.equal((await repo.list()).length, 1);
});

test('service retries batches and reaches requested positive and negative counts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wine-bench-'));
  const chunksFile = path.join(dir, 'chunks.json');
  await fs.writeFile(chunksFile, JSON.stringify([
    { id: 'doc:chunk:1', documentId: 'doc', text: 'Fetească Neagră has aromas of blackberry and plum.', metadata: { page: 19 } },
    { id: 'doc:chunk:2', documentId: 'doc', text: 'Codru is the largest wine region.', metadata: { page: 15 } }
  ]));
  let positiveCall = 0;
  const generator = {
    model: 'mock',
    generateBatch: async ({ polarity }) => {
      if (polarity === 'positive') {
        positiveCall += 1;
        if (positiveCall === 1) return { items: [{ polarity: 'positive', question: 'Какие ароматы?', referenceAnswer: 'blackberry and plum', category: 'grape', difficulty: 1, questionType: 'fact', evidence: { chunkId: 'doc:chunk:1', page: 19, quote: 'blackberry and plum' } }] };
        return { items: [{ polarity: 'positive', question: 'Какой регион крупнейший?', referenceAnswer: 'Codru', category: 'region', difficulty: 1, questionType: 'fact', evidence: { chunkId: 'doc:chunk:2', page: 15, quote: 'Codru is the largest' } }] };
      }
      return { items: [{ polarity: 'negative', question: 'Какая цена сегодня?', referenceAnswer: null, category: 'boundary', difficulty: 1, questionType: 'absence', evidence: null }] };
    },
    judgeNegativeBatch: async ({ candidates }) => new Map(candidates.map(x => [x.id, { id: x.id, answerPresent: false, reason: 'Цена не указана' }]))
  };
  const service = new BenchmarkDatasetService({
    repository: new BenchmarkDatasetRepository({ directory: path.join(dir, 'sets') }),
    registry: { load: async () => [{ documentId: 'doc', title: 'Guide', status: 'active', pages: 204 }] },
    chunksFile,
    generator,
    validator: new DatasetValidator(),
    batchSize: 1,
    maxAttempts: 4
  });
  const dataset = await service.generate({ documentId: 'doc', positiveCount: 2, negativeCount: 1 });
  assert.equal(dataset.stats.positive, 2);
  assert.equal(dataset.stats.negative, 1);
  assert.equal(dataset.stats.complete, true);
  assert.equal(dataset.items.length, 3);
});

test('job service returns immediately and completes in background', async () => {
  const jobs = new BenchmarkJobService({ datasetService: { generate: async ({ onProgress }) => { onProgress({ phase: 'generating_positive', message: 'working', approved: 1 }); return { datasetId: 'dataset-1', status: 'complete', stats: { complete: true } }; } } });
  const job = jobs.create({ documentId: 'doc' });
  assert.equal(job.status, 'queued');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(jobs.get(job.jobId).status, 'completed');
  assert.equal(jobs.get(job.jobId).datasetId, 'dataset-1');
});

test('benchmark generator rejects a non-ASCII placeholder API key with a clear error', async () => {
  const generator = new OpenAIQuestionGenerator({ apiKey: 'ваш_ключ', fetchImpl: async () => { throw new Error('fetch must not run'); } });
  await assert.rejects(
    () => generator.generate({ document: {}, chunks: [], positiveCount: 1, negativeCount: 0 }),
    error => error.code === 'BENCHMARK_INVALID_API_KEY' && /API-ключ/.test(error.message)
  );
});
