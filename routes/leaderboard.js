// ============================================================================
// [ SYSTEM: LEADERBOARD MAINFRAME ]
// [ TYPE: TACTICAL ROUTER ]
// [ DESC: Processes operative ranks, strength ratios, and division intelligence. ]
// ============================================================================

const express = require('express');
const prisma = require('../src/prisma');
const { optionalAuth } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { getWeightClassLabel, formatStrengthRatio } = require('../src/utils/strengthRatio');
const {
  resolveCompetitiveLiftId,
  getCompetitiveLiftById,
  getCompetitiveLiftWorkoutAliases,
} = require('../src/constants/competitiveLifts');

const router = express.Router();

const buildUserWhere = (region, weightClass) => {
  const where = {};

  if (region !== 'Global') {
    where.region = region;
  }

  if (weightClass) {
    where.weightClass = weightClass.toUpperCase();
  } else {
    where.weightClass = { not: 'UNCLASSIFIED' };
  }

  return where;
};

const matchesLeaderboardFilters = (user, region, weightClass) => {
  if (!user) return false;
  if (region !== 'Global' && user.region !== region) return false;
  if (weightClass && user.weightClass !== weightClass.toUpperCase()) return false;
  if (!weightClass && user.weightClass === 'UNCLASSIFIED') return false;
  return true;
};

