import fs from 'node:fs/promises';
import path from 'node:path';
export class DocumentRegistry {
  constructor({registryFile}){this.registryFile=registryFile;}
  async load(){try{const raw=await fs.readFile(this.registryFile,'utf8');const data=JSON.parse(raw);return Array.isArray(data)?data:[];}catch(e){if(e.code==='ENOENT')return [];throw e;}}
  async save(items){await fs.mkdir(path.dirname(this.registryFile),{recursive:true});const tmp=`${this.registryFile}.tmp`;await fs.writeFile(tmp,JSON.stringify(items,null,2),'utf8');await fs.rename(tmp,this.registryFile);}
  async upsert(doc){const items=await this.load();const i=items.findIndex(x=>x.documentId===doc.documentId);if(i>=0)items[i]=doc;else items.push(doc);await this.save(items);return doc;}
  async setStatus(documentId,status){const items=await this.load();const doc=items.find(x=>x.documentId===documentId);if(!doc)return null;doc.status=status;doc.updatedAt=new Date().toISOString();await this.save(items);return doc;}
  async remove(documentId){const items=await this.load();const next=items.filter(x=>x.documentId!==documentId);if(next.length===items.length)return null;await this.save(next);return true;}
}
