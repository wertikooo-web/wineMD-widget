# Knowledge Studio audit

## Already working

- Overview counters for documents, chunks, entities, facts, review status and catalog.
- Entity list with search, type/status filters, sorting, grouping and pagination.
- Fact list with predicate/status filters and review actions.
- Entity and fact detail drawers with source quotes and graph neighborhood.
- Claim provenance remains linked to documents, pages and chunks when present.

## Product-blocking gaps

1. Entity cards are read-only. Canonical name, type, description and status cannot be corrected.
2. Aliases can be viewed but not added or removed.
3. Duplicate entities cannot be merged safely.
4. Review history is written to PostgreSQL but not visible in the UI.
5. Fact editing exists in the API but is not exposed clearly in the interface.
6. There is no dedicated workflow for entities without facts or facts without sources.
7. Bulk actions are absent, so reviewing thousands of facts remains slow.

## Focused implementation order

1. Entity editor and alias management.
2. Visible review history.
3. Fact editor in the drawer.
4. Safe entity merge with transactional fact/source reassignment.
5. Bulk verify/reject for selected facts.

Route Planner and other research modules remain frozen. Work continues only on functions that improve answer quality or reduce editorial effort.