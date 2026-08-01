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
- `tours`
- `wine_routes`
- `wine_route_stops`

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

Initial predicates include `located_in`, `founded_in`, `produces`, `made_from`, `grown_in`, `has_aroma`, `has_flavor`, `pairs_with`, `aged_in`, `offers_tour`, `offers_tasting`, `available_at`, `has_vintage`, `has_alcohol` and other approved relations from `predicate_catalog`.

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

1. Wine.md webhook updates immediately.
2. Scheduled synchronization runs as a safety net.
3. Manual `Sync now` remains available in admin.

The Wine.md source is authoritative for current price, stock, image and product URL. It must never overwrite verified historical or descriptive knowledge.

Configuration:

- `WINEMD_CATALOG_URL`
- `WINEMD_WEBHOOK_SECRET`
- `WINEMD_SYNC_INTERVAL_MINUTES`

Admin endpoints:

- `GET /api/admin/winemd-catalog/status`
- `POST /api/admin/winemd-catalog/sync`
- `POST /api/admin/winemd-catalog/import`

Webhook endpoint:

- `POST /api/integrations/winemd/catalog`

The webhook accepts `X-WineMD-Secret` or `Authorization: Bearer <secret>`.

## Knowledge Studio

Protected page:

- `/admin/knowledge-studio.html`

Protected API:

- `GET /api/admin/knowledge-studio/overview`
- `GET /api/admin/knowledge-studio/entities`
- `GET /api/admin/knowledge-studio/entities/:id`
- `GET /api/admin/knowledge-studio/facts`
- `POST /api/admin/knowledge-studio/facts/:id/review`
- `PUT /api/admin/knowledge-studio/facts/:id`
- `GET /api/admin/knowledge-studio/predicates`

The interface shows human-readable entities and facts, sources, quotes, confidence, status and review actions.

Review actions include verify, edit, reject and publish. Every change is recorded in `review_actions`.

## Migration strategy

1. Create v1 tables next to legacy tables.
2. Keep legacy `knowledge_entities`, `knowledge_facts` and `knowledge_processed_chunks` intact.
3. Copy legacy entities and facts into the new schema.
4. Normalize entity types and predicates.
5. Exclude book-production metadata such as editor, designer, prepress and ISBN from the operational sommelier layer.
6. Verify counts and source traceability.
7. Switch read paths only after tests pass.
8. Keep rollback possible until production verification is complete.

## Extraction profile: Wine Sommelier Moldova

Include wines, wineries, grape varieties, regions, terroir, history, aromas, flavours, food pairings, traditions, routes, tours, tastings and assortment references.

Exclude book editors, designers, pagination, prepress, ISBN, printing metadata and unrelated publishing credits.

## Commands

```bash
npm run db:migrate:knowledge-v1
npm run db:migrate:knowledge-v1:legacy
npm run db:verify:knowledge-v1
npm run check:knowledge-v1
npm test
```
