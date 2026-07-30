import fs from 'node:fs/promises';
import { CatalogProvider } from '../CatalogProvider.js';

export class LocalCatalogProvider extends CatalogProvider {
  constructor({ dataFile }) {
    super();
    this.dataFile = dataFile;
    this.productsPromise = null;
  }

  async loadProducts() {
    if (!this.productsPromise) {
      this.productsPromise = fs.readFile(this.dataFile, 'utf8').then((raw) => {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Local catalog file must contain an array');
        return parsed;
      });
    }
    return this.productsPromise;
  }

  async getProductsByIds(ids) {
    const products = await this.loadProducts();
    const byId = new Map(products.map((product) => [product.id, product]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }
}
