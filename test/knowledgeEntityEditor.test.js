import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeEntityEditorService, knowledgeEntityStatuses, knowledgeEntityTypes } from '../src/knowledge/studio/KnowledgeEntityEditorService.js';

test('entity editor exposes controlled wine ontology types and statuses', () => {
  assert.ok(knowledgeEntityTypes.includes('winery'));
  assert.ok(knowledgeEntityTypes.includes('wine'));
  assert.ok(knowledgeEntityStatuses.includes('verified'));
  assert.ok(knowledgeEntityStatuses.includes('published'));
});

test('entity editor rejects missing canonical name before database access', async () => {
  const service = new KnowledgeEntityEditorService({ db: { connect() { throw new Error('database must not be touched'); } } });
  await assert.rejects(
    service.updateEntity({ entityId: 'e1', canonicalName: '  ', entityType: 'winery', status: 'verified' }),
    error => error.code === 'ENTITY_NAME_REQUIRED'
  );
});

test('entity editor rejects unknown entity type before database access', async () => {
  const service = new KnowledgeEntityEditorService({ db: { connect() { throw new Error('database must not be touched'); } } });
  await assert.rejects(
    service.updateEntity({ entityId: 'e1', canonicalName: 'Example', entityType: 'spaceship', status: 'verified' }),
    error => error.code === 'INVALID_ENTITY_TYPE'
  );
});

test('entity editor rejects empty alias before database access', async () => {
  const service = new KnowledgeEntityEditorService({ db: { connect() { throw new Error('database must not be touched'); } } });
  await assert.rejects(
    service.addAlias({ entityId: 'e1', alias: '' }),
    error => error.code === 'ALIAS_REQUIRED'
  );
});
