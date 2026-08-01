import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { getPool, postgresEnabled } from '../src/db/Postgres.js';

dotenv.config({ override: true });

if (!postgresEnabled()) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = getPool();
const id = (prefix, value) => `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20)}`;
const norm = value => String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const typeMap = new Map([
  ['winery', 'winery'], ['wine producer', 'winery'], ['producer', 'winery'],
  ['wine', 'wine'], ['wine_line', 'wine_line'], ['wine line', 'wine_line'],
  ['grape', 'grape_variety'], ['grape_variety', 'grape_variety'], ['grape variety', 'grape_variety'],
  ['region', 'wine_region'], ['wine_region', 'wine_region'], ['wine region', 'wine_region'],
  ['place', 'geographic_place'], ['city', 'geographic_place'], ['village', 'geographic_place'], ['country', 'geographic_place'],
  ['terroir', 'terroir'], ['aroma', 'aroma'], ['flavor', 'flavor'], ['food', 'food'], ['dish', 'dish'],
  ['tradition', 'tradition'], ['historical_event', 'historical_event'], ['historical event', 'historical_event'],
  ['person', 'person'], ['organization', 'organization'], ['route', 'wine_route'], ['wine_route', 'wine_route'],
  ['tour', 'tour'], ['tasting', 'tasting'], ['event', 'event'], ['shop', 'shop'], ['product', 'product']
]);

const predicateMap = new Map([
  ['located_in', 'located_in'], ['based_in', 'located_in'], ['is_located_in', 'located_in'], ['location', 'located_in'],
  ['founded_in', 'founded_in'], ['founded', 'founded_in'], ['established_in', 'founded_in'],
  ['produces', 'produces'], ['producer_of', 'produces'], ['makes', 'produces'],
  ['made_from', 'made_from'], ['made_of', 'made_from'], ['grape_variety', 'made_from'],
  ['grows', 'grows'], ['cultivates', 'grows'], ['grown_in', 'grown_in'],
  ['has_aroma', 'has_aroma'], ['aroma', 'has_aroma'], ['has_flavor', 'has_flavor'], ['flavor', 'has_flavor'],
  ['pairs_with', 'pairs_with'], ['pairing', 'pairs_with'], ['served_with', 'served_with'],
  ['aged_in', 'aged_in'], ['matured_in', 'aged_in'], ['has_style', 'has_style'], ['has_color', 'has_color'],
  ['has_sweetness', 'has_sweetness'], ['part_of_region', 'part_of_region'], ['part_of_route', 'part_of_route'],
  ['offers_tour', 'offers_tour'], ['offers_tasting', 'offers_tasting'], ['has_duration', 'has_duration'],
  ['has_price', 'has_price'], ['available_at', 'available_at'], ['sold_by', 'sold_by'],
  ['has_vintage', 'has_vintage'], ['vintage', 'has_vintage'], ['has_alcohol', 'has_alcohol'],
  ['has_history', 'has_history'], ['associated_with_tradition', 'associated_with_tradition']
]);

const excludedPredicates = new Set([
  'editor_of', 'author_of', 'designer_of', 'translator_of', 'pagination_prepress_of',
  'isbn', 'published_by', 'printed_by', 'typeset_by', 'proofreader_of'
]);

function classifyType(rawType) {
  const normalized = norm(rawType).replace(/[-_]+/g, ' ');
  return typeMap.get(normalized) ?? 'organization';
}

function classifyPredicate(rawPredicate) {
  const normalized = norm(rawPredicate).replace(/[\s-]+/g, '_');
  if (excludedPredicates.has(normalized)) return { predicate: null, relevance: 'irrelevant' };
  return { predicate: predicateMap.get(normalized) ?? null, relevance: predicateMap.has(normalized) ? 'core' : 'needs_review' };
}

async function ensureLegacyDocument(documentId) {
  await db.query(`INSERT INTO documents(id,title,file_name,source_type,status,indexed_at,extracted_at,metadata)
    VALUES($1,$2,$3,'book','extracted',now(),now(),$4::jsonb)
    ON CONFLICT(id) DO NOTHING`, [documentId, documentId, documentId, JSON.stringify({ migratedFrom: 'legacy_knowledge' })]);
}

