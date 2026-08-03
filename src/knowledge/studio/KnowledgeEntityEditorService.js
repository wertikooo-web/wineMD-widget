import { getPool, postgresEnabled } from '../../db/Postgres.js';

const ENTITY_STATUSES = new Set(['extracted', 'needs_review', 'verified', 'rejected', 'published']);
const ENTITY_TYPES = new Set([
  'winery','wine','wine_line','grape_variety','wine_region','geographic_place','terroir','aroma','flavor',
  'food','dish','tradition','historical_event','person','organization','wine_route','tour','tasting','event','shop','product'
]);

function dbOrThrow(db) {
  if (db) return db;
  if (!postgresEnabled()) {
    const error = new Error('Knowledge entity editor requires PostgreSQL');
    error.code = 'POSTGRES_REQUIRED';
    throw error;
  }
  return getPool();
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value, max = 4000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

export class KnowledgeEntityEditorService {
  constructor({ db } = {}) { this.db = db ?? null; }
  pool() { return dbOrThrow(this.db); }

  async updateEntity({ entityId, canonicalName, entityType, shortDescription, status, comment = '', actor = 'admin' }) {
    const name = cleanText(canonicalName, 300);
    if (!name) {
      const error = new Error('Canonical name is required');
      error.code = 'ENTITY_NAME_REQUIRED';
      throw error;
    }
    if (!ENTITY_TYPES.has(entityType)) {
      const error = new Error('Unsupported entity type');
      error.code = 'INVALID_ENTITY_TYPE';
      throw error;
    }
    if (!ENTITY_STATUSES.has(status)) {
      const error = new Error('Unsupported entity status');
      error.code = 'INVALID_ENTITY_STATUS';
      throw error;
    }

    const db = this.pool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT * FROM entities WHERE id=$1 FOR UPDATE', [entityId]);
      if (!before.rowCount) return null;
      const normalized = normalizeName(name);
      const duplicate = await client.query(
        'SELECT id,canonical_name FROM entities WHERE entity_type=$1 AND normalized_name=$2 AND id<>$3 LIMIT 1',
        [entityType, normalized, entityId]
      );
      if (duplicate.rowCount) {
        const error = new Error(`Duplicate entity: ${duplicate.rows[0].canonical_name}`);
        error.code = 'ENTITY_DUPLICATE';
        error.duplicateEntityId = duplicate.rows[0].id;
        throw error;
      }
      const updated = await client.query(`
        UPDATE entities
        SET canonical_name=$2,normalized_name=$3,entity_type=$4,short_description=$5,status=$6,updated_at=now()
        WHERE id=$1 RETURNING *`,
        [entityId, name, normalized, entityType, cleanText(shortDescription), status]
      );
      await client.query(`INSERT INTO review_actions(target_type,target_id,action,old_value,new_value,comment,actor)
        VALUES('entity',$1,'edit',$2::jsonb,$3::jsonb,$4,$5)`,
        [entityId, JSON.stringify(before.rows[0]), JSON.stringify(updated.rows[0]), cleanText(comment, 1000), actor]
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async addAlias({ entityId, alias, language = null, comment = '', actor = 'admin' }) {
    const cleanAlias = cleanText(alias, 300);
    if (!cleanAlias) {
      const error = new Error('Alias is required');
      error.code = 'ALIAS_REQUIRED';
      throw error;
    }
    const db = this.pool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const entity = await client.query('SELECT id FROM entities WHERE id=$1 FOR UPDATE', [entityId]);
      if (!entity.rowCount) return null;
      const normalized = normalizeName(cleanAlias);
      const inserted = await client.query(`
        INSERT INTO entity_aliases(entity_id,alias,normalized_alias,language)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(entity_id,normalized_alias) DO UPDATE SET alias=EXCLUDED.alias,language=COALESCE(EXCLUDED.language,entity_aliases.language)
        RETURNING *`, [entityId, cleanAlias, normalized, cleanText(language, 20)]);
      await client.query(`INSERT INTO review_actions(target_type,target_id,action,new_value,comment,actor)
        VALUES('entity',$1,'add_alias',$2::jsonb,$3,$4)`,
        [entityId, JSON.stringify(inserted.rows[0]), cleanText(comment, 1000), actor]);
      await client.query('COMMIT');
      return inserted.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async deleteAlias({ entityId, aliasId, comment = '', actor = 'admin' }) {
    const db = this.pool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const removed = await client.query('DELETE FROM entity_aliases WHERE id=$1 AND entity_id=$2 RETURNING *', [aliasId, entityId]);
      if (!removed.rowCount) return null;
      await client.query(`INSERT INTO review_actions(target_type,target_id,action,old_value,comment,actor)
        VALUES('entity',$1,'delete_alias',$2::jsonb,$3,$4)`,
        [entityId, JSON.stringify(removed.rows[0]), cleanText(comment, 1000), actor]);
      await client.query('COMMIT');
      return removed.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async history(entityId, limit = 100) {
    const result = await this.pool().query(`
      SELECT id,action,old_value,new_value,comment,actor,created_at
      FROM review_actions
      WHERE target_type='entity' AND target_id=$1
      ORDER BY created_at DESC,id DESC LIMIT $2`, [entityId, Math.min(Math.max(Number(limit) || 100, 1), 300)]);
    return result.rows;
  }
}

export const knowledgeEntityTypes = [...ENTITY_TYPES];
export const knowledgeEntityStatuses = [...ENTITY_STATUSES];
