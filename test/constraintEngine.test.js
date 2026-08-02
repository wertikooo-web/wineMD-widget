import test from 'node:test';
import assert from 'node:assert/strict';
import { extractConstraints, validateConstraints, constraintPrompt } from '../src/intelligence/ConstraintEngine.js';

test('extracts travel budget, days and preferences', () => {
  const constraints = extractConstraints('Я прилетаю на три дня. Люблю натуральные вина и небольшие семейные винодельни. Бюджет до 300 евро.');
  assert.deepEqual(constraints.find((item) => item.type === 'budget_max'), {
    type: 'budget_max', value: 300, currency: 'EUR', sourceText: 'Бюджет до 300 евро'
  });
  assert.equal(constraints.find((item) => item.type === 'days')?.value, 3);
  assert.ok(constraints.some((item) => item.type === 'preference' && item.value === 'natural_wine'));
  assert.ok(constraints.some((item) => item.type === 'preference' && item.value === 'family_wineries'));
});

test('fails answer whose explicit total exceeds budget', () => {
  const result = validateConstraints({
    query: 'Составь маршрут, бюджет до 300 евро.',
    answer: 'Общий бюджет: 385–590 евро.'
  });
  const budget = result.checks.find((item) => item.type === 'budget_max');
  assert.equal(budget.status, 'fail');
  assert.equal(budget.actual, 590);
  assert.equal(result.ok, false);
});

test('passes answer with total below budget and three days', () => {
  const result = validateConstraints({
    query: 'Маршрут на 3 дня, бюджет до 300 евро.',
    answer: 'День 1. Кодру.\nДень 2. Штефан Водэ.\nДень 3. Игристые вина.\nИтого: 285 евро.'
  });
  assert.equal(result.failed, 0);
  assert.equal(result.checks.find((item) => item.type === 'budget_max').status, 'pass');
  assert.equal(result.checks.find((item) => item.type === 'days').status, 'pass');
});

test('prompt lists detected constraints for the answer model', () => {
  const prompt = constraintPrompt('Посоветуй 3 вина, бюджет до 100 евро.');
  assert.match(prompt, /budget_max: 100 EUR/);
  assert.match(prompt, /option_count: 3/);
});
