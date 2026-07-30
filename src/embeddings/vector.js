export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]), y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y; aa += x * x; bb += y * y;
  }
  if (!aa || !bb) return 0;
  return dot / Math.sqrt(aa * bb);
}

export function normalizeCosine(value) {
  return Math.max(0, Math.min(1, (Number(value) + 1) / 2));
}
