import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageUrl = new URL('../public/admin/fact-editor.html', import.meta.url);

test('fact editor page contains required editing flows and valid script syntax', async () => {
  const html = await readFile(pageUrl, 'utf8');
  assert.match(html, /Редактор фактов/);
  assert.match(html, /async function saveFact\(\)/);
  assert.match(html, /async function review\(action\)/);
  assert.match(html, /async function searchEntities\(\)/);
  assert.match(html, /\/api\/admin\/knowledge-studio\/facts\//);
  assert.match(html, /\/api\/admin\/knowledge-studio\/entities\?/);

  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'inline script must exist');
  assert.doesNotThrow(() => new Function(script));
});
