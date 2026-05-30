const crypto = require('crypto');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

function sameOriginGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.path === '/api/webhook/sepay') return next();

  const source = req.headers.origin || req.headers.referer;
  if (!source) return next();

  try {
    const sourceUrl = new URL(source);
    const host = req.headers.host;
    if (sourceUrl.host === host) return next();
  } catch (_) {
    return res.status(403).json({ success: false, message: 'Nguồn yêu cầu không hợp lệ!' });
  }

  const wantsJson = req.xhr || req.path.startsWith('/api') || req.path.startsWith('/admin/users') || req.path.startsWith('/admin/payments');
  if (wantsJson) return res.status(403).json({ success: false, message: 'Yêu cầu bị chặn vì khác nguồn!' });
  req.flash?.('error', 'Yêu cầu bị chặn vì khác nguồn!');
  return res.redirect('back');
}

function rateLimit({ windowMs, max, keyPrefix = 'rl', methods = null, message = 'Bạn thao tác hơi nhanh, thử lại sau một chút nhé.' }) {
  const hits = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, Math.min(windowMs, 60 * 1000));
  cleanup.unref?.();

  return (req, res, next) => {
    if (methods && !methods.includes(req.method)) return next();

    const now = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count <= max) return next();

    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    if (req.path.startsWith('/api') || req.path.startsWith('/admin/users') || req.path.startsWith('/admin/payments')) {
      return res.status(429).json({ success: false, message });
    }
    req.flash?.('error', message);
    return res.status(429).redirect('back');
  };
}

function stableRef(parts) {
  return crypto
    .createHash('sha256')
    .update(parts.filter(Boolean).map(String).join('|'))
    .digest('hex')
    .slice(0, 32);
}

module.exports = {
  securityHeaders,
  sameOriginGuard,
  rateLimit,
  stableRef
};
