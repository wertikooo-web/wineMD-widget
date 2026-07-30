const DEFAULT_NO_EVIDENCE_MESSAGE = 'В предоставленной базе Wine.md нет точной информации для ответа на этот вопрос.';

function cleanResult(result) {
  return { id: result.id, type: result.type, title: result.title, text: result.text, sourceUrl: result.sourceUrl || undefined, score: Number(result.score) || 0, metadata: result.metadata && typeof result.metadata === 'object' ? result.metadata : {} };
}

export function splitCompoundQuery(query) {
  const normalized = String(query ?? '').trim();
  if (normalized.length < 12) return [];
  const parts = normalized
    .split(/(?:\?|;|\n|,\s*(?:а|и)\s+|\s+(?:и|а также|ещ[её])\s+)/iu)
    .map(x => x.trim().replace(/^[,.!?\s]+|[,.!?\s]+$/g, ''))
    .filter(x => x.length >= 5);
  return [...new Set(parts)].slice(0, 4);
}

export class KnowledgeService {
  constructor({ provider, minScore = 0.34, maxResults = 8, noEvidenceMessage = DEFAULT_NO_EVIDENCE_MESSAGE, compoundSearch = true }) {
    if (!provider || typeof provider.search !== 'function') throw new TypeError('KnowledgeService requires a provider with search()');
    Object.assign(this, { provider, minScore, maxResults, noEvidenceMessage, compoundSearch });
  }

  async retrieve(query) {
    const normalizedQuery = String(query ?? '').trim();
    if (normalizedQuery.length < 2) return { found: false, query: normalizedQuery, results: [], reason: 'QUERY_TOO_SHORT', subqueries: [] };
    const subqueries = this.compoundSearch ? splitCompoundQuery(normalizedQuery) : [];
    const queries = [normalizedQuery, ...subqueries.filter(x => x.toLowerCase() !== normalizedQuery.toLowerCase())];
    const groups = await Promise.all(queries.map(q => this.provider.search({ query: q, limit: this.maxResults })));
    const merged = new Map();
    groups.forEach((group, queryIndex) => {
      for (const raw of Array.isArray(group) ? group : []) {
        const item = cleanResult(raw);
        const adjusted = queryIndex === 0 ? item.score : Math.min(1, item.score + 0.04);
        const existing = merged.get(item.id);
        if (!existing || adjusted > existing.score) merged.set(item.id, { ...item, score: adjusted, metadata: { ...item.metadata, matchedQuery: queries[queryIndex] } });
      }
    });
    const primary = [...merged.values()].filter(x => x.score >= this.minScore).sort((a,b)=>b.score-a.score).slice(0,this.maxResults);
    const expanded = await this.expandNeighbors(primary);
    const results = expanded.slice(0, Math.min(this.maxResults + 4, 12));
    return { found: results.length > 0, query: normalizedQuery, subqueries, results, reason: results.length ? null : 'NO_RELEVANT_EVIDENCE' };
  }

  async expandNeighbors(results) {
    if (!results.length || typeof this.provider.getByIds !== 'function') return results;
    const ids = [];
    for (const item of results.slice(0, 3)) {
      const prev = item.metadata?.previousChunkId;
      const next = item.metadata?.nextChunkId;
      if (prev) ids.push(prev);
      if (next) ids.push(next);
    }
    if (!ids.length) return results;
    const neighbors = await this.provider.getByIds([...new Set(ids)]);
    const seen = new Set(results.map(x => x.id));
    return [...results, ...(neighbors || []).map(cleanResult).filter(x => !seen.has(x.id)).map(x => ({ ...x, score: Math.max(this.minScore, x.score || this.minScore), metadata: { ...x.metadata, expandedNeighbor: true } }))];
  }

  noEvidenceAnswer() { return this.noEvidenceMessage; }
}
export { DEFAULT_NO_EVIDENCE_MESSAGE };
