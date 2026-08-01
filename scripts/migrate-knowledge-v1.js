import dotenv from 'dotenv';
import { getPool, postgresEnabled } from '../src/db/Postgres.js';

dotenv.config({ override: true });

if (!postgresEnabled()) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = getPool();

const sql = `
CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  title text NOT NULL,
  file_name text,
  source_type text NOT NULL DEFAULT 'other',
  language text,
  status text NOT NULL DEFAULT 'uploaded',
  source_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  indexed_at timestamptz,
  extracted_at timestamptz
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  page_number integer,
  text text NOT NULL,
  embedding jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS document_chunks_document_idx ON document_chunks(document_id);

CREATE TABLE IF NOT EXISTS entities (
  id text PRIMARY KEY,
  entity_type text NOT NULL,
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  short_description text,
  status text NOT NULL DEFAULT 'extracted',
  relevance text NOT NULL DEFAULT 'core',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, normalized_name)
);
CREATE INDEX IF NOT EXISTS entities_type_idx ON entities(entity_type);
CREATE INDEX IF NOT EXISTS entities_status_idx ON entities(status);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id bigserial PRIMARY KEY,
  entity_id text NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  language text,
  source_document_id text REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS entity_aliases_normalized_idx ON entity_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS entity_descriptions (
  id bigserial PRIMARY KEY,
  entity_id text NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  language text,
  description text NOT NULL,
  document_id text REFERENCES documents(id) ON DELETE SET NULL,
  chunk_id text REFERENCES document_chunks(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'extracted',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS predicate_catalog (
  predicate text PRIMARY KEY,
  label_ru text NOT NULL,
  label_ro text,
  label_en text NOT NULL,
  subject_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  object_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS facts (
  id text PRIMARY KEY,
  subject_entity_id text NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  predicate text NOT NULL REFERENCES predicate_catalog(predicate),
  object_entity_id text REFERENCES entities(id) ON DELETE SET NULL,
  text_value text,
  number_value numeric,
  date_value date,
  unit text,
  confidence double precision NOT NULL DEFAULT 0.75,
  status text NOT NULL DEFAULT 'extracted',
  relevance text NOT NULL DEFAULT 'core',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (object_entity_id IS NOT NULL OR text_value IS NOT NULL OR number_value IS NOT NULL OR date_value IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS facts_subject_idx ON facts(subject_entity_id);
CREATE INDEX IF NOT EXISTS facts_object_idx ON facts(object_entity_id);
CREATE INDEX IF NOT EXISTS facts_predicate_idx ON facts(predicate);
CREATE INDEX IF NOT EXISTS facts_status_idx ON facts(status);

CREATE TABLE IF NOT EXISTS fact_sources (
  id bigserial PRIMARY KEY,
  fact_id text NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  document_id text REFERENCES documents(id) ON DELETE SET NULL,
  chunk_id text REFERENCES document_chunks(id) ON DELETE SET NULL,
  page_number integer,
  source_quote text,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_sources_fact_idx ON fact_sources(fact_id);

CREATE TABLE IF NOT EXISTS extraction_profiles (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  allowed_entity_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_predicates jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extraction_jobs (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  profile_id text REFERENCES extraction_profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued',
  total_chunks integer NOT NULL DEFAULT 0,
  processed_chunks integer NOT NULL DEFAULT 0,
  failed_chunks integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_actions (
  id bigserial PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  comment text,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_actions_target_idx ON review_actions(target_type, target_id);

CREATE TABLE IF NOT EXISTS catalog_products (
  id text PRIMARY KEY,
  external_id text NOT NULL UNIQUE,
  wine_entity_id text REFERENCES entities(id) ON DELETE SET NULL,
  seller_entity_id text REFERENCES entities(id) ON DELETE SET NULL,
  title text NOT NULL,
  vintage text,
  volume_ml integer,
  price numeric,
  currency text,
  availability text,
  stock_quantity integer,
  product_url text,
  image_url text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_products_wine_idx ON catalog_products(wine_entity_id);
CREATE INDEX IF NOT EXISTS catalog_products_availability_idx ON catalog_products(availability);

CREATE TABLE IF NOT EXISTS catalog_sync_jobs (
  id text PRIMARY KEY,
  source text NOT NULL DEFAULT 'wine.md',
  mode text NOT NULL DEFAULT 'scheduled',
  status text NOT NULL DEFAULT 'queued',
  products_seen integer NOT NULL DEFAULT 0,
  products_changed integer NOT NULL DEFAULT 0,
  products_failed integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_sync_errors (
  id bigserial PRIMARY KEY,
  job_id text REFERENCES catalog_sync_jobs(id) ON DELETE CASCADE,
  external_id text,
  error text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tours (
  id text PRIMARY KEY,
  winery_entity_id text NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  duration_minutes integer,
  price numeric,
  currency text,
  languages jsonb NOT NULL DEFAULT '[]'::jsonb,
  booking_url text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wine_routes (
  id text PRIMARY KEY,
  route_entity_id text REFERENCES entities(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  duration text,
  distance_km numeric,
  region_entity_id text REFERENCES entities(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wine_route_stops (
  route_id text NOT NULL REFERENCES wine_routes(id) ON DELETE CASCADE,
  stop_order integer NOT NULL,
  entity_id text NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  notes text,
  PRIMARY KEY(route_id, stop_order)
);
`;

