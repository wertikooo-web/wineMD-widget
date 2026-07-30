import fs from 'node:fs/promises';
import { KnowledgeProvider } from '../KnowledgeProvider.js';

const tokens = value => String(value ?? '').toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu,'').match(/[\p{L}\p{N}]{2,}/gu) ?? [];
const overlapScore = (query, text) => {
  const q=[...new Set(tokens(query))], t=new Set(tokens(text));
  if(!q.length)return 0; const hits=q.filter(x=>t.has(x)).length;
  return Math.min(1, hits/q.length + (hits>=2?0.18:0));
};

export class StructuredKnowledgeProvider extends KnowledgeProvider {
  constructor({ file }) { super(); this.file=file; }
  async load(){try{return JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code==='ENOENT')return {entities:[],facts:[]};throw e;}}
  async search({query,limit=5}){
    const data=await this.load(); const entities=new Map((data.entities??[]).map(x=>[x.id,x]));
    return (data.facts??[]).map(f=>{
      const subject=entities.get(f.subjectEntityId), object=entities.get(f.objectEntityId);
      const statement=[subject?.canonicalName,f.predicate,object?.canonicalName??f.value,f.sourceText].filter(Boolean).join(' ');
      const score=overlapScore(query,statement);
      return {id:f.id,type:'structured_fact',title:subject?.canonicalName||'Structured knowledge',text:f.sourceText||`${subject?.canonicalName||''} ${f.predicate} ${object?.canonicalName||f.value||''}`,score,metadata:{documentId:f.documentId,chunkId:f.chunkId,subjectEntityId:f.subjectEntityId,objectEntityId:f.objectEntityId,predicate:f.predicate,confidence:f.confidence,status:f.status}};
    }).filter(x=>x.score>=.34).sort((a,b)=>b.score-a.score).slice(0,limit);
  }
}
