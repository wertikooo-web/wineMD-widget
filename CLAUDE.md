# CLAUDE.md

Сначала прочитай корневой `AGENTS.md`.

Не загружай весь репозиторий и весь каталог `docs/` заранее. Открывай только документы и файлы, относящиеся к текущей задаче.

Прочитай `docs/agent-context/WORKFLOW_EFFICIENCY.md`.

Для каждой задачи:

- сначала дай короткий план и ожидаемый список файлов;
- читай только относящиеся к задаче файлы;
- запускай узкие тесты во время работы;
- остановись после запрошенного этапа;
- не выполняй production write, deploy, merge, prune или destructive migration без отдельного разрешения.

При изменении widget/UI проверь, что встраивание не ломает host page, responsive layout, focus, keyboard navigation и mobile behavior.

При изменении knowledge ingestion, chunking, embeddings или database flow сначала определи источник истины, правила идемпотентности и rollback.
