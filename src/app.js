import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedAudioType, normalizeAudioType, transcribeWithOpenAI } from './transcription.js';
import { answerFromKnowledge, answerWithOpenAI, answerGeneralWithOpenAI } from './answering.js';
import { synthesizeWithOpenAI } from './speech.js';
import { createKnowledgeService } from './knowledge/createKnowledgeService.js';
import { createCatalogService } from './catalog/createCatalogService.js';
import { createDocumentServices } from './documents/createDocumentServices.js';
import { createAuthService } from './auth/createAuthService.js';
import { parseCookies } from './auth/AuthService.js';
import { createBenchmarkServices } from './benchmark/createBenchmarkServices.js';
import { AssistantSettingsStore } from './settings/AssistantSettingsStore.js';
import { JsonKnowledgeStore } from './knowledge/extraction/JsonKnowledgeStore.js';
import { OpenAIKnowledgeExtractor } from './knowledge/extraction/OpenAIKnowledgeExtractor.js';
import { KnowledgeExtractionJobService } from './knowledge/extraction/KnowledgeExtractionJobService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.webp', 'image/webp']
]);

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

function isAllowedClientId(value, allowedClientIds) {
  return typeof value === 'string' && /^[a-z0-9_-]{2,40}$/i.test(value) && allowedClientIds.has(value);
}

