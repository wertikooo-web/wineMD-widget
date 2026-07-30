import fs from 'node:fs/promises';
import crypto from 'node:crypto';

function normalizeQuestion(value) { return String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
function lexicalScore(query, chunk) {
  const terms = String(query).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  if (!terms.length) return 0;
  const text = String(chunk.text).toLowerCase();
  return terms.filter(term => text.includes(term)).length / terms.length;
}

export class BenchmarkDatasetService {
  constructor({ repository, registry, chunksFile, generator, validator, batchSize = 10, maxAttempts = 8 }) {
    if (!validator || typeof validator.validate !== 'function') throw new TypeError('BenchmarkDatasetService requires validator.validate(raw, context)');
    if (!generator || typeof generator.generateBatch !== 'function') throw new TypeError('BenchmarkDatasetService requires generator.generateBatch(input)');
    if (!repository || typeof repository.save !== 'function') throw new TypeError('BenchmarkDatasetService requires repository.save(dataset)');
    if (!registry || typeof registry.load !== 'function') throw new TypeError('BenchmarkDatasetService requires registry.load()');
    Object.assign(this, { repository, registry, chunksFile, generator, validator, batchSize, maxAttempts });
  }

  async chunks() { try { const data = JSON.parse(await fs.readFile(this.chunksFile, 'utf8')); return Array.isArray(data) ? data : []; } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }

  representativeChunks(chunks, offset = 0, limit = 60) {
    if (chunks.length <= limit) return chunks;
    const step = Math.max(1, Math.floor(chunks.length / limit));
    const result = [];
    for (let i = offset % step; i < chunks.length && result.length < limit; i += step) result.push(chunks[i]);
    return result;
  }

  async generate({ documentId, positiveCount = 50, negativeCount = 50, language = 'ru', onProgress = () => {} }) {
    positiveCount = Math.max(1, Math.min(Number(positiveCount) || 50, 200));
    negativeCount = Math.max(0, Math.min(Number(negativeCount) || 50, 200));
    const document = (await this.registry.load()).find(d => d.documentId === documentId && d.status === 'active');
    if (!document) throw Object.assign(new Error('Document not found'), { code: 'DOCUMENT_NOT_FOUND' });
    const all = await this.chunks();
    const chunks = all.filter(c => c.documentId === documentId);
    if (!chunks.length) throw Object.assign(new Error('Document has no chunks'), { code: 'DOCUMENT_HAS_NO_CHUNKS' });

    const approved = [];
    const rejected = [];
    const seen = new Set();
    const targets = { positive: positiveCount, negative: negativeCount };
    let generatedTotal = 0;

    const searchDocument = async (query, limit) => chunks.map(c => ({ ...c, score: lexicalScore(query, c) })).sort((a, b) => b.score - a.score).slice(0, limit);
    const chunkById = async id => all.find(c => c.id === id);
    const negativeJudgeBatch = candidates => this.generator.judgeNegativeBatch({ candidates });

    for (const polarity of ['positive', 'negative']) {
      const target = targets[polarity];
      if (!target) continue;
      let attempts = 0;
      while (approved.filter(x => x.polarity === polarity).length < target && attempts < this.maxAttempts) {
        attempts += 1;
        const acceptedNow = approved.filter(x => x.polarity === polarity).length;
        const remaining = target - acceptedNow;
        const count = Math.min(this.batchSize, Math.max(remaining, Math.min(this.batchSize, remaining + 3)));
        onProgress({ phase: `generating_${polarity}`, message: `Генерация ${polarity}: ${acceptedNow}/${target}`, approved: approved.length, rejected: rejected.length, generated: generatedTotal });
        const representative = this.representativeChunks(chunks, attempts - 1, 70);
        const raw = await this.generator.generateBatch({
          document,
          chunks: representative.map(c => ({ id: c.id, title: c.title, text: String(c.text).slice(0, 2400), page: c.metadata?.page ?? null })),
          count,
          polarity,
          language,
          excludedQuestions: [...seen].slice(-150)
        });
        const uniqueItems = [];
        for (const item of raw.items ?? []) {
          const key = normalizeQuestion(item.question);
          if (!key || seen.has(key) || item.polarity !== polarity) continue;
          seen.add(key);
          uniqueItems.push(item);
        }
        generatedTotal += uniqueItems.length;
        onProgress({ phase: `validating_${polarity}`, message: `Проверка ${polarity}: партия ${attempts}`, approved: approved.length, rejected: rejected.length, generated: generatedTotal });
        const result = await this.validator.validate({ items: uniqueItems }, { documentId, searchDocument, chunkById, negativeJudgeBatch });
        approved.push(...result.items.slice(0, remaining));
        rejected.push(...result.rejected, ...result.items.slice(remaining).map(x => ({ ...x, rejectionReason: 'TARGET_ALREADY_REACHED' })));
        if (!uniqueItems.length) break;
      }
    }

    const finalPositive = approved.filter(x => x.polarity === 'positive').slice(0, positiveCount);
    const finalNegative = approved.filter(x => x.polarity === 'negative').slice(0, negativeCount);
    const items = [...finalPositive, ...finalNegative].map((item, i) => ({ ...item, id: `${item.polarity === 'positive' ? 'pos' : 'neg'}-${String(i + 1).padStart(3, '0')}` }));
    const complete = finalPositive.length === positiveCount && finalNegative.length === negativeCount;
    const now = new Date().toISOString();
    const dataset = {
      schemaVersion: '1.2',
      datasetId: `benchmark-${crypto.randomUUID()}`,
      title: `${document.title} — benchmark`,
      documentId,
      document: { title: document.title, authors: document.authors, language: document.language, pages: document.pages },
      createdAt: now,
      updatedAt: now,
      generator: { model: this.generator.model, language, batchSize: this.batchSize, maxAttempts: this.maxAttempts },
      status: complete ? 'complete' : 'partial',
      stats: { requested: positiveCount + negativeCount, requestedPositive: positiveCount, requestedNegative: negativeCount, generated: generatedTotal, accepted: items.length, rejected: rejected.length, positive: finalPositive.length, negative: finalNegative.length, complete },
      items,
      rejected
    };
    await this.repository.save(dataset);
    onProgress({ phase: 'complete', message: complete ? 'Набор готов' : 'Набор сохранён частично', approved: items.length, rejected: rejected.length, generated: generatedTotal, datasetId: dataset.datasetId });
    return dataset;
  }

  async importSeed(seed, { documentId }) {
    const document = (await this.registry.load()).find(d => d.documentId === documentId);
    if (!document) throw Object.assign(new Error('Document not found'), { code: 'DOCUMENT_NOT_FOUND' });
    const now = new Date().toISOString();
    const items = (seed.items ?? []).map(x => ({ ...x, documentId, status: x.polarity === 'positive' ? 'review_required' : 'candidate' }));
    const dataset = { ...seed, datasetId: `seed-${crypto.randomUUID()}`, documentId, document: { title: document.title, pages: document.pages }, createdAt: now, updatedAt: now, stats: { requested: items.length, accepted: 0, rejected: 0, positive: items.filter(x => x.polarity === 'positive').length, negative: items.filter(x => x.polarity === 'negative').length }, items };
    await this.repository.save(dataset);
    return dataset;
  }
}
