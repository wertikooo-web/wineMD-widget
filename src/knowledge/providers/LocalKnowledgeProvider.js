import fs from 'node:fs/promises';
import { KnowledgeProvider } from '../KnowledgeProvider.js';

const STOP_WORDS = new Set([
  'а', 'без', 'бы', 'в', 'вам', 'вас', 'вы', 'где', 'для', 'до', 'его', 'ее',
  'ещё', 'же', 'за', 'и', 'из', 'или', 'к', 'как', 'какая', 'какие', 'какой',
  'ли', 'мне', 'можно', 'на', 'надо', 'не', 'но', 'о', 'об', 'он', 'она',
  'они', 'от', 'по', 'под', 'про', 'с', 'со', 'так', 'такое', 'у', 'что', 'это',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'is', 'are'
]);

function normalize(value) {
  return String(value ?? '')
    .toLocaleLowerCase('ru-RU')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemLoose(token) {
  if (token.length <= 4) return token;
  return token.replace(/(иями|ями|ами|ого|ему|ими|ыми|ая|яя|ое|ее|ие|ые|ый|ий|ой|ам|ям|ах|ях|ов|ев|ом|ем|у|ю|а|я|ы|и|е)$/u, '');
}

function tokenize(value) {
  return normalize(value)
    .split(' ')
    .map(stemLoose)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function scoreRecord(query, record) {
  const queryNormalized = normalize(query);
  const haystack = normalize([
    record.title,
    record.text,
    ...(record.keywords ?? []),
    ...Object.values(record.metadata ?? {})
  ].join(' '));

  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length) return 0;

  const haystackTokens = new Set(tokenize(haystack));
  let matches = 0;
  for (const token of queryTokens) {
    if (haystackTokens.has(token)) matches += 1;
  }

  const coverage = matches / queryTokens.length;
  const density = matches / Math.max(4, Math.sqrt(haystackTokens.size));
  const exactPhraseBoost = queryNormalized.length >= 5 && haystack.includes(queryNormalized) ? 0.35 : 0;
  const titleBoost = normalize(record.title).includes(queryNormalized) ? 0.2 : 0;
  const keywordBoost = (record.keywords ?? []).some((keyword) => queryNormalized.includes(normalize(keyword))) ? 0.16 : 0;

  return Math.min(1, coverage * 0.68 + density * 0.12 + exactPhraseBoost + titleBoost + keywordBoost);
}

function validateRecord(record, index) {
  if (!record || typeof record !== 'object') throw new Error(`Invalid knowledge record at index ${index}`);
  for (const field of ['id', 'type', 'title', 'text']) {
    if (typeof record[field] !== 'string' || !record[field].trim()) {
      throw new Error(`Knowledge record ${index} has invalid ${field}`);
    }
  }
}

export class LocalKnowledgeProvider extends KnowledgeProvider {
  constructor({ dataFile }) {
    super();
    this.dataFile = dataFile;
    this.recordsPromise = null;
  }

  async loadRecords() {
    if (!this.recordsPromise) {
      this.recordsPromise = fs.readFile(this.dataFile, 'utf8').then((raw) => {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Local knowledge file must contain an array');
        parsed.forEach(validateRecord);
        return parsed;
      });
    }
    return this.recordsPromise;
  }

  async search({ query, limit = 5 }) {
    const records = await this.loadRecords();
    return records
      .map((record) => ({ ...record, score: scoreRecord(query, record) }))
      .filter((record) => record.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 10)));
  }
}
