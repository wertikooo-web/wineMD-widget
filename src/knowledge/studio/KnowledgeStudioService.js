import { getPool, postgresEnabled } from '../../db/Postgres.js';

function assertPostgres() {
  if (!postgresEnabled()) {
    const error = new Error('Knowledge Studio requires PostgreSQL');
    error.code = 'POSTGRES_REQUIRED';
    throw error;
  }
  return getPool();
}

const allowedStatuses = new Set(['extracted', 'needs_review', 'verified', 'rejected', 'published']);
const allowedActions = new Set(['verify', 'reject', 'publish']);
const entitySorts = {
  name: 'e.canonical_name',
  type: 'e.entity_type',
  facts: 'fact_count',
  sources: 'source_count',
  created: 'e.created_at',
  updated: 'e.updated_at',
  status: 'e.status'
};
const factSorts = {
  updated: 'f.updated_at',
  created: 'f.created_at',
  confidence: 'f.confidence',
  subject: 's.canonical_name',
  predicate: 'f.predicate',
  sources: 'source_count',
  status: 'f.status'
};
const direction = value => String(value).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

export class KnowledgeStudioService {
  constructor({ db } = {}) { this.db = db ?? null; }
  pool() { return this.db ?? assertPostgres(); }

  async overview() {
    const db = this.pool();
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM documents) AS documents,
        (SELECT COUNT(*)::int FROM document_chunks) AS chunks,
        (SELECT COUNT(*)::int FROM entities) AS entities,
        (SELECT COUNT(*)::int FROM facts) AS facts,
        (SELECT COUNT(*)::int FROM facts WHERE status='verified') AS verified,
        (SELECT COUNT(*)::int FROM facts WHERE status='published') AS published,
        (SELECT COUNT(*)::int FROM facts WHERE status='needs_review') AS needs_review,
        (SELECT COUNT(*)::int FROM facts WHERE status='rejected') AS rejected,
        (SELECT COUNT(*)::int FROM facts f WHERE NOT EXISTS (SELECT 1 FROM fact_sources s WHERE s.fact_id=f.id)) AS facts_without_source,
        (SELECT COUNT(*)::int FROM entities e WHERE NOT EXISTS (SELECT 1 FROM facts f WHERE f.subject_entity_id=e.id OR f.object_entity_id=e.id)) AS entities_without_facts,
        (SELECT COUNT(*)::int FROM catalog_products) AS catalog_products,
        (SELECT COUNT(*)::int FROM catalog_products WHERE availability IN ('in_stock','available')) AS catalog_available,
        (SELECT COUNT(*)::int FROM catalog_products WHERE wine_entity_id IS NULL) AS catalog_unmatched
    `);
    const types = await db.query(`SELECT entity_type,COUNT(*)::int AS count FROM entities GROUP BY entity_type ORDER BY count DESC,entity_type`);
    const predicates = await db.query(`SELECT predicate,COUNT(*)::int AS count FROM facts GROUP BY predicate ORDER BY count DESC,predicate LIMIT 30`);
    return { ...result.rows[0], entity_types: types.rows, predicates: predicates.rows };
  }

  async listEntities({ query = '', type = '', status = '', sort = 'name', order = 'asc', limit = 50, offset = 0 } = {}) {
    const db = this.pool();
    const values = [];
    const where = [];
    if (query.trim()) {
      values.push(`%${query.trim().toLocaleLowerCase()}%`);
      where.push(`(e.normalized_name LIKE $${values.length} OR LOWER(COALESCE(e.short_description,'')) LIKE $${values.length} OR EXISTS (
        SELECT 1 FROM entity_aliases a WHERE a.entity_id=e.id AND a.normalized_alias LIKE $${values.length}
      ))`);
    }
    if (type.trim()) { values.push(type.trim()); where.push(`e.entity_type=$${values.length}`); }
    if (status.trim()) { values.push(status.trim()); where.push(`e.status=$${values.length}`); }
    values.push(Math.min(Math.max(Number(limit) || 50, 1), 200)); const limitPosition = values.length;
    values.push(Math.max(Number(offset) || 0, 0)); const offsetPosition = values.length;
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortSql = entitySorts[sort] ?? entitySorts.name;
    const orderSql = direction(order);

    const rows = await db.query(`
      SELECT e.id,e.entity_type,e.canonical_name,e.short_description,e.status,e.relevance,e.created_at,e.updated_at,
        COUNT(DISTINCT f.id)::int AS fact_count,
        COUNT(DISTINCT fs.id)::int AS evidence_count,
        COUNT(DISTINCT fs.document_id)::int AS source_count,
        COALESCE(jsonb_agg(DISTINCT a.alias) FILTER (WHERE a.alias IS NOT NULL),'[]'::jsonb) AS aliases
      FROM entities e
      LEFT JOIN entity_aliases a ON a.entity_id=e.id
      LEFT JOIN facts f ON f.subject_entity_id=e.id OR f.object_entity_id=e.id
      LEFT JOIN fact_sources fs ON fs.fact_id=f.id
      ${filter}
      GROUP BY e.id
      ORDER BY ${sortSql} ${orderSql} NULLS LAST,e.canonical_name ASC
      LIMIT $${limitPosition} OFFSET $${offsetPosition}
    `, values);
    const countValues = values.slice(0, -2);
    const count = await db.query(`SELECT COUNT(*)::int AS count FROM entities e ${filter}`, countValues);
    return { items: rows.rows, total: count.rows[0].count, limit: values[limitPosition - 1], offset: values[offsetPosition - 1] };
  }

  async entityDetails(entityId) {
    const db = this.pool();
    const entity = await db.query(`
      SELECT e.*,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'alias',a.alias,'language',a.language) ORDER BY a.alias)
          FROM entity_aliases a WHERE a.entity_id=e.id),'[]'::jsonb) AS aliases,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'description',d.description,'language',d.language,'status',d.status,'documentId',d.document_id,'chunkId',d.chunk_id) ORDER BY d.created_at)
          FROM entity_descriptions d WHERE d.entity_id=e.id),'[]'::jsonb) AS descriptions
      FROM entities e WHERE e.id=$1`, [entityId]);
    if (!entity.rowCount) return null;

    const facts = await db.query(`
      SELECT f.id,f.subject_entity_id,sub.canonical_name AS subject_name,f.predicate,p.label_ru,p.label_ro,p.label_en,
        f.object_entity_id,o.canonical_name AS object_name,f.text_value,f.number_value,f.date_value,f.unit,
        f.confidence,f.status,f.relevance,f.created_at,f.updated_at,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object('documentId',fs.document_id,'documentTitle',d.title,
          'chunkId',fs.chunk_id,'pageNumber',fs.page_number,'quote',fs.source_quote,'url',fs.source_url,
          'chunkText',dc.text)) FILTER (WHERE fs.id IS NOT NULL),'[]'::jsonb) AS sources
      FROM facts f
      JOIN entities sub ON sub.id=f.subject_entity_id
      JOIN predicate_catalog p ON p.predicate=f.predicate
      LEFT JOIN entities o ON o.id=f.object_entity_id
      LEFT JOIN fact_sources fs ON fs.fact_id=f.id
      LEFT JOIN documents d ON d.id=fs.document_id
      LEFT JOIN document_chunks dc ON dc.id=fs.chunk_id
      WHERE f.subject_entity_id=$1 OR f.object_entity_id=$1
      GROUP BY f.id,p.predicate,sub.id,o.id
      ORDER BY f.updated_at DESC`, [entityId]);

    return { ...entity.rows[0], facts: facts.rows };
  }

  async listFacts({ query = '', predicate = '', status = '', needsReview = false, sort = 'updated', order = 'desc', limit = 50, offset = 0 } = {}) {
    const db = this.pool();
    const values = [];
    const where = [];
    if (query.trim()) {
      values.push(`%${query.trim().toLocaleLowerCase()}%`);
      where.push(`(s.normalized_name LIKE $${values.length} OR COALESCE(o.normalized_name,'') LIKE $${values.length} OR LOWER(COALESCE(f.text_value,'')) LIKE $${values.length} OR LOWER(f.predicate) LIKE $${values.length})`);
    }
    if (predicate.trim()) { values.push(predicate.trim()); where.push(`f.predicate=$${values.length}`); }
    if (status.trim()) { values.push(status.trim()); where.push(`f.status=$${values.length}`); }
    if (needsReview) where.push(`(f.status='needs_review' OR f.relevance='needs_review' OR f.confidence < 0.75 OR NOT EXISTS (SELECT 1 FROM fact_sources x WHERE x.fact_id=f.id))`);
    values.push(Math.min(Math.max(Number(limit) || 50, 1), 200)); const limitPosition = values.length;
    values.push(Math.max(Number(offset) || 0, 0)); const offsetPosition = values.length;
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortSql = factSorts[sort] ?? factSorts.updated;
    const orderSql = direction(order);

    const rows = await db.query(`
      SELECT f.id,s.canonical_name AS subject_name,f.subject_entity_id,f.predicate,p.label_ru,p.label_ro,p.label_en,
        o.canonical_name AS object_name,f.object_entity_id,f.text_value,f.number_value,f.date_value,f.unit,
        f.confidence,f.status,f.relevance,f.created_at,f.updated_at,COUNT(fs.id)::int AS source_count
      FROM facts f
      JOIN entities s ON s.id=f.subject_entity_id
      JOIN predicate_catalog p ON p.predicate=f.predicate
      LEFT JOIN entities o ON o.id=f.object_entity_id
      LEFT JOIN fact_sources fs ON fs.fact_id=f.id
      ${filter}
      GROUP BY f.id,s.id,p.predicate,o.id
      ORDER BY ${sortSql} ${orderSql} NULLS LAST,f.id
      LIMIT $${limitPosition} OFFSET $${offsetPosition}`, values);
    const countValues = values.slice(0, -2);
    const count = await db.query(`SELECT COUNT(*)::int AS count FROM facts f JOIN entities s ON s.id=f.subject_entity_id LEFT JOIN entities o ON o.id=f.object_entity_id ${filter}`, countValues);
    return { items: rows.rows, total: count.rows[0].count, limit: values[limitPosition - 1], offset: values[offsetPosition - 1] };
  }

  async factDetails(factId) {
    const result = await this.pool().query(`
      SELECT f.*,s.canonical_name AS subject_name,o.canonical_name AS object_name,p.label_ru,p.label_ro,p.label_en,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object('documentId',fs.document_id,'documentTitle',d.title,
          'chunkId',fs.chunk_id,'pageNumber',fs.page_number,'quote',fs.source_quote,'url',fs.source_url,'chunkText',dc.text))
          FILTER (WHERE fs.id IS NOT NULL),'[]'::jsonb) AS sources
      FROM facts f JOIN entities s ON s.id=f.subject_entity_id
      JOIN predicate_catalog p ON p.predicate=f.predicate
      LEFT JOIN entities o ON o.id=f.object_entity_id
      LEFT JOIN fact_sources fs ON fs.fact_id=f.id
      LEFT JOIN documents d ON d.id=fs.document_id
      LEFT JOIN document_chunks dc ON dc.id=fs.chunk_id
      WHERE f.id=$1 GROUP BY f.id,s.id,o.id,p.predicate`, [factId]);
    return result.rows[0] ?? null;
  }

  async graph(entityId, depth = 1, limit = 80) {
    const db = this.pool();
    const root = await db.query('SELECT id,canonical_name,entity_type,status FROM entities WHERE id=$1', [entityId]);
    if (!root.rowCount) return null;
    const facts = await db.query(`
      SELECT f.id,f.predicate,p.label_ru,f.subject_entity_id,s.canonical_name AS subject_name,s.entity_type AS subject_type,
        f.object_entity_id,o.canonical_name AS object_name,o.entity_type AS object_type,f.text_value,f.number_value,f.date_value,f.unit,f.status
      FROM facts f JOIN predicate_catalog p ON p.predicate=f.predicate
      JOIN entities s ON s.id=f.subject_entity_id LEFT JOIN entities o ON o.id=f.object_entity_id
      WHERE f.subject_entity_id=$1 OR f.object_entity_id=$1 ORDER BY f.confidence DESC NULLS LAST LIMIT $2`, [entityId, Math.min(Math.max(Number(limit)||80,1),200)]);
    const nodes = new Map([[root.rows[0].id, root.rows[0]]]);
    const edges = [];
    for (const f of facts.rows) {
      nodes.set(f.subject_entity_id,{id:f.subject_entity_id,name:f.subject_name,type:f.subject_type});
      if (f.object_entity_id) nodes.set(f.object_entity_id,{id:f.object_entity_id,name:f.object_name,type:f.object_type});
      edges.push({id:f.id,from:f.subject_entity_id,to:f.object_entity_id,predicate:f.predicate,label:f.label_ru,value:f.object_entity_id?null:(f.text_value ?? f.number_value ?? f.date_value),status:f.status});
    }
    return { root: root.rows[0], nodes:[...nodes.values()], edges, depth: Number(depth)||1 };
  }

  async reviewFact({ factId, action, comment = '', actor = 'admin' }) {
    if (!allowedActions.has(action)) { const error = new Error('Unsupported review action'); error.code = 'INVALID_REVIEW_ACTION'; throw error; }
    const status = action === 'verify' ? 'verified' : action === 'publish' ? 'published' : 'rejected';
    const db = this.pool(); const client = await db.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT * FROM facts WHERE id=$1 FOR UPDATE', [factId]);
      if (!before.rowCount) return null;
      const updated = await client.query('UPDATE facts SET status=$2,updated_at=now() WHERE id=$1 RETURNING *', [factId, status]);
      await client.query(`INSERT INTO review_actions(target_type,target_id,action,old_value,new_value,comment,actor) VALUES('fact',$1,$2,$3::jsonb,$4::jsonb,$5,$6)`, [factId, action, JSON.stringify(before.rows[0]), JSON.stringify(updated.rows[0]), comment, actor]);
      await client.query('COMMIT'); return updated.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async updateFact({ factId, predicate, objectEntityId = null, textValue = null, numberValue = null, dateValue = null, unit = null, comment = '', actor = 'admin' }) {
    const db = this.pool(); const client = await db.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT * FROM facts WHERE id=$1 FOR UPDATE', [factId]);
      if (!before.rowCount) return null;
      const predicateExists = await client.query('SELECT 1 FROM predicate_catalog WHERE predicate=$1 AND active=true', [predicate]);
      if (!predicateExists.rowCount) { const error = new Error('Unknown predicate'); error.code = 'UNKNOWN_PREDICATE'; throw error; }
      if (!objectEntityId && textValue == null && numberValue == null && dateValue == null) { const error = new Error('Fact must have an object or value'); error.code = 'FACT_VALUE_REQUIRED'; throw error; }
      const updated = await client.query(`UPDATE facts SET predicate=$2,object_entity_id=$3,text_value=$4,number_value=$5,date_value=$6,unit=$7,status='verified',updated_at=now() WHERE id=$1 RETURNING *`, [factId,predicate,objectEntityId,textValue,numberValue,dateValue,unit]);
      await client.query(`INSERT INTO review_actions(target_type,target_id,action,old_value,new_value,comment,actor) VALUES('fact',$1,'edit',$2::jsonb,$3::jsonb,$4,$5)`, [factId,JSON.stringify(before.rows[0]),JSON.stringify(updated.rows[0]),comment,actor]);
      await client.query('COMMIT'); return updated.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async predicates() { return (await this.pool().query('SELECT * FROM predicate_catalog WHERE active=true ORDER BY label_ru')).rows; }
}

export const knowledgeStudioStatuses = [...allowedStatuses];
