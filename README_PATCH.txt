WINE AI — STT quality, latency diagnostics, launcher portrait

1. Распакуйте содержимое архива в корень проекта с заменой файлов.
2. В существующем .env замените только строку:
   STT_MODEL=gpt-4o-mini-transcribe
   на:
   STT_MODEL=gpt-4o-transcribe
   Не заменяйте весь .env, чтобы не потерять OPENAI_API_KEY.
3. Перезапустите:
   npm test
   npm start
4. Обновите страницу Ctrl+Shift+R.

Что изменено:
- круглая кнопка раскрытия использует launcher-avatar.png;
- добавлен терминологический STT prompt для молдавских вин и названий;
- язык ru/ro/en продолжает передаваться в STT;
- ответы модели ограничены 160 токенами для меньшей задержки;
- в PowerShell появляются строки [timing] stt=..., answer=..., tts=...;
- в Console браузера появляются Wine AI timing по каждому этапу.
