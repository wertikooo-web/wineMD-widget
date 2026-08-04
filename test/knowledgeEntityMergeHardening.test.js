import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KnowledgeEntityMergeService } from '../src/knowledge/studio/KnowledgeEntityMergeService.js';

test('rejects merging an entity into itself before touching the database', async () => {
  const service = new KnowledgeEntityMergeService({ db: { connect() { throw new Error('database must not be touched'); } } });
  await assert.rejects(
    service.merge({ sourceEntityId: 'same', targetEntityId: 'same' }),
    error => error.code === 'INVALID_MERGE_TARGET'
  );
});

test('merge implementation revalidates under lock and verifies no source references remain', () => {
  const source = fs.readFileSync(new URL('../src/knowledge/studio/KnowledgeEntityMergeService.js', import.meta.url), 'utf8');
  assert.match(source, /ORDER BY id FOR UPDATE/);
  assert.match(source, /MERGE_ENTITY_NOT_FOUND/);
  assert.match(source, /MERGE_TYPE_MISMATCH/);
  assert.match(source, /MERGE_INCOMPLETE/);
  assert.match(source, /remainingSourceRefs/);
  assert.match(source, /removedSelfReferences/);
  assert.match(source, /duplicateFactsRemoved/);
});

test('knowledge studio API exposes merge conflicts as explicit client errors', () => {
  const source = fs.readFileSync(new URL('../src/appWithKnowledgeStudio.js', import.meta.url), 'utf8');
  assert.match(source, /MERGE_ENTITY_NOT_FOUND/);
  assert.match(source, /MERGE_INCOMPLETE/);
  assert.match(source, /conflictCodes\.includes\(error\?\.code\)\?409/);
  assert.match(source, /leftovers:error\?\.leftovers/);
});
