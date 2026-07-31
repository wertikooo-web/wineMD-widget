# WINE AI Knowledge Architecture v1

## Goal

Build a traceable, editable knowledge system for wines, wineries, grape varieties, regions, history, geography, terroir, traditions, food pairings, wine routes, tours, tastings and the live Wine.md assortment.

The architecture separates stable knowledge from fast-changing commercial catalog data.

## Stable knowledge layer

Sources include books, winery websites, ONVV, official registries, manually curated data and approved external sources.

Core tables:

- `documents`
- `document_chunks`
- `entities`
- `entity_aliases`
- `entity_descriptions`
- `facts`
- `fact_sources`
- `predicate_catalog`
- `extraction_profiles`
- `extraction_jobs`
- `review_actions`

### Controlled entity types

- winery
- wine
- wine_line
- grape_variety
- wine_region
- geographic_place
- terroir
- aroma
- flavor
- food
- dish
- tradition
- historical_event
- person
- organization
- wine_route
- tour
- tasting
- event
- shop
- product

Unknown types are stored as `needs_review` and are not published automatically.

### Controlled predicates

Initial predicates include:

- located_in
- founded_in
- produces
- belongs_to_line
- made_from
- grows
- grown_in
- has_aroma
- has_flavor
- pairs_with
- served_with
- aged_in
- has_style
- has_color
- has_sweetness
- part_of_region
- part_of_route
- offers_tour
- offers_tasting
- has_duration
- has_price
- available_at
- sold_by
- has_vintage
- has_alcohol
- has_history
- associated_with_tradition

The extractor must map synonyms to this catalog instead of inventing new predicates.

### Fact lifecycle

- extracted
- needs_review
- verified
- rejected
- published

Public answers should prioritize `published` and `verified` facts. High-confidence `extracted` facts may be used only when they have a valid source and no conflict.

## Wine.md live catalog layer

Commercial data is stored separately because price, availability and product pages change frequently.

Core tables:

- `catalog_products`
- `catalog_sync_jobs`
- `catalog_sync_errors`

Each catalog product can link to a canonical wine entity through `wine_entity_id`.

Preferred update model:

1. Wine.md webhook updates an individual product immediately.
2. Scheduled synchronization runs as a safety net.
3. Manual `Sync now` remains available in admin.

The Wine.md source is authoritative for current price, stock, image and product URL. It must never overwrite verified historical or descriptive knowledge.

## Knowledge Studio

Admin sections:

- Dashboard
- Documents
- Entities
- Facts
- Review queue
- Wine.md catalog
- Extraction profiles
- Sync history

Entity view must show canonical name, type, aliases, multilingual descriptions, facts, linked entities, sources, quotes and review history.

Fact view must show subject, predicate, object/value, confidence, status, source document, chunk, page, quote and review actions.

Review actions:

- verify
- edit
- reject
- merge
- restore
- publish

## Migration strategy

1. Create v1 tables next to legacy tables.
2. Keep legacy `knowledge_entities`, `knowledge_facts` and `knowledge_processed_chunks` intact.
3. Copy legacy entities and facts into the new schema.
4. Normalize entity types and predicates.
5. Mark book-production metadata such as editor, designer, prepress and ISBN as low relevance or `needs_review`.
6. Verify counts and source traceability.
7. Switch read paths only after tests pass.
8. Keep rollback possible until production verification is complete.

## Extraction profile: Wine Sommelier Moldova

Include:

- wines
- wineries
- grape varieties
- regions
- terroir
- history
- aromas and flavors
- food pairings
- traditions
- routes
- tours
- tastings
- assortment references

Exclude from the main published layer:

- book editors
- designers
- pagination and prepress
- ISBN
- printing metadata
- unrelated publishing credits
