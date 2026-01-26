// Simple in-memory rate limiter

const requestCounts = new Map();

const rateLimiter = (req, res, next) => {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000; // 15 minutes
  const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;

  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, startTime: now });
    return next();
  }

  const record = requestCounts.get(ip);

  // Reset window if expired
  if (now - record.startTime > windowMs) {
    record.count = 1;
    record.startTime = now;
    return next();
  }

  // Check if limit exceeded
  if (record.count >= maxRequests) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests, please try again later',
      retryAfter: Math.ceil((record.startTime + windowMs - now) / 1000),
    });
  }

  record.count++;
  next();
};

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000;

  for (const [ip, record] of requestCounts.entries()) {
    if (now - record.startTime > windowMs) {
      requestCounts.delete(ip);
    }
  }
}, 60000); // Clean up every minute

module.exports = { rateLimiter };
