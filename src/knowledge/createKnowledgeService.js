import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KnowledgeService} from './KnowledgeService.js';
import {LocalKnowledgeProvider} from './providers/LocalKnowledgeProvider.js';
import {DocumentKnowledgeProvider} from './providers/DocumentKnowledgeProvider.js';
import {CompositeKnowledgeProvider} from './providers/CompositeKnowledgeProvider.js';
import {DocumentRegistry} from '../documents/DocumentRegistry.js';
import {OpenAIEmbeddingClient} from '../embeddings/OpenAIEmbeddingClient.js';
import {StructuredKnowledgeProvider} from './providers/StructuredKnowledgeProvider.js';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
export function createKnowledgeService(config,dependencies={}){
  if(dependencies.knowledgeService)return dependencies.knowledgeService;
  const local=dependencies.localKnowledgeProvider??new LocalKnowledgeProvider({dataFile:config.localKnowledgeFile||path.join(__dirname,'data','winemd.sample.json')});
  const registry=dependencies.documentRegistry??new DocumentRegistry({registryFile:config.documentRegistryFile});
  const embeddingClient=dependencies.embeddingClient??new OpenAIEmbeddingClient({apiKey:config.openAiApiKey,model:config.embeddingModel,dimensions:config.embeddingDimensions,batchSize:config.embeddingBatchSize});
  const docs=dependencies.documentKnowledgeProvider??new DocumentKnowledgeProvider({chunksFile:config.documentChunksFile,registry,embeddingClient,semanticWeight:config.semanticWeight,semanticMinScore:config.semanticMinScore});
  const structured=dependencies.structuredKnowledgeProvider??(config.knowledgeExtractionFile?new StructuredKnowledgeProvider({file:config.knowledgeExtractionFile}):null);
  const provider=dependencies.knowledgeProvider??new CompositeKnowledgeProvider({providers:[structured,local,docs]});
  return new KnowledgeService({provider,minScore:config.knowledgeMinScore,maxResults:config.knowledgeMaxResults});
}
