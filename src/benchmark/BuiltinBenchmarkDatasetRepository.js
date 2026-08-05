import { wineAiBenchmarkMvp } from '../../data/benchmark/wine-ai-mvp.js';

const CREATED_AT = '2026-08-05T00:00:00.000Z';

function builtInDataset() {
  const categories = Object.fromEntries(
    [...new Set(wineAiBenchmarkMvp.map(item => item.category))]
      .map(category => [category, wineAiBenchmarkMvp.filter(item => item.category === category).length])
  );
  return {
    schemaVersion: '1.1',
    datasetId: 'wine-ai-mvp-200',
    title: 'WINE AI Benchmark MVP · 200 вопросов',
    documentId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    stats: { total: wineAiBenchmarkMvp.length, categories },
    items: wineAiBenchmarkMvp.map(item => ({
      ...item,
      polarity: 'positive',
      expectedFacts: [],
      evidence: []
    }))
  };
}

export class BuiltinBenchmarkDatasetRepository {
  constructor({ repository }) {
    this.repository = repository;
  }

  async save(dataset) {
    if (dataset?.datasetId === 'wine-ai-mvp-200') {
      throw Object.assign(new Error('Built-in benchmark is read-only'), { code: 'BUILTIN_DATASET_READ_ONLY' });
    }
    return this.repository.save(dataset);
  }

  async get(datasetId) {
    if (datasetId === 'wine-ai-mvp-200') return builtInDataset();
    return this.repository.get(datasetId);
  }

  async list() {
    const items = await this.repository.list();
    const builtin = builtInDataset();
    return [
      {
        datasetId: builtin.datasetId,
        title: builtin.title,
        documentId: null,
        createdAt: builtin.createdAt,
        updatedAt: builtin.updatedAt,
        stats: builtin.stats,
        builtin: true
      },
      ...items.filter(item => item.datasetId !== builtin.datasetId)
    ];
  }

  async remove(datasetId) {
    if (datasetId === 'wine-ai-mvp-200') {
      throw Object.assign(new Error('Built-in benchmark cannot be deleted'), { code: 'BUILTIN_DATASET_READ_ONLY' });
    }
    return this.repository.remove(datasetId);
  }
}

export { builtInDataset };
