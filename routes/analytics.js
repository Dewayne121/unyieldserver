const express = require('express');
const prisma = require('../src/prisma');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_CATEGORIES = new Set([
  'AUTH', 'NAVIGATION', 'WORKOUTS', 'CHALLENGES', 'LEADERBOARDS',
  'SOCIAL', 'MONETIZATION', 'NOTIFICATIONS', 'ERRORS', 'ONBOARDING', 'SYSTEM',
]);

function extractContext(body) {
  const ctx = body._context || {};
  return {
    eventId: ctx.event_id || body.event_id || null,
    userId: ctx.user_id || body.user_id || null,
    anonymousId: ctx.anonymous_id || null,
    sessionId: ctx.session_id || null,
    platform: ctx.platform || null,
    appVersion: ctx.app_version || null,
    osVersion: ctx.os_version || null,
    deviceType: ctx.device_type || null,
    locale: ctx.locale || null,
    timezone: ctx.timezone || null,
    consentState: ctx.consent_state || null,
  };
}

function eventToRow(body) {
  const { _context, event: _evt, ...props } = body;
  const ctx = extractContext(body);
  return {
    eventId: ctx.eventId || `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: body.event || body.name || 'unknown',
    category: body.category || guessCategory(body.event || body.name),
    userId: ctx.userId,
    anonymousId: ctx.anonymousId,
    sessionId: ctx.sessionId,
    platform: ctx.platform,
    appVersion: ctx.appVersion,
    osVersion: ctx.osVersion,
    deviceType: ctx.deviceType,
    locale: ctx.locale,
    timezone: ctx.timezone,
    consentState: ctx.consentState ? JSON.stringify(ctx.consentState) : null,
    properties: JSON.stringify(props),
  };
}

function guessCategory(name) {
  if (!name) return 'SYSTEM';
  const map = {
    user_signed_up: 'AUTH', user_signed_in: 'AUTH', user_signed_out: 'AUTH', user_deleted_account: 'AUTH',
    screen_viewed: 'NAVIGATION',
    workout_started: 'WORKOUTS', workout_completed: 'WORKOUTS', workout_deleted: 'WORKOUTS',
    challenge_viewed: 'CHALLENGES', challenge_joined: 'CHALLENGES', challenge_submitted: 'CHALLENGES',
    leaderboard_viewed: 'LEADERBOARDS', core_lift_submitted: 'LEADERBOARDS',
    profile_viewed: 'SOCIAL', profile_updated: 'SOCIAL',
    purchase_started: 'MONETIZATION', purchase_completed: 'MONETIZATION', purchase_failed: 'MONETIZATION',
    push_permission_requested: 'NOTIFICATIONS', notification_opened: 'NOTIFICATIONS',
    error_seen: 'ERRORS', api_error: 'ERRORS', video_upload_failed: 'ERRORS',
    onboarding_started: 'ONBOARDING', onboarding_completed: 'ONBOARDING',
    app_opened: 'SYSTEM', session_started: 'SYSTEM',
  };
  return map[name] || 'SYSTEM';
}

// ---------------------------------------------------------------------------
// POST /api/analytics/track — single event
// ---------------------------------------------------------------------------
router.post(
  '/track',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const row = eventToRow(req.body);
    try {
      await prisma.analyticsEvent.create({ data: row });
    } catch (err) {
      // Duplicate eventId — ignore
      if (!err.message?.includes('Unique')) {
        throw err;
      }
    }
    res.json({ success: true });
  })
);

// ---------------------------------------------------------------------------
// POST /api/analytics/batch — batch of events
// ---------------------------------------------------------------------------
router.post(
  '/batch',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const events = req.body?.events;
    if (!Array.isArray(events) || events.length === 0) {
      return res.json({ success: true, stored: 0 });
    }

    const rows = events.map(eventToRow);

    // Use createMany with skipDuplicates for dedup
    const result = await prisma.analyticsEvent.createMany({
      data: rows,
      skipDuplicates: true,
    });

    res.json({ success: true, stored: result.count });
  })
);

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/events — list/filter events
// ---------------------------------------------------------------------------
router.get(
  '/events',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { category, name, userId, limit = '100', offset = '0', startDate, endDate } = req.query;

    const where = {};
    if (category) where.category = category;
    if (name) where.name = name;
    if (userId) where.userId = userId;
    if (startDate || endDate) {
      where.receivedAt = {};
      if (startDate) where.receivedAt.gte = new Date(startDate);
      if (endDate) where.receivedAt.lte = new Date(endDate);
    }

    const [events, total] = await Promise.all([
      prisma.analyticsEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: Math.min(parseInt(limit, 10) || 100, 500),
        skip: parseInt(offset, 10) || 0,
      }),
      prisma.analyticsEvent.count({ where }),
    ]);

    // Parse JSON fields for frontend
    const parsed = events.map(e => ({
      ...e,
      properties: safeParseJSON(e.properties),
      consentState: safeParseJSON(e.consentState),
    }));

    res.json({ events: parsed, total });
  })
);

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/funnels — funnel analysis
// ---------------------------------------------------------------------------
router.get(
  '/funnels',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const funnels = buildDefaultFunnels();

    // For each funnel, count distinct users per step
    const results = {};
    for (const funnel of funnels) {
      const steps = [];
      for (let i = 0; i < funnel.steps.length; i++) {
        const stepName = funnel.steps[i];
        const count = await prisma.analyticsEvent.count({
          where: { name: stepName },
        });
        steps.push({ name: stepName, count });
      }
      results[funnel.key] = { steps };
    }

    res.json({ funnels: results });
  })
);

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/retention — cohort retention
// ---------------------------------------------------------------------------
router.get(
  '/retention',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const weeks = parseInt(req.query.weeks, 10) || 8;

    // Get sign-up events grouped by week
    const signUpEvents = await prisma.analyticsEvent.findMany({
      where: { name: 'user_signed_up' },
      select: { userId: true, receivedAt: true },
      orderBy: { receivedAt: 'asc' },
    });

    if (signUpEvents.length === 0) {
      return res.json({ cohorts: [] });
    }

    // Group by signup week
    const cohortMap = {};
    for (const ev of signUpEvents) {
      if (!ev.userId) continue;
      const weekStart = getWeekStart(ev.receivedAt);
      if (!cohortMap[weekStart]) cohortMap[weekStart] = new Set();
      cohortMap[weekStart].add(ev.userId);
    }

    // For each cohort, calculate weekly retention
    const cohorts = [];
    const cohortWeeks = Object.keys(cohortMap).sort();

    for (const cohortWeek of cohortWeeks.slice(-weeks)) {
      const userIds = [...cohortMap[cohortWeek]];
      const size = userIds.length;
      const weekData = { cohort: cohortWeek, size, weeks: { 0: 100 } };

      for (let w = 1; w <= weeks; w++) {
        const weekStart = new Date(cohortWeek);
        weekStart.setDate(weekStart.getDate() + w * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const active = await prisma.analyticsEvent.groupBy({
          by: ['userId'],
          where: {
            userId: { in: userIds },
            receivedAt: { gte: weekStart, lt: weekEnd },
            name: { notIn: ['user_signed_up'] },
          },
        });

        weekData.weeks[w] = size > 0 ? Math.round((active.length / size) * 100) : 0;
      }

      cohorts.push(weekData);
    }

    res.json({ cohorts });
  })
);

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/realtime — recent events for live stream
// ---------------------------------------------------------------------------
router.get(
  '/realtime',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    const [recent, activeNow, topEvents] = await Promise.all([
      // Last 50 events
      prisma.analyticsEvent.findMany({
        orderBy: { receivedAt: 'desc' },
        take: 50,
      }),
      // Active sessions in last 5 min
      prisma.analyticsEvent.groupBy({
        by: ['sessionId'],
        where: { receivedAt: { gte: fiveMinAgo } },
        _count: true,
      }),
      // Top event names in last hour
      prisma.analyticsEvent.groupBy({
        by: ['name'],
        where: { receivedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
        _count: { name: true },
        orderBy: { _count: { name: 'desc' } },
        take: 10,
      }),
    ]);

    const parsed = recent.map(e => ({
      ...e,
      properties: safeParseJSON(e.properties),
      consentState: safeParseJSON(e.consentState),
    }));

    res.json({
      events: parsed,
      activeSessions: activeNow.length,
      topEvents: topEvents.map(t => ({ name: t.name, count: t._count.name })),
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/dau — daily active users line graph data
// ---------------------------------------------------------------------------
router.get(
  '/dau',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);

    const rows = await prisma.$queryRaw`
      SELECT
        DATE("receivedAt") AS day,
        COUNT(DISTINCT COALESCE("userId", "anonymousId")) AS users
      FROM "AnalyticsEvent"
      WHERE "receivedAt" >= NOW() - (${days} || ' days')::interval
      GROUP BY DATE("receivedAt")
      ORDER BY day ASC
    `;

    const data = rows.map(r => ({
      day: r.day instanceof Date ? r.day.toISOString().split('T')[0] : String(r.day),
      users: Number(r.users),
    }));

    // Current online: distinct users with event in last 5 min
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const onlineRows = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT COALESCE("userId", "anonymousId")) AS count
      FROM "AnalyticsEvent"
      WHERE "receivedAt" >= ${fiveMinAgo}
    `;
    const currentOnline = Number(onlineRows[0]?.count || 0);

    res.json({ data, currentOnline });
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function safeParseJSON(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return {}; }
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

function buildDefaultFunnels() {
  return [
    { key: 'signup_to_workout', label: 'Signup → Workout', steps: ['user_signed_up', 'workout_completed'] },
    { key: 'signup_to_challenge', label: 'Signup → Challenge', steps: ['user_signed_up', 'challenge_joined'] },
    { key: 'signup_to_purchase', label: 'Signup → Purchase', steps: ['user_signed_up', 'purchase_completed'] },
    { key: 'challenge_view_to_submit', label: 'Challenge View → Submit', steps: ['challenge_viewed', 'challenge_submitted'] },
  ];
}

// ---------------------------------------------------------------------------
// POST /api/purchases/record — record a purchase from the client
// ---------------------------------------------------------------------------
router.post(
  '/record',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { sku, transactionId, userId } = req.body;
    if (!sku) {
      return res.status(400).json({ success: false, error: 'sku is required' });
    }

    // Store as an analytics event so it shows up in dashboards
    const uid = userId || req.user?.id || null;
    const row = {
      eventId: transactionId || `purch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: 'purchase_completed',
      category: 'MONETIZATION',
      userId: uid,
      sessionId: null,
      properties: JSON.stringify({ sku, transaction_id: transactionId || null }),
      receivedAt: new Date(),
    };

    try {
      await prisma.analyticsEvent.create({ data: row });
    } catch (err) {
      if (!err.message?.includes('Unique')) throw err;
    }

    res.json({ success: true });
  })
);

module.exports = router;
