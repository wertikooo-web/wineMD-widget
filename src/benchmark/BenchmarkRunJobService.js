import crypto from 'node:crypto';
export class BenchmarkRunJobService{
  constructor({runner,repository}){this.runner=runner;this.repository=repository;this.repository?.markInterrupted().catch(error=>console.error('[benchmark-jobs] mark interrupted',error));}
  create(input){const jobId=`run-job-${crypto.randomUUID()}`;const now=new Date().toISOString();const job={jobId,datasetId:input.datasetId,status:'queued',phase:'queued',message:'Проверка поставлена в очередь',createdAt:now,updatedAt:now,progress:{completed:0,total:0}};this.repository.save(job).catch(error=>console.error('[benchmark-jobs] save queued',error));queueMicrotask(async()=>{await this.update(jobId,{status:'running',phase:'starting',message:'Подготовка benchmark'});try{const run=await this.runner.run({...input,onProgress:p=>this.update(jobId,{phase:p.phase,message:p.message,progress:p})});await this.update(jobId,{status:'completed',phase:'complete',message:'Проверка завершена',runId:run.runId,stats:run.stats,progress:{completed:run.stats.total,total:run.stats.total}});}catch(e){await this.update(jobId,{status:'failed',phase:'failed',message:e.message,error:e.code??'BENCHMARK_RUN_FAILED'});}});return job;}
  async update(id,patch){const current=await this.repository.get(id);if(!current)return null;const job={...current,...patch,updatedAt:new Date().toISOString()};await this.repository.save(job);return job;}
  async get(id){return this.repository.get(id);}
  async list(options){return this.repository.list(options);}
}
