# Phase 6B — Practical Benchmark

Реализованы пять упрощённых этапов для виджета винодельни:

1. Dataset 1.2: `expectedFacts`, `evidences`, `single_source`/`multi_source`, проверка полного покрытия составного вопроса.
2. Benchmark Runner: прогоняет набор через тот же `answerFromKnowledge`, что использует виджет, и сохраняет отчёт.
3. RAG: до 8 основных результатов, лёгкая декомпозиция составных вопросов, объединение результатов и соседние chunks.
4. Baseline: отчёт показывает общую точность, Positive/Negative, recall источников, multi-source accuracy и задержку.
5. Условная декомпозиция: без отдельного planner и intent-архитектуры; вопрос делится по союзам максимум на четыре поисковых подзапроса.

## Использование

1. Запустите сервер: `npm start`.
2. Откройте `/admin/`.
3. Создайте benchmark dataset.
4. Откройте набор и нажмите «Запустить проверку».
5. Смотрите baseline-карточки над списком вопросов.

## Формат составного кейса

```json
{
  "question": "Когда основана винодельня и какие вина она выпускает?",
  "expectedFacts": [
    { "id": "fact-1", "text": "основана в 1994 году", "evidenceChunkIds": ["chunk-12"] },
    { "id": "fact-2", "text": "выпускает X, Y и Z", "evidenceChunkIds": ["chunk-47"] }
  ],
  "evidences": [
    { "chunkId": "chunk-12", "page": 3, "quote": "..." },
    { "chunkId": "chunk-47", "page": 9, "quote": "..." }
  ],
  "sourceMode": "multi_source",
  "complexity": "compound"
}
```
