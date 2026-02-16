const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const { connectDB, disconnectDB } = require('./config/database');
const MIN_JWT_SECRET_LENGTH = 32;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
  const message = `JWT_SECRET must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long`;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(message);
  }
  console.warn(`[SECURITY WARNING] ${message}`);
}

// Connect to PostgreSQL
connectDB();

// Initialize scheduled jobs (only in production)
if (process.env.NODE_ENV === 'production') {
  const { initializeWeeklyRankDigest } = require('./jobs/weeklyRankDigest');
  const { initializeChallengeEndingNotifier } = require('./jobs/challengeEndingNotifier');

  initializeWeeklyRankDigest();
  initializeChallengeEndingNotifier();
  console.log('Scheduled jobs initialized');
}

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
  // Allow Expo development URLs when explicitly enabled via ALLOW_EXPO_DEV=true
  // This is opt-in for security - add to Railway environment variables to enable
  if (process.env.ALLOW_EXPO_DEV === 'true') {
    // Expo tunnel URLs (exp:// and https:// protocols)
    if (origin && origin.match(/^(https?|exp):\/\/[a-z0-9-]+\.[a-z0-9-]+\.exp\.direct$/i)) {
      return true;
    }
  }

  // Always allow localhost in non-production for local web development
  if (process.env.NODE_ENV !== 'production' && origin && origin.match(/^https?:\/\/localhost(:\d+)?$/i)) {
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
    if (!origin) {
      return callback(null, true);
    }

    if (allowAllCorsInDev || isOriginAllowed(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`UNYIELDING Server running on http://0.0.0.0:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: PostgreSQL via Prisma`);
  console.log(`Video uploads enabled`);
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    console.log('HTTP server closed.');
    await disconnectDB();
    console.log('Database connection closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
