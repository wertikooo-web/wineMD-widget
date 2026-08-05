import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readAdminPage = (name) => readFile(new URL(`../public/admin/${name}`, import.meta.url), 'utf8');

test('Knowledge admin pages expose reciprocal navigation', async () => {
  const [studio, facts, audit] = await Promise.all([
    readAdminPage('knowledge-studio.html'),
    readAdminPage('fact-editor.html'),
    readAdminPage('knowledge-audit.html'),
  ]);

  assert.match(studio, /\/admin\/fact-editor\.html/);
  assert.match(studio, /\/admin\/knowledge-audit\.html/);
  assert.match(facts, /\/admin\/knowledge-studio\.html/);
  assert.match(audit, /\/admin\/knowledge-studio\.html/);
  assert.match(audit, /\/admin\/fact-editor\.html/);
});
