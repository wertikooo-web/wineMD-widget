# WINE AI Benchmark MVP

## Goal

Provide a stable 200-question regression set for measuring answer quality before production changes.

## Scope

The seed contains 10 categories with 20 questions each:

- wines
- wineries
- grapes
- food_pairing
- history_regions
- tourism
- wine_md
- service_storage
- expert
- dynamic_web

## Source policy

- `knowledge_graph` and `documents` are primary for stable wine knowledge.
- `wine_md_catalog` is primary for price, stock and product links.
- `official_web` is required for dynamic facts such as opening hours, events and current visit prices.
- General internet search is forbidden for Wine.md stock and price questions because the catalog sync is the source of truth.

## Status

All questions start with `status: seed`. They are suitable for regression coverage, but expert review must later add expected facts, forbidden claims and reference answers before the dataset can be used for public model rankings.

## Acceptance criteria

- exactly 200 unique IDs;
- exactly 200 unique questions;
- 10 categories, 20 questions each;
- source policy and quality checks on every item;
- automatic tests fail if the contract is broken.
