import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KnowledgeAuditService } from '../src/knowledge/studio/KnowledgeAuditService.js';

test('audit list marks supported entity edit as reversible', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
      return { rows: [{ id: 'a1', target_type: 'entity', target_id: 'e1', action: 'edit', old_value: {}, new_value: {} }] };
    }
  };
  const result = await new KnowledgeAuditService({ db }).list();
  assert.equal(result.total, 1);
  assert.equal(result.items[0].reversible, true);
});

test('audit list keeps merge actions read-only', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
      return { rows: [{ id: 'a2', target_type: 'entity', target_id: 'e1', action: 'merge_target', old_value: {}, new_value: {} }] };
    }
  };
  const result = await new KnowledgeAuditService({ db }).list();
  assert.equal(result.items[0].reversible, false);
});

test('admin API and page expose guarded audit workflow', async () => {
  const [app, page] = await Promise.all([
    readFile(new URL('../src/appWithKnowledgeStudio.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/admin/knowledge-audit.html', import.meta.url), 'utf8')
  ]);
  assert.match(app, /section==='audit'/);
  assert.match(app, /NEWER_ACTION_EXISTS/);
  assert.match(app, /ACTION_NOT_REVERSIBLE/);
  assert.match(page, /История изменений знаний/);
  assert.match(page, /Откатить это изменение/);
  assert.match(page, /Есть более новое изменение/);
});
