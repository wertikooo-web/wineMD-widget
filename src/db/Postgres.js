import pg from 'pg';

const { Pool } = pg;
let pool;
let schemaReady;

export function postgresEnabled(env = process.env) {
  return Boolean(String(env.DATABASE_URL ?? '').trim());
}

export function getPool(env = process.env) {
  if (!postgresEnabled(env)) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: String(env.PGSSL ?? 'true').toLowerCase() === 'false' ? false : { rejectUnauthorized: false },
      max: Number(env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    pool.on('error', error => console.error('PostgreSQL pool error:', error));
  }
  return pool;
}

export async function ensurePostgresSchema(env = process.env) {
  const db = getPool(env);
  if (!db) return false;
  if (!schemaReady) schemaReady = db.query(`
    CREATE TABLE IF NOT EXISTS assistant_settings (
      id text PRIMARY KEY DEFAULT 'default',
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS knowledge_entities (
      id text PRIMARY KEY,
      type text NOT NULL,
      canonical_name text NOT NULL,
      normalized_name text NOT NULL,
      aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
      descriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(type, normalized_name)
    );
    CREATE TABLE IF NOT EXISTS knowledge_facts (
      id text PRIMARY KEY,
      fact_key text NOT NULL UNIQUE,
      subject_entity_id text NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
      predicate text NOT NULL,
      object_entity_id text REFERENCES knowledge_entities(id) ON DELETE SET NULL,
      value text,
      document_id text NOT NULL,
      chunk_id text NOT NULL,
      source_text text,
      confidence double precision NOT NULL DEFAULT 0.75,
      status text NOT NULL DEFAULT 'extracted',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS knowledge_facts_document_idx ON knowledge_facts(document_id);
    CREATE INDEX IF NOT EXISTS knowledge_facts_chunk_idx ON knowledge_facts(chunk_id);
    CREATE TABLE IF NOT EXISTS knowledge_processed_chunks (
      chunk_id text PRIMARY KEY,
      document_id text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS knowledge_processed_document_idx ON knowledge_processed_chunks(document_id);
    CREATE TABLE IF NOT EXISTS benchmark_runs (
      run_id text PRIMARY KEY,
      dataset_id text NOT NULL,
      created_at timestamptz NOT NULL,
      stats jsonb NOT NULL DEFAULT '{}'::jsonb,
      payload jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS benchmark_runs_dataset_created_idx ON benchmark_runs(dataset_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS benchmark_run_jobs (
      job_id text PRIMARY KEY,
      dataset_id text,
      status text NOT NULL,
      phase text,
      message text,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      run_id text,
      stats jsonb,
      error text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS benchmark_run_jobs_updated_idx ON benchmark_run_jobs(updated_at DESC);
  `).then(() => true);
  return schemaReady;
}

export async function closePostgres() {
  if (pool) await pool.end();
  pool = undefined;
  schemaReady = undefined;
}
