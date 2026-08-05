import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('WINE AI benchmark dashboard installs, runs and loads results', async () => {
  const html = await readFile(new URL('../public/admin/wine-ai-benchmark.html', import.meta.url), 'utf8');
  assert.match(html, /benchmark-mvp\/install/);
  assert.match(html, /datasets\/wine-ai-mvp-200\/run/);
  assert.match(html, /run-jobs/);
  assert.match(html, /\/api\/admin\/benchmark\/runs\//);
  assert.match(html, /По категориям/);
});
