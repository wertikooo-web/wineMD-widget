import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWineAiMvpDataset, WINE_AI_MVP_DATASET_ID } from '../src/benchmark/installWineAiMvpDataset.js';
import { readFile } from 'node:fs/promises';

test('runtime benchmark installer builds the 200-question dataset used by the existing runner', () => {
  const dataset = buildWineAiMvpDataset('2026-08-05T00:00:00.000Z');
  assert.equal(dataset.datasetId, WINE_AI_MVP_DATASET_ID);
  assert.equal(dataset.items.length, 200);
  assert.equal(dataset.stats.accepted, 200);
  assert.equal(new Set(dataset.items.map(x => x.id)).size, 200);
  assert.ok(dataset.items.every(x => x.status === 'approved'));
  assert.ok(dataset.items.every(x => x.evaluationMode === 'diagnostic'));
  assert.ok(dataset.items.every(x => x.sourcePolicy && x.checks));
});

test('admin benchmark MVP screen can install and run the dataset through benchmark APIs', async () => {
  const html = await readFile(new URL('../public/admin/benchmark-mvp.html', import.meta.url), 'utf8');
  assert.match(html, /wine-ai-mvp-200/);
  assert.match(html, /benchmark-mvp\/install/);
  assert.match(html, /\/api\/admin\/benchmark\/datasets\/\$\{datasetId\}\/run/);
  assert.match(html, /Запустить все 200 вопросов/);
});
