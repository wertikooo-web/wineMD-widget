import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogService } from './CatalogService.js';
import { LocalCatalogProvider } from './providers/LocalCatalogProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createCatalogService(config, dependencies = {}) {
  if (dependencies.catalogService) return dependencies.catalogService;
  const provider = dependencies.catalogProvider ?? new LocalCatalogProvider({
    dataFile: config.localCatalogFile || path.join(__dirname, 'data', 'winemd.catalog.sample.json')
  });
  return new CatalogService({ provider, maxProducts: config.catalogMaxProducts ?? 5 });
}
