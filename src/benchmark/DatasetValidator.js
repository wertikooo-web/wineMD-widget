import { asEvidenceArray, asExpectedFacts, normalizeBenchmarkItem } from './benchmarkSchema.js';

function words(text) { return new Set(String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []); }
function overlap(a, b) { const x = words(a), y = words(b); if (!x.size) return 0; let n = 0; for (const word of x) if (y.has(word)) n += 1; return n / x.size; }

export class DatasetValidator {
  async validate(raw, { documentId, searchDocument, chunkById, negativeJudgeBatch }) {
    const items = [];
    const rejected = [];
    const negatives = [];
    let index = 0;

    for (const candidate of raw.items ?? []) {
      index += 1;
      const base = normalizeBenchmarkItem({ ...candidate, id: candidate.id || `${candidate.polarity === 'negative' ? 'neg' : 'pos'}-${String(index).padStart(3, '0')}`, documentId });
      if (!String(base.question ?? '').trim()) { rejected.push({ ...base, rejectionReason: 'QUESTION_EMPTY' }); continue; }

      if (base.polarity === 'positive') {
        const evidenceRefs = asEvidenceArray(base);
        const expectedFacts = asExpectedFacts(base);
        if (!evidenceRefs.length || !expectedFacts.length || !String(base.referenceAnswer ?? '').trim()) {
          rejected.push({ ...base, rejectionReason: 'POSITIVE_EVIDENCE_INVALID' }); continue;
        }
        const loaded = [];
        for (const ref of evidenceRefs) {
          const chunk = ref?.chunkId ? await chunkById(ref.chunkId) : null;
          if (!chunk || chunk.documentId !== documentId) continue;
          loaded.push({ ref, chunk });
        }
        if (loaded.length !== evidenceRefs.length) {
          rejected.push({ ...base, rejectionReason: 'POSITIVE_EVIDENCE_INVALID' }); continue;
        }
        const unsupported = expectedFacts.find(fact => {
          const scoped = fact.evidenceChunkIds?.length ? loaded.filter(x => fact.evidenceChunkIds.includes(x.chunk.id)) : loaded;
          return !scoped.some(({ chunk }) => overlap(fact.text, chunk.text) >= 0.12);
        });
        if (unsupported) {
          rejected.push({ ...base, rejectionReason: 'EXPECTED_FACT_NOT_SUPPORTED', unsupportedFact: unsupported.text }); continue;
        }
        const evidence = loaded.map(({ ref, chunk }) => ({
          ...ref,
          page: ref.page ?? chunk.metadata?.page ?? null,
          preview: String(chunk.text).slice(0, 700)
        }));
        items.push({ ...base, status: 'approved', evidence: evidence[0] ?? null, evidences: evidence });
        continue;
      }

      if (base.polarity === 'negative') {
        const results = await searchDocument(base.question, 8);
        negatives.push({ base, results });
        continue;
      }
      rejected.push({ ...base, rejectionReason: 'UNKNOWN_POLARITY' });
    }

    if (negatives.length) {
      const judgeInput = negatives.map(({ base, results }) => ({ id: base.id, question: base.question, fragments: results.slice(0, 5).map(r => ({ id: r.id, page: r.metadata?.page ?? null, text: String(r.text).slice(0, 1200) })) }));
      const judgments = negativeJudgeBatch ? await negativeJudgeBatch(judgeInput) : new Map();
      for (const { base, results } of negatives) {
        const judgment = judgments.get(base.id);
        if (!judgment) rejected.push({ ...base, rejectionReason: 'NEGATIVE_JUDGE_MISSING' });
        else if (judgment.answerPresent) rejected.push({ ...base, rejectionReason: 'NEGATIVE_ANSWER_FOUND', judgeReason: judgment.reason, matches: results.slice(0, 3).map(r => ({ id: r.id, score: r.score, title: r.title, page: r.metadata?.page ?? null })) });
        else items.push({ ...base, referenceAnswer: null, expectedFacts: [], evidence: null, evidences: [], status: 'approved', expectedBehavior: 'refuse_no_evidence', validationReason: judgment.reason, sourceMode: 'none', complexity: 'simple' });
      }
    }
    return { items, rejected, stats: { requested: (raw.items ?? []).length, accepted: items.length, rejected: rejected.length, positive: items.filter(x => x.polarity === 'positive').length, negative: items.filter(x => x.polarity === 'negative').length } };
  }
}
