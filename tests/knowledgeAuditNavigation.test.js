import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Knowledge Studio exposes direct navigation to the audit journal', async () => {
  const html = await readFile(new URL('../public/admin/knowledge-studio.html', import.meta.url), 'utf8');
  assert.match(html, /\/admin\/knowledge-audit\.html/);
  assert.match(html, />Журнал изменений</);
});
