import fs from 'node:fs/promises';
import path from 'node:path';

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
    try { return { ...DEFAULTS, ...sanitize(JSON.parse(await fs.readFile(this.file, 'utf8'))) }; }
    catch (error) { if (error.code === 'ENOENT') return { ...DEFAULTS }; throw error; }
  }
  async save(input) {
    const value = sanitize(input);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
    return value;
  }
}
