import { getPool, postgresEnabled } from '../../db/Postgres.js';

function dbOrThrow(db) {
  if (db) return db;
  if (!postgresEnabled()) {
    const error = new Error('Knowledge audit requires PostgreSQL');
    error.code = 'POSTGRES_REQUIRED';
    throw error;
  }
  return getPool();
}

function cleanText(value, max = 1000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

const reversibleEntityActions = new Set(['edit']);
const reversibleFactActions = new Set(['edit', 'verify', 'publish', 'reject']);

function isReversible(row) {
  return (row.target_type === 'entity' && reversibleEntityActions.has(row.action)) ||
    (row.target_type === 'fact' && reversibleFactActions.has(row.action));
}

export class KnowledgeAuditService {
  constructor({ db } = {}) { this.db = db ?? null; }
  pool() { return dbOrThrow(this.db); }

  async list({ targetType = '', action = '', actor = '', query = '', limit = 50, offset = 0 } = {}) {
    const db = this.pool();
    const values = [];
    const where = [];
    if (targetType) { values.push(targetType); where.push(`r.target_type=$${values.length}`); }
    if (action) { values.push(action); where.push(`r.action=$${values.length}`); }
    if (actor) { values.push(`%${actor.toLowerCase()}%`); where.push(`LOWER(COALESCE(r.actor,'')) LIKE $${values.length}`); }
    if (query) {
      values.push(`%${query.toLowerCase()}%`);
      where.push(`(LOWER(COALESCE(r.comment,'')) LIKE $${values.length} OR LOWER(r.target_id) LIKE $${values.length} OR LOWER(r.action) LIKE $${values.length})`);
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const boundedOffset = Math.max(Number(offset) || 0, 0);
    values.push(boundedLimit); const limitPos = values.length;
    values.push(boundedOffset); const offsetPos = values.length;
    const rows = await db.query(`
      SELECT r.id,r.target_type,r.target_id,r.action,r.comment,r.actor,r.created_at,
        r.old_value,r.new_value,
        CASE WHEN r.target_type='entity' THEN e.canonical_name WHEN r.target_type='fact' THEN s.canonical_name END AS target_name,
        CASE WHEN r.target_type='fact' THEN f.predicate END AS predicate
      FROM review_actions r
      LEFT JOIN entities e ON r.target_type='entity' AND e.id=r.target_id
      LEFT JOIN facts f ON r.target_type='fact' AND f.id=r.target_id
      LEFT JOIN entities s ON f.subject_entity_id=s.id
      ${filter}
      ORDER BY r.created_at DESC,r.id DESC
      LIMIT $${limitPos} OFFSET $${offsetPos}`, values);
    const count = await db.query(`SELECT COUNT(*)::int AS count FROM review_actions r ${filter}`, values.slice(0, -2));
    return {
      items: rows.rows.map(row => ({ ...row, reversible: isReversible(row) })),
      total: count.rows[0].count,
      limit: boundedLimit,
      offset: boundedOffset
    };
  }

  async details(actionId) {
    const result = await this.pool().query(`
      SELECT r.*,
        CASE WHEN r.target_type='entity' THEN e.canonical_name WHEN r.target_type='fact' THEN s.canonical_name END AS target_name,
        CASE WHEN r.target_type='fact' THEN f.predicate END AS predicate
      FROM review_actions r
      LEFT JOIN entities e ON r.target_type='entity' AND e.id=r.target_id
      LEFT JOIN facts f ON r.target_type='fact' AND f.id=r.target_id
      LEFT JOIN entities s ON f.subject_entity_id=s.id
      WHERE r.id=$1`, [actionId]);
    const row = result.rows[0];
    return row ? { ...row, reversible: isReversible(row) } : null;
  }

  async revert({ actionId, comment = '', actor = 'admin' }) {
    const db = this.pool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const actionResult = await client.query('SELECT * FROM review_actions WHERE id=$1 FOR UPDATE', [actionId]);
      if (!actionResult.rowCount) return null;
      const action = actionResult.rows[0];
      if (!isReversible(action) || !action.old_value) {
        const error = new Error('This action cannot be reverted automatically');
        error.code = 'ACTION_NOT_REVERSIBLE';
        throw error;
      }
      const later = await client.query(`SELECT id,action,created_at FROM review_actions
        WHERE target_type=$1 AND target_id=$2 AND (created_at>$3 OR (created_at=$3 AND id>$4))
        ORDER BY created_at DESC,id DESC LIMIT 1`, [action.target_type, action.target_id, action.created_at, action.id]);
      if (later.rowCount) {
        const error = new Error('A newer change exists for this record');
        error.code = 'NEWER_ACTION_EXISTS';
        error.newerActionId = later.rows[0].id;
        throw error;
      }

      let current;
      let restored;
      if (action.target_type === 'entity') {
        current = await client.query('SELECT * FROM entities WHERE id=$1 FOR UPDATE', [action.target_id]);
        if (!current.rowCount) {
          const error = new Error('Entity no longer exists');
          error.code = 'REVERT_TARGET_NOT_FOUND';
          throw error;
        }
        const old = action.old_value;
        restored = await client.query(`UPDATE entities SET canonical_name=$2,normalized_name=$3,entity_type=$4,
          short_description=$5,status=$6,relevance=$7,updated_at=now() WHERE id=$1 RETURNING *`,
          [action.target_id, old.canonical_name, old.normalized_name, old.entity_type, old.short_description ?? null,
            old.status, old.relevance ?? 'secondary']);
      } else {
        current = await client.query('SELECT * FROM facts WHERE id=$1 FOR UPDATE', [action.target_id]);
        if (!current.rowCount) {
          const error = new Error('Fact no longer exists');
          error.code = 'REVERT_TARGET_NOT_FOUND';
          throw error;
        }
        const old = action.old_value;
        restored = await client.query(`UPDATE facts SET subject_entity_id=$2,predicate=$3,object_entity_id=$4,
          text_value=$5,number_value=$6,date_value=$7,unit=$8,confidence=$9,status=$10,relevance=$11,updated_at=now()
          WHERE id=$1 RETURNING *`, [action.target_id, old.subject_entity_id, old.predicate, old.object_entity_id ?? null,
            old.text_value ?? null, old.number_value ?? null, old.date_value ?? null, old.unit ?? null,
            old.confidence ?? null, old.status, old.relevance ?? 'secondary']);
      }

      const audit = await client.query(`INSERT INTO review_actions(target_type,target_id,action,old_value,new_value,comment,actor)
        VALUES($1,$2,'revert',$3::jsonb,$4::jsonb,$5,$6) RETURNING *`,
        [action.target_type, action.target_id, JSON.stringify(current.rows[0]), JSON.stringify({
          ...restored.rows[0], revertedActionId: action.id
        }), cleanText(comment), actor]);
      await client.query('COMMIT');
      return { restored: restored.rows[0], audit: audit.rows[0], revertedActionId: action.id };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        const conflict = new Error('Revert would create a duplicate record');
        conflict.code = 'REVERT_CONFLICT';
        throw conflict;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
