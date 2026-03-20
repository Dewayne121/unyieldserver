const express = require('express');
const prisma = require('../src/prisma');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { calculateStrengthRatio, getWeightClass, getWeightClassLabel } = require('../src/utils/strengthRatio');
const {
  COMPETITIVE_LIFTS,
  resolveCompetitiveLiftId,
  getCompetitiveLiftById,
  getCompetitiveLiftWorkoutAliases,
} = require('../src/constants/competitiveLifts');

const router = express.Router();

const VALID_LOCATION_TYPES = new Set(['home', 'gym']);
const LOCATION_MARKER_REGEX = /\[loc:(home|gym)\]/i;
const VERIFIED_CORE_MARKER = '[verified:core]';

const normalizeLocationType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return VALID_LOCATION_TYPES.has(normalized) ? normalized : null;
};

const resolveWorkoutLocation = (notes) => {
  const match = String(notes || '').match(LOCATION_MARKER_REGEX);
  if (!match) return 'gym';
  const loc = String(match[1] || '').toLowerCase();
  return VALID_LOCATION_TYPES.has(loc) ? loc : 'gym';
};

const estimate1RM = (weight, reps) => {
  const weightNum = Number(weight) || 0;
  const repsNum = Number(reps) || 0;
  if (weightNum <= 0 || repsNum <= 0) return 0;
  const estimated = weightNum * (1 + repsNum / 30);
  return Math.round(estimated * 1000) / 1000;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const buildUserWhere = ({ region, weightClass }) => {
  const where = {};
  if (region && region !== 'Global') {
    where.region = region;
  }
  if (weightClass) {
    where.weightClass = String(weightClass).toUpperCase();
  }
  return where;
};

const formatLiftRecord = ({ user, aggregate, rank, liftId, liftLabel }) => ({
  userId: user.id,
  id: user.id,
  name: user.name || user.username || 'Unknown',
  username: user.username || null,
  profileImage: user.profileImage || null,
  region: user.region || 'Global',
  weightClass: user.weightClass || 'UNCLASSIFIED',
  weightClassLabel: getWeightClassLabel(user.weightClass),
  weight: user.weight || null,
  liftType: liftId,
  liftLabel,
  estimated1RM: aggregate.estimated1RM,
  bestWeight: aggregate.bestWeight,
  bestReps: aggregate.bestReps,
  locationType: aggregate.locationType,
  verified: true,
  rank,
  createdAt: aggregate.createdAt,
  updatedAt: aggregate.updatedAt,
});

// GET /api/core-lifts/leaderboard
router.get('/leaderboard', optionalAuth, asyncHandler(async (req, res) => {
  const {
    liftType = 'bench_press',
    region = 'Global',
    weightClass = null,
    locationType = null,
    limit = 100,
    offset = 0,
  } = req.query;

  const liftId = resolveCompetitiveLiftId(liftType);
  if (!liftId) {
    throw new AppError('Invalid liftType. Supported lifts: bench_press, deadlift, squat.', 400);
  }

  const locationFilter = normalizeLocationType(locationType);
  if (locationType && !locationFilter) {
    throw new AppError('Invalid locationType. Supported values: home, gym.', 400);
  }

  const parsedLimit = Math.min(parsePositiveInt(limit, 100), 500);
  const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

  const lift = getCompetitiveLiftById(liftId);
  const aliases = getCompetitiveLiftWorkoutAliases(liftId);
  const userWhere = buildUserWhere({ region, weightClass });

  const users = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true,
      username: true,
      name: true,
      profileImage: true,
      region: true,
      weight: true,
      weightClass: true,
    },
  });

  const eligibleUserIds = users.map((entry) => entry.id);
  if (eligibleUserIds.length === 0) {
    return res.json({
      success: true,
      data: {
        leaderboard: [],
        total: 0,
        currentUser: null,
        limit: parsedLimit,
        offset: parsedOffset,
        filters: { liftType: liftId, region, weightClass, locationType: locationFilter },
      },
    });
  }

  const workouts = await prisma.workout.findMany({
    where: {
      userId: { in: eligibleUserIds },
      exercise: { in: aliases },
      weight: { gt: 0 },
      reps: { gt: 0 },
      notes: {
        contains: VERIFIED_CORE_MARKER,
        mode: 'insensitive',
      },
    },
    select: {
      userId: true,
      weight: true,
      reps: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const bestByUser = new Map();
  for (const workout of workouts) {
    const workoutLocation = resolveWorkoutLocation(workout.notes);
    if (locationFilter && workoutLocation !== locationFilter) {
      continue;
    }

    const estimated1RM = estimate1RM(workout.weight, workout.reps);
    if (estimated1RM <= 0) {
      continue;
    }

    const current = bestByUser.get(workout.userId);
    const next = {
      estimated1RM,
      bestWeight: Number(workout.weight) || 0,
      bestReps: Number(workout.reps) || 0,
      locationType: workoutLocation,
      createdAt: workout.createdAt,
      updatedAt: workout.updatedAt,
    };

    if (!current) {
      bestByUser.set(workout.userId, next);
      continue;
    }

    const replace =
      next.estimated1RM > current.estimated1RM ||
      (next.estimated1RM === current.estimated1RM && next.bestWeight > current.bestWeight) ||
      (next.estimated1RM === current.estimated1RM && next.bestWeight === current.bestWeight && next.bestReps > current.bestReps);

    if (replace) {
      bestByUser.set(workout.userId, next);
    }
  }

  const ranked = users
    .filter((entry) => bestByUser.has(entry.id))
    .map((entry) => ({
      user: entry,
      aggregate: bestByUser.get(entry.id),
    }))
    .sort((a, b) => {
      if (b.aggregate.estimated1RM !== a.aggregate.estimated1RM) {
        return b.aggregate.estimated1RM - a.aggregate.estimated1RM;
      }
      if (b.aggregate.bestWeight !== a.aggregate.bestWeight) {
        return b.aggregate.bestWeight - a.aggregate.bestWeight;
      }
      if (b.aggregate.bestReps !== a.aggregate.bestReps) {
        return b.aggregate.bestReps - a.aggregate.bestReps;
      }
      return new Date(a.aggregate.createdAt) - new Date(b.aggregate.createdAt);
    });

  const leaderboard = ranked
    .slice(parsedOffset, parsedOffset + parsedLimit)
    .map((entry, index) => formatLiftRecord({
      user: entry.user,
      aggregate: entry.aggregate,
      rank: parsedOffset + index + 1,
      liftId,
      liftLabel: lift?.label || liftId,
    }));

  let currentUser = null;
  if (req.user?.id) {
    const currentUserIndex = ranked.findIndex((entry) => entry.user.id === req.user.id);
    if (currentUserIndex >= 0) {
      const current = ranked[currentUserIndex];
      currentUser = formatLiftRecord({
        user: current.user,
        aggregate: current.aggregate,
        rank: currentUserIndex + 1,
        liftId,
        liftLabel: lift?.label || liftId,
      });
    }
  }

  res.json({
    success: true,
    data: {
      leaderboard,
      total: ranked.length,
      currentUser,
      limit: parsedLimit,
      offset: parsedOffset,
      filters: { liftType: liftId, region, weightClass, locationType: locationFilter },
    },
  });
}));

// POST /api/core-lifts/submit
router.post('/submit', authenticate, asyncHandler(async (req, res) => {
  const {
    liftType,
    weight,
    reps,
    locationType = 'gym',
    notes = '',
  } = req.body || {};

  const liftId = resolveCompetitiveLiftId(liftType);
  if (!liftId) {
    throw new AppError('Invalid liftType. Supported lifts: bench_press, deadlift, squat.', 400);
  }

  const parsedWeight = Number(weight);
  const parsedReps = parseInt(reps, 10);
  if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
    throw new AppError('Weight must be greater than 0', 400);
  }
  if (!Number.isFinite(parsedReps) || parsedReps <= 0) {
    throw new AppError('Reps must be greater than 0', 400);
  }

  const normalizedLocation = normalizeLocationType(locationType);
  if (!normalizedLocation) {
    throw new AppError('Invalid locationType. Supported values: home, gym.', 400);
  }

  // Prevent duplicate imports when a challenge submission is pushed to core lifts.
  const notesText = String(notes || '');
  const challengeImportMatch = notesText.match(/challenge submission\s+([a-z0-9]+)/i);
  if (challengeImportMatch?.[1]) {
    const submissionId = challengeImportMatch[1];
    const existingImport = await prisma.workout.findFirst({
      where: {
        userId: req.user.id,
        exercise: liftId,
        reps: parsedReps,
        weight: parsedWeight,
        notes: {
          contains: `challenge submission ${submissionId}`,
          mode: 'insensitive',
        },
      },
      select: { id: true },
    });

    if (existingImport) {
      throw new AppError('This challenge submission is already in Core Lifts', 409);
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, weight: true, streakBest: true },
  });
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const locationTag = `[loc:${normalizedLocation}]`;
  const combinedNotes = [locationTag, VERIFIED_CORE_MARKER, String(notes || '').trim()].filter(Boolean).join(' ').trim();
  const estimated1RMValue = estimate1RM(parsedWeight, parsedReps);

  const workout = await prisma.workout.create({
    data: {
      userId: req.user.id,
      exercise: liftId,
      reps: parsedReps,
      weight: parsedWeight,
      notes: combinedNotes || null,
      points: 0,
      strengthRatio: 0,
      date: new Date(),
    },
  });

  // Keep aggregate strength ranking data in sync with workout submissions.
  let strengthRatio = 0;
  if (user.weight && user.weight > 0) {
    strengthRatio = calculateStrengthRatio({
      weightLifted: parsedWeight * parsedReps,
      bodyweight: user.weight,
      reps: parsedReps,
    });
  }

  await prisma.workout.update({
    where: { id: workout.id },
    data: { strengthRatio },
  });

  const allWorkouts = await prisma.workout.findMany({
    where: { userId: req.user.id },
    select: { strengthRatio: true },
  });
  const totalStrengthRatio = allWorkouts.reduce((sum, item) => sum + (item.strengthRatio || 0), 0);

  const weightClass = getWeightClass(user.weight);
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      strengthRatio: totalStrengthRatio,
      weightClass,
      lastWorkoutDate: workout.date,
    },
  });

  res.status(201).json({
    success: true,
    data: {
      workoutId: workout.id,
      liftType: liftId,
      estimated1RM: estimated1RMValue,
      locationType: normalizedLocation,
      strengthRatio,
      totalStrengthRatio,
    },
  });
}));

