import test from 'node:test';
import assert from 'node:assert/strict';
import { extractConstraints, validateConstraints, constraintPrompt } from '../src/intelligence/ConstraintEngine.js';

test('extracts travel budget, days and preferences', () => {
  const constraints = extractConstraints('Я прилетаю на три дня. Люблю натуральные вина и небольшие семейные винодельни. Бюджет до 300 евро.');
  const budget = constraints.find((item) => item.type === 'budget_max');
  assert.equal(budget?.value, 300);
  assert.equal(budget?.currency, 'EUR');
  assert.match(budget?.sourceText ?? '', /300\s*евро/iu);
  assert.equal(constraints.find((item) => item.type === 'days')?.value, 3);
  assert.ok(constraints.some((item) => item.type === 'preference' && item.value === 'natural_wine'));
  assert.ok(constraints.some((item) => item.type === 'preference' && item.value === 'family_wineries'));
});

test('recognizes written winery count in instrumental case', () => {
  const constraints = extractConstraints('Составь маршрут с двумя винодельнями и вернуться вечером.');
  assert.equal(constraints.find((item) => item.type === 'winery_count')?.value, 2);
  assert.equal(constraints.find((item) => item.type === 'return_evening')?.value, true);
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
