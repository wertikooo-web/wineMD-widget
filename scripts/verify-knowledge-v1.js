import dotenv from 'dotenv';
import { getPool, postgresEnabled } from '../src/db/Postgres.js';

dotenv.config({ override: true });

if (!postgresEnabled()) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = getPool();
const requiredTables = [
  'documents','document_chunks','entities','entity_aliases','entity_descriptions',
  'predicate_catalog','facts','fact_sources','extraction_profiles','extraction_jobs',
  'review_actions','catalog_products','catalog_sync_jobs','catalog_sync_errors',
  'tours','wine_routes','wine_route_stops'
];

try {
  const tables = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  const existing = new Set(tables.rows.map(row => row.table_name));
  const missing = requiredTables.filter(name => !existing.has(name));
  if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);

  const predicateCount = await db.query('SELECT COUNT(*)::int AS count FROM predicate_catalog WHERE active=true');
  const profile = await db.query("SELECT id,name,active FROM extraction_profiles WHERE id='wine-sommelier-moldova-v1'");
  if (predicateCount.rows[0].count < 20) throw new Error('Predicate catalog is incomplete');
  if (!profile.rows[0]?.active) throw new Error('Wine Sommelier Moldova profile is missing or inactive');

  const legacy = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM knowledge_entities) AS legacy_entities,
      (SELECT COUNT(*)::int FROM knowledge_facts) AS legacy_facts,
      (SELECT COUNT(*)::int FROM knowledge_processed_chunks) AS legacy_chunks
  `);

  console.log(JSON.stringify({
    ok: true,
    tables: requiredTables.length,
    predicates: predicateCount.rows[0].count,
    profile: profile.rows[0],
    legacy: legacy.rows[0]
  }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.end();
}
