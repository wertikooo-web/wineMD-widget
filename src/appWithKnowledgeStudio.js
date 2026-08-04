import { createRequestHandler as createBaseRequestHandler } from './app.js';
import { createAuthService } from './auth/createAuthService.js';
import { parseCookies } from './auth/AuthService.js';
import { KnowledgeStudioService } from './knowledge/studio/KnowledgeStudioService.js';
import { KnowledgeEntityEditorService } from './knowledge/studio/KnowledgeEntityEditorService.js';
import { KnowledgeEntityMergeService } from './knowledge/studio/KnowledgeEntityMergeService.js';

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(payload),'Cache-Control':'no-store'});
  res.end(payload);
}
async function readJson(req, maxBytes = 128 * 1024) {
  const chunks=[]; let total=0;
  for await (const chunk of req) { total+=chunk.length; if(total>maxBytes){const e=new Error('Request body is too large');e.code='BODY_TOO_LARGE';throw e;} chunks.push(chunk); }
  if(!chunks.length)return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Invalid JSON');e.code='INVALID_JSON';throw e;}
}
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===String(req.headers.host??'');}catch{return false;}}
function positiveInt(value,fallback,max=200){const parsed=Number.parseInt(String(value??''),10);if(!Number.isFinite(parsed))return fallback;return Math.min(Math.max(parsed,0),max);}

