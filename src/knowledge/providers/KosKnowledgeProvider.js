import { KnowledgeProvider } from '../KnowledgeProvider.js';

/**
 * Integration seam for the full WINE AI KOS.
 * Implement only this class when the KOS search endpoint/SDK is available.
 * KnowledgeService, /api/answer and the widget remain unchanged.
 */
export class KosKnowledgeProvider extends KnowledgeProvider {
  constructor({ searchClient }) {
    super();
    this.searchClient = searchClient;
  }

  async search({ query, limit }) {
    if (!this.searchClient || typeof this.searchClient.search !== 'function') {
      throw new Error('KOS search client is not configured');
    }
    const response = await this.searchClient.search({ query, limit });
    return response.results.map((item) => ({
      id: item.id,
      type: item.type || 'document',
      title: item.title,
      text: item.text,
      sourceUrl: item.sourceUrl,
      score: item.score,
      metadata: item.metadata || {}
    }));
  }
}
