import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogService } from '../src/catalog/CatalogService.js';
import { LocalCatalogProvider } from '../src/catalog/providers/LocalCatalogProvider.js';
import { WineMdCatalogProvider } from '../src/catalog/providers/WineMdCatalogProvider.js';
import { KnowledgeService } from '../src/knowledge/KnowledgeService.js';
import { answerFromKnowledge } from '../src/answering.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(__dirname, '../src/catalog/data/winemd.catalog.sample.json');

test('local catalog returns products in requested order', async () => {
  const service = new CatalogService({ provider: new LocalCatalogProvider({ dataFile }), maxProducts: 5 });
  const products = await service.getProductsByIds(['product-feteasca-alba', 'product-rara-neagra']);
  assert.equal(products.length, 2);
  assert.equal(products[0].id, 'product-feteasca-alba');
  assert.match(products[0].imageUrl, /feteasca-alba\.svg$/);
});

test('catalog service removes duplicate ids and invalid products', async () => {
  const service = new CatalogService({
    provider: { getProductsByIds: async () => [{ id: '1', name: 'Wine', winery: 'Winery', imageUrl: '/wine.svg', productUrl: 'https://wine.md/', inStock: true }] },
    maxProducts: 5
  });
  const products = await service.getProductsByIds(['1', '1']);
  assert.equal(products.length, 1);
});

test('grounded answer attaches only products linked by evidence metadata', async () => {
  let requestedIds;
  const knowledgeService = new KnowledgeService({
    provider: { search: async () => [{ id: 'wine-1', type: 'wine', title: 'Wine', text: 'К рыбе подходит.', score: 0.9, metadata: { productIds: ['product-1'] } }] },
    minScore: 0.3,
    maxResults: 5
  });
  const result = await answerFromKnowledge({
    query: 'Что к рыбе?',
    knowledgeService,
    catalogService: { getProductsByIds: async (ids) => { requestedIds = ids; return [{ id: 'product-1', name: 'Wine', winery: 'Winery', imageUrl: '/wine.svg', productUrl: 'https://wine.md/', inStock: true }]; } },
    answerProvider: async () => ({ text: 'Подойдёт Wine.', model: 'mock' }),
    apiKey: 'test',
    model: 'mock'
  });
  assert.deepEqual(requestedIds, ['product-1']);
  assert.equal(result.products[0].id, 'product-1');
});

test('refusal never returns product cards', async () => {
  const result = await answerFromKnowledge({
    query: 'Погода?',
    knowledgeService: { retrieve: async () => ({ found: false, results: [] }), noEvidenceAnswer: () => 'Нет данных.' },
    catalogService: { getProductsByIds: async () => { throw new Error('must not be called'); } },
    answerProvider: async () => { throw new Error('must not be called'); }
  });
  assert.deepEqual(result.products, []);
});

test('Wine.md API provider replaces local provider through the same contract', async () => {
  const provider = new WineMdCatalogProvider({ catalogClient: { getProductsByIds: async (ids) => ids.map((id) => ({ id, name: 'Wine', winery: 'Winery', imageUrl: '/wine.svg', productUrl: 'https://wine.md/' })) } });
  const service = new CatalogService({ provider });
  const products = await service.getProductsByIds(['external-1']);
  assert.equal(products[0].id, 'external-1');
});

test('catalog outage does not hide a grounded answer', async () => {
  const knowledgeService = new KnowledgeService({
    provider: { search: async () => [{ id: 'wine-1', type: 'wine', title: 'Wine', text: 'Подтверждённый факт.', score: 0.9, metadata: { productIds: ['product-1'] } }] },
    minScore: 0.3,
    maxResults: 5
  });
  const result = await answerFromKnowledge({
    query: 'Расскажи о вине',
    knowledgeService,
    catalogService: { getProductsByIds: async () => { throw new Error('catalog offline'); } },
    answerProvider: async () => ({ text: 'Подтверждённый факт.', model: 'mock' })
  });
  assert.equal(result.answer, 'Подтверждённый факт.');
  assert.deepEqual(result.products, []);
});
