import fs from 'node:fs/promises';
import {loadConfig} from '../src/config.js';
import {OpenAIEmbeddingClient} from '../src/embeddings/OpenAIEmbeddingClient.js';
const config=loadConfig();
const client=new OpenAIEmbeddingClient({apiKey:config.openAiApiKey,model:config.embeddingModel,dimensions:config.embeddingDimensions,batchSize:config.embeddingBatchSize});
if(!client.configured){console.error('OPENAI_API_KEY is required');process.exit(1);}
let chunks=[];try{chunks=JSON.parse(await fs.readFile(config.documentChunksFile,'utf8'));}catch(e){if(e.code==='ENOENT'){console.log('No chunks found.');process.exit(0);}throw e;}
const texts=chunks.map(c=>`${c.title||''}\n${c.text||''}`);
const vectors=await client.embed(texts);
chunks=chunks.map((c,i)=>({...c,embedding:vectors[i],embeddingModel:client.model}));
await fs.writeFile(config.documentChunksFile,JSON.stringify(chunks,null,2),'utf8');
console.log(`Embedded ${chunks.length} chunks with ${client.model}.`);
