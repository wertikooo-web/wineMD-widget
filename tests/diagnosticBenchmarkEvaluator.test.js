import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDiagnosticItem } from '../src/benchmark/DiagnosticBenchmarkEvaluator.js';

const item = {
  sourcePolicy: { primary: ['wine_md_catalog'], internet: 'forbidden' },
  checks: { completeness: true, source_traceability: true }
};

test('diagnostic evaluator passes a substantive catalog answer with sources', () => {
  const result = evaluateDiagnosticItem(item, {
    answer: 'В каталоге Wine.md найдено подходящее вино. Цена, наличие и ссылка подтверждены актуальной карточкой товара. Рекомендация учитывает бюджет пользователя.',
    sources: [{ type: 'wine_md_catalog', id: 'wine-1' }]
  });
  assert.equal(result.passed, true);
  assert.equal(result.diagnosis, 'PASS');
  assert.equal(result.score, 1);
});

test('diagnostic evaluator detects missing required source layer', () => {
  const result = evaluateDiagnosticItem(item, {
    answer: 'Подробный ответ достаточной длины, но он построен только на общем документе и не подтверждает актуальную карточку товара в каталоге Wine.md.',
    sources: [{ type: 'document', id: 'chunk-1' }]
  });
  assert.equal(result.passed, false);
  assert.equal(result.diagnosis, 'WRONG_SOURCE_LAYER');
  assert.ok(result.failedChecks.includes('primary_source_policy'));
});

test('diagnostic evaluator detects forbidden web fallback', () => {
  const result = evaluateDiagnosticItem(item, {
    answer: 'Подробный ответ достаточной длины, но цена была найдена во внешнем интернете вместо внутреннего каталога Wine.md, что нарушает правила.',
    sources: [{ type: 'official_web', id: 'page-1' }, { type: 'wine_md_catalog', id: 'wine-1' }]
  });
  assert.equal(result.passed, false);
  assert.equal(result.diagnosis, 'WEB_FORBIDDEN');
});
