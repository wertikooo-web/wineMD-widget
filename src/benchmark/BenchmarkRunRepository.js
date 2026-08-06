import fs from 'node:fs/promises';
import path from 'node:path';
import { ensurePostgresSchema, getPool, postgresEnabled } from '../db/Postgres.js';

function safeId(value){const id=String(value??'').trim();if(!/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(id))throw Object.assign(new Error('Invalid run id'),{code:'INVALID_RUN_ID'});return id;}
function summary(run){return {runId:run.runId,datasetId:run.datasetId,createdAt:run.createdAt,stats:run.stats};}

export class BenchmarkRunRepository{
  constructor({directory}){this.directory=directory;this.usePostgres=postgresEnabled();}
  async ensure(){if(this.usePostgres){await ensurePostgresSchema();return;}await fs.mkdir(this.directory,{recursive:true});}
  file(id){return path.join(this.directory,`${safeId(id)}.json`);}
  async save(run){
    await this.ensure();
    if(this.usePostgres){
      await getPool().query(`INSERT INTO benchmark_runs(run_id,dataset_id,created_at,stats,payload)
        VALUES($1,$2,$3,$4::jsonb,$5::jsonb)
        ON CONFLICT(run_id) DO UPDATE SET dataset_id=EXCLUDED.dataset_id,created_at=EXCLUDED.created_at,stats=EXCLUDED.stats,payload=EXCLUDED.payload`,
        [safeId(run.runId),run.datasetId,run.createdAt,JSON.stringify(run.stats??{}),JSON.stringify(run)]);
      return run;
    }
    const tmp=`${this.file(run.runId)}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(tmp,JSON.stringify(run,null,2),'utf8');await fs.rename(tmp,this.file(run.runId));return run;
  }
  async get(id){
    await this.ensure();
    if(this.usePostgres){const r=await getPool().query('SELECT payload FROM benchmark_runs WHERE run_id=$1',[safeId(id)]);if(!r.rows[0])throw Object.assign(new Error('Run not found'),{code:'RUN_NOT_FOUND'});return r.rows[0].payload;}
    return JSON.parse(await fs.readFile(this.file(id),'utf8'));
  }
  async list({datasetId=null,limit=100}={}){
    await this.ensure();
    let out=[];
    if(this.usePostgres){
      const r=datasetId
        ? await getPool().query('SELECT run_id,dataset_id,created_at,stats FROM benchmark_runs WHERE dataset_id=$1 ORDER BY created_at DESC LIMIT $2',[datasetId,limit])
        : await getPool().query('SELECT run_id,dataset_id,created_at,stats FROM benchmark_runs ORDER BY created_at DESC LIMIT $1',[limit]);
      out=r.rows.map(x=>({runId:x.run_id,datasetId:x.dataset_id,createdAt:new Date(x.created_at).toISOString(),stats:x.stats??{}}));
    } else {
      for(const name of (await fs.readdir(this.directory)).filter(x=>x.endsWith('.json'))){try{const r=JSON.parse(await fs.readFile(path.join(this.directory,name),'utf8'));if(!datasetId||r.datasetId===datasetId)out.push(summary(r));}catch{}}
      out=out.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit);
    }
    if(!out.length)return out;
    const best=[...out].sort((a,b)=>Number(b.stats?.score??b.stats?.accuracy??0)-Number(a.stats?.score??a.stats?.accuracy??0))[0]?.runId;
    return out.map((x,i)=>({...x,isLatest:i===0,isBest:x.runId===best}));
  }
  async compare(leftId,rightId){
    const [left,right]=await Promise.all([this.get(leftId),this.get(rightId)]);const rightById=new Map((right.results??[]).map(x=>[x.itemId,x]));
    const changes=(left.results??[]).map(a=>{const b=rightById.get(a.itemId);if(!b)return null;return {itemId:a.itemId,question:a.question,beforePassed:a.passed,afterPassed:b.passed,beforeScore:a.score??0,afterScore:b.score??0,scoreDelta:(b.score??0)-(a.score??0),changed:a.passed!==b.passed||Math.abs((b.score??0)-(a.score??0))>.0001};}).filter(Boolean);
    return {left:summary(left),right:summary(right),summary:{accuracyDelta:Number(right.stats?.accuracy??0)-Number(left.stats?.accuracy??0),scoreDelta:Number(right.stats?.score??0)-Number(left.stats?.score??0),sourceTraceabilityDelta:Number(right.stats?.sourceTraceability??0)-Number(left.stats?.sourceTraceability??0),improved:changes.filter(x=>!x.beforePassed&&x.afterPassed).length,regressed:changes.filter(x=>x.beforePassed&&!x.afterPassed).length},changes:changes.filter(x=>x.changed)};
  }
}
