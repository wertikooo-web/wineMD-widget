# AGENTS.md

## Назначение

WineMD Widget is a standalone voice assistant and closed-RAG widget for WineMD. It accepts microphone or text input, retrieves answers from approved documents, generates a response, and can return speech. The repository also contains an admin interface for document ingestion, testing, and benchmark dataset generation.

## How to work

1. Read `docs/agent-context/PROJECT.md`.
2. Use `docs/agent-context/CONTEXT_MAP.md` to load only the files needed for the task.
3. Treat code, tests, schemas, and rendered UI as the primary references. Documentation explains decisions that are not obvious from those artifacts.
4. Follow `docs/agent-context/AUTONOMY.md` for write boundaries.
5. Before completion, follow `docs/agent-context/VERIFICATION.md`.

## Hard invariants

- Answer generation must stay grounded in the configured knowledge base. Do not silently replace closed-RAG behavior with open-web answers.
- An empty or partially indexed knowledge base is a valid state and must fail clearly, without invented facts.
- Never expose secret values, authorization headers, uploaded private documents, or raw user audio in logs or responses.
- Admin routes and public widget routes must keep separate trust boundaries.
- Background jobs must have bounded retries, inspectable status, and a terminal state.
- Positive benchmark questions require evidence from the source chunk. Negative questions must remain unanswerable from the indexed corpus.
- Preserve existing API contracts unless the task explicitly includes a migration.

## Working standard

Make the smallest coherent change that solves the demonstrated problem. Match the surrounding code style. Do not combine voice, retrieval, admin UI, storage, and benchmark redesign in one change unless the task requires that scope.

## Success and stopping

A task is complete when the requested behavior is implemented or the requested diagnosis is supported by evidence, relevant checks pass, unrelated files remain untouched, and remaining uncertainty is stated plainly.

Stop when another tool cycle cannot materially improve correctness, or when the next action requires production access, destructive data changes, secret values, payment, or a broader product decision.