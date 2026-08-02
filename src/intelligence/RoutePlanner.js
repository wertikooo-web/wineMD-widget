import { extractConstraints, validateConstraints } from './ConstraintEngine.js';

const STYLE_KEYS = ['sparkling','white','orange','rose','red_light','red_full','dessert','fortified','natural'];

function cleanText(value) { return String(value ?? '').trim(); }
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function normalizeStop(stop = {}, index = 0) {
  return {
    id: cleanText(stop.id) || `stop-${index + 1}`,
    name: cleanText(stop.name) || `Остановка ${index + 1}`,
    type: cleanText(stop.type) || 'winery',
    day: Math.max(1, Math.trunc(finite(stop.day) ?? 1)),
    style: STYLE_KEYS.includes(stop.style) ? stop.style : cleanText(stop.style) || null,
    visitMinutes: Math.max(0, finite(stop.visitMinutes) ?? 90),
    travelMinutesFromPrevious: Math.max(0, finite(stop.travelMinutesFromPrevious) ?? 0),
    cost: Math.max(0, finite(stop.cost) ?? 0),
    currency: cleanText(stop.currency).toUpperCase() || 'EUR',
    opensAt: cleanText(stop.opensAt) || null,
    closesAt: cleanText(stop.closesAt) || null,
    bookingRequired: Boolean(stop.bookingRequired),
    sourceType: cleanText(stop.sourceType) || null,
    sourceUpdatedAt: cleanText(stop.sourceUpdatedAt) || null,
    coordinates: Array.isArray(stop.coordinates) && stop.coordinates.length === 2 ? stop.coordinates.map(Number) : null,
    tags: unique(Array.isArray(stop.tags) ? stop.tags.map(cleanText) : [])
  };
}

function sumBy(items, key) { return items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0); }

function freshnessDays(value, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function routeText(plan) {
  const lines = [];
  for (const day of plan.days) {
    lines.push(`День ${day.day}.`);
    for (const stop of day.stops) lines.push(`${stop.name}: ${stop.cost} ${stop.currency}.`);
  }
  lines.push(`Итого: ${plan.totalCost} ${plan.currency}.`);
  return lines.join('\n');
}

export function buildRoutePlan(input = {}) {
  const currency = cleanText(input.currency).toUpperCase() || 'EUR';
  const stops = (Array.isArray(input.stops) ? input.stops : []).map(normalizeStop);
  const dayNumbers = unique(stops.map((stop) => stop.day)).sort((a,b) => a-b);
  const days = dayNumbers.map((day) => {
    const dayStops = stops.filter((stop) => stop.day === day);
    return {
      day,
      stops: dayStops,
      visitMinutes: sumBy(dayStops, 'visitMinutes'),
      travelMinutes: sumBy(dayStops, 'travelMinutesFromPrevious'),
      totalMinutes: sumBy(dayStops, 'visitMinutes') + sumBy(dayStops, 'travelMinutesFromPrevious'),
      cost: dayStops.filter((stop) => stop.currency === currency).reduce((sum, stop) => sum + stop.cost, 0),
      styles: unique(dayStops.map((stop) => stop.style))
    };
  });
  return {
    start: cleanText(input.start) || 'Chișinău',
    currency,
    days,
    stops,
    totalCost: stops.filter((stop) => stop.currency === currency).reduce((sum, stop) => sum + stop.cost, 0),
    styles: unique(stops.map((stop) => stop.style))
  };
}

export function auditRoutePlan({ query = '', plan: rawPlan = {}, now = new Date() } = {}) {
  const plan = buildRoutePlan(rawPlan);
  const constraints = extractConstraints(query);
  const constraintReport = validateConstraints({ query, answer: routeText(plan), constraints });
  const checks = [];

  for (const day of plan.days) {
    checks.push({
      type: 'daily_duration', day: day.day,
      status: day.totalMinutes <= 600 ? 'pass' : 'fail',
      actual: day.totalMinutes,
      message: day.totalMinutes <= 600 ? `День ${day.day}: ${day.totalMinutes} минут, запас по времени есть.` : `День ${day.day}: ${day.totalMinutes} минут, маршрут перегружен.`
    });
    const wineries = day.stops.filter((stop) => stop.type === 'winery').length;
    checks.push({
      type: 'daily_winery_load', day: day.day,
      status: wineries <= 2 ? 'pass' : 'warning', actual: wineries,
      message: wineries <= 2 ? `День ${day.day}: ${wineries} винодельни.` : `День ${day.day}: ${wineries} винодельни, впечатления и логистика могут пострадать.`
    });
  }

  const dayStyles = plan.days.map((day) => day.styles.join('|')).filter(Boolean);
  checks.push({
    type: 'style_diversity',
    status: plan.days.length <= 1 || unique(dayStyles).length === plan.days.length ? 'pass' : 'warning',
    actual: plan.styles,
    message: unique(dayStyles).length === plan.days.length ? 'Дни различаются по винным стилям.' : 'Часть дней повторяет одинаковый набор винных стилей.'
  });

  const dataGaps = [];
  for (const stop of plan.stops) {
    if (!stop.opensAt || !stop.closesAt) dataGaps.push({ stopId: stop.id, field: 'opening_hours', message: `${stop.name}: нет подтверждённых часов работы.` });
    if (!stop.coordinates) dataGaps.push({ stopId: stop.id, field: 'coordinates', message: `${stop.name}: нет координат для точного расчёта дороги.` });
    if (!stop.sourceType) dataGaps.push({ stopId: stop.id, field: 'source', message: `${stop.name}: источник данных не указан.` });
    const age = freshnessDays(stop.sourceUpdatedAt, now);
    if (age === null) dataGaps.push({ stopId: stop.id, field: 'freshness', message: `${stop.name}: дата актуальности не указана.` });
    else if (age > 30) dataGaps.push({ stopId: stop.id, field: 'freshness', message: `${stop.name}: данные старше 30 дней.` });
  }

  const failed = [...constraintReport.checks, ...checks].filter((item) => item.status === 'fail').length;
  const warnings = checks.filter((item) => item.status === 'warning').length + dataGaps.length + constraintReport.unknown;
  return {
    ok: failed === 0,
    readyForUser: failed === 0 && dataGaps.length === 0,
    plan,
    constraintReport,
    routeChecks: checks,
    dataGaps,
    summary: { failed, warnings, days: plan.days.length, stops: plan.stops.length, totalCost: plan.totalCost, currency: plan.currency }
  };
}
