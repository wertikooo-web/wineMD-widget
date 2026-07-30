import {DocumentRegistry} from './DocumentRegistry.js';
import {DocumentIngestionService} from './DocumentIngestionService.js';
import {OpenAIEmbeddingClient} from '../embeddings/OpenAIEmbeddingClient.js';
export function createDocumentServices(config, dependencies={}){
  const registry=dependencies.registry??new DocumentRegistry({registryFile:config.documentRegistryFile});
  const embeddingClient=dependencies.embeddingClient??new OpenAIEmbeddingClient({apiKey:config.openAiApiKey,model:config.embeddingModel,dimensions:config.embeddingDimensions,batchSize:config.embeddingBatchSize});
  const ingestionService=new DocumentIngestionService({registry,chunksFile:config.documentChunksFile,documentsDir:config.documentStorageDir,embeddingClient});
  return {registry,ingestionService,embeddingClient};
}
