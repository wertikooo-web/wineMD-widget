import { CatalogProvider } from '../CatalogProvider.js';

/** Replace only this adapter when Wine.md provides an API or database access. */
export class WineMdCatalogProvider extends CatalogProvider {
  constructor({ catalogClient }) {
    super();
    this.catalogClient = catalogClient;
  }

  async getProductsByIds(ids) {
    if (!this.catalogClient || typeof this.catalogClient.getProductsByIds !== 'function') {
      throw new Error('Wine.md catalog client is not configured');
    }
    return this.catalogClient.getProductsByIds(ids);
  }
}