function resolvePublicFile(urlPath) {
  const decoded = decodeURIComponent(urlPath === '/' ? '/demo.html' : (urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath));
  const normalized = path.posix.normalize(decoded).replace(/^\/+/, '');
  const fullPath = path.resolve(publicDir, normalized);
  if (!fullPath.startsWith(`${publicDir}${path.sep}`) && fullPath !== publicDir) return null;
  return fullPath;
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Request body is too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, maxBytes) {
  const body = await readBody(req, maxBytes);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function sttErrorResponse(error) {
  if (error?.code === 'STT_NOT_CONFIGURED') return { status: 503, body: { error: 'STT_NOT_CONFIGURED', message: 'На сервере не задан OPENAI_API_KEY.' } };
  if (error?.code === 'STT_QUOTA_EXCEEDED') return { status: 429, body: { error: 'STT_QUOTA_EXCEEDED', message: 'На API-счёте закончились средства или исчерпан лимит проекта.' } };
  if (error?.code === 'STT_RATE_LIMIT') return { status: 429, body: { error: 'STT_RATE_LIMIT', message: 'Слишком много запросов к STT. Повторите немного позже.' } };
  if (error?.code === 'STT_EMPTY_RESULT') return { status: 422, body: { error: 'STT_EMPTY_RESULT', message: 'Речь не удалось распознать. Попробуйте говорить громче.' } };
  return { status: 502, body: { error: 'STT_PROVIDER_ERROR', message: 'Сервис распознавания речи временно недоступен.' } };
}

function ttsErrorResponse(error) {
  if (error?.code === 'TTS_NOT_CONFIGURED') return { status: 503, body: { error: 'TTS_NOT_CONFIGURED', message: 'На сервере не задан OPENAI_API_KEY.' } };
  if (error?.code === 'TTS_QUOTA_EXCEEDED') return { status: 429, body: { error: 'TTS_QUOTA_EXCEEDED', message: 'На API-счёте закончились средства или исчерпан лимит проекта.' } };
  if (error?.code === 'TTS_RATE_LIMIT') return { status: 429, body: { error: 'TTS_RATE_LIMIT', message: 'Слишком много запросов к озвучиванию. Повторите немного позже.' } };
  if (error?.code === 'TTS_EMPTY_TEXT') return { status: 422, body: { error: 'TTS_EMPTY_TEXT', message: 'Нет текста для озвучивания.' } };
  return { status: 502, body: { error: 'TTS_PROVIDER_ERROR', message: 'Сервис озвучивания временно недоступен.' } };
}

function answerErrorResponse(error) {
  if (error?.code === 'ANSWER_NOT_CONFIGURED') return { status: 503, body: { error: 'ANSWER_NOT_CONFIGURED', message: 'На сервере не настроен провайдер текстовых ответов.' } };
  if (error?.code === 'ANSWER_RATE_LIMIT') return { status: 429, body: { error: 'ANSWER_RATE_LIMIT', message: 'Лимит генерации ответа временно исчерпан.' } };
  return { status: 502, body: { error: 'ANSWER_PROVIDER_ERROR', message: 'Сервис формирования ответа временно недоступен.' } };
}

export function createRequestHandler(config, dependencies = {}) {
  const transcribe = dependencies.transcribe ?? transcribeWithOpenAI;
  const answerProvider = dependencies.answerProvider ?? answerWithOpenAI;
  const generalAnswerProvider = dependencies.generalAnswerProvider ?? answerGeneralWithOpenAI;
  const synthesize = dependencies.synthesize ?? synthesizeWithOpenAI;
  const knowledgeService = createKnowledgeService(config, dependencies);
  const catalogService = createCatalogService(config, dependencies);
  const documentServices = dependencies.documentServices ?? createDocumentServices(config);
  const authService = dependencies.authService ?? createAuthService(config);
  const settingsStore = dependencies.settingsStore ?? (config.assistantSettingsFile ? new AssistantSettingsStore({ file: config.assistantSettingsFile }) : { load: async()=>({answerMode:'knowledge_only',systemPrompt:'',answerLength:'medium',voiceStyle:'sommelier',voice:'marin',defaultLanguage:'auto'}), save: async(value)=>value });
  const structuredKnowledgeStore = dependencies.structuredKnowledgeStore ?? new JsonKnowledgeStore({ file: config.knowledgeExtractionFile ?? path.join(process.cwd(),'data','knowledge','runtime','knowledge.json') });
  const knowledgeExtractor = dependencies.knowledgeExtractor ?? new OpenAIKnowledgeExtractor({ apiKey: config.openAiApiKey, model: config.knowledgeExtractionModel ?? 'gpt-4.1-mini' });
  const extractionJobs = dependencies.extractionJobs ?? new KnowledgeExtractionJobService({ registry: documentServices.registry, ingestionService: documentServices.ingestionService, store: structuredKnowledgeStore, extractor: knowledgeExtractor });
  const benchmarkServices = dependencies.benchmarkServices ?? createBenchmarkServices(config, { registry: documentServices.registry, generator: dependencies.benchmarkGenerator, answerQuestion: async ({ query }) => { const settings=await settingsStore.load(); return answerFromKnowledge({ query, knowledgeService, catalogService, answerProvider, generalAnswerProvider, apiKey: config.openAiApiKey, model: config.answerModel, mode: settings.answerMode, language: settings.defaultLanguage }); } });
  const loginAttempts = new Map();

  function currentAdmin(req) {
    const token = parseCookies(req.headers.cookie ?? '').winemd_admin_session;
    return authService.verifySession(token);
  }
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === String(req.headers.host ?? ''); } catch { return false; }
  }
  function loginAllowed(ip) {
    const now = Date.now(), windowMs = 15 * 60 * 1000;
    const record = loginAttempts.get(ip);
    if (!record || now - record.startedAt > windowMs) { loginAttempts.set(ip, { startedAt: now, count: 1 }); return true; }
    record.count += 1; return record.count <= 10;
  }

  return async function requestHandler(req, res) {
    try {
      setSecurityHeaders(res);
      const requestUrl = new URL(req.url ?? '/', 'http://localhost');

      if (requestUrl.pathname.startsWith('/api/admin/auth/')) {
        if (!sameOrigin(req)) return sendJson(res, 403, { error: 'INVALID_ORIGIN' });
        await authService.ensureStorage();
        if (requestUrl.pathname === '/api/admin/auth/setup-status' && req.method === 'GET') {
          return sendJson(res, 200, { ok: true, setupRequired: !(await authService.hasUsers()) });
        }
        if (requestUrl.pathname === '/api/admin/auth/me' && req.method === 'GET') {
          const user = currentAdmin(req);
          return user ? sendJson(res, 200, { ok: true, user }) : sendJson(res, 401, { error: 'UNAUTHORIZED' });
        }
        if (requestUrl.pathname === '/api/admin/auth/setup' && req.method === 'POST') {
          if (await authService.hasUsers()) return sendJson(res, 409, { error: 'SETUP_COMPLETE' });
          const payload = await readJson(req, 16 * 1024);
          try {
            const user = await authService.createFirstAdmin(payload);
            res.setHeader('Set-Cookie', authService.cookie(authService.signSession(user)));
            return sendJson(res, 201, { ok: true, user });
          } catch (error) { return sendJson(res, 422, { error: error.code ?? 'SETUP_FAILED', message: error.message }); }
        }
        if (requestUrl.pathname === '/api/admin/auth/login' && req.method === 'POST') {
          const ip = String(req.socket?.remoteAddress ?? 'unknown');
          if (!loginAllowed(ip)) return sendJson(res, 429, { error: 'TOO_MANY_ATTEMPTS', message: 'Слишком много попыток входа. Повторите позже.' });
          const payload = await readJson(req, 16 * 1024);
          const user = await authService.authenticate(payload?.email, payload?.password);
          if (!user) return sendJson(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль.' });
          loginAttempts.delete(ip);
          res.setHeader('Set-Cookie', authService.cookie(authService.signSession(user)));
          return sendJson(res, 200, { ok: true, user });
        }
        if (requestUrl.pathname === '/api/admin/auth/logout' && req.method === 'POST') {
          res.setHeader('Set-Cookie', authService.clearCookie());
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }

      if (requestUrl.pathname === '/api/admin/documents') {
        if (req.method === 'GET') {
          if (!currentAdmin(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
          return sendJson(res, 200, { ok: true, documents: await documentServices.registry.load() });
        }
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        if (!currentAdmin(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
        let filename = 'document.bin';
        try { filename = decodeURIComponent(String(req.headers['x-filename'] ?? filename)); } catch {}
        filename = path.basename(filename).replace(/[^\p{L}\p{N}._ -]/gu, '_');
        let metadata = {};
        try { metadata = JSON.parse(decodeURIComponent(String(req.headers['x-document-metadata'] ?? '%7B%7D'))); } catch { return sendJson(res, 400, { error: 'INVALID_METADATA' }); }
        try {
          const buffer = await readBody(req, config.maxDocumentBytes);
          const document = await documentServices.ingestionService.ingest({ buffer, filename, metadata });
          return sendJson(res, 201, { ok: true, document });
        } catch (error) {
          if (error?.code === 'BODY_TOO_LARGE') return sendJson(res, 413, { error: 'DOCUMENT_TOO_LARGE', message: 'Документ слишком большой.' });
          if (error?.code === 'OCR_REQUIRED') return sendJson(res, 422, { error: 'OCR_REQUIRED', message: 'PDF не содержит достаточного текстового слоя. Нужен OCR.' });
          if (error?.code === 'UNSUPPORTED_DOCUMENT_TYPE') return sendJson(res, 415, { error: error.code, message: 'Поддерживаются PDF, DOCX, TXT и Markdown.' });
          return sendJson(res, 422, { error: error?.code ?? 'DOCUMENT_INGESTION_FAILED', message: error?.message ?? 'Не удалось обработать документ.' });
        }
      }


      if (requestUrl.pathname === '/api/admin/settings') {
        if (!currentAdmin(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
        if (req.method === 'GET') return sendJson(res, 200, { ok: true, settings: await settingsStore.load() });
        if (req.method === 'PUT') {
          if (!sameOrigin(req)) return sendJson(res, 403, { error: 'INVALID_ORIGIN' });
          const payload = await readJson(req, 64 * 1024);
          return sendJson(res, 200, { ok: true, settings: await settingsStore.save(payload) });
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }

      if (requestUrl.pathname.startsWith('/api/admin/documents/')) {
        if (!currentAdmin(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
        if (!sameOrigin(req)) return sendJson(res, 403, { error: 'INVALID_ORIGIN' });
        const parts=requestUrl.pathname.split('/').filter(Boolean); const documentId=parts[3]; const action=parts[4];
        if (!documentId) return sendJson(res, 404, { error: 'DOCUMENT_NOT_FOUND' });
        if (parts.length===4 && req.method==='DELETE') {
          const removed=await documentServices.ingestionService.delete(documentId); if(!removed)return sendJson(res,404,{error:'DOCUMENT_NOT_FOUND'});
          await structuredKnowledgeStore.removeDocument(documentId); return sendJson(res,200,{ok:true});
        }
        if (action==='reindex' && req.method==='POST') {
          try { return sendJson(res,200,{ok:true,document:await documentServices.ingestionService.reindex(documentId)}); }
          catch(error){ return sendJson(res,422,{error:error.code??'REINDEX_FAILED',message:error.message}); }
        }
        if (action==='extract' && req.method==='POST') {
          const payload=await readJson(req,16*1024).catch(()=>({})); return sendJson(res,202,{ok:true,job:extractionJobs.create({documentId,force:Boolean(payload?.force)})});
        }
        if (action==='knowledge-stats' && req.method==='GET') return sendJson(res,200,{ok:true,stats:await structuredKnowledgeStore.stats(documentId)});
        return sendJson(res,405,{error:'Method not allowed'});
      }

      if (requestUrl.pathname.startsWith('/api/admin/extraction-jobs/')) {
        if (!currentAdmin(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
        const id=requestUrl.pathname.split('/').filter(Boolean)[3]; const job=extractionJobs.get(id);
        return job?sendJson(res,200,{ok:true,job}):sendJson(res,404,{error:'JOB_NOT_FOUND'});
      }


      if (requestUrl.pathname.startsWith('/api/admin/benchmark')) {
        if (!currentAdmin(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
        if (!sameOrigin(req)) return sendJson(res, 403, { error: 'INVALID_ORIGIN' });
        const parts=requestUrl.pathname.split('/').filter(Boolean);
        if (requestUrl.pathname === '/api/admin/benchmark/datasets' && req.method === 'GET') return sendJson(res,200,{ok:true,datasets:await benchmarkServices.repository.list()});
        if (requestUrl.pathname === '/api/admin/benchmark/generate' && req.method === 'POST') {
          const payload=await readJson(req,64*1024);
          try { const job=benchmarkServices.jobs.create(payload??{}); return sendJson(res,202,{ok:true,job}); }
          catch(error){ const status=error.code==='DOCUMENT_NOT_FOUND'?404:['BENCHMARK_NOT_CONFIGURED','BENCHMARK_INVALID_API_KEY'].includes(error.code)?503:422; return sendJson(res,status,{error:error.code??'BENCHMARK_GENERATION_FAILED',message:error.message}); }
        }
        if (parts.length===5 && parts[3]==='jobs' && req.method==='GET') {
          const job=benchmarkServices.jobs.get(parts[4]);
          return job?sendJson(res,200,{ok:true,job}):sendJson(res,404,{error:'JOB_NOT_FOUND'});
        }
        if (requestUrl.pathname === '/api/admin/benchmark/import-seed' && req.method === 'POST') {
          const payload=await readJson(req,2*1024*1024);
          try { const dataset=await benchmarkServices.service.importSeed(payload.seed,{documentId:payload.documentId}); return sendJson(res,201,{ok:true,dataset}); }
          catch(error){return sendJson(res,error.code==='DOCUMENT_NOT_FOUND'?404:422,{error:error.code??'SEED_IMPORT_FAILED',message:error.message});}
        }
        if (parts.length===6 && parts[3]==='datasets' && parts[5]==='run' && req.method==='POST') {
          if(!benchmarkServices.runJobs)return sendJson(res,503,{error:'BENCHMARK_RUNNER_NOT_CONFIGURED'});
          try { const job=benchmarkServices.runJobs.create({datasetId:parts[4]}); return sendJson(res,202,{ok:true,job}); }
          catch(error){return sendJson(res,422,{error:error.code??'BENCHMARK_RUN_FAILED',message:error.message});}
        }
        if (parts.length===5 && parts[3]==='run-jobs' && req.method==='GET') {
          const job=benchmarkServices.runJobs?.get(parts[4]);
          return job?sendJson(res,200,{ok:true,job}):sendJson(res,404,{error:'RUN_JOB_NOT_FOUND'});
        }
        if (parts.length===5 && parts[3]==='runs' && req.method==='GET') {
          try{return sendJson(res,200,{ok:true,run:await benchmarkServices.runRepository.get(parts[4])});}catch{return sendJson(res,404,{error:'RUN_NOT_FOUND'});}
        }
        if (parts.length===5 && parts[3]==='datasets') {
          const id=parts[4];
          if(req.method==='GET'){try{return sendJson(res,200,{ok:true,dataset:await benchmarkServices.repository.get(id)});}catch(e){return sendJson(res,404,{error:'DATASET_NOT_FOUND'});}}
          if(req.method==='DELETE'){try{await benchmarkServices.repository.remove(id);return sendJson(res,200,{ok:true});}catch(e){return sendJson(res,404,{error:'DATASET_NOT_FOUND'});}}
        }
        return sendJson(res,405,{error:'Method not allowed'});
      }

      if (requestUrl.pathname === '/api/transcribe') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        const clientId = requestUrl.searchParams.get('clientId') ?? '';
        if (!isAllowedClientId(clientId, config.allowedClientIds)) return sendJson(res, 400, { error: 'Unknown or invalid clientId' });

        const contentType = normalizeAudioType(req.headers['content-type'] ?? '');
        if (!isAllowedAudioType(contentType)) return sendJson(res, 415, { error: 'UNSUPPORTED_AUDIO_TYPE', message: 'Неподдерживаемый формат аудио.' });
        const contentLength = Number.parseInt(req.headers['content-length'] ?? '0', 10);
        if (contentLength > config.maxAudioBytes) return sendJson(res, 413, { error: 'AUDIO_TOO_LARGE', message: 'Аудиозапись слишком большая.' });

        let audioBuffer;
        try { audioBuffer = await readBody(req, config.maxAudioBytes); }
        catch (error) {
          if (error?.code === 'BODY_TOO_LARGE') return sendJson(res, 413, { error: 'AUDIO_TOO_LARGE', message: 'Аудиозапись слишком большая.' });
          throw error;
        }
        if (audioBuffer.length < 100) return sendJson(res, 422, { error: 'AUDIO_TOO_SHORT', message: 'Аудиозапись пустая или слишком короткая.' });

        try {
          const requestedLanguage = requestUrl.searchParams.get('language');
          const language = ['ru', 'ro', 'en'].includes(requestedLanguage) ? requestedLanguage : (config.sttLanguage || undefined);
          const startedAt = Date.now();
          const result = await transcribe({ audioBuffer, contentType, apiKey: config.openAiApiKey, model: config.sttModel, language, prompt: config.sttPrompt });
          const durationMs = Date.now() - startedAt;
          console.log(`[timing] stt=${durationMs}ms model=${result.model} language=${language || 'auto'} bytes=${audioBuffer.length}`);
          res.setHeader('Server-Timing', `stt;dur=${durationMs}`);
          return sendJson(res, 200, { ok: true, text: result.text, model: result.model, language: result.language || language || 'auto', durationMs });
        } catch (error) {
          console.error('[stt]', error?.code ?? 'UNKNOWN', error?.message ?? 'Unknown error');
          const mapped = sttErrorResponse(error);
          return sendJson(res, mapped.status, mapped.body);
        }
      }

      if (requestUrl.pathname === '/api/speak') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        const clientId = requestUrl.searchParams.get('clientId') ?? '';
        if (!isAllowedClientId(clientId, config.allowedClientIds)) return sendJson(res, 400, { error: 'Unknown or invalid clientId' });
        if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          return sendJson(res, 415, { error: 'UNSUPPORTED_CONTENT_TYPE', message: 'Ожидается application/json.' });
        }
        let payload;
        try { payload = await readJson(req, config.maxJsonBytes); }
        catch (error) {
          if (error?.code === 'BODY_TOO_LARGE') return sendJson(res, 413, { error: 'REQUEST_TOO_LARGE' });
          if (error?.code === 'INVALID_JSON') return sendJson(res, 400, { error: 'INVALID_JSON' });
          throw error;
        }
        const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
        if (text.length < 1 || text.length > 4000) return sendJson(res, 422, { error: 'INVALID_TTS_TEXT', message: 'Текст должен содержать от 1 до 4000 символов.' });
        try {
          const startedAt = Date.now();
          const result = await synthesize({ text, apiKey: config.openAiApiKey, model: config.ttsModel, voice: config.ttsVoice, instructions: config.ttsInstructions });
          const durationMs = Date.now() - startedAt;
          console.log(`[timing] tts=${durationMs}ms model=${result.model} chars=${text.length}`);
          res.writeHead(200, {
            'Content-Type': result.contentType || 'audio/mpeg',
            'Content-Length': result.audioBuffer.length,
            'Cache-Control': 'no-store',
            'X-TTS-Model': result.model || config.ttsModel,
            'X-TTS-Voice': result.voice || config.ttsVoice,
            'Server-Timing': `tts;dur=${durationMs}`
          });
          return res.end(result.audioBuffer);
        } catch (error) {
          console.error('[tts]', error?.code ?? 'UNKNOWN', error?.message ?? 'Unknown error');
          const mapped = ttsErrorResponse(error);
          return sendJson(res, mapped.status, mapped.body);
        }
      }

      if (requestUrl.pathname === '/api/answer') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        const clientId = requestUrl.searchParams.get('clientId') ?? '';
        if (!isAllowedClientId(clientId, config.allowedClientIds)) return sendJson(res, 400, { error: 'Unknown or invalid clientId' });
        if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          return sendJson(res, 415, { error: 'UNSUPPORTED_CONTENT_TYPE', message: 'Ожидается application/json.' });
        }

        let payload;
        try { payload = await readJson(req, config.maxJsonBytes); }
        catch (error) {
          if (error?.code === 'BODY_TOO_LARGE') return sendJson(res, 413, { error: 'REQUEST_TOO_LARGE' });
          if (error?.code === 'INVALID_JSON') return sendJson(res, 400, { error: 'INVALID_JSON' });
          throw error;
        }

        const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
        const assistantSettings = await settingsStore.load();
        const language = ['ru', 'ro', 'en'].includes(payload?.language) ? payload.language : assistantSettings.defaultLanguage;
        const answerMode = ['general_chat','knowledge_only'].includes(payload?.answerMode) ? payload.answerMode : assistantSettings.answerMode;
        if (query.length < 2 || query.length > 500) {
          return sendJson(res, 422, { error: 'INVALID_QUERY', message: 'Вопрос должен содержать от 2 до 500 символов.' });
        }

        try {
          const result = await answerFromKnowledge({ query, knowledgeService, catalogService, answerProvider, generalAnswerProvider, apiKey: config.openAiApiKey, model: config.answerModel, language, mode: answerMode, assistantSettings });
          return sendJson(res, 200, { ok: true, answer: result.answer, grounded: result.grounded, refused: result.refused, sources: result.sources, products: result.products, model: result.model });
        } catch (error) {
          console.error('[answer]', error?.code ?? 'UNKNOWN', error?.message ?? 'Unknown error');
          const mapped = answerErrorResponse(error);
          return sendJson(res, mapped.status, mapped.body);
        }
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });

      if (requestUrl.pathname === '/health') {
        return sendJson(res, 200, { ok: true, service: 'wine-md-voice-lite', phase: '6B-voice', sttConfigured: Boolean(config.openAiApiKey), answerConfigured: Boolean(config.openAiApiKey), ttsConfigured: Boolean(config.openAiApiKey), knowledgeProvider: config.knowledgeProvider, catalogProvider: config.catalogProvider });
      }

      if (requestUrl.pathname === '/widget/config') {
        const clientId = requestUrl.searchParams.get('clientId') ?? '';
        if (!isAllowedClientId(clientId, config.allowedClientIds)) return sendJson(res, 400, { error: 'Unknown or invalid clientId' });
        const assistantSettings=await settingsStore.load(); return sendJson(res, 200, { clientId, title: 'Wine.md AI Sommelier', status: 'ready', phase: '6B-voice', sttConfigured: Boolean(config.openAiApiKey), answerConfigured: Boolean(config.openAiApiKey), ttsConfigured: Boolean(config.openAiApiKey), assistantSettings });
      }

      const filePath = resolvePublicFile(requestUrl.pathname);
      if (!filePath) return sendJson(res, 400, { error: 'Invalid path' });
      fs.stat(filePath, (statError, stats) => {
        if (statError || !stats.isFile()) return sendJson(res, 404, { error: 'Not found' });
        const extension = path.extname(filePath).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_TYPES.get(extension) ?? 'application/octet-stream');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', filePath.endsWith('loader.js') ? 'public, max-age=60' : 'public, max-age=300');
        if (filePath.endsWith('loader.js')) res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'HEAD') return res.end();
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => { if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' }); else res.destroy(); });
        stream.pipe(res);
      });
    } catch (error) {
      console.error('[wine-md-voice-lite]', error?.message ?? 'Unknown error');
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' }); else res.end();
    }
  };
}