// ----------------------------------------------------------------------------
// [ GET ] /api/leaderboard
// [ OP ] FETCH MAIN RANKINGS (By Strength Ratio / Weight Class)
// ----------------------------------------------------------------------------
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const {
    region = 'Global',
    weightClass,
    limit = 50,
    offset = 0,
    exercise,
    timeframe = 'all_time',
  } = req.query;
  const parsedLimit = parseInt(limit, 10);
  const parsedOffset = parseInt(offset, 10);
  const limitNum = Number.isFinite(parsedLimit) ? parsedLimit : 50;
  const offsetNum = Number.isFinite(parsedOffset) ? parsedOffset : 0;
  const liftId = resolveCompetitiveLiftId(exercise);

  if (exercise && !liftId) {
    throw new AppError('Invalid exercise. Supported lifts: bench_press, deadlift, squat.', 400);
  }

  if (liftId) {
    const lift = getCompetitiveLiftById(liftId);
    const userWhere = buildUserWhere(region, weightClass);

    const eligibleUsers = await prisma.user.findMany({
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

    const eligibleUserIds = eligibleUsers.map((entry) => entry.id);
    const aliases = getCompetitiveLiftWorkoutAliases(liftId);

    const workoutWhere = {
      userId: { in: eligibleUserIds },
      exercise: { in: aliases },
      weight: { not: null, gt: 0 },
    };

    const challengeWhere = {
      userId: { in: eligibleUserIds },
      exercise: { in: aliases },
      weight: { gt: 0 },
      status: 'approved',
    };

    if (timeframe === 'weekly') {
      const oneWeekAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
      workoutWhere.date = { gte: oneWeekAgo };
      challengeWhere.verifiedAt = { gte: oneWeekAgo };
    }

    const [workouts, challengeSubmissions] = eligibleUserIds.length > 0
      ? await Promise.all([
          prisma.workout.findMany({
            where: workoutWhere,
            select: {
              userId: true,
              weight: true,
              reps: true,
              date: true,
            },
          }),
          prisma.challengeSubmission.findMany({
            where: challengeWhere,
            select: {
              userId: true,
              weight: true,
              reps: true,
              verifiedAt: true,
              createdAt: true,
            },
          }),
        ])
      : [[], []];

    const combinedWorkouts = [
      ...workouts,
      ...challengeSubmissions.map((sub) => ({
        userId: sub.userId,
        weight: sub.weight,
        reps: sub.reps,
        date: sub.verifiedAt || sub.createdAt,
      })),
    ];

    const aggregateByUser = new Map();
    combinedWorkouts.forEach((workout) => {
      const current = aggregateByUser.get(workout.userId);
      const candidateWeight = Number(workout.weight) || 0;
      const candidateReps = workout.reps || 0;

      if (!current) {
        aggregateByUser.set(workout.userId, {
          bestValue: candidateWeight,
          bestReps: candidateReps,
          bestAt: workout.date,
        });
        return;
      }

      const shouldReplace =
        candidateWeight > current.bestValue ||
        (candidateWeight === current.bestValue && candidateReps > current.bestReps);

      if (shouldReplace) {
        aggregateByUser.set(workout.userId, {
          bestValue: candidateWeight,
          bestReps: candidateReps,
          bestAt: workout.date,
        });
      }
    });

    const ranked = eligibleUsers
      .filter((entry) => aggregateByUser.has(entry.id))
      .map((entry) => {
        const aggregate = aggregateByUser.get(entry.id);
        return {
          id: entry.id,
          username: entry.username,
          name: entry.name,
          profileImage: entry.profileImage,
          region: entry.region,
          weight: entry.weight,
          weightClass: entry.weightClass,
          weightClassLabel: getWeightClassLabel(entry.weightClass),
          exercise: lift.id,
          exerciseName: lift.label,
          bestValue: aggregate.bestValue,
          bestReps: aggregate.bestReps,
          bestAt: aggregate.bestAt,
          points: Math.round(aggregate.bestValue),
        };
      })
      .sort((a, b) => {
        if (b.bestValue !== a.bestValue) return b.bestValue - a.bestValue;
        if (b.bestReps !== a.bestReps) return b.bestReps - a.bestReps;
        return new Date(a.bestAt) - new Date(b.bestAt);
      });

    const leaderboard = ranked
      .slice(offsetNum, offsetNum + limitNum)
      .map((entry, index) => ({
        ...entry,
        rank: offsetNum + index + 1,
      }));

    let currentUserRank = null;
    if (req.user) {
      const currentUser = await prisma.user.findUnique({
        where: { id: req.user.id },
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

      if (currentUser) {
        const disqualified = !matchesLeaderboardFilters(currentUser, region, weightClass);
        const rankIndex = ranked.findIndex((entry) => entry.id === currentUser.id);
        const rankedEntry = rankIndex >= 0 ? ranked[rankIndex] : null;

        currentUserRank = {
          id: currentUser.id,
          username: currentUser.username,
          name: currentUser.name,
          profileImage: currentUser.profileImage,
          region: currentUser.region,
          weight: currentUser.weight,
          weightClass: currentUser.weightClass,
          weightClassLabel: getWeightClassLabel(currentUser.weightClass),
          exercise: lift.id,
          exerciseName: lift.label,
          bestValue: rankedEntry?.bestValue || 0,
          bestReps: rankedEntry?.bestReps || 0,
          bestAt: rankedEntry?.bestAt || null,
          rank: rankedEntry ? rankIndex + 1 : null,
          hasEntry: !!rankedEntry,
          disqualified,
          points: rankedEntry ? Math.round(rankedEntry.bestValue) : 0,
        };
      }
    }

    return res.json({
      success: true,
      data: {
        leaderboard,
        total: ranked.length,
        currentUser: currentUserRank,
        limit: limitNum,
        offset: offsetNum,
        metricType: 'max_weight',
        liftUnit: 'kg',
        filters: {
          region,
          weightClass,
          exercise: lift.id,
          timeframe: timeframe === 'weekly' ? 'weekly' : 'all_time',
        },
      },
    });
  }

  // [1] CONSTRUCT TACTICAL FILTERS
  const where = buildUserWhere(region, weightClass);

  // [2] EXECUTE DATABASE QUERY
  const [operatives, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        name: true,
        profileImage: true,
        region: true,
        weight: true,
        weightClass: true,
        strengthRatio: true,
        streak: true,
        accolades: true,
        totalPoints: true, // Legacy points included for system compatibility
        weeklyPoints: true,
      },
      orderBy: { strengthRatio: 'desc' },
      skip: offsetNum,
      take: limitNum,
    }),
    prisma.user.count({ where }),
  ]);

  // [3] PROCESS OPERATIVE DATA
  const leaderboard = operatives.map((user, index) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    profileImage: user.profileImage,
    region: user.region,
    weight: user.weight,
    weightClass: user.weightClass,
    weightClassLabel: getWeightClassLabel(user.weightClass),
    strengthRatio: user.strengthRatio || 0,
    ratioDisplay: formatStrengthRatio(user.strengthRatio),
    streak: user.streak,
    accolades: user.accolades || [],
    rank: offsetNum + index + 1,
    points: Math.round((user.strengthRatio || 0) * 100), // Legacy integration
  }));

  // [4] CALCULATE CURRENT OPERATIVE'S STANDING
  let currentUserRank = null;
  
  if (req.user) {
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (currentUser) {
      const userRatio = currentUser.strengthRatio || 0;

      // Verify if operative is eligible for the current sector view
      const userQualifies = 
        (!weightClass || currentUser.weightClass === weightClass.toUpperCase()) &&
        currentUser.weightClass !== 'UNCLASSIFIED';

      let userPosition = 0;
      if (userQualifies) {
        userPosition = await prisma.user.count({
          where: {
            ...where,
            strengthRatio: { gt: userRatio },
          },
        });
      }

      currentUserRank = {
        id: currentUser.id,
        username: currentUser.username,
        name: currentUser.name,
        profileImage: currentUser.profileImage,
        region: currentUser.region,
        weight: currentUser.weight,
        weightClass: currentUser.weightClass,
        weightClassLabel: getWeightClassLabel(currentUser.weightClass),
        strengthRatio: userRatio,
        ratioDisplay: formatStrengthRatio(userRatio),
        streak: currentUser.streak,
        accolades: currentUser.accolades || [],
        rank: userQualifies ? userPosition + 1 : null,
        points: Math.round(userRatio * 100),
        disqualified: !userQualifies,
      };
    }
  }

  // [5] TRANSMIT PAYLOAD
  res.json({
    success: true,
    data: {
      leaderboard,
      total,
      currentUser: currentUserRank,
      limit: limitNum,
      offset: offsetNum,
      filters: { region, weightClass, exercise: null, timeframe: 'all_time' },
    },
  });
}));

