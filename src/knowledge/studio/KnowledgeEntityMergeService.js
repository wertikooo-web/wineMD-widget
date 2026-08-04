import { getPool, postgresEnabled } from '../../db/Postgres.js';

function dbOrThrow(db) {
  if (db) return db;
  if (!postgresEnabled()) {
    const error = new Error('Knowledge entity merge requires PostgreSQL');
    error.code = 'POSTGRES_REQUIRED';
    throw error;
  }
  return getPool();
}

function cleanText(value, max = 1000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

function invalidMerge(message, code = 'INVALID_MERGE_TARGET') {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class KnowledgeEntityMergeService {
  constructor({ db } = {}) { this.db = db ?? null; }
  pool() { return dbOrThrow(this.db); }

  async preview({ sourceEntityId, targetEntityId }) {
    if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId) {
      throw invalidMerge('Choose two different entities');
    }
    const db = this.pool();
    const entities = await db.query(`
      SELECT id,canonical_name,entity_type,status,
        (SELECT COUNT(*)::int FROM facts WHERE subject_entity_id=e.id OR object_entity_id=e.id) AS fact_count,
        (SELECT COUNT(*)::int FROM entity_aliases WHERE entity_id=e.id) AS alias_count,
        (SELECT COUNT(*)::int FROM entity_descriptions WHERE entity_id=e.id) AS description_count
      FROM entities e WHERE id=ANY($1::text[])`, [[sourceEntityId, targetEntityId]]);
    if (entities.rowCount !== 2) return null;
    const byId = new Map(entities.rows.map(row => [row.id, row]));
    const source = byId.get(sourceEntityId);
    const target = byId.get(targetEntityId);
    if (!source || !target) return null;
    if (source.entity_type !== target.entity_type) {
      throw invalidMerge('Entities of different types cannot be merged', 'MERGE_TYPE_MISMATCH');
    }
    const refs = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM catalog_products WHERE wine_entity_id=$1 OR seller_entity_id=$1) AS catalog_products,
      (SELECT COUNT(*)::int FROM tours WHERE winery_entity_id=$1) AS tours,
      (SELECT COUNT(*)::int FROM wine_routes WHERE route_entity_id=$1 OR region_entity_id=$1) AS routes,
      (SELECT COUNT(*)::int FROM wine_route_stops WHERE entity_id=$1) AS route_stops`, [sourceEntityId]);
    return { source, target, references: refs.rows[0] };
  }

  async merge({ sourceEntityId, targetEntityId, comment = '', actor = 'admin' }) {
    if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId) {
      throw invalidMerge('Choose two different entities');
    }
    const db = this.pool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(`
        SELECT id,canonical_name,normalized_name,entity_type,status,
          (SELECT COUNT(*)::int FROM facts WHERE subject_entity_id=e.id OR object_entity_id=e.id) AS fact_count,
          (SELECT COUNT(*)::int FROM entity_aliases WHERE entity_id=e.id) AS alias_count,
          (SELECT COUNT(*)::int FROM entity_descriptions WHERE entity_id=e.id) AS description_count
        FROM entities e WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`, [[sourceEntityId, targetEntityId]]);
      if (locked.rowCount !== 2) {
        throw invalidMerge('One of the entities no longer exists', 'MERGE_ENTITY_NOT_FOUND');
      }
      const byId = new Map(locked.rows.map(row => [row.id, row]));
      const source = byId.get(sourceEntityId);
      const target = byId.get(targetEntityId);
      if (!source || !target) throw invalidMerge('One of the entities no longer exists', 'MERGE_ENTITY_NOT_FOUND');
      if (source.entity_type !== target.entity_type) {
        throw invalidMerge('Entities changed type and can no longer be merged', 'MERGE_TYPE_MISMATCH');
      }

      const refs = await client.query(`SELECT
        (SELECT COUNT(*)::int FROM catalog_products WHERE wine_entity_id=$1 OR seller_entity_id=$1) AS catalog_products,
        (SELECT COUNT(*)::int FROM tours WHERE winery_entity_id=$1) AS tours,
        (SELECT COUNT(*)::int FROM wine_routes WHERE route_entity_id=$1 OR region_entity_id=$1) AS routes,
        (SELECT COUNT(*)::int FROM wine_route_stops WHERE entity_id=$1) AS route_stops`, [sourceEntityId]);
      const beforeCounts = { source, target, references: refs.rows[0] };

      await client.query(`INSERT INTO entity_aliases(entity_id,alias,normalized_alias,language,source_document_id)
        SELECT $2,alias,normalized_alias,language,source_document_id FROM entity_aliases WHERE entity_id=$1
        ON CONFLICT(entity_id,normalized_alias) DO NOTHING`, [sourceEntityId, targetEntityId]);
      await client.query(`INSERT INTO entity_aliases(entity_id,alias,normalized_alias)
        SELECT $2,canonical_name,normalized_name FROM entities WHERE id=$1
        ON CONFLICT(entity_id,normalized_alias) DO NOTHING`, [sourceEntityId, targetEntityId]);
      await client.query('UPDATE entity_descriptions SET entity_id=$2 WHERE entity_id=$1', [sourceEntityId, targetEntityId]);
      await client.query('UPDATE facts SET subject_entity_id=$2 WHERE subject_entity_id=$1', [sourceEntityId, targetEntityId]);
      await client.query('UPDATE facts SET object_entity_id=$2 WHERE object_entity_id=$1', [sourceEntityId, targetEntityId]);
      await client.query('UPDATE catalog_products SET wine_entity_id=$2 WHERE wine_entity_id=$1', [sourceEntityId, targetEntityId]);
      await client.query('UPDATE catalog_products SET seller_entity_id=$2 WHERE seller_entity_id=$1', [sourceEntityId, targetEntityId]);
      await client.query('UPDATE tours SET winery_entity_id=$2 WHERE winery_entity_id=$1', [sourceEntityId, targetEntityId]);
      await client.query('UPDATE wine_routes SET route_entity_id=$2 WHERE route_entity_id=$1', [sourceEntityId, targetEntityId]);
      await client.query('UPDATE wine_routes SET region_entity_id=$2 WHERE region_entity_id=$1', [sourceEntityId, targetEntityId]);
      await client.query(`DELETE FROM wine_route_stops s USING wine_route_stops t
        WHERE s.entity_id=$1 AND t.entity_id=$2 AND s.route_id=t.route_id AND s.stop_order=t.stop_order`, [sourceEntityId, targetEntityId]);
      await client.query('UPDATE wine_route_stops SET entity_id=$2 WHERE entity_id=$1', [sourceEntityId, targetEntityId]);

      const removedSelfReferences = await client.query(`DELETE FROM facts
        WHERE subject_entity_id=$1 AND object_entity_id=$1
        RETURNING id`, [targetEntityId]);

      const duplicates = await client.query(`
        SELECT array_agg(id ORDER BY updated_at DESC,id) AS ids
        FROM facts
        WHERE subject_entity_id=$1 OR object_entity_id=$1
        GROUP BY subject_entity_id,predicate,object_entity_id,text_value,number_value,date_value,unit
        HAVING COUNT(*)>1`, [targetEntityId]);
      let duplicateFactsRemoved = 0;
      for (const row of duplicates.rows) {
        const [keepId, ...removeIds] = row.ids;
        for (const removeId of removeIds) {
          await client.query(`INSERT INTO fact_sources(fact_id,document_id,chunk_id,page_number,source_quote,source_url)
            SELECT $1,fs.document_id,fs.chunk_id,fs.page_number,fs.source_quote,fs.source_url
            FROM fact_sources fs WHERE fs.fact_id=$2 AND NOT EXISTS (
              SELECT 1 FROM fact_sources x WHERE x.fact_id=$1
                AND x.document_id IS NOT DISTINCT FROM fs.document_id
                AND x.chunk_id IS NOT DISTINCT FROM fs.chunk_id
                AND x.page_number IS NOT DISTINCT FROM fs.page_number
                AND x.source_quote IS NOT DISTINCT FROM fs.source_quote
                AND x.source_url IS NOT DISTINCT FROM fs.source_url)`, [keepId, removeId]);
          await client.query('DELETE FROM facts WHERE id=$1', [removeId]);
          duplicateFactsRemoved += 1;
        }
      }

      const remainingSourceRefs = await client.query(`SELECT
        (SELECT COUNT(*)::int FROM facts WHERE subject_entity_id=$1 OR object_entity_id=$1) AS facts,
        (SELECT COUNT(*)::int FROM entity_aliases WHERE entity_id=$1) AS aliases,
        (SELECT COUNT(*)::int FROM entity_descriptions WHERE entity_id=$1) AS descriptions,
        (SELECT COUNT(*)::int FROM catalog_products WHERE wine_entity_id=$1 OR seller_entity_id=$1) AS catalog,
        (SELECT COUNT(*)::int FROM tours WHERE winery_entity_id=$1) AS tours,
        (SELECT COUNT(*)::int FROM wine_routes WHERE route_entity_id=$1 OR region_entity_id=$1) AS routes,
        (SELECT COUNT(*)::int FROM wine_route_stops WHERE entity_id=$1) AS stops`, [sourceEntityId]);
      const leftovers = remainingSourceRefs.rows[0];
      if (Object.values(leftovers).some(value => Number(value) > 0)) {
        const error = new Error('Merge left references to the source entity');
        error.code = 'MERGE_INCOMPLETE';
        error.leftovers = leftovers;
        throw error;
      }

      const mergeSummary = {
        mergedFrom: sourceEntityId,
        mergedInto: targetEntityId,
        removedSelfReferences: removedSelfReferences.rowCount,
        duplicateFactsRemoved,
        sourceBefore: beforeCounts.source,
        targetBefore: beforeCounts.target,
        referencesBefore: beforeCounts.references
      };
      await client.query(`INSERT INTO review_actions(target_type,target_id,action,old_value,new_value,comment,actor)
        VALUES('entity',$1,'merge_source',$2::jsonb,$3::jsonb,$4,$5)`,
        [sourceEntityId, JSON.stringify(beforeCounts), JSON.stringify(mergeSummary), cleanText(comment), actor]);
      await client.query(`INSERT INTO review_actions(target_type,target_id,action,old_value,new_value,comment,actor)
        VALUES('entity',$1,'merge_target',$2::jsonb,$3::jsonb,$4,$5)`,
        [targetEntityId, JSON.stringify(beforeCounts), JSON.stringify(mergeSummary), cleanText(comment), actor]);
      await client.query('DELETE FROM entities WHERE id=$1', [sourceEntityId]);
      const updatedTarget = await client.query('UPDATE entities SET updated_at=now() WHERE id=$1 RETURNING id,canonical_name,entity_type,status,updated_at', [targetEntityId]);
      await client.query('COMMIT');
      return { sourceEntityId, targetEntityId, target: updatedTarget.rows[0], summary: mergeSummary };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
