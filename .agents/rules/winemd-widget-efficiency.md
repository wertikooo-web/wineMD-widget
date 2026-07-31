# WINE.md Widget agent workflow

Always read:

- `AGENTS.md`
- `docs/agent-context/WORKFLOW_EFFICIENCY.md`

Do not preload the whole repository or all files under `docs/`.

For every task:

1. Identify one affected contour: widget/UI, API, knowledge ingestion, embeddings, benchmark, or database.
2. Read only the relevant code, documentation, and tests.
3. Provide a plan of no more than 10 lines before editing.
4. Keep the file scope narrow.
5. Run focused tests during implementation.
6. Stop after the requested checkpoint.
7. Keep the final report compact.

Never perform production database writes, destructive SQL, prune, deploy, merge, secret changes, Railway variable changes, or permission changes without explicit approval for the exact operation.

Before any approved destructive operation, print:

- target environment;
- resolved flags;
- expected affected rows or files;
- dry-run result;
- rollback or backup status.

Abort destructive cleanup if an earlier creation, ingestion, embedding, migration, or verification stage fails.