// ----------------------------------------------------------------------------
// [ GET ] /api/leaderboard/top
// [ OP ] FETCH ELITE OPERATIVES (Top 10 Overall)
// ----------------------------------------------------------------------------
router.get('/top', asyncHandler(async (req, res) => {
  const { count = 10, region = 'Global' } = req.query;

  const where = region !== 'Global' ? { region } : {};

  const topOperativesRaw = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      region: true,
      totalPoints: true,
      streak: true,
      accolades: true,
      profileImage: true,
    },
    orderBy: { totalPoints: 'desc' },
    take: parseInt(count),
  });

  const topUsers = topOperativesRaw.map((user, index) => ({
    id: user.id,
    name: user.name,
    profileImage: user.profileImage,
    region: user.region,
    totalPoints: user.totalPoints,
    streak: user.streak,
    accolades: user.accolades || [],
    rank: index + 1,
    points: user.totalPoints,
  }));

  res.json({
    success: true,
    data: topUsers,
  });
}));

// ----------------------------------------------------------------------------
// [ GET ] /api/leaderboard/weekly
// [ OP ] FETCH WEEKLY CAMPAIGN STANDINGS
// ----------------------------------------------------------------------------
router.get('/weekly', optionalAuth, asyncHandler(async (req, res) => {
  const { region = 'Global', limit = 50 } = req.query;

  const where = region !== 'Global' ? { region } : {};

  const weeklyOperativesRaw = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      region: true,
      weeklyPoints: true,
      totalPoints: true,
      profileImage: true,
      accolades: true,
    },
    orderBy: { weeklyPoints: 'desc' },
    take: parseInt(limit),
  });

  const rankedList = weeklyOperativesRaw.map((user, index) => ({
    id: user.id,
    name: user.name,
    profileImage: user.profileImage,
    region: user.region,
    weeklyPoints: user.weeklyPoints,
    totalPoints: user.totalPoints,
    accolades: user.accolades || [],
    rank: index + 1,
    points: user.weeklyPoints,
  }));

  res.json({
    success: true,
    data: rankedList,
  });
}));

// ----------------------------------------------------------------------------
// [ GET ] /api/leaderboard/monthly
// [ OP ] FETCH MONTHLY PODIUM (Top 3 for Supply Drop)
// ----------------------------------------------------------------------------
router.get('/monthly', optionalAuth, asyncHandler(async (req, res) => {
  const { region = 'Global' } = req.query;

  const where = region !== 'Global' ? { region } : {};

  // Extract top 3 operatives for monthly podium deployment
  const podiumOperativesRaw = await prisma.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      name: true,
      profileImage: true,
      region: true,
      totalPoints: true,
      weeklyPoints: true,
      streak: true,
      accolades: true,
    },
    orderBy: { totalPoints: 'desc' },
    take: 3,
  });

  const monthlyPodium = podiumOperativesRaw.map((user, index) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    profileImage: user.profileImage,
    region: user.region,
    totalPoints: user.totalPoints,
    weeklyPoints: user.weeklyPoints,
    streak: user.streak,
    accolades: user.accolades || [],
    rank: index + 1,
    points: user.totalPoints,
  }));

  // Append current user's intel if they are not in the top 3
  let currentUserRank = null;
  if (req.user) {
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id }
    });
    
    if (currentUser) {
      const userPosition = await prisma.user.count({
        where: {
          ...where,
          totalPoints: { gt: currentUser.totalPoints },
        },
      });

      currentUserRank = {
        id: currentUser.id,
        username: currentUser.username,
        name: currentUser.name,
        profileImage: currentUser.profileImage,
        region: currentUser.region,
        totalPoints: currentUser.totalPoints,
        weeklyPoints: currentUser.weeklyPoints,
        streak: currentUser.streak,
        accolades: currentUser.accolades || [],
        rank: userPosition + 1,
        points: currentUser.totalPoints,
      };
    }
  }

  res.json({
    success: true,
    data: {
      leaderboard: monthlyPodium,
      currentUser: currentUserRank,
    },
  });
}));

