import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutePlan, auditRoutePlan } from '../src/intelligence/RoutePlanner.js';

const completeStops = [
  { id:'a', name:'Family White', day:1, type:'winery', style:'white', visitMinutes:120, travelMinutesFromPrevious:60, cost:45, currency:'EUR', opensAt:'10:00', closesAt:'18:00', coordinates:[47,28], sourceType:'official', sourceUpdatedAt:'2026-08-01' },
  { id:'b', name:'Natural Orange', day:2, type:'winery', style:'orange', visitMinutes:120, travelMinutesFromPrevious:80, cost:55, currency:'EUR', opensAt:'10:00', closesAt:'18:00', coordinates:[46.9,28.5], sourceType:'official', sourceUpdatedAt:'2026-08-01' },
  { id:'c', name:'Classic Red', day:3, type:'winery', style:'red_full', visitMinutes:120, travelMinutesFromPrevious:90, cost:65, currency:'EUR', opensAt:'10:00', closesAt:'18:00', coordinates:[46.8,29], sourceType:'official', sourceUpdatedAt:'2026-08-01' }
];

test('builds a route grouped by day and calculates cost', () => {
  const plan = buildRoutePlan({ currency:'EUR', stops: completeStops });
  assert.equal(plan.days.length, 3);
  assert.equal(plan.totalCost, 165);
  assert.deepEqual(plan.styles, ['white','orange','red_full']);
});

test('passes a complete three-day route under budget', () => {
  const report = auditRoutePlan({
    query:'Маршрут на три дня, бюджет до 300 евро.',
    plan:{ currency:'EUR', stops: completeStops },
    now:new Date('2026-08-02T00:00:00Z')
  });
  assert.equal(report.ok, true);
  assert.equal(report.readyForUser, true);
  assert.equal(report.constraintReport.checks.find((x)=>x.type==='budget_max').status, 'pass');
  assert.equal(report.constraintReport.checks.find((x)=>x.type==='days').status, 'pass');
});

test('fails when route exceeds budget', () => {
  const stops = completeStops.map((stop) => ({ ...stop, cost: 150 }));
  const report = auditRoutePlan({ query:'Бюджет до 300 евро.', plan:{ currency:'EUR', stops } });
  assert.equal(report.ok, false);
  assert.equal(report.constraintReport.checks.find((x)=>x.type==='budget_max').status, 'fail');
});

test('marks missing hours, coordinates and freshness as data gaps', () => {
  const report = auditRoutePlan({
    query:'Маршрут на один день.',
    plan:{ currency:'EUR', stops:[{ name:'Unknown Winery', day:1, cost:20 }] }
  });
  assert.equal(report.readyForUser, false);
  assert.ok(report.dataGaps.some((x)=>x.field==='opening_hours'));
  assert.ok(report.dataGaps.some((x)=>x.field==='coordinates'));
  assert.ok(report.dataGaps.some((x)=>x.field==='freshness'));
});

test('warns about overloaded winery day and repeated styles', () => {
  const stops = [1,2,3].map((n)=>({ ...completeStops[0], id:String(n), name:`W${n}`, day:1, cost:10 }));
  stops.push({ ...completeStops[0], id:'4', name:'W4', day:2, cost:10 });
  const report = auditRoutePlan({ query:'Маршрут на два дня.', plan:{ currency:'EUR', stops }, now:new Date('2026-08-02') });
  assert.ok(report.routeChecks.some((x)=>x.type==='daily_winery_load' && x.status==='warning'));
  assert.ok(report.routeChecks.some((x)=>x.type==='style_diversity' && x.status==='warning'));
});
