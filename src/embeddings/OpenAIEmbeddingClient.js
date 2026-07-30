const ENDPOINT = 'https://api.openai.com/v1/embeddings';

function providerError(status, payload) {
  const error = new Error(payload?.error?.message || `Embedding provider returned HTTP ${status}`);
  const code = payload?.error?.code || payload?.error?.type;
  if (status === 429 && code === 'insufficient_quota') error.code = 'EMBEDDING_QUOTA_EXCEEDED';
  else if (status === 429) error.code = 'EMBEDDING_RATE_LIMIT';
  else error.code = 'EMBEDDING_PROVIDER_ERROR';
  return error;
}

export class OpenAIEmbeddingClient {
  constructor({ apiKey, model = 'text-embedding-3-small', dimensions, fetchImpl = globalThis.fetch, batchSize = 64 }) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
    this.fetchImpl = fetchImpl;
    this.batchSize = Math.max(1, Math.min(Number(batchSize) || 64, 128));
  }

  get configured() { return Boolean(this.apiKey); }

  async embed(inputs) {
    const texts = (Array.isArray(inputs) ? inputs : [inputs]).map((value) => String(value ?? '').trim());
    if (!texts.length || texts.some((text) => !text)) throw Object.assign(new Error('Embedding input must not be empty'), { code: 'INVALID_EMBEDDING_INPUT' });
    if (!this.configured) throw Object.assign(new Error('OPENAI_API_KEY is not configured'), { code: 'EMBEDDING_NOT_CONFIGURED' });

    const vectors = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const input = texts.slice(offset, offset + this.batchSize);
      const body = { model: this.model, input, encoding_format: 'float' };
      if (Number.isInteger(this.dimensions) && this.dimensions > 0) body.dimensions = this.dimensions;
      const response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      let payload = {};
      try { payload = await response.json(); } catch {}
      if (!response.ok) throw providerError(response.status, payload);
      const ordered = [...(payload.data || [])].sort((a, b) => a.index - b.index);
      if (ordered.length !== input.length || ordered.some((item) => !Array.isArray(item.embedding))) {
        throw Object.assign(new Error('Embedding provider returned an invalid response'), { code: 'EMBEDDING_INVALID_RESPONSE' });
      }
      vectors.push(...ordered.map((item) => item.embedding));
    }
    return vectors;
  }
}
