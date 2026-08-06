# Storage and migrations

Persisted documents, chunks, embeddings, benchmark datasets, jobs, and settings may outlive a process restart and may already exist in older formats.

## Design rules

- Identify the authoritative repository or storage adapter before changing persistence.
- Keep one owner for each stored entity and its state transitions.
- Schema or serialized-shape changes must define compatibility with existing data.
- Writes that can be retried must be idempotent or protected by stable identifiers.
- Partial ingestion and background-job failures must remain inspectable after restart.
- Do not place secrets or raw private document contents into logs, benchmark exports, or public responses.

## Migration practice

Prefer additive changes first. Read old and new forms during a transition when practical, then remove compatibility in a separate change. Record any one-way migration explicitly and provide a backup or rollback path before production use.

## Verification focus

Read existing fixtures before and after the change, repeat the migration or write operation, restart the service when persistence is involved, and verify that no duplicate records or impossible states appear.