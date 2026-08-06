import path from 'node:path';
import { createRequestHandler as createCatalogHandler } from './appWithCatalogSync.js';
import { createAuthService } from './auth/createAuthService.js';
import { parseCookies } from './auth/AuthService.js';
import { extractConstraints, validateConstraints } from './intelligence/ConstraintEngine.js';
import { auditRoutePlan } from './intelligence/RoutePlanner.js';
import { BenchmarkDatasetRepository } from './benchmark/BenchmarkDatasetRepository.js';
import { BenchmarkRunRepository } from './benchmark/BenchmarkRunRepository.js';
import { BenchmarkRunJobRepository } from './benchmark/BenchmarkRunJobRepository.js';
import { installWineAiMvpDataset, WINE_AI_MVP_DATASET_ID } from './benchmark/installWineAiMvpDataset.js';

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(payload),'Cache-Control':'no-store'});
  res.end(payload);
}
async function readJson(req,maxBytes=256*1024){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>maxBytes){const error=new Error('Request body is too large');error.code='BODY_TOO_LARGE';throw error;}chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const error=new Error('Invalid JSON');error.code='INVALID_JSON';throw error;}}
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===String(req.headers.host??'');}catch{return false;}}

export function createRequestHandler(config,dependencies={}){
  const authService=dependencies.authService??createAuthService(config);
  const base=createCatalogHandler(config,{...dependencies,authService});
  const benchmarkDirectory=config.benchmarkDatasetDir||path.join(process.cwd(),'data','benchmark','runtime');
  const benchmarkRepository=dependencies.benchmarkRepository??new BenchmarkDatasetRepository({directory:benchmarkDirectory});
  const runRepository=dependencies.runRepository??new BenchmarkRunRepository({directory:path.join(benchmarkDirectory,'runs')});
  const runJobRepository=dependencies.runJobRepository??new BenchmarkRunJobRepository();
  const paths=new Set(['/api/admin/wine-intelligence/validate','/api/admin/wine-intelligence/route-audit','/api/admin/wine-intelligence/benchmark-mvp','/api/admin/wine-intelligence/benchmark-mvp/install','/api/admin/wine-intelligence/benchmark-history','/api/admin/wine-intelligence/benchmark-jobs','/api/admin/wine-intelligence/benchmark-compare']);
  function currentAdmin(req){const token=parseCookies(req.headers.cookie??'').winemd_admin_session;return authService.verifySession(token);}

  return async function wineIntelligenceHandler(req,res){
    const requestUrl=new URL(req.url??'/','http://localhost');if(!paths.has(requestUrl.pathname))return base(req,res);
    try{
      if(!currentAdmin(req))return sendJson(res,401,{error:'UNAUTHORIZED'});
      if(!sameOrigin(req))return sendJson(res,403,{error:'INVALID_ORIGIN'});
      if(requestUrl.pathname==='/api/admin/wine-intelligence/benchmark-history'){
        if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed'});
        return sendJson(res,200,{ok:true,runs:await runRepository.list({datasetId:requestUrl.searchParams.get('datasetId')||WINE_AI_MVP_DATASET_ID,limit:Math.min(100,Number(requestUrl.searchParams.get('limit')||30))})});
      }
      if(requestUrl.pathname==='/api/admin/wine-intelligence/benchmark-jobs'){
        if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed'});
        return sendJson(res,200,{ok:true,jobs:await runJobRepository.list({limit:20})});
      }
      if(requestUrl.pathname==='/api/admin/wine-intelligence/benchmark-compare'){
        if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed'});const left=requestUrl.searchParams.get('left'),right=requestUrl.searchParams.get('right');if(!left||!right)return sendJson(res,422,{error:'RUN_IDS_REQUIRED'});return sendJson(res,200,{ok:true,comparison:await runRepository.compare(left,right)});
      }
      if(requestUrl.pathname==='/api/admin/wine-intelligence/benchmark-mvp'){
        if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed'});try{const dataset=await benchmarkRepository.get(WINE_AI_MVP_DATASET_ID);return sendJson(res,200,{ok:true,installed:true,datasetId:dataset.datasetId,stats:dataset.stats,updatedAt:dataset.updatedAt});}catch{return sendJson(res,200,{ok:true,installed:false,datasetId:WINE_AI_MVP_DATASET_ID});}
      }
      if(requestUrl.pathname==='/api/admin/wine-intelligence/benchmark-mvp/install'){
        if(req.method!=='POST')return sendJson(res,405,{error:'Method not allowed'});const dataset=await installWineAiMvpDataset(benchmarkRepository);return sendJson(res,200,{ok:true,datasetId:dataset.datasetId,stats:dataset.stats,updatedAt:dataset.updatedAt});
      }
      if(req.method!=='POST')return sendJson(res,405,{error:'Method not allowed'});const payload=await readJson(req);const query=typeof payload.query==='string'?payload.query.trim():'';if(query.length<2)return sendJson(res,422,{error:'INVALID_QUERY',message:'Нужен исходный вопрос пользователя.'});
      if(requestUrl.pathname.endsWith('/route-audit')){if(!payload.plan||typeof payload.plan!=='object')return sendJson(res,422,{error:'INVALID_ROUTE_PLAN',message:'Нужен объект plan со списком stops.'});return sendJson(res,200,{ok:true,report:auditRoutePlan({query,plan:payload.plan})});}
      const answer=typeof payload.answer==='string'?payload.answer.trim():'';if(!answer)return sendJson(res,422,{error:'INVALID_VALIDATION_INPUT',message:'Нужен ответ для проверки.'});const constraints=extractConstraints(query);return sendJson(res,200,{ok:true,constraints,report:validateConstraints({query,answer,constraints})});
    }catch(error){const status=error?.code==='BODY_TOO_LARGE'?413:error?.code==='INVALID_JSON'?422:error?.code==='RUN_NOT_FOUND'?404:500;console.error('[wine-intelligence]',error?.code??'UNKNOWN',error?.message??error);return sendJson(res,status,{error:error?.code??'WINE_INTELLIGENCE_ERROR',message:error?.message??'Wine Intelligence error'});}
  };
}
