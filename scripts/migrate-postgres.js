import dotenv from 'dotenv';
dotenv.config({ override: true });

import fs from 'node:fs/promises';
import path from 'node:path';
import { ensurePostgresSchema, getPool, postgresEnabled, closePostgres } from '../src/db/Postgres.js';
import { AssistantSettingsStore } from '../src/settings/AssistantSettingsStore.js';
import { JsonKnowledgeStore } from '../src/knowledge/extraction/JsonKnowledgeStore.js';

const root = process.cwd();
const settingsFile = process.env.ASSISTANT_SETTINGS_FILE ?? path.join(root,'data','settings','assistant.json');
const knowledgeFile = process.env.KNOWLEDGE_EXTRACTION_FILE ?? path.join(root,'data','knowledge','runtime','knowledge.json');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function main() {
  if (!postgresEnabled()) throw new Error('DATABASE_URL is required');
  await ensurePostgresSchema();

  const rawSettings = await readJson(settingsFile, null);
  if (rawSettings) {
    const store = new AssistantSettingsStore({ file: settingsFile });
    await store.save(rawSettings);
    console.log('Assistant settings migrated.');
  }

  const data = await readJson(knowledgeFile, { entities: [], facts: [], processedChunks: [] });
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const entity of data.entities ?? []) {
      const normalized = String(entity.canonicalName ?? '').trim().toLocaleLowerCase().replace(/\s+/g,' ');
      if (!entity.id || !normalized) continue;
      await client.query(
        `INSERT INTO knowledge_entities(id,type,canonical_name,normalized_name,aliases,descriptions,created_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,COALESCE($7::timestamptz,now()))
         ON CONFLICT(id) DO UPDATE SET aliases=EXCLUDED.aliases,descriptions=EXCLUDED.descriptions,updated_at=now()`,
        [entity.id,entity.type ?? 'concept',entity.canonicalName,normalized,JSON.stringify(entity.aliases ?? []),JSON.stringify(entity.descriptions ?? []),entity.createdAt ?? null]
      );
    }
    for (const fact of data.facts ?? []) {
      await client.query(
        `INSERT INTO knowledge_facts(id,fact_key,subject_entity_id,predicate,object_entity_id,value,document_id,chunk_id,source_text,confidence,status,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,now()))
         ON CONFLICT(fact_key) DO NOTHING`,
        [fact.id,fact.key,fact.subjectEntityId,fact.predicate,fact.objectEntityId ?? null,fact.value ?? null,fact.documentId,fact.chunkId,fact.sourceText ?? '',Number(fact.confidence ?? .75),fact.status ?? 'extracted',fact.createdAt ?? null]
      );
    }
    for (const chunkId of data.processedChunks ?? []) {
      const documentId = String(chunkId).split(':')[0] || 'unknown';
      await client.query('INSERT INTO knowledge_processed_chunks(chunk_id,document_id) VALUES($1,$2) ON CONFLICT(chunk_id) DO NOTHING',[chunkId,documentId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }

  const stats = await new JsonKnowledgeStore({ file: knowledgeFile }).stats();
  console.log('Knowledge migrated:', stats);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(closePostgres);