try {
  await db.query('BEGIN');

  const entities = await db.query('SELECT * FROM knowledge_entities ORDER BY created_at');
  for (const row of entities.rows) {
    const entityType = classifyType(row.type);
    const relevance = entityType === 'organization' && !['organization', 'person'].includes(norm(row.type)) ? 'needs_review' : 'core';
    const descriptions = Array.isArray(row.descriptions) ? row.descriptions : [];
    const shortDescription = descriptions.find(Boolean) ?? null;

    await db.query(`INSERT INTO entities(id,entity_type,canonical_name,normalized_name,short_description,status,relevance,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,'extracted',$6,$7,$8)
      ON CONFLICT(id) DO UPDATE SET entity_type=EXCLUDED.entity_type,canonical_name=EXCLUDED.canonical_name,
        normalized_name=EXCLUDED.normalized_name,short_description=COALESCE(entities.short_description,EXCLUDED.short_description),
        relevance=EXCLUDED.relevance,updated_at=EXCLUDED.updated_at`,
      [row.id, entityType, row.canonical_name, row.normalized_name, shortDescription, relevance, row.created_at, row.updated_at]);

    const aliases = Array.isArray(row.aliases) ? row.aliases : [];
    for (const alias of aliases) {
      if (!String(alias).trim()) continue;
      await db.query(`INSERT INTO entity_aliases(entity_id,alias,normalized_alias)
        VALUES($1,$2,$3) ON CONFLICT(entity_id,normalized_alias) DO NOTHING`, [row.id, String(alias).trim(), norm(alias)]);
    }

    for (const description of descriptions) {
      if (!String(description).trim()) continue;
      await db.query(`INSERT INTO entity_descriptions(entity_id,description,status)
        SELECT $1,$2,'extracted' WHERE NOT EXISTS (
          SELECT 1 FROM entity_descriptions WHERE entity_id=$1 AND description=$2
        )`, [row.id, String(description).trim()]);
    }
  }

  const facts = await db.query('SELECT * FROM knowledge_facts ORDER BY created_at');
  let migrated = 0;
  let needsReview = 0;
  let irrelevant = 0;

  for (const row of facts.rows) {
    await ensureLegacyDocument(row.document_id);
    const classification = classifyPredicate(row.predicate);
    if (!classification.predicate) {
      irrelevant += 1;
      await db.query(`INSERT INTO review_actions(target_type,target_id,action,old_value,comment,actor)
        VALUES('legacy_fact',$1,$2,$3::jsonb,$4,'migration')`, [row.id, classification.relevance === 'irrelevant' ? 'hide' : 'needs_review', JSON.stringify(row), `Unknown or excluded predicate: ${row.predicate}`]);
      continue;
    }

    const targetStatus = classification.relevance === 'needs_review' ? 'needs_review' : row.status;
    if (targetStatus === 'needs_review') needsReview += 1;

    const factId = id('factv1', row.id);
    await db.query(`INSERT INTO facts(id,subject_entity_id,predicate,object_entity_id,text_value,confidence,status,relevance,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
      ON CONFLICT(id) DO NOTHING`, [factId,row.subject_entity_id,classification.predicate,row.object_entity_id,row.value,row.confidence,targetStatus,classification.relevance,row.created_at]);

    await db.query(`INSERT INTO fact_sources(fact_id,document_id,source_quote)
      SELECT $1,$2,$3 WHERE NOT EXISTS (
        SELECT 1 FROM fact_sources WHERE fact_id=$1 AND document_id=$2 AND COALESCE(source_quote,'')=COALESCE($3,'')
      )`, [factId,row.document_id,row.source_text]);
    migrated += 1;
  }

  await db.query('COMMIT');
  console.log(JSON.stringify({
    ok: true,
    entitiesMigrated: entities.rowCount,
    factsMigrated: migrated,
    factsNeedsReview: needsReview,
    factsExcluded: irrelevant
  }, null, 2));
} catch (error) {
  await db.query('ROLLBACK');
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.end();
}
