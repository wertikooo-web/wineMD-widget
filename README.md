# WINE.md Voice Lite — Phase 6A

Готовый модуль генерации benchmark-наборов для закрытого RAG.

В архиве:
- исходники сервиса;
- валидатор;
- OpenAI generator;
- JSON repository;
- примеры API;
- тесты;
- seed dataset 50 positive + 50 negative.


## Phase 6A final

Benchmark generator теперь работает партиями, имеет background jobs, progress UI, retry/deduplication, отдельную проверку Negative-вопросов и карточный просмотр результатов. См. `docs/PHASE_6A.md`.
