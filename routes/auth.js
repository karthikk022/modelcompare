const AUTH_HEADER = 'x-api-key';

function requireAuth(req, res, next) {
  const apiKey = process.env.API_KEY || null;
  if (!apiKey) return next();
  const provided = req.headers[AUTH_HEADER] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (provided === apiKey) return next();
  return res.status(401).json({ error: 'Unauthorized — provide x-api-key header or set API_KEY env var' });
}

function isAuthConfigured() {
  return !!process.env.API_KEY;
}

module.exports = { requireAuth, isAuthConfigured };
