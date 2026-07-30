function safeProduct(product) {
  if (!product || typeof product !== 'object') return null;
  const required = ['id', 'name', 'winery', 'imageUrl', 'productUrl'];
  if (required.some((field) => typeof product[field] !== 'string' || !product[field].trim())) return null;
  return {
    id: product.id,
    name: product.name,
    winery: product.winery,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    price: typeof product.price === 'string' ? product.price : undefined,
    inStock: product.inStock === true,
    volume: typeof product.volume === 'string' ? product.volume : undefined
  };
}

export class CatalogService {
  constructor({ provider, maxProducts = 5 }) {
    if (!provider || typeof provider.getProductsByIds !== 'function') {
      throw new TypeError('CatalogService requires a provider with getProductsByIds()');
    }
    this.provider = provider;
    this.maxProducts = maxProducts;
  }

  async getProductsByIds(ids) {
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id.trim()))]
      .slice(0, this.maxProducts);
    if (!uniqueIds.length) return [];
    const products = await this.provider.getProductsByIds(uniqueIds);
    return (Array.isArray(products) ? products : []).map(safeProduct).filter(Boolean).slice(0, this.maxProducts);
  }
}
