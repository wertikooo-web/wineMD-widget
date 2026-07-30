export class CatalogProvider {
  async getProductsByIds(_ids) {
    throw new Error('CatalogProvider.getProductsByIds() must be implemented');
  }
}
