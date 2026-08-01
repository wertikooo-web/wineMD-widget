import { createRequestHandler as createKnowledgeStudioHandler } from './appWithKnowledgeStudio.js';
import { createAuthService } from './auth/createAuthService.js';
import { parseCookies } from './auth/AuthService.js';
import { WineMdCatalogSyncService } from './catalog/WineMdCatalogSyncService.js';

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

async function readJson(req, maxBytes = 4 * 1024 * 1024) {
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
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('Invalid JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === String(req.headers.host ?? ''); }
  catch { return false; }
}

export function createRequestHandler(config, dependencies = {}) {
  const base = createKnowledgeStudioHandler(config, dependencies);
  const authService = dependencies.authService ?? createAuthService(config);
  const catalogSync = dependencies.catalogSync ?? new WineMdCatalogSyncService();
  catalogSync.startScheduler();

  function currentAdmin(req) {
    const token = parseCookies(req.headers.cookie ?? '').winemd_admin_session;
    return authService.verifySession(token);
  }

  return async function catalogAwareHandler(req, res) {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const isAdminCatalog = requestUrl.pathname.startsWith('/api/admin/winemd-catalog');
    const isWebhook = requestUrl.pathname === '/api/integrations/winemd/catalog';
    if (!isAdminCatalog && !isWebhook) return base(req, res);

    try {
      if (isWebhook) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        if (!catalogSync.verifyWebhook(req)) return sendJson(res, 401, { error: 'INVALID_WEBHOOK_SECRET' });
        const result = await catalogSync.syncPayload(await readJson(req), { mode: 'webhook' });
        return sendJson(res, 202, { ok: true, result });
      }

      const admin = currentAdmin(req);
      if (!admin) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'INVALID_ORIGIN' });

      if (requestUrl.pathname === '/api/admin/winemd-catalog/status' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, status: await catalogSync.status() });
      }
      if (requestUrl.pathname === '/api/admin/winemd-catalog/sync' && req.method === 'POST') {
        const result = await catalogSync.syncRemote({ mode: 'manual' });
        return sendJson(res, 200, { ok: true, result });
      }
      if (requestUrl.pathname === '/api/admin/winemd-catalog/import' && req.method === 'POST') {
        const result = await catalogSync.syncPayload(await readJson(req), { mode: 'manual_import' });
        return sendJson(res, 200, { ok: true, result });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    } catch (error) {
      const status = error?.code === 'CATALOG_URL_NOT_CONFIGURED' ? 503
        : error?.code === 'CATALOG_FETCH_FAILED' ? 502
        : error?.code === 'POSTGRES_REQUIRED' ? 503
        : error?.code === 'BODY_TOO_LARGE' ? 413
        : error?.code === 'INVALID_JSON' ? 422
        : 500;
      console.error('[winemd-catalog]', error?.code ?? 'UNKNOWN', error?.message ?? error);
      return sendJson(res, status, { error: error?.code ?? 'WINEMD_CATALOG_ERROR', message: error?.message ?? 'Wine.md catalog error' });
    }
  };
}
