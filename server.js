const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Preserve explicitly provided NODE_ENV (e.g., test runners).
const shouldOverrideEnv = !process.env.NODE_ENV;
const envCandidates = [
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '.env.local'),
];

const loadedEnvFiles = new Set();
envCandidates.forEach((envPath) => {
  if (loadedEnvFiles.has(envPath) || !fs.existsSync(envPath)) {
    return;
  }
  dotenv.config({ path: envPath, override: shouldOverrideEnv });
  loadedEnvFiles.add(envPath);
});

const { connectDB, disconnectDB } = require('./config/database');
const MIN_JWT_SECRET_LENGTH = 32;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
  const message = `JWT_SECRET must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long`;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(message);
  }
  console.warn(`[SECURITY WARNING] ${message}`);
}
const maskDatabaseUrl = (value) => {
  const input = String(value || '');
  if (!input) return '(missing)';
  return input.replace(/\/\/([^:/]+):([^@]+)@/, '//$1:****@');
};

const assertPrimaryDatabaseConfig = () => {
  const databaseUrl = String(process.env.DATABASE_URL || '');
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set. PostgreSQL is the primary database.');
  }
  if (!databaseUrl.toLowerCase().startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must point to PostgreSQL. Non-PostgreSQL primary databases are not supported.');
  }
  console.log(`[DB] Primary database: PostgreSQL (${maskDatabaseUrl(databaseUrl)})`);
};

const maybeSyncUsersFromMongo = async () => {
  const { shouldAttemptMongoUserSync, syncMongoUsersToPostgres } = require('./services/userSyncService');
  if (!shouldAttemptMongoUserSync()) {
    return;
  }

  const thresholdRaw = process.env.MONGO_USER_SYNC_THRESHOLD;
  const threshold = Number.isFinite(Number(thresholdRaw))
    ? Number(thresholdRaw)
    : 20;

  const stats = await syncMongoUsersToPostgres({
    onlyIfPostgresUserCountBelow: threshold,
    logPrefix: '[STARTUP USER SYNC]',
  });
  console.log('[STARTUP USER SYNC] Result:', JSON.stringify(stats));
};

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const workoutRoutes = require('./routes/workouts');
const leaderboardRoutes = require('./routes/leaderboard');
const challengeRoutes = require('./routes/challenges');
const notificationRoutes = require('./routes/notifications');
const videoRoutes = require('./routes/videos');
const adminRoutes = require('./routes/admin');
const adminChallengeRoutes = require('./routes/admin-challenges');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { rateLimiter } = require('./middleware/rateLimiter');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const parseCorsOrigins = () => {
  const raw = process.env.CORS_ORIGINS || '';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const allowedCorsOrigins = parseCorsOrigins();
const allowAllCorsInDev = process.env.NODE_ENV !== 'production' && allowedCorsOrigins.length === 0;
const allowDevTunnelOrigins = process.env.ALLOW_DEV_TUNNEL_ORIGINS !== 'false';
const allowExpoDevOrigins = process.env.NODE_ENV === 'production'
  ? process.env.ALLOW_EXPO_DEV === 'true'
  : process.env.ALLOW_EXPO_DEV !== 'false';
const configuredAllowedHeaders = (process.env.CORS_ALLOWED_HEADERS || '')
  .split(',')
  .map((header) => header.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && allowedCorsOrigins.length === 0) {
  console.warn('[SECURITY WARNING] CORS_ORIGINS is empty in production. Browser origins will be blocked by default.');
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const originPatternToRegex = (pattern) => {
  if (!pattern.includes('*')) {
    return null;
  }
  const source = `^${escapeRegex(pattern).replace(/\\\*/g, '.*')}$`;
  return new RegExp(source);
};

const corsOriginMatchers = allowedCorsOrigins.map((pattern) => ({
  pattern,
  regex: originPatternToRegex(pattern),
}));

const isOriginAllowed = (origin) => {
  if (!origin) {
    return true;
  }

  // Keep tunnel and localhost development clients working across environments unless disabled.
  if (allowDevTunnelOrigins) {
    if (origin.match(/^https?:\/\/localhost(:\d+)?$/i) || origin.match(/^https?:\/\/127\.0\.0\.1(:\d+)?$/i)) {
      return true;
    }
    if (origin.match(/^https:\/\/[a-z0-9-]+\.loca\.lt$/i) || origin.match(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i)) {
      return true;
    }
    // Allow ngrok tunnels for remote development
    if (origin.match(/^https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app$/i) || origin.match(/^https:\/\/[a-z0-9-]+\.ngrok\.io$/i)) {
      return true;
    }
  }

  // Expo dev URLs are allowed by default in non-production, opt-in in production.
  if (allowExpoDevOrigins) {
    if (origin.match(/^(https?|exp):\/\/([a-z0-9-]+\.)+exp\.direct$/i)) {
      return true;
    }
  }

  // Always allow localhost in non-production for local web development
  if (process.env.NODE_ENV !== 'production' && origin.match(/^https?:\/\/localhost(:\d+)?$/i)) {
    return true;
  }

  return corsOriginMatchers.some(({ pattern, regex }) => {
    if (regex) {
      return regex.test(origin);
    }
    return pattern === origin;
  });
};

// Security middleware (but allow video endpoints)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  referrerPolicy: { policy: 'no-referrer' },
}));

