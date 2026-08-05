function text(value) {
  return String(value ?? '').trim();
}

function sourceKinds(actual) {
  return new Set((actual?.sources ?? []).flatMap((source) => [
    source?.kind,
    source?.type,
    source?.sourceType,
    source?.provider
  ].map((value) => text(value).toLowerCase()).filter(Boolean)));
}

function hasSourceLike(kinds, expected) {
  const aliases = {
    knowledge_graph: ['knowledge_graph', 'knowledge graph', 'graph'],
    documents: ['document', 'documents', 'chunk', 'book', 'pdf'],
    wine_md_catalog: ['wine_md_catalog', 'wine.md', 'catalog', 'wine_md'],
    official_web: ['official_web', 'official', 'web', 'website']
  };
  return (aliases[expected] ?? [expected]).some((candidate) =>
    [...kinds].some((kind) => kind.includes(candidate))
  );
}

export function evaluateDiagnosticItem(item, actual, error = null) {
  const answer = text(actual?.answer);
  const kinds = sourceKinds(actual);
  const policy = item?.sourcePolicy ?? item?.source_policy ?? {};
  const primary = Array.isArray(policy.primary) ? policy.primary : [];
  const internetMode = policy.internet ?? 'fallback';
  const sources = actual?.sources ?? [];
  const webUsed = [...kinds].some((kind) => kind.includes('web') || kind.includes('website') || kind.includes('official'));

  const checks = {
    provider_success: !error,
    answered: answer.length >= 40 && !actual?.refused,
    substantive: answer.length >= 120,
    source_traceability: sources.length > 0,
    primary_source_policy: primary.length === 0 || primary.some((expected) => hasSourceLike(kinds, expected)),
    internet_policy: internetMode === 'required' ? webUsed : internetMode === 'forbidden' ? !webUsed : true
  };

  const required = ['provider_success', 'answered'];
  if (item?.checks?.source_traceability) required.push('source_traceability');
  if (primary.length) required.push('primary_source_policy');
  if (internetMode === 'required' || internetMode === 'forbidden') required.push('internet_policy');
  if (item?.checks?.completeness) required.push('substantive');

  const passedCount = required.filter((name) => checks[name]).length;
  const score = required.length ? passedCount / required.length : 0;
  const failedChecks = required.filter((name) => !checks[name]);

  let diagnosis = 'PASS';
  if (error) diagnosis = 'RUN_ERROR';
  else if (!checks.answered) diagnosis = actual?.refused ? 'FALSE_REFUSAL' : 'EMPTY_OR_SHORT_ANSWER';
  else if (!checks.internet_policy) diagnosis = internetMode === 'required' ? 'WEB_REQUIRED' : 'WEB_FORBIDDEN';
  else if (!checks.primary_source_policy) diagnosis = 'WRONG_SOURCE_LAYER';
  else if (!checks.source_traceability) diagnosis = 'MISSING_SOURCES';
  else if (!checks.substantive) diagnosis = 'INCOMPLETE_ANSWER';

  return { passed: failedChecks.length === 0, score, diagnosis, checks, failedChecks };
}