export function createRequestHandler(config, dependencies = {}) {
  const authService = dependencies.authService ?? createAuthService(config);
  const base = createBaseRequestHandler(config, {...dependencies, authService});
  const studio = dependencies.knowledgeStudio ?? new KnowledgeStudioService();
  const entityEditor = dependencies.knowledgeEntityEditor ?? new KnowledgeEntityEditorService();
  const entityMerge = dependencies.knowledgeEntityMerge ?? new KnowledgeEntityMergeService();
  function currentAdmin(req){const token=parseCookies(req.headers.cookie??'').winemd_admin_session;return authService.verifySession(token);}
  function actor(admin){return admin.email??admin.name??'admin';}

  return async function knowledgeStudioAwareHandler(req,res){
    const requestUrl=new URL(req.url??'/','http://localhost');
    if(!requestUrl.pathname.startsWith('/api/admin/knowledge-studio')) return base(req,res);
    try{
      const admin=currentAdmin(req);
      if(!admin)return sendJson(res,401,{error:'UNAUTHORIZED'});
      if(!sameOrigin(req))return sendJson(res,403,{error:'INVALID_ORIGIN'});
      const parts=requestUrl.pathname.split('/').filter(Boolean);
      const section=parts[3]??''; const id=parts[4]?decodeURIComponent(parts[4]):''; const action=parts[5]??''; const nestedId=parts[6]?decodeURIComponent(parts[6]):'';

      if(section==='overview'&&req.method==='GET')return sendJson(res,200,{ok:true,overview:await studio.overview()});
      if(section==='predicates'&&req.method==='GET')return sendJson(res,200,{ok:true,predicates:await studio.predicates()});

      if(section==='entities'&&!id&&req.method==='GET'){
        const result=await studio.listEntities({
          query:requestUrl.searchParams.get('query')??'',type:requestUrl.searchParams.get('type')??'',status:requestUrl.searchParams.get('status')??'',
          sort:requestUrl.searchParams.get('sort')??'name',order:requestUrl.searchParams.get('order')??'asc',
          limit:positiveInt(requestUrl.searchParams.get('limit'),50),offset:positiveInt(requestUrl.searchParams.get('offset'),0,100000)
        });
        return sendJson(res,200,{ok:true,...result});
      }
      if(section==='entities'&&id&&action==='graph'&&req.method==='GET'){
        const graph=await studio.graph(id,positiveInt(requestUrl.searchParams.get('depth'),1,2),positiveInt(requestUrl.searchParams.get('limit'),80,200));
        return graph?sendJson(res,200,{ok:true,graph}):sendJson(res,404,{error:'ENTITY_NOT_FOUND'});
      }
      if(section==='entities'&&id&&action==='history'&&req.method==='GET'){
        return sendJson(res,200,{ok:true,items:await entityEditor.history(id,positiveInt(requestUrl.searchParams.get('limit'),100,300))});
      }
      if(section==='entities'&&id&&action==='merge-preview'&&req.method==='POST'){
        const payload=await readJson(req);
        const preview=await entityMerge.preview({sourceEntityId:id,targetEntityId:payload.targetEntityId});
        return preview?sendJson(res,200,{ok:true,preview}):sendJson(res,404,{error:'ENTITY_NOT_FOUND'});
      }
      if(section==='entities'&&id&&action==='merge'&&req.method==='POST'){
        const payload=await readJson(req);
        const result=await entityMerge.merge({sourceEntityId:id,targetEntityId:payload.targetEntityId,comment:payload.comment??'',actor:actor(admin)});
        return result?sendJson(res,200,{ok:true,result}):sendJson(res,404,{error:'ENTITY_NOT_FOUND'});
      }
      if(section==='entities'&&id&&action==='aliases'&&!nestedId&&req.method==='POST'){
        const payload=await readJson(req);
        const alias=await entityEditor.addAlias({entityId:id,alias:payload.alias,language:payload.language??null,comment:payload.comment??'',actor:actor(admin)});
        return alias?sendJson(res,200,{ok:true,alias}):sendJson(res,404,{error:'ENTITY_NOT_FOUND'});
      }
      if(section==='entities'&&id&&action==='aliases'&&nestedId&&req.method==='DELETE'){
        const payload=await readJson(req);
        const alias=await entityEditor.deleteAlias({entityId:id,aliasId:nestedId,comment:payload.comment??'',actor:actor(admin)});
        return alias?sendJson(res,200,{ok:true,alias}):sendJson(res,404,{error:'ALIAS_NOT_FOUND'});
      }
      if(section==='entities'&&id&&req.method==='PUT'){
        const payload=await readJson(req);
        const entity=await entityEditor.updateEntity({
          entityId:id,canonicalName:payload.canonicalName,entityType:payload.entityType,
          shortDescription:payload.shortDescription??null,status:payload.status,
          comment:payload.comment??'',actor:actor(admin)
        });
        return entity?sendJson(res,200,{ok:true,entity}):sendJson(res,404,{error:'ENTITY_NOT_FOUND'});
      }
      if(section==='entities'&&id&&req.method==='GET'){
        const entity=await studio.entityDetails(id);return entity?sendJson(res,200,{ok:true,entity}):sendJson(res,404,{error:'ENTITY_NOT_FOUND'});
      }

      if(section==='facts'&&!id&&req.method==='GET'){
        const result=await studio.listFacts({
          query:requestUrl.searchParams.get('query')??'',predicate:requestUrl.searchParams.get('predicate')??'',status:requestUrl.searchParams.get('status')??'',
          needsReview:requestUrl.searchParams.get('needsReview')==='true',sort:requestUrl.searchParams.get('sort')??'updated',order:requestUrl.searchParams.get('order')??'desc',
          limit:positiveInt(requestUrl.searchParams.get('limit'),50),offset:positiveInt(requestUrl.searchParams.get('offset'),0,100000)
        });
        return sendJson(res,200,{ok:true,...result});
      }
      if(section==='facts'&&id&&action==='review'&&req.method==='POST'){
        const payload=await readJson(req);const fact=await studio.reviewFact({factId:id,action:payload.action,comment:payload.comment??'',actor:actor(admin)});
        return fact?sendJson(res,200,{ok:true,fact}):sendJson(res,404,{error:'FACT_NOT_FOUND'});
      }
      if(section==='facts'&&id&&req.method==='GET'){
        const fact=await studio.factDetails(id);return fact?sendJson(res,200,{ok:true,fact}):sendJson(res,404,{error:'FACT_NOT_FOUND'});
      }
      if(section==='facts'&&id&&req.method==='PUT'){
        const payload=await readJson(req);const fact=await studio.updateFact({factId:id,predicate:payload.predicate,objectEntityId:payload.objectEntityId??null,textValue:payload.textValue??null,numberValue:payload.numberValue??null,dateValue:payload.dateValue??null,unit:payload.unit??null,comment:payload.comment??'',actor:actor(admin)});
        return fact?sendJson(res,200,{ok:true,fact}):sendJson(res,404,{error:'FACT_NOT_FOUND'});
      }
      return sendJson(res,405,{error:'Method not allowed'});
    }catch(error){
      const validationCodes=['INVALID_REVIEW_ACTION','UNKNOWN_PREDICATE','FACT_VALUE_REQUIRED','INVALID_JSON','ENTITY_NAME_REQUIRED','INVALID_ENTITY_TYPE','INVALID_ENTITY_STATUS','ENTITY_DUPLICATE','ALIAS_REQUIRED','INVALID_MERGE_TARGET','MERGE_TYPE_MISMATCH'];
      const status=error?.code==='POSTGRES_REQUIRED'?503:validationCodes.includes(error?.code)?422:error?.code==='BODY_TOO_LARGE'?413:500;
      console.error('[knowledge-studio]',error?.code??'UNKNOWN',error?.message??error);
      return sendJson(res,status,{error:error?.code??'KNOWLEDGE_STUDIO_ERROR',message:error?.message??'Knowledge Studio error',duplicateEntityId:error?.duplicateEntityId??null});
    }
  };
}
