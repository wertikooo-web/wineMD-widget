# CHANGELOG

## Phase 0
- Bootstrap проекта
- HTTP server
- Widget

## Phase 1
- Shadow DOM widget
- Launcher
- Responsive UI

## Phase 2
- MediaRecorder
- Hold-to-talk
- Таймер
- Local playback

## Phase 3
- POST /api/transcribe
- OpenAI STT
- Валидация загрузки

## Phase 4
- Closed RAG
- KnowledgeService
- LocalKnowledgeProvider
- Composite provider
- Provenance

## Phase 5A
- CatalogService
- Карточки вин
- Изображения, цены, ссылки

## Phase 5B
- PDF/DOCX/TXT/MD ingestion
- Registry
- Chunking
- Admin upload
- Prompt injection protection

## Phase 5C
- Embeddings
- Hybrid search
- Cosine similarity
- Semantic ranking

## Phase 5D
- Admin authentication
- HttpOnly sessions
- Login/logout/session API
- First administrator wizard

## 0.9.0 — Phase 6B Practical Benchmark
- Added compound and multi-source benchmark cases (`expectedFacts`, `evidences`).
- Added benchmark runner and baseline metrics.
- Added lightweight compound-query decomposition and neighbor chunk expansion.
- Increased default knowledge result limit from 5 to 8.
- Added admin button to run a dataset through the real answer pipeline.
- Added automated coverage for runner and compound retrieval.