// CORS configuration
const corsOptions = {
  origin(origin, callback) {
    // Native mobile apps and server-to-server calls may not include Origin.
    if (allowAllCorsInDev || isOriginAllowed(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: configuredAllowedHeaders.length > 0 ? configuredAllowedHeaders : undefined,
  credentials: false,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Enforce HTTPS when behind a proxy (Railway sets x-forwarded-proto)
if (process.env.NODE_ENV === 'production' && process.env.ENFORCE_HTTPS !== 'false') {
  app.use((req, res, next) => {
    // Always allow platform health checks
    if (req.path === '/health' || req.path === '/api/health') {
      return next();
    }

    const forwardedProto = req.headers['x-forwarded-proto'];
    const primaryForwardedProto = typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : '';

    // If proxy protocol info is unavailable (e.g., internal platform checks),
    // don't block the request at app level.
    if (!primaryForwardedProto) {
      return next();
    }

    if (req.secure || primaryForwardedProto === 'https') {
      return next();
    }
    return res.status(426).json({
      success: false,
      error: 'HTTPS is required',
    });
  });
}

// Request parsing
// Only parse JSON for application/json content type, not for multipart uploads
app.use(express.json({
  limit: '50mb',
  type: 'application/json'
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Log all incoming requests to debug
app.use((req, res, next) => {
  console.log('[REQUEST]', req.method, req.path, {
    hasBody: !!req.body,
    contentType: req.get('content-type'),
    query: req.query
  });
  next();
});

// Rate limiting
app.use(rateLimiter);

// Serve uploaded videos as static files
// DISABLED: Videos now stored in Oracle Cloud Object Storage
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'UNYIELDING API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      healthApi: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      workouts: '/api/workouts',
      leaderboard: '/api/leaderboard',
      challenges: '/api/challenges',
      notifications: '/api/notifications',
      videos: '/api/videos',
      admin: '/api/admin',
      uploads: '/uploads',
    },
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Health check endpoint for platforms expecting /api prefix (e.g., Railway)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/workouts', workoutRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/core-lifts', require('./routes/coreLifts'));
app.use('/api/notifications', notificationRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/challenges', adminChallengeRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server (skip network bind when running tests)
const PORT = process.env.PORT || 3000;
let server = null;

const startServer = async () => {
  assertPrimaryDatabaseConfig();
  await connectDB();

  // Keep PostgreSQL auth in sync with legacy Mongo users for local/dev recovery.
  if (process.env.NODE_ENV === 'development') {
    try {
      await maybeSyncUsersFromMongo();
    } catch (error) {
      console.warn('[STARTUP USER SYNC] Skipped due to error:', error.message);
    }
  }

  // Initialize scheduled jobs only in production.
  if (process.env.NODE_ENV === 'production') {
    const { initializeWeeklyRankDigest } = require('./jobs/weeklyRankDigest');
    const { initializeChallengeEndingNotifier } = require('./jobs/challengeEndingNotifier');

    initializeWeeklyRankDigest();
    initializeChallengeEndingNotifier();
    console.log('Scheduled jobs initialized');
  }

  if (process.env.NODE_ENV !== 'test') {
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`UNYIELDING Server running on http://0.0.0.0:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('Database: PostgreSQL via Prisma (primary)');
      console.log('Video uploads enabled');
    });
  }
};

startServer().catch(async (error) => {
  console.error('Failed to start server:', error);
  try {
    await disconnectDB();
  } catch (disconnectError) {
    console.error('Failed to disconnect database after startup error:', disconnectError);
  }
  process.exit(1);
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      console.log('HTTP server closed.');
      await disconnectDB();
      console.log('Database connection closed.');
      process.exit(0);
    });
    return;
  }
  await disconnectDB();
  console.log('Database connection closed.');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
