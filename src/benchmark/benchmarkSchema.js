export function asEvidenceArray(item) {
  if (Array.isArray(item?.evidences)) return item.evidences.filter(Boolean);
  if (Array.isArray(item?.evidence)) return item.evidence.filter(Boolean);
  return item?.evidence ? [item.evidence] : [];
}

export function asExpectedFacts(item) {
  if (Array.isArray(item?.expectedFacts) && item.expectedFacts.length) {
    return item.expectedFacts.map((fact, index) => ({
      id: String(fact?.id || `fact-${index + 1}`),
      text: String(fact?.text ?? fact?.value ?? '').trim(),
      evidenceChunkIds: Array.isArray(fact?.evidenceChunkIds) ? fact.evidenceChunkIds.map(String) : []
    })).filter(fact => fact.text);
  }
  const answer = String(item?.referenceAnswer ?? '').trim();
  if (!answer) return [];
  return [{ id: 'fact-1', text: answer, evidenceChunkIds: asEvidenceArray(item).map(x => x.chunkId).filter(Boolean) }];
}

export function normalizeBenchmarkItem(item) {
  const evidence = asEvidenceArray(item);
  const expectedFacts = asExpectedFacts(item);
  const sourceMode = evidence.length > 1 || new Set(expectedFacts.flatMap(x => x.evidenceChunkIds)).size > 1 ? 'multi_source' : 'single_source';
  return {
    ...item,
    evidence,
    expectedFacts,
    sourceMode: item?.sourceMode || sourceMode,
    complexity: item?.complexity || (expectedFacts.length > 1 ? 'compound' : 'simple')
  };
}
