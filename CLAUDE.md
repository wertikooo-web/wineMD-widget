# CLAUDE.md

Use `AGENTS.md` as the project instruction entry point.

Load context progressively through `docs/agent-context/CONTEXT_MAP.md`. Do not preload every domain document.

Prefer repository evidence over prose summaries: inspect the implementation, tests, request/response shapes, stored data, and rendered admin/widget UI before changing behavior.

When a task asks for diagnosis or review, remain read-only. When it asks to fix or build, make scoped changes and run non-destructive checks without asking for routine approval. External writes outside the approved repository task still follow `docs/agent-context/AUTONOMY.md`.