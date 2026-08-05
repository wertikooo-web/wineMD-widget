import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkCategories, wineAiBenchmarkMvp } from '../data/benchmark/wine-ai-mvp.js';

test('WINE AI benchmark MVP contains exactly 200 unique questions', () => {
  assert.equal(wineAiBenchmarkMvp.length, 200);
  assert.equal(new Set(wineAiBenchmarkMvp.map(item => item.id)).size, 200);
  assert.equal(new Set(wineAiBenchmarkMvp.map(item => item.question)).size, 200);
});

test('benchmark covers 10 categories with 20 questions each', () => {
  assert.equal(Object.keys(benchmarkCategories).length, 10);
  for (const [category, questions] of Object.entries(benchmarkCategories)) {
    assert.equal(questions.length, 20, category);
  }
});

test('every benchmark item has source policy and quality checks', () => {
  for (const item of wineAiBenchmarkMvp) {
    assert.match(item.id, /^[a-z_]+_\d{3}$/);
    assert.ok(['easy', 'medium', 'hard'].includes(item.difficulty));
    assert.equal(item.language, 'ru');
    assert.ok(item.question.length >= 15);
    assert.ok(Array.isArray(item.source_policy.primary));
    assert.ok(item.source_policy.primary.length > 0);
    assert.equal(item.checks.factual_accuracy, true);
    assert.equal(item.checks.completeness, true);
    assert.equal(item.checks.source_traceability, true);
  }
});

test('dynamic and catalog questions enforce freshness-aware source rules', () => {
  const dynamic = wineAiBenchmarkMvp.filter(item => item.category === 'dynamic_web');
  const catalog = wineAiBenchmarkMvp.filter(item => item.category === 'wine_md');
  assert.ok(dynamic.every(item => item.source_policy.internet === 'required' && item.checks.freshness));
  assert.ok(catalog.every(item => item.source_policy.internet === 'forbidden' && item.checks.freshness));
});
