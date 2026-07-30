import fs from 'node:fs/promises';
import {KnowledgeProvider} from '../KnowledgeProvider.js';
import {scoreText} from '../../documents/text.js';
import {cosineSimilarity,normalizeCosine} from '../../embeddings/vector.js';
export class DocumentKnowledgeProvider extends KnowledgeProvider{
  constructor({chunksFile,registry,embeddingClient=null,semanticWeight=.78,semanticMinScore=.58}){super();Object.assign(this,{chunksFile,registry,embeddingClient,semanticWeight,semanticMinScore});}
  async loadEligible(){let chunks=[];try{chunks=JSON.parse(await fs.readFile(this.chunksFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}const docs=await this.registry.load();const allowed=new Map(docs.filter(d=>d.status==='active'&&d.allowedForAnswers!==false).map(d=>[d.documentId,d]));return {chunks:chunks.filter(c=>allowed.has(c.documentId)),allowed};}
  decorate(c,doc,score=0,extra={}){return {...c,score,metadata:{...c.metadata,authors:doc.authors,allowedForQuoting:doc.allowedForQuoting,publicationYear:doc.publicationYear,...extra}};}
  async search({query,limit=8}){const {chunks:eligible,allowed}=await this.loadEligible();let queryVector=null;if(this.embeddingClient?.configured&&eligible.some(c=>Array.isArray(c.embedding)))queryVector=(await this.embeddingClient.embed([query]))[0];return eligible.map(c=>{const doc=allowed.get(c.documentId);const lexical=scoreText(query,c.text,c.title);let semantic=0,score=lexical;if(queryVector&&Array.isArray(c.embedding)&&c.embedding.length===queryVector.length){semantic=normalizeCosine(cosineSimilarity(queryVector,c.embedding));const hybrid=this.semanticWeight*semantic+(1-this.semanticWeight)*lexical;score=semantic>=this.semanticMinScore?hybrid:Math.max(lexical*.72,hybrid*.55);}return this.decorate(c,doc,score,{retrieval:{mode:queryVector?'hybrid':'lexical',semanticScore:semantic,lexicalScore:lexical}});}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(limit,20)));}
  async getByIds(ids){const wanted=new Set(ids);const {chunks,allowed}=await this.loadEligible();return chunks.filter(c=>wanted.has(c.id)).map(c=>this.decorate(c,allowed.get(c.documentId),0));}
}