// GET /api/core-lifts/my-records
router.get('/my-records', authenticate, asyncHandler(async (req, res) => {
  const workouts = await prisma.workout.findMany({
    where: {
      userId: req.user.id,
      weight: { gt: 0 },
      reps: { gt: 0 },
      notes: {
        contains: VERIFIED_CORE_MARKER,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      exercise: true,
      weight: true,
      reps: true,
      notes: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const bestByKey = new Map();
  for (const workout of workouts) {
    const liftId = resolveCompetitiveLiftId(workout.exercise);
    if (!liftId) {
      continue;
    }
    const location = resolveWorkoutLocation(workout.notes);
    const key = `${liftId}:${location}`;
    const estimated1RM = estimate1RM(workout.weight, workout.reps);
    if (estimated1RM <= 0) {
      continue;
    }

    const current = bestByKey.get(key);
    const next = {
      liftType: liftId,
      locationType: location,
      estimated1RM,
      bestWeight: Number(workout.weight) || 0,
      bestReps: Number(workout.reps) || 0,
      createdAt: workout.createdAt,
      workoutId: workout.id,
    };

    if (!current || next.estimated1RM > current.estimated1RM) {
      bestByKey.set(key, next);
    }
  }

  const records = Array.from(bestByKey.values())
    .sort((a, b) => b.estimated1RM - a.estimated1RM);

  const bestByLift = COMPETITIVE_LIFTS.reduce((acc, lift) => {
    const liftRecords = records.filter((record) => record.liftType === lift.id);
    acc[lift.id] = liftRecords.length > 0 ? liftRecords[0] : null;
    return acc;
  }, {});

  res.json({
    success: true,
    data: {
      records,
      bestByLift,
    },
  });
}));

module.exports = router;
