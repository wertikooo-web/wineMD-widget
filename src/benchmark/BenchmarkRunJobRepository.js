import { ensurePostgresSchema, getPool, postgresEnabled } from '../db/Postgres.js';

export class BenchmarkRunJobRepository {
  constructor(){this.enabled=postgresEnabled();this.memory=new Map();}
  async save(job){
    this.memory.set(job.jobId,structuredClone(job));
    if(!this.enabled)return job;
    await ensurePostgresSchema();
    await getPool().query(`INSERT INTO benchmark_run_jobs(job_id,dataset_id,status,phase,message,progress,run_id,stats,error,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11)
      ON CONFLICT(job_id) DO UPDATE SET dataset_id=EXCLUDED.dataset_id,status=EXCLUDED.status,phase=EXCLUDED.phase,message=EXCLUDED.message,progress=EXCLUDED.progress,run_id=EXCLUDED.run_id,stats=EXCLUDED.stats,error=EXCLUDED.error,updated_at=EXCLUDED.updated_at`,
      [job.jobId,job.datasetId??null,job.status,job.phase??null,job.message??null,JSON.stringify(job.progress??{}),job.runId??null,job.stats?JSON.stringify(job.stats):null,job.error??null,job.createdAt,job.updatedAt]);
    return job;
  }
  async get(id){
    if(!this.enabled)return this.memory.get(id)||null;
    await ensurePostgresSchema();const r=await getPool().query('SELECT * FROM benchmark_run_jobs WHERE job_id=$1',[id]);return r.rows[0]?this.map(r.rows[0]):null;
  }
  async list({limit=20}={}){
    if(!this.enabled)return [...this.memory.values()].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,limit);
    await ensurePostgresSchema();const r=await getPool().query('SELECT * FROM benchmark_run_jobs ORDER BY updated_at DESC LIMIT $1',[limit]);return r.rows.map(x=>this.map(x));
  }
  async markInterrupted(){
    if(!this.enabled)return;
    await ensurePostgresSchema();await getPool().query(`UPDATE benchmark_run_jobs SET status='interrupted',phase='interrupted',message='Прогон прерван перезапуском сервера. Запустите его снова.',error='SERVER_RESTART',updated_at=now() WHERE status IN ('queued','running')`);
  }
  map(x){return {jobId:x.job_id,datasetId:x.dataset_id,status:x.status,phase:x.phase,message:x.message,progress:x.progress??{},runId:x.run_id,stats:x.stats,error:x.error,createdAt:new Date(x.created_at).toISOString(),updatedAt:new Date(x.updated_at).toISOString()};}
}