const predicates = [
  ['located_in','находится в','este situat în','located in'],
  ['founded_in','основано в','fondat în','founded in'],
  ['produces','производит','produce','produces'],
  ['belongs_to_line','входит в линейку','aparține gamei','belongs to line'],
  ['made_from','сделано из','produs din','made from'],
  ['grows','выращивает','cultivă','grows'],
  ['grown_in','выращивается в','cultivat în','grown in'],
  ['has_aroma','имеет аромат','are aroma','has aroma'],
  ['has_flavor','имеет вкус','are gust','has flavor'],
  ['pairs_with','сочетается с','se asociază cu','pairs with'],
  ['served_with','подаётся с','se servește cu','served with'],
  ['aged_in','выдерживается в','maturat în','aged in'],
  ['has_style','имеет стиль','are stil','has style'],
  ['has_color','имеет цвет','are culoare','has color'],
  ['has_sweetness','имеет уровень сладости','are nivel de dulceață','has sweetness'],
  ['part_of_region','относится к региону','face parte din regiune','part of region'],
  ['part_of_route','входит в маршрут','face parte din rută','part of route'],
  ['offers_tour','предлагает экскурсию','oferă tur','offers tour'],
  ['offers_tasting','предлагает дегустацию','oferă degustare','offers tasting'],
  ['has_duration','имеет длительность','are durata','has duration'],
  ['has_price','имеет цену','are preț','has price'],
  ['available_at','доступно в','disponibil la','available at'],
  ['sold_by','продаётся у','vândut de','sold by'],
  ['has_vintage','имеет винтаж','are anul recoltei','has vintage'],
  ['has_alcohol','имеет крепость','are alcool','has alcohol'],
  ['has_history','имеет историю','are istorie','has history'],
  ['associated_with_tradition','связано с традицией','asociat cu tradiția','associated with tradition']
];

const profile = {
  id: 'wine-sommelier-moldova-v1',
  name: 'Wine Sommelier Moldova',
  description: 'Knowledge profile for Moldovan wine, wineries, grape varieties, geography, history, traditions, pairings, routes, tours, tastings and catalog references.',
  allowedEntityTypes: ['winery','wine','wine_line','grape_variety','wine_region','geographic_place','terroir','aroma','flavor','food','dish','tradition','historical_event','person','organization','wine_route','tour','tasting','event','shop','product'],
  allowedPredicates: predicates.map(([name]) => name),
  excludedTopics: ['book editor','book designer','pagination','prepress','isbn','printing metadata','publishing credits']
};

try {
  await db.query('BEGIN');
  await db.query(sql);
  for (const [predicate,labelRu,labelRo,labelEn] of predicates) {
    await db.query(`INSERT INTO predicate_catalog(predicate,label_ru,label_ro,label_en)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(predicate) DO UPDATE SET label_ru=EXCLUDED.label_ru,label_ro=EXCLUDED.label_ro,label_en=EXCLUDED.label_en,active=true`,
      [predicate,labelRu,labelRo,labelEn]);
  }
  await db.query(`INSERT INTO extraction_profiles(id,name,description,allowed_entity_types,allowed_predicates,excluded_topics)
    VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,allowed_entity_types=EXCLUDED.allowed_entity_types,allowed_predicates=EXCLUDED.allowed_predicates,excluded_topics=EXCLUDED.excluded_topics,updated_at=now()`,
    [profile.id,profile.name,profile.description,JSON.stringify(profile.allowedEntityTypes),JSON.stringify(profile.allowedPredicates),JSON.stringify(profile.excludedTopics)]);
  await db.query('COMMIT');
  console.log('Knowledge Architecture v1 schema is ready.');
} catch (error) {
  await db.query('ROLLBACK');
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.end();
}