// ----------------------------------------------------------------------------
// [ GET ] /api/leaderboard/around-me
// [ OP ] RADAR SCAN: FETCH ADJACENT OPERATIVES
// ----------------------------------------------------------------------------
router.get('/around-me', optionalAuth, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.json({ success: true, data: [] });
  }

  const { region = 'Global', range = 5 } = req.query;

  const currentUser = await prisma.user.findUnique({
    where: { id: req.user.id }
  });
  
  if (!currentUser) {
    return res.json({ success: true, data: [] });
  }

  const where = region !== 'Global' ? { region } : {};

  // Scan for operatives ranked higher
  const usersAbove = await prisma.user.findMany({
    where: {
      ...where,
      totalPoints: { gt: currentUser.totalPoints },
    },
    select: {
      id: true,
      name: true,
      region: true,
      totalPoints: true,
      weeklyPoints: true,
      profileImage: true,
    },
    orderBy: { totalPoints: 'asc' },
    take: parseInt(range),
  });

  // Scan for operatives ranked lower
  const usersBelow = await prisma.user.findMany({
    where: {
      ...where,
      id: { not: currentUser.id },
      totalPoints: { lte: currentUser.totalPoints },
    },
    select: {
      id: true,
      name: true,
      region: true,
      totalPoints: true,
      weeklyPoints: true,
      profileImage: true,
    },
    orderBy: { totalPoints: 'desc' },
    take: parseInt(range),
  });

  // Compile full radar sweep
  const allUsers = [...usersAbove.reverse(), currentUser, ...usersBelow];

  // Calculate true positional rank
  const userPosition = await prisma.user.count({
    where: {
      ...where,
      totalPoints: { gt: currentUser.totalPoints },
    },
  });

  const aroundMe = allUsers.map((user, index) => ({
    id: user.id,
    name: user.name,
    profileImage: user.profileImage,
    region: user.region,
    totalPoints: user.totalPoints,
    weeklyPoints: user.weeklyPoints,
    rank: userPosition - usersAbove.length + index + 1,
    isCurrentUser: user.id === currentUser.id,
  }));

  res.json({
    success: true,
    data: aroundMe,
  });
}));

// ----------------------------------------------------------------------------
// [ GET ] /api/leaderboard/weight-classes
// [ OP ] FETCH DIVISION INTEL (Weight Classes)
// ----------------------------------------------------------------------------
router.get('/weight-classes', asyncHandler(async (req, res) => {
  const weightClasses = [
    { id: 'W55_64', label: '55-64 kg', minWeight: 55, maxWeight: 64 },
    { id: 'W65_74', label: '65-74 kg', minWeight: 65, maxWeight: 74 },
    { id: 'W75_84', label: '75-84 kg', minWeight: 75, maxWeight: 84 },
    { id: 'W85_94', label: '85-94 kg', minWeight: 85, maxWeight: 94 },
    { id: 'W95_109', label: '95-109 kg', minWeight: 95, maxWeight: 109 },
    { id: 'W110_PLUS', label: '110+ kg', minWeight: 110, maxWeight: null },
  ];

  // Aggregate troop counts per division
  const counts = await Promise.all(
    weightClasses.map(async (wc) => {
      const count = await prisma.user.count({
        where: { weightClass: wc.id }
      });
      return { ...wc, userCount: count };
    })
  );

  // Isolate unclassified targets
  const unclassifiedCount = await prisma.user.count({
    where: { weightClass: 'UNCLASSIFIED' }
  });

  res.json({
    success: true,
    data: {
      weightClasses: counts,
      unclassifiedCount,
      totalCompeting: counts.reduce((sum, wc) => sum + wc.userCount, 0),
    },
  });
}));

module.exports = router;
