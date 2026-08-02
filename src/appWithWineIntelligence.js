import { createRequestHandler as createCatalogHandler } from './appWithCatalogSync.js';
import { createAuthService } from './auth/createAuthService.js';
import { parseCookies } from './auth/AuthService.js';
import { extractConstraints, validateConstraints } from './intelligence/ConstraintEngine.js';

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

async function readJson(req, maxBytes = 128 * 1024) {
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
  const authService = dependencies.authService ?? createAuthService(config);
  const base = createCatalogHandler(config, { ...dependencies, authService });

  function currentAdmin(req) {
    const token = parseCookies(req.headers.cookie ?? '').winemd_admin_session;
    return authService.verifySession(token);
  }

  return async function wineIntelligenceHandler(req, res) {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    if (requestUrl.pathname !== '/api/admin/wine-intelligence/validate') return base(req, res);

    try {
      if (!currentAdmin(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'INVALID_ORIGIN' });
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

      const payload = await readJson(req);
      const query = typeof payload.query === 'string' ? payload.query.trim() : '';
      const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
      if (query.length < 2 || answer.length < 1) {
        return sendJson(res, 422, { error: 'INVALID_VALIDATION_INPUT', message: 'Нужны вопрос и ответ.' });
      }

      const constraints = extractConstraints(query);
      const report = validateConstraints({ query, answer, constraints });
      return sendJson(res, 200, { ok: true, constraints, report });
    } catch (error) {
      const status = error?.code === 'BODY_TOO_LARGE' ? 413 : error?.code === 'INVALID_JSON' ? 422 : 500;
      console.error('[wine-intelligence]', error?.code ?? 'UNKNOWN', error?.message ?? error);
      return sendJson(res, status, { error: error?.code ?? 'WINE_INTELLIGENCE_ERROR', message: error?.message ?? 'Wine Intelligence error' });
    }
  };
}
