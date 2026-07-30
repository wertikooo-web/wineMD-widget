# WINE AI MVP admin + structured knowledge

Implemented in this build:

- Three admin tabs: Documents, Assistant settings, Testing.
- Documents list with status, chunk count, structured-knowledge counters, delete and embedding reindex actions.
- Assistant settings persisted in `data/settings/assistant.json` and applied without restart.
- Background structured extraction from document chunks through OpenAI strict JSON schema.
- Temporary JSON knowledge store at `data/knowledge/runtime/knowledge.json`.
- Stable entity/fact IDs, aliases, provenance (`documentId`, `chunkId`, `sourceText`), confidence and status.
- Safe resume: already processed chunks are skipped.
- Structured facts participate in hybrid retrieval together with document chunks.
- Storage is isolated behind `JsonKnowledgeStore`, ready for a PostgreSQL adapter migration.

## Use

1. Run `npm start`.
2. Open `http://localhost:3000/admin`.
3. In **Documents**, click **Извлечь знания** for a loaded book.
4. Keep the server running while progress is shown. The job resumes on the next click if interrupted.
5. Configure behavior in **Настройки ассистента**.

Note: extraction makes one model request per unprocessed chunk and therefore consumes API credit.
