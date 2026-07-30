import fs from 'node:fs/promises';
import path from 'node:path';
import { ensurePostgresSchema, getPool, postgresEnabled } from '../db/Postgres.js';

const DEFAULTS = Object.freeze({
  answerMode: 'knowledge_only',
  systemPrompt: 'Ты — дружелюбный цифровой сомелье WINE AI. Отвечай точно, естественно и без выдуманных фактов.',
  answerLength: 'medium',
  voiceStyle: 'sommelier',
  voice: 'marin',
  defaultLanguage: 'auto',
  updatedAt: null
});

function sanitize(input = {}) {
  return {
    answerMode: input.answerMode === 'knowledge_only' ? 'knowledge_only' : 'general_chat',
    systemPrompt: String(input.systemPrompt ?? DEFAULTS.systemPrompt).trim().slice(0, 12000) || DEFAULTS.systemPrompt,
    answerLength: ['short','medium','detailed'].includes(input.answerLength) ? input.answerLength : DEFAULTS.answerLength,
    voiceStyle: ['professional','friendly','sommelier','storyteller'].includes(input.voiceStyle) ? input.voiceStyle : DEFAULTS.voiceStyle,
    voice: String(input.voice ?? DEFAULTS.voice).trim().slice(0, 80) || DEFAULTS.voice,
    defaultLanguage: ['auto','ru','ro','en'].includes(input.defaultLanguage) ? input.defaultLanguage : DEFAULTS.defaultLanguage,
    updatedAt: new Date().toISOString()
  };
}

export class AssistantSettingsStore {
  constructor({ file }) { this.file = file; }

  async load() {
    if (postgresEnabled()) {
      await ensurePostgresSchema();
      const result = await getPool().query("SELECT value FROM assistant_settings WHERE id='default'");
      if (!result.rows[0]) return { ...DEFAULTS };
      return { ...DEFAULTS, ...sanitize(result.rows[0].value) };
    }
    try { return { ...DEFAULTS, ...sanitize(JSON.parse(await fs.readFile(this.file, 'utf8'))) }; }
    catch (error) { if (error.code === 'ENOENT') return { ...DEFAULTS }; throw error; }
  }

  async save(input) {
    const value = sanitize(input);
    if (postgresEnabled()) {
      await ensurePostgresSchema();
      await getPool().query(
        `INSERT INTO assistant_settings(id, value, updated_at)
         VALUES('default', $1::jsonb, now())
         ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [JSON.stringify(value)]
      );
      return value;
    }
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
    return value;
  }
}
