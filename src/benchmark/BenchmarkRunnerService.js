import crypto from 'node:crypto';
import { asExpectedFacts, asEvidenceArray } from './benchmarkSchema.js';

function tokens(text){return [...new Set(String(text??'').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])];}
function factScore(fact,answer){const t=tokens(fact);if(!t.length)return 0;const hay=new Set(tokens(answer));return t.filter(x=>hay.has(x)).length/t.length;}
function hasOfficialWebSource(actual){return (actual?.sources??[]).some(source=>Boolean(source?.url)&&/^(https?:\/\/)/i.test(source.url));}
function hasWineMdEvidence(actual){return Boolean((actual?.products??[]).length)||(actual?.sources??[]).some(source=>/wine\.?md/i.test(`${source?.type??''} ${source?.provider??''} ${source?.title??''} ${source?.url??''}`));}
function sourcePolicyResult(item,actual){
  const policy=item.source_policy??{};
  if(policy.internet==='required'&&!hasOfficialWebSource(actual))return{passed:false,diagnosis:'MISSING_CURRENT_WEB_SOURCE'};
  if((policy.primary??[]).includes('wine_md_catalog')&&!hasWineMdEvidence(actual))return{passed:false,diagnosis:'MISSING_WINE_MD_EVIDENCE'};
  if(item.checks?.source_traceability&&!((actual?.sources??[]).length||(actual?.products??[]).length))return{passed:false,diagnosis:'MISSING_SOURCE_TRACEABILITY'};
  return{passed:true,diagnosis:'PASS'};
}

export class BenchmarkRunnerService{
  constructor({datasetRepository,runRepository,answerQuestion}){Object.assign(this,{datasetRepository,runRepository,answerQuestion});}
  async run({datasetId,onProgress=()=>{}}){
    const dataset=await this.datasetRepository.get(datasetId);const results=[];const items=dataset.items??[];
    for(let i=0;i<items.length;i++){
      const item=items[i];onProgress({phase:'running',message:`Проверка ${i+1}/${items.length}`,completed:i,total:items.length});
      const started=Date.now();let actual,error=null;
      try{actual=await this.answerQuestion({query:item.question});}catch(e){error={code:e.code??'RUN_ERROR',message:e.message};}
      const answer=actual?.answer??'';const expectedFacts=asExpectedFacts(item);const sourceIds=new Set((actual?.sources??[]).map(x=>x.id));const expectedSources=[...new Set(asEvidenceArray(item).map(x=>x.chunkId).filter(Boolean))];
      const factResults=expectedFacts.map(f=>{const score=factScore(f.text,answer);return{id:f.id,text:f.text,score,passed:score>=.45};});
      const sourceRecall=expectedSources.length?expectedSources.filter(id=>sourceIds.has(id)).length/expectedSources.length:null;
      const refused=Boolean(actual?.refused);const answerPresent=String(answer).trim().length>=40;const policy=sourcePolicyResult(item,actual);
      const positivePass=!error&&!refused&&answerPresent&&policy.passed&&factResults.every(x=>x.passed);
      const negativePass=!error&&refused;
      const automatedPass=item.polarity==='negative'?negativePass:positivePass;
      const reviewRequired=automatedPass&&expectedFacts.length===0&&Boolean(item.checks?.factual_accuracy||item.checks?.completeness);
      let diagnosis='PASS';
      if(error)diagnosis='RUN_ERROR';
      else if(item.polarity==='negative'&&!refused)diagnosis='MISSING_REFUSAL';
      else if(item.polarity==='positive'&&refused)diagnosis='FALSE_REFUSAL';
      else if(item.polarity==='positive'&&!answerPresent)diagnosis='EMPTY_OR_TOO_SHORT';
      else if(item.polarity==='positive'&&!policy.passed)diagnosis=policy.diagnosis;
      else if(item.polarity==='positive'&&sourceRecall===0)diagnosis='RETRIEVAL_MISS';
      else if(item.polarity==='positive'&&!factResults.every(x=>x.passed))diagnosis='INCOMPLETE_ANSWER';
      else if(reviewRequired)diagnosis='MANUAL_REVIEW_REQUIRED';
      results.push({itemId:item.id,category:item.category,difficulty:item.difficulty,question:item.question,polarity:item.polarity,passed:automatedPass,automatedPass,reviewRequired,diagnosis,answer:answer||null,grounded:Boolean(actual?.grounded),refused,sources:actual?.sources??[],products:actual?.products??[],subqueries:actual?.retrieval?.subqueries??[],expectedFacts,factResults,expectedSourceIds:expectedSources,sourceRecall,sourcePolicy:item.source_policy??null,checks:item.checks??null,latencyMs:Date.now()-started,error});
    }
    const positive=results.filter(x=>x.polarity==='positive'),negative=results.filter(x=>x.polarity==='negative');
    const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;const now=new Date().toISOString();
    const run={schemaVersion:'1.1',runId:`run-${crypto.randomUUID()}`,datasetId,documentId:dataset.documentId,createdAt:now,stats:{total:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,reviewRequired:results.filter(x=>x.reviewRequired).length,accuracy:avg(results.map(x=>x.passed?1:0)),positiveAccuracy:avg(positive.map(x=>x.passed?1:0)),negativeAccuracy:avg(negative.map(x=>x.passed?1:0)),sourceRecall:avg(results.filter(x=>x.sourceRecall!=null).map(x=>x.sourceRecall)),multiSourceAccuracy:avg(results.filter(x=>x.expectedSourceIds.length>1).map(x=>x.passed?1:0)),averageLatencyMs:Math.round(avg(results.map(x=>x.latencyMs))),diagnoses:Object.fromEntries([...new Set(results.map(x=>x.diagnosis))].map(k=>[k,results.filter(x=>x.diagnosis===k).length]))},results};
    await this.runRepository.save(run);onProgress({phase:'complete',message:'Проверка завершена',completed:items.length,total:items.length,runId:run.runId,stats:run.stats});return run;
  }
}
