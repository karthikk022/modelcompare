"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require('crypto');
const AUTH_HEADER = 'x-api-key';
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string')
        return false;
    if (a.length !== b.length)
        return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function requireAuth(req, res, next) {
    const apiKey = process.env.API_KEY || null;
    if (!apiKey)
        return next();
    const provided = req.headers[AUTH_HEADER] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (provided && timingSafeEqual(provided, apiKey))
        return next();
    return res.status(401).json({ error: 'Unauthorized — provide x-api-key header or set API_KEY env var' });
}
function isAuthConfigured() {
    return !!process.env.API_KEY;
}
/*
 * CSRF mitigation: validates Origin header on mutation requests when auth is active.
 * Browsers always send the Origin header on cross-origin requests. We already restrict
 * CORS via ALLOWED_ORIGINS, so this is a defense-in-depth check — any origin that
 * survived CORS preflight is also checked here.
 * Notes:
 *   - If ALLOWED_ORIGINS is empty/unset, CSRF check skips (fallback to CORS-only).
 *   - Missing Origin (server-to-server, curl, Postman) is allowed.
 *   - This approach requires zero client changes — the React app works as-is.
 */
function requireCsrf(req, res, next) {
    const apiKey = process.env.API_KEY || null;
    if (!apiKey)
        return next();
    const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (origins.length === 0)
        return next();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.headers['origin'];
        if (origin && !origins.some(o => origin === o || origin.startsWith(o + '/'))) {
            return res.status(403).json({ error: 'CSRF: origin not allowed' });
        }
    }
    next();
}
module.exports = { requireAuth, isAuthConfigured, requireCsrf };
//# sourceMappingURL=auth.js.map