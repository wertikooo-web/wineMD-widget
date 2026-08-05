import { wineAiBenchmarkMvp } from '../../data/benchmark/wine-ai-mvp.js';

export const WINE_AI_MVP_DATASET_ID = 'wine-ai-mvp-200';

export function buildWineAiMvpDataset(now = new Date().toISOString()) {
  const items = wineAiBenchmarkMvp.map((item) => ({
    id: item.id,
    status: 'approved',
    polarity: 'positive',
    category: item.category,
    difficulty: item.difficulty,
    language: item.language,
    question: item.question,
    referenceAnswer: '',
    expectedFacts: [],
    evidence: [],
    sourcePolicy: item.source_policy,
    checks: item.checks,
    evaluationMode: 'diagnostic'
  }));

  return {
    schemaVersion: '1.0',
    datasetId: WINE_AI_MVP_DATASET_ID,
    title: 'WINE AI Benchmark MVP · 200 вопросов',
    documentId: null,
    createdAt: now,
    updatedAt: now,
    kind: 'cross_source_regression',
    evaluationMode: 'diagnostic',
    stats: {
      complete: true,
      requested: items.length,
      generated: items.length,
      accepted: items.length,
      positive: items.length,
      negative: 0,
      rejected: 0
    },
    items,
    rejected: []
  };
}

export async function installWineAiMvpDataset(repository) {
  let existing = null;
  try { existing = await repository.get(WINE_AI_MVP_DATASET_ID); } catch {}
  const now = new Date().toISOString();
  const dataset = buildWineAiMvpDataset(existing?.createdAt ?? now);
  dataset.updatedAt = now;
  await repository.save(dataset);
  return dataset;
}
