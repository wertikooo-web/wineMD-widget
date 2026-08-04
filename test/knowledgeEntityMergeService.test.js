import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { KnowledgeEntityMergeService } from '../src/knowledge/studio/KnowledgeEntityMergeService.js';

test('merge preview rejects identical source and target', async () => {
  const service = new KnowledgeEntityMergeService({ db: { query() { throw new Error('database should not be called'); } } });
  await assert.rejects(
    service.preview({ sourceEntityId: 'same', targetEntityId: 'same' }),
    error => error.code === 'INVALID_MERGE_TARGET'
  );
});

test('merge preview rejects different entity types', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('FROM entities e')) return {
        rowCount: 2,
        rows: [
          { id: 'source', canonical_name: 'Source', entity_type: 'wine', fact_count: 1, alias_count: 0, description_count: 0 },
          { id: 'target', canonical_name: 'Target', entity_type: 'winery', fact_count: 2, alias_count: 0, description_count: 0 }
        ]
      };
      throw new Error('unexpected query');
    }
  };
  const service = new KnowledgeEntityMergeService({ db });
  await assert.rejects(
    service.preview({ sourceEntityId: 'source', targetEntityId: 'target' }),
    error => error.code === 'MERGE_TYPE_MISMATCH'
  );
});

test('Knowledge Studio exposes fact editor and guarded merge controls', () => {
  const html = fs.readFileSync(new URL('../public/admin/knowledge-studio.html', import.meta.url), 'utf8');
  assert.match(html, /\/admin\/fact-editor\.html/);
  assert.match(html, /merge-preview/);
  assert.match(html, /confirmMerge/);
  assert.match(html, /Объединить дубль/);

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});
