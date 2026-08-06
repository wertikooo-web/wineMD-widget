# Context map

Load `PROJECT.md` first, then only the route that matches the task.

## Public widget or demo UI

Inspect the files serving the public page, its browser scripts, styles, and the API routes it calls. Use the rendered page and network contract as references. Skip benchmark internals unless the change affects shared APIs.

## Voice chain: microphone, STT, answer, TTS

Load `domains/voice-pipeline.md`. Inspect configuration, provider clients, request cancellation, audio lifecycle, and tests around the changed stage. Keep STT, retrieval, generation, and TTS failures distinguishable.

## Knowledge ingestion, chunks, embeddings, retrieval

Load `domains/knowledge.md`. Inspect ingestion scripts, parsers, repositories, search functions, and evidence returned to answer generation. Verify behavior with an empty corpus and with representative indexed data.

## Admin UI or admin API

Load `domains/admin.md`. Check authentication boundaries, route methods, payload validation, long-running job status, and browser polling. Verify both unauthorized and authorized behavior where test infrastructure allows it.

## Benchmark generator

Load `domains/benchmark.md` and treat `docs/PHASE_6A.md`, generated dataset shapes, validators, and tests as direct references. Preserve exact requested counts only when accepted questions satisfy their evidence rules.

## Storage or migration

Load `domains/storage.md`. Inspect the repository abstraction and current serialized or database representation before changing schemas. Plan backward compatibility and rollback for persisted data.

## Production or release work

Load `VERIFICATION.md`. Diagnose first. Do not deploy, change paid services, or mutate production data without explicit approval.

## Security-sensitive work

Read `AUTONOMY.md` and inspect route guards, secret handling, upload limits, file parsing, path handling, and logs. Keep admin and public trust boundaries explicit.