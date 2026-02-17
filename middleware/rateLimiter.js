const stores = new Map();

const parseNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
};

const getStore = (name) => {
  if (!stores.has(name)) {
    stores.set(name, new Map());
  }
  return stores.get(name);
};

const createRateLimiter = ({
  name,
  windowMs,
  maxRequests,
  keyGenerator,
  message = 'Too many requests, please try again later',
}) => {
  const store = getStore(name);

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator(req);
    const record = store.get(key);

    if (!record || now - record.startTime > windowMs) {
      store.set(key, { count: 1, startTime: now });
      return next();
    }

    if (record.count >= maxRequests) {
      const retryAfterSeconds = Math.ceil((record.startTime + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: message,
        retryAfter: retryAfterSeconds,
      });
    }

    record.count += 1;
    return next();
  };
};

const globalWindowMs = parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const globalMaxRequests = parseNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 500);
const authWindowMs = parseNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const authMaxRequests = parseNumber(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 30);
const inviteWindowMs = parseNumber(process.env.INVITE_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000);
const inviteMaxRequests = parseNumber(process.env.INVITE_RATE_LIMIT_MAX_REQUESTS, 50);

const rateLimiter = createRateLimiter({
  name: 'global',
  windowMs: globalWindowMs,
  maxRequests: globalMaxRequests,
  keyGenerator: (req) => getClientIp(req),
});

const authRateLimiter = createRateLimiter({
  name: 'auth',
  windowMs: authWindowMs,
  maxRequests: authMaxRequests,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${getClientIp(req)}:${email || 'no-email'}`;
  },
  message: 'Too many authentication attempts, please try again later',
});

const inviteRateLimiter = createRateLimiter({
  name: 'invite',
  windowMs: inviteWindowMs,
  maxRequests: inviteMaxRequests,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : getClientIp(req),
  message: 'Too many invite actions, please try again later',
});

// Clean up old entries periodically
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  const maxWindow = Math.max(globalWindowMs, authWindowMs, inviteWindowMs);

  for (const store of stores.values()) {
    for (const [key, record] of store.entries()) {
      if (now - record.startTime > maxWindow) {
        store.delete(key);
      }
    }
  }
}, 60 * 1000);

if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

module.exports = {
  rateLimiter,
  authRateLimiter,
  inviteRateLimiter,
};
