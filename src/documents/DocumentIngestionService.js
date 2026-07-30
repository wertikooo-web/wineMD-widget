import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {extractDocument} from './extractors/index.js';
function cleanText(s){return String(s??'').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();}
function chunkText(text,{maxChars=1800,overlap=220}={}){const paragraphs=cleanText(text).split(/\n\s*\n/).filter(Boolean);const out=[];let current='';for(const p of paragraphs){if((current+'\n\n'+p).length<=maxChars){current=current?`${current}\n\n${p}`:p;continue;}if(current)out.push(current);if(p.length<=maxChars){current=p;continue;}for(let i=0;i<p.length;i+=maxChars-overlap)out.push(p.slice(i,i+maxChars));current='';}if(current)out.push(current);return out;}
function safeMeta(meta={}){return {title:String(meta.title??'').trim(),authors:Array.isArray(meta.authors)?meta.authors.map(String):[],sourceType:String(meta.sourceType??'document'),language:String(meta.language??'ru'),owner:String(meta.owner??'Wine.md'),publicationYear:meta.publicationYear?Number(meta.publicationYear):null,allowedForAnswers:meta.allowedForAnswers!==false,allowedForQuoting:meta.allowedForQuoting===true,status:'active'};}
export class DocumentIngestionService{
  constructor({registry,chunksFile,documentsDir,embeddingClient=null}){this.registry=registry;this.chunksFile=chunksFile;this.documentsDir=documentsDir;this.embeddingClient=embeddingClient;}
  async loadChunks(){try{const x=JSON.parse(await fs.readFile(this.chunksFile,'utf8'));return Array.isArray(x)?x:[];}catch(e){if(e.code==='ENOENT')return [];throw e;}}
  async saveChunks(items){await fs.mkdir(path.dirname(this.chunksFile),{recursive:true});await fs.writeFile(this.chunksFile,JSON.stringify(items,null,2),'utf8');}
  async delete(documentId){
    const docs=await this.registry.load();const doc=docs.find(x=>x.documentId===documentId);if(!doc)return false;
    const chunks=(await this.loadChunks()).filter(c=>c.documentId!==documentId);await this.saveChunks(chunks);
    if(doc.filename){try{await fs.unlink(path.join(this.documentsDir,doc.filename));}catch(e){if(e.code!=='ENOENT')throw e;}}
    await this.registry.remove(documentId);return true;
  }
  async reindex(documentId){
    const docs=await this.registry.load();const doc=docs.find(x=>x.documentId===documentId);if(!doc)throw Object.assign(new Error('Document not found'),{code:'DOCUMENT_NOT_FOUND'});
    const chunks=await this.loadChunks();const target=chunks.filter(c=>c.documentId===documentId);if(!target.length)throw Object.assign(new Error('Document has no chunks'),{code:'DOCUMENT_HAS_NO_CHUNKS'});
    if(!this.embeddingClient?.configured)throw Object.assign(new Error('Embedding provider is not configured'),{code:'EMBEDDING_NOT_CONFIGURED'});
    await this.registry.setStatus(documentId,'indexing');
    const vectors=await this.embeddingClient.embed(target.map(c=>`${doc.title}\n${c.text}`));let i=0;
    const next=chunks.map(c=>c.documentId===documentId?{...c,embedding:vectors[i++],embeddingModel:this.embeddingClient.model}:c);await this.saveChunks(next);
    const updated={...doc,status:'active',embeddingStatus:'ready',embeddingModel:this.embeddingClient.model,updatedAt:new Date().toISOString()};await this.registry.upsert(updated);return updated;
  }
  async ingest({buffer,filename,metadata}){
    if(!Buffer.isBuffer(buffer)||buffer.length===0)throw Object.assign(new Error('Empty document'),{code:'EMPTY_DOCUMENT'});
    const meta=safeMeta(metadata);if(!meta.title)meta.title=path.basename(filename,path.extname(filename));
    const documentId=metadata?.documentId||`doc-${crypto.createHash('sha256').update(buffer).digest('hex').slice(0,16)}`;
    const extracted=await extractDocument({buffer,filename});const text=cleanText(extracted.text);if(text.length<40)throw Object.assign(new Error('Not enough extractable text'),{code:'DOCUMENT_TEXT_TOO_SHORT'});
    const storedName=`${documentId}${path.extname(filename).toLowerCase()}`;await fs.mkdir(this.documentsDir,{recursive:true});await fs.writeFile(path.join(this.documentsDir,storedName),buffer);
    const chunkTexts=chunkText(text);let vectors=null;if(this.embeddingClient?.configured){vectors=await this.embeddingClient.embed(chunkTexts.map((chunk)=>`${meta.title}\n${chunk}`));}const chunks=chunkTexts.map((chunk,index)=>({id:`${documentId}:chunk:${index+1}`,documentId,type:'document_chunk',title:meta.title,text:chunk,sourceUrl:undefined,embedding:vectors?.[index],embeddingModel:vectors?this.embeddingClient.model:undefined,metadata:{...meta,documentId,filename:storedName,chunkIndex:index+1,page:null,previousChunkId:index>0?`${documentId}:chunk:${index}`:null,nextChunkId:index<chunkTexts.length-1?`${documentId}:chunk:${index+2}`:null}}));
    const all=(await this.loadChunks()).filter(c=>c.documentId!==documentId);all.push(...chunks);await this.saveChunks(all);
    const now=new Date().toISOString();const doc={documentId,...meta,filename:storedName,originalFilename:filename,pages:extracted.pages,chunkCount:chunks.length,embeddingStatus:vectors?'ready':'missing',embeddingModel:vectors?this.embeddingClient.model:null,uploadedAt:now,updatedAt:now};await this.registry.upsert(doc);return doc;
  }
}
