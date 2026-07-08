const crypto = require('crypto');
const AUTH_HEADER = 'x-api-key';

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function requireAuth(req, res, next) {
  const apiKey = process.env.API_KEY || null;
  if (!apiKey) return next();
  const provided = req.headers[AUTH_HEADER] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (provided && timingSafeEqual(provided, apiKey)) return next();
  return res.status(401).json({ error: 'Unauthorized — provide x-api-key header or set API_KEY env var' });
}

function isAuthConfigured() {
  return !!process.env.API_KEY;
}

/*
 * CSRF mitigation for JSON API: requires X-Requested-With header on mutation requests.
 * Browsers enforce CORS preflight for non-standard headers, so an attacker on a
 * different origin cannot forge this header without a preflight that CORS would block.
 * Combined with API_KEY auth + restricted CORS origins, this closes the remaining
 * CSRF vector for cookie-free API servers.
 */
function requireCsrf(req, res, next) {
  const apiKey = process.env.API_KEY || null;
  if (!apiKey) return next();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const requestedWith = req.headers['x-requested-with'];
    if (requestedWith !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'CSRF: X-Requested-With header required' });
    }
  }
  next();
}

module.exports = { requireAuth, isAuthConfigured, requireCsrf };
