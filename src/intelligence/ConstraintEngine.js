const MONEY_RE = /(\d+(?:[.,]\d+)?)\s*(?:[-–]\s*(\d+(?:[.,]\d+)?)\s*)?(евро|€|eur|леев|лей|mdl)/giu;

function number(value) {
  return Number(String(value).replace(',', '.'));
}

function normalizeCurrency(value) {
  const x = String(value ?? '').toLowerCase();
  return /евро|€|eur/.test(x) ? 'EUR' : 'MDL';
}

function unique(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function extractConstraints(query = '') {
  const text = String(query);
  const constraints = [];

  const budgetPatterns = [
    /(?:бюджет(?:ом)?|не\s+больше|не\s+дороже|до|не\s+превыс(?:ить|ит))\s*(\d+(?:[.,]\d+)?)\s*(евро|€|eur|леев|лей|mdl)/iu,
    /(\d+(?:[.,]\d+)?)\s*(евро|€|eur|леев|лей|mdl)\s*(?:на\s+всё|максимум|предел)/iu
  ];
  for (const pattern of budgetPatterns) {
    const match = text.match(pattern);
    if (match) {
      constraints.push({ type: 'budget_max', value: number(match[1]), currency: normalizeCurrency(match[2]), sourceText: match[0] });
      break;
    }
  }

  const days = text.match(/(?:на|за)\s*(\d+)\s*(?:дня|дней|день)/iu);
  if (days) constraints.push({ type: 'days', value: Number(days[1]), sourceText: days[0] });

  const wineries = text.match(/(?:посетить|хочу|нужно)?\s*(\d+)\s*(?:винодельни|виноделен|винодельню)/iu);
  if (wineries) constraints.push({ type: 'winery_count', value: Number(wineries[1]), sourceText: wineries[0] });

  const options = text.match(/(?:назови|посоветуй|предложи|дай)\s*(\d+)\s*(?:вина|варианта|вариантов|винодельни|виноделен)/iu);
  if (options) constraints.push({ type: 'option_count', value: Number(options[1]), sourceText: options[0] });

  if (/вернут(?:ься|ся)?\s+(?:в\s+кишин[её]в\s+)?вечером|вернуться вечером/iu.test(text)) {
    constraints.push({ type: 'return_evening', value: true, sourceText: 'вернуться вечером' });
  }

  const preferences = [];
  if (/небольш(?:ие|их)\s+(?:семейн(?:ые|ых)\s+)?винодельн/iu.test(text)) preferences.push('small_wineries');
  if (/семейн(?:ые|ых)\s+винодельн/iu.test(text)) preferences.push('family_wineries');
  if (/натуральн(?:ые|ых)\s+вин/iu.test(text)) preferences.push('natural_wine');
  if (/автохтонн(?:ые|ых)\s+(?:сорта|вина)/iu.test(text)) preferences.push('autochthonous');
  for (const value of preferences) constraints.push({ type: 'preference', value, sourceText: value });

  return unique(constraints, (item) => `${item.type}:${item.value}:${item.currency ?? ''}`);
}

function moneyMentions(answer = '') {
  const mentions = [];
  for (const match of String(answer).matchAll(MONEY_RE)) {
    const low = number(match[1]);
    const high = match[2] ? number(match[2]) : low;
    mentions.push({ low, high, currency: normalizeCurrency(match[3]), text: match[0], index: match.index ?? 0 });
  }
  return mentions;
}

function totalCandidates(answer = '', currency) {
  const lines = String(answer).split(/\n+/);
  const candidates = [];
  for (const line of lines) {
    if (!/(?:итого|общ(?:ая|ий)\s+стоимость|общий\s+бюджет|всего|суммарно)/iu.test(line)) continue;
    for (const money of moneyMentions(line)) if (money.currency === currency) candidates.push(money);
  }
  return candidates;
}

function countNumberedItems(answer = '') {
  const matches = String(answer).match(/(?:^|\n)\s*(?:\d+[.)]|день\s+\d+)/giu);
  return matches?.length ?? 0;
}

export function validateConstraints({ query = '', answer = '', constraints = extractConstraints(query) } = {}) {
  const checks = [];

  for (const constraint of constraints) {
    if (constraint.type === 'budget_max') {
      const totals = totalCandidates(answer, constraint.currency);
      const all = moneyMentions(answer).filter((item) => item.currency === constraint.currency);
      const candidates = totals.length ? totals : all;
      if (!candidates.length) {
        checks.push({ ...constraint, status: 'unknown', message: `Лимит ${constraint.value} ${constraint.currency} найден, итоговая сумма в ответе не указана.` });
      } else {
        const max = Math.max(...candidates.map((item) => item.high));
        checks.push({
          ...constraint,
          status: max <= constraint.value ? 'pass' : 'fail',
          actual: max,
          message: max <= constraint.value
            ? `Ответ укладывается в лимит ${constraint.value} ${constraint.currency}.`
            : `Указанная сумма ${max} ${constraint.currency} превышает лимит ${constraint.value} ${constraint.currency}.`
        });
      }
    }

    if (constraint.type === 'days') {
      const count = countNumberedItems(answer);
      checks.push({
        ...constraint,
        status: count === constraint.value ? 'pass' : count ? 'fail' : 'unknown',
        actual: count || null,
        message: count === constraint.value
          ? `План содержит ${constraint.value} дня.`
          : count ? `Найдено ${count} разделов маршрута вместо ${constraint.value}.` : 'Не удалось проверить число дней по структуре ответа.'
      });
    }

    if (constraint.type === 'return_evening') {
      const ok = /возвращен(?:ие|ия)|вернут(?:ься|ся)|вечером\s+в\s+кишин[её]в/iu.test(answer);
      checks.push({ ...constraint, status: ok ? 'pass' : 'unknown', message: ok ? 'Возвращение вечером учтено.' : 'Возвращение вечером явно не зафиксировано.' });
    }

    if (constraint.type === 'option_count') {
      const count = countNumberedItems(answer);
      checks.push({ ...constraint, status: count === constraint.value ? 'pass' : count ? 'fail' : 'unknown', actual: count || null, message: count === constraint.value ? `Дано ${constraint.value} варианта.` : `Число вариантов не совпадает или не распознано.` });
    }
  }

  const failed = checks.filter((item) => item.status === 'fail').length;
  const unknown = checks.filter((item) => item.status === 'unknown').length;
  return {
    constraints,
    checks,
    passed: checks.filter((item) => item.status === 'pass').length,
    failed,
    unknown,
    ok: failed === 0,
    needsReview: failed > 0 || unknown > 0
  };
}

export function constraintPrompt(query = '') {
  const constraints = extractConstraints(query);
  if (!constraints.length) return '';
  return `ОГРАНИЧЕНИЯ ПОЛЬЗОВАТЕЛЯ:\n${constraints.map((item) => `- ${item.type}: ${item.value}${item.currency ? ` ${item.currency}` : ''}`).join('\n')}\nПеред выдачей ответа проверь каждое ограничение. Для бюджета обязательно укажи итоговую оценку.`;
}
