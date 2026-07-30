import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensurePostgresSchema, getPool, postgresEnabled } from '../../db/Postgres.js';

const empty = () => ({ version: 1, entities: [], facts: [], relations: [], processedChunks: [], updatedAt: null });
const norm = s => String(s ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const id = (prefix, value) => `${prefix}-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 18)}`;

export class JsonKnowledgeStore {
  constructor({ file }) { this.file = file; }

  async load() {
    if (postgresEnabled()) {
      await ensurePostgresSchema();
      const db = getPool();
      const [entities, facts, chunks] = await Promise.all([
        db.query('SELECT id,type,canonical_name AS "canonicalName",aliases,descriptions,created_at AS "createdAt" FROM knowledge_entities ORDER BY created_at'),
        db.query('SELECT id,fact_key AS key,subject_entity_id AS "subjectEntityId",predicate,object_entity_id AS "objectEntityId",value,document_id AS "documentId",chunk_id AS "chunkId",source_text AS "sourceText",confidence,status,created_at AS "createdAt" FROM knowledge_facts ORDER BY created_at'),
        db.query('SELECT chunk_id FROM knowledge_processed_chunks ORDER BY processed_at')
      ]);
      return { version: 1, entities: entities.rows, facts: facts.rows, relations: [], processedChunks: chunks.rows.map(x => x.chunk_id), updatedAt: new Date().toISOString() };
    }
    try { return { ...empty(), ...JSON.parse(await fs.readFile(this.file, 'utf8')) }; }
    catch (e) { if (e.code === 'ENOENT') return empty(); throw e; }
  }

  async save(data) {
    if (postgresEnabled()) throw new Error('Direct save is not supported for PostgreSQL knowledge storage');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    data.updatedAt = new Date().toISOString();
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  async mergeExtraction({ documentId, chunk, extraction }) {
    if (postgresEnabled()) return this.#mergePostgres({ documentId, chunk, extraction });
    const data = await this.load();
    const entityMap = new Map(data.entities.map(x => [`${x.type}:${norm(x.canonicalName)}`, x]));
    const localIds = new Map();
    for (const raw of extraction.entities ?? []) {
      const type = String(raw.type ?? 'concept').toLowerCase();
      const canonicalName = String(raw.canonicalName ?? raw.name ?? '').trim();
      if (!canonicalName) continue;
      const key = `${type}:${norm(canonicalName)}`;
      let entity = entityMap.get(key);
      if (!entity) {
        entity = { id: id('ent', key), type, canonicalName, aliases: [], descriptions: [], createdAt: new Date().toISOString() };
        data.entities.push(entity); entityMap.set(key, entity);
      }
      entity.aliases = [...new Set([...(entity.aliases ?? []), ...(raw.aliases ?? []).map(String).filter(Boolean)])];
      if (raw.description) entity.descriptions = [...new Set([...(entity.descriptions ?? []), String(raw.description)])].slice(-20);
      localIds.set(String(raw.localId ?? raw.name ?? canonicalName), entity.id);
      localIds.set(canonicalName, entity.id);
    }
    for (const raw of extraction.facts ?? []) {
      const subjectEntityId = localIds.get(String(raw.subjectRef ?? raw.subject ?? '')) ?? null;
      const objectEntityId = localIds.get(String(raw.objectRef ?? raw.object ?? '')) ?? null;
      const predicate = String(raw.predicate ?? 'related_to').trim().toLowerCase();
      const value = raw.value == null ? null : String(raw.value).trim();
      if (!subjectEntityId || (!objectEntityId && !value)) continue;
      const sourceText = String(raw.sourceText ?? '').trim().slice(0, 800);
      const factKey = `${subjectEntityId}|${predicate}|${objectEntityId ?? value}|${chunk.id}`;
      if (data.facts.some(x => x.key === factKey)) continue;
      data.facts.push({ id:id('fact',factKey), key:factKey, subjectEntityId, predicate, objectEntityId, value, documentId, chunkId:chunk.id, sourceText, confidence:Number(raw.confidence ?? .75), status:'extracted', createdAt:new Date().toISOString() });
    }
    if (!data.processedChunks.includes(chunk.id)) data.processedChunks.push(chunk.id);
    await this.save(data);
    return this.stats(documentId);
  }

  async #mergePostgres({ documentId, chunk, extraction }) {
    await ensurePostgresSchema();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const localIds = new Map();
      for (const raw of extraction.entities ?? []) {
        const type = String(raw.type ?? 'concept').toLowerCase();
        const canonicalName = String(raw.canonicalName ?? raw.name ?? '').trim();
        if (!canonicalName) continue;
        const normalizedName = norm(canonicalName);
        const entityId = id('ent', `${type}:${normalizedName}`);
        const aliases = [...new Set((raw.aliases ?? []).map(String).filter(Boolean))];
        const descriptions = raw.description ? [String(raw.description)] : [];
        const result = await client.query(
          `INSERT INTO knowledge_entities(id,type,canonical_name,normalized_name,aliases,descriptions)
           VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)
           ON CONFLICT(type,normalized_name) DO UPDATE SET
             aliases=(SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(knowledge_entities.aliases || EXCLUDED.aliases)),
             descriptions=(SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(knowledge_entities.descriptions || EXCLUDED.descriptions)),
             updated_at=now()
           RETURNING id`,
          [entityId,type,canonicalName,normalizedName,JSON.stringify(aliases),JSON.stringify(descriptions)]
        );
        const storedId = result.rows[0].id;
        localIds.set(String(raw.localId ?? raw.name ?? canonicalName), storedId);
        localIds.set(canonicalName, storedId);
      }
      for (const raw of extraction.facts ?? []) {
        const subjectEntityId = localIds.get(String(raw.subjectRef ?? raw.subject ?? '')) ?? null;
        const objectEntityId = localIds.get(String(raw.objectRef ?? raw.object ?? '')) ?? null;
        const predicate = String(raw.predicate ?? 'related_to').trim().toLowerCase();
        const value = raw.value == null ? null : String(raw.value).trim();
        if (!subjectEntityId || (!objectEntityId && !value)) continue;
        const factKey = `${subjectEntityId}|${predicate}|${objectEntityId ?? value}|${chunk.id}`;
        await client.query(
          `INSERT INTO knowledge_facts(id,fact_key,subject_entity_id,predicate,object_entity_id,value,document_id,chunk_id,source_text,confidence,status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'extracted') ON CONFLICT(fact_key) DO NOTHING`,
          [id('fact',factKey),factKey,subjectEntityId,predicate,objectEntityId,value,documentId,chunk.id,String(raw.sourceText ?? '').trim().slice(0,800),Number(raw.confidence ?? .75)]
        );
      }
      await client.query('INSERT INTO knowledge_processed_chunks(chunk_id,document_id) VALUES($1,$2) ON CONFLICT(chunk_id) DO NOTHING',[chunk.id,documentId]);
      await client.query('COMMIT');
      return this.stats(documentId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async removeDocument(documentId) {
    if (postgresEnabled()) {
      await ensurePostgresSchema();
      const db = getPool();
      await db.query('DELETE FROM knowledge_processed_chunks WHERE document_id=$1',[documentId]);
      await db.query('DELETE FROM knowledge_facts WHERE document_id=$1',[documentId]);
      await db.query('DELETE FROM knowledge_entities e WHERE NOT EXISTS (SELECT 1 FROM knowledge_facts f WHERE f.subject_entity_id=e.id OR f.object_entity_id=e.id)');
      return;
    }
    const d=await this.load(); d.facts=d.facts.filter(x=>x.documentId!==documentId); d.processedChunks=d.processedChunks.filter(x=>!x.startsWith(`${documentId}:`)); const used=new Set(d.facts.flatMap(x=>[x.subjectEntityId,x.objectEntityId]).filter(Boolean)); d.entities=d.entities.filter(x=>used.has(x.id)); await this.save(d);
  }

  async stats(documentId) {
    if (postgresEnabled()) {
      await ensurePostgresSchema();
      const values = documentId ? [documentId] : [];
      const where = documentId ? 'WHERE document_id=$1' : '';
      const db = getPool();
      const facts = await db.query(`SELECT COUNT(*)::int AS facts, COUNT(*) FILTER (WHERE object_entity_id IS NOT NULL)::int AS relations, COUNT(DISTINCT subject_entity_id)::int + COUNT(DISTINCT object_entity_id)::int AS entities FROM knowledge_facts ${where}`, values);
      const chunks = await db.query(`SELECT COUNT(*)::int AS count FROM knowledge_processed_chunks ${where}`, values);
      return { entities:facts.rows[0].entities, facts:facts.rows[0].facts, relations:facts.rows[0].relations, processedChunks:chunks.rows[0].count, updatedAt:new Date().toISOString() };
    }
    const d=await this.load(); const facts=documentId?d.facts.filter(x=>x.documentId===documentId):d.facts; const ids=new Set(facts.flatMap(x=>[x.subjectEntityId,x.objectEntityId]).filter(Boolean)); return { entities:ids.size, facts:facts.length, relations:facts.filter(x=>x.objectEntityId).length, processedChunks:documentId?d.processedChunks.filter(x=>x.startsWith(`${documentId}:`)).length:d.processedChunks.length, updatedAt:d.updatedAt };
  }
}
