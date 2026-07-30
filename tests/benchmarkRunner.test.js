import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BenchmarkDatasetRepository } from '../src/benchmark/BenchmarkDatasetRepository.js';
import { BenchmarkRunRepository } from '../src/benchmark/BenchmarkRunRepository.js';
import { BenchmarkRunnerService } from '../src/benchmark/BenchmarkRunnerService.js';
import { KnowledgeService, splitCompoundQuery } from '../src/knowledge/KnowledgeService.js';

test('compound query is split into useful subqueries', () => {
  const parts = splitCompoundQuery('Когда основана винодельня и какие вина она выпускает?');
  assert.ok(parts.length >= 2);
});

test('knowledge service merges evidence from compound subqueries', async () => {
  const provider = { search: async ({ query }) => query.includes('основана') ? [{ id:'a', title:'A', text:'Основана в 1994', score:.9 }] : [{ id:'b', title:'B', text:'Выпускает X', score:.8 }] };
  const service = new KnowledgeService({ provider, minScore:.1, maxResults:8 });
  const result = await service.retrieve('Когда основана винодельня и какие вина она выпускает?');
  assert.deepEqual(new Set(result.results.map(x=>x.id)), new Set(['a','b']));
});

test('runner scores positive, negative and multi-source cases', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'wine-run-'));
  const datasets = new BenchmarkDatasetRepository({ directory:path.join(dir,'sets') });
  const runs = new BenchmarkRunRepository({ directory:path.join(dir,'runs') });
  await datasets.save({ datasetId:'d1', documentId:'doc', items:[
    { id:'p1', polarity:'positive', question:'Когда и что?', referenceAnswer:'Основана в 1994 году. Выпускает X.', expectedFacts:[{id:'f1',text:'основана в 1994 году',evidenceChunkIds:['c1']},{id:'f2',text:'выпускает X',evidenceChunkIds:['c2']}], evidences:[{chunkId:'c1'},{chunkId:'c2'}] },
    { id:'n1', polarity:'negative', question:'Цена?' }
  ]});
  const runner = new BenchmarkRunnerService({ datasetRepository:datasets, runRepository:runs, answerQuestion:async ({query}) => query==='Цена?' ? {answer:'нет',refused:true,sources:[]} : {answer:'Винодельня основана в 1994 году и выпускает X.',refused:false,sources:[{id:'c1'},{id:'c2'}],retrieval:{subqueries:['Когда','что']}} });
  const run = await runner.run({ datasetId:'d1' });
  assert.equal(run.stats.passed,2);
  assert.equal(run.stats.multiSourceAccuracy,1);
  assert.equal((await runs.get(run.runId)).runId,run.runId);
});
