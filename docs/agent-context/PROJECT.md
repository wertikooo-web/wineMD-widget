# Project context

## Product

WineMD Widget is a lightweight voice and text assistant for WineMD. The primary flow is microphone or text input, speech-to-text when needed, retrieval from approved WineMD documents, grounded answer generation, and optional text-to-speech output.

The same service also provides an admin surface for uploading and indexing documents, inspecting knowledge status, testing retrieval, and creating benchmark datasets.

## Product boundaries

- The widget must remain usable as a standalone service and embeddable client.
- The approved document corpus is the factual source for closed-RAG answers.
- Public users must not gain admin capabilities through shared routes, tokens, or frontend state.
- Benchmark generation supports quality control; it must not alter production knowledge silently.
- Provider changes must stay behind existing application boundaries so STT, answer generation, TTS, and embeddings can evolve independently.

## Current technical shape

- Node.js 20+, ECMAScript modules, built-in HTTP server.
- Vanilla browser UI for the public demo and admin area.
- Document ingestion for formats such as PDF and DOCX.
- Scripts for ingestion and embedding reindexing.
- Node test runner through `npm test`.

## Known operational facts

- Real provider checks may require paid API credentials and cannot be proven by unit tests alone.
- Benchmark jobs run in batches and need bounded retries plus visible terminal status.
- The repository may start with no indexed documents; this is an expected setup state.

## Sources of truth

For behavior, prefer code and tests. For data contracts, prefer schemas and serialized examples. For UI behavior, inspect the rendered page and network requests. Use this file only for product intent and boundaries that are easy to miss from the tree.