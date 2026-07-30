import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cosineSimilarity} from '../src/embeddings/vector.js';
import {DocumentRegistry} from '../src/documents/DocumentRegistry.js';
import {DocumentIngestionService} from '../src/documents/DocumentIngestionService.js';
import {DocumentKnowledgeProvider} from '../src/knowledge/providers/DocumentKnowledgeProvider.js';

class FakeEmbeddingClient {
  constructor(){this.configured=true;this.model='fake-embedding';}
  async embed(inputs){return inputs.map(text=>String(text).toLowerCase().includes('кисл')||String(text).toLowerCase().includes('свеж')?[1,0,0]:[0,1,0]);}
}

async function setup(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'winemd-semantic-'));const registry=new DocumentRegistry({registryFile:path.join(root,'registry.json')});return {root,registry,chunksFile:path.join(root,'chunks.json'),files:path.join(root,'files')};}

test('cosine similarity ranks identical vectors highest',()=>{assert.equal(cosineSimilarity([1,0],[1,0]),1);assert.equal(cosineSimilarity([1,0],[0,1]),0);});

test('ingestion stores embeddings for every chunk when configured',async()=>{const x=await setup();const ingestion=new DocumentIngestionService({registry:x.registry,chunksFile:x.chunksFile,documentsDir:x.files,embeddingClient:new FakeEmbeddingClient()});const doc=await ingestion.ingest({buffer:Buffer.from('Свежая кислотность делает белое вино подходящим к рыбе. '.repeat(40)),filename:'book.txt',metadata:{title:'Книга'}});const chunks=JSON.parse(await fs.readFile(x.chunksFile,'utf8'));assert.equal(doc.embeddingStatus,'ready');assert.ok(chunks.every(c=>Array.isArray(c.embedding)));assert.ok(chunks.every(c=>c.embeddingModel==='fake-embedding'));});

test('semantic retrieval finds concept without exact query words',async()=>{const x=await setup();await x.registry.upsert({documentId:'doc-1',title:'Винная книга',authors:['Wine.md'],status:'active',allowedForAnswers:true});await fs.writeFile(x.chunksFile,JSON.stringify([{id:'c1',documentId:'doc-1',type:'document_chunk',title:'Баланс белого вина',text:'Высокая свежесть и яркий профиль хорошо сопровождают морепродукты.',embedding:[1,0,0],metadata:{documentId:'doc-1'}}]));const provider=new DocumentKnowledgeProvider({chunksFile:x.chunksFile,registry:x.registry,embeddingClient:new FakeEmbeddingClient(),semanticWeight:.9,semanticMinScore:.5});const results=await provider.search({query:'Какое вино обладает хорошей кислотностью?',limit:3});assert.equal(results[0].id,'c1');assert.equal(results[0].metadata.retrieval.mode,'hybrid');assert.ok(results[0].metadata.retrieval.semanticScore>.9);});

test('retrieval falls back to lexical mode without API key',async()=>{const x=await setup();await x.registry.upsert({documentId:'doc-1',title:'Справочник',authors:[],status:'active',allowedForAnswers:true});await fs.writeFile(x.chunksFile,JSON.stringify([{id:'c1',documentId:'doc-1',type:'document_chunk',title:'Рара Нягрэ',text:'Рара Нягрэ подходит к утке.',metadata:{documentId:'doc-1'}}]));const provider=new DocumentKnowledgeProvider({chunksFile:x.chunksFile,registry:x.registry,embeddingClient:{configured:false}});const results=await provider.search({query:'Рара Нягрэ',limit:3});assert.equal(results[0].metadata.retrieval.mode,'lexical');});
