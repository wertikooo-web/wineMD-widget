import crypto from 'node:crypto';
export class BenchmarkRunJobService{
  constructor({runner}){this.runner=runner;this.jobs=new Map();}
  create(input){const jobId=`run-job-${crypto.randomUUID()}`;const job={jobId,status:'queued',phase:'queued',message:'Проверка поставлена в очередь',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),progress:{completed:0,total:0}};this.jobs.set(jobId,job);queueMicrotask(async()=>{this.update(jobId,{status:'running',phase:'starting',message:'Подготовка benchmark'});try{const run=await this.runner.run({...input,onProgress:p=>this.update(jobId,{phase:p.phase,message:p.message,progress:p})});this.update(jobId,{status:'completed',phase:'complete',message:'Проверка завершена',runId:run.runId,stats:run.stats,progress:{completed:run.stats.total,total:run.stats.total}});}catch(e){this.update(jobId,{status:'failed',phase:'failed',message:e.message,error:e.code??'BENCHMARK_RUN_FAILED'});}});return job;}
  update(id,patch){const j=this.jobs.get(id);if(!j)return;Object.assign(j,patch,{updatedAt:new Date().toISOString()});}
  get(id){return this.jobs.get(id)||null;}
}
