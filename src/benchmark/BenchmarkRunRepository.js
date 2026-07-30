import fs from 'node:fs/promises';
import path from 'node:path';
function safeId(value){const id=String(value??'').trim();if(!/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(id))throw Object.assign(new Error('Invalid run id'),{code:'INVALID_RUN_ID'});return id;}
export class BenchmarkRunRepository{
  constructor({directory}){this.directory=directory;}
  async ensure(){await fs.mkdir(this.directory,{recursive:true});}
  file(id){return path.join(this.directory,`${safeId(id)}.json`);}
  async save(run){await this.ensure();const tmp=`${this.file(run.runId)}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(tmp,JSON.stringify(run,null,2),'utf8');await fs.rename(tmp,this.file(run.runId));return run;}
  async get(id){return JSON.parse(await fs.readFile(this.file(id),'utf8'));}
  async list(){await this.ensure();const out=[];for(const name of (await fs.readdir(this.directory)).filter(x=>x.endsWith('.json'))){try{const r=JSON.parse(await fs.readFile(path.join(this.directory,name),'utf8'));out.push({runId:r.runId,datasetId:r.datasetId,createdAt:r.createdAt,stats:r.stats});}catch{}}return out.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
}
