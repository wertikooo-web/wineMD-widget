import crypto from 'node:crypto';
import { asExpectedFacts, asEvidenceArray } from './benchmarkSchema.js';
import { evaluateDiagnosticItem } from './DiagnosticBenchmarkEvaluator.js';

function tokens(text){return [...new Set(String(text??'').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])];}
function factScore(fact,answer){const t=tokens(fact);if(!t.length)return 0;const hay=new Set(tokens(answer));return t.filter(x=>hay.has(x)).length/t.length;}
function avg(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;}

export class BenchmarkRunnerService{
  constructor({datasetRepository,runRepository,answerQuestion}){Object.assign(this,{datasetRepository,runRepository,answerQuestion});}

  async run({datasetId,onProgress=()=>{}}){
    const dataset=await this.datasetRepository.get(datasetId);
    const results=[];
    const items=dataset.items??[];

    for(let i=0;i<items.length;i++){
      const item=items[i];
      onProgress({phase:'running',message:`Проверка ${i+1}/${items.length}`,completed:i,total:items.length});
      const started=Date.now();
      let actual,error=null;
      try{actual=await this.answerQuestion({query:item.question});}
      catch(e){error={code:e.code??'RUN_ERROR',message:e.message};}

      const expectedFacts=asExpectedFacts(item);
      const sourceIds=new Set((actual?.sources??[]).map(x=>x.id));
      const expectedSources=[...new Set(asEvidenceArray(item).map(x=>x.chunkId).filter(Boolean))];
      const factResults=expectedFacts.map(f=>({id:f.id,text:f.text,score:factScore(f.text,actual?.answer??''),passed:factScore(f.text,actual?.answer??'')>=.45}));
      const sourceRecall=expectedSources.length?expectedSources.filter(id=>sourceIds.has(id)).length/expectedSources.length:null;
      const refused=Boolean(actual?.refused);

      let passed,diagnosis,score=0,diagnosticChecks=null,failedChecks=[];
      if(item.evaluationMode==='diagnostic'||dataset.evaluationMode==='diagnostic'){
        const evaluation=evaluateDiagnosticItem(item,actual,error);
        ({passed,diagnosis,score,checks:diagnosticChecks,failedChecks}=evaluation);
      }else{
        passed=item.polarity==='negative'?refused:(!error&&!refused&&factResults.every(x=>x.passed));
        score=passed?1:0;
        diagnosis='PASS';
        if(error)diagnosis='RUN_ERROR';
        else if(item.polarity==='negative'&&!refused)diagnosis='MISSING_REFUSAL';
        else if(item.polarity==='positive'&&refused)diagnosis='FALSE_REFUSAL';
        else if(item.polarity==='positive'&&sourceRecall===0)diagnosis='RETRIEVAL_MISS';
        else if(item.polarity==='positive'&&!factResults.every(x=>x.passed))diagnosis='INCOMPLETE_ANSWER';
      }

      results.push({
        itemId:item.id,category:item.category,difficulty:item.difficulty,question:item.question,
        polarity:item.polarity,passed,score,diagnosis,diagnosticChecks,failedChecks,
        answer:actual?.answer??null,refused,sources:actual?.sources??[],
        subqueries:actual?.retrieval?.subqueries??[],expectedFacts,factResults,
        expectedSourceIds:expectedSources,sourceRecall,latencyMs:Date.now()-started,error
      });
    }

    const positive=results.filter(x=>x.polarity==='positive');
    const negative=results.filter(x=>x.polarity==='negative');
    const byCategory=Object.fromEntries([...new Set(results.map(x=>x.category).filter(Boolean))].map(category=>{
      const rows=results.filter(x=>x.category===category);
      return [category,{total:rows.length,passed:rows.filter(x=>x.passed).length,accuracy:avg(rows.map(x=>x.passed?1:0)),score:avg(rows.map(x=>x.score??0))}];
    }));
    const now=new Date().toISOString();
    const run={
      schemaVersion:'1.1',runId:`run-${crypto.randomUUID()}`,datasetId,documentId:dataset.documentId,
      createdAt:now,evaluationMode:dataset.evaluationMode??'reference',
      stats:{
        total:results.length,passed:results.filter(x=>x.passed).length,
        accuracy:avg(results.map(x=>x.passed?1:0)),score:avg(results.map(x=>x.score??0)),
        positiveAccuracy:avg(positive.map(x=>x.passed?1:0)),negativeAccuracy:avg(negative.map(x=>x.passed?1:0)),
        sourceRecall:avg(results.filter(x=>x.sourceRecall!=null).map(x=>x.sourceRecall)),
        sourceTraceability:avg(results.map(x=>(x.sources?.length??0)>0?1:0)),
        multiSourceAccuracy:avg(results.filter(x=>x.expectedSourceIds.length>1).map(x=>x.passed?1:0)),
        averageLatencyMs:Math.round(avg(results.map(x=>x.latencyMs))),
        diagnoses:Object.fromEntries([...new Set(results.map(x=>x.diagnosis))].map(key=>[key,results.filter(x=>x.diagnosis===key).length])),
        byCategory
      },results
    };
    await this.runRepository.save(run);
    onProgress({phase:'complete',message:'Проверка завершена',completed:items.length,total:items.length,runId:run.runId,stats:run.stats});
    return run;
  }
}
