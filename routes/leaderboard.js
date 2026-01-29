const express = require('express');
const prisma = require('../src/prisma');
const { optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { getWeightClassLabel, formatStrengthRatio } = require('../src/utils/strengthRatio');

const router = express.Router();

// GET /api/leaderboard - Get leaderboard by strength ratio
// Now ranks by strengthRatio instead of points
// Supports weight class filtering
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { region = 'Global', weightClass, limit = 50, offset = 0 } = req.query;

  // Build where clause
  const where = {};

  // Region filter
  if (region !== 'Global') {
    where.region = region;
  }

  // Weight class filter
  if (weightClass) {
    where.weightClass = weightClass.toUpperCase();
  } else {
    // Default: exclude users without weight from main leaderboard
    where.weightClass = { not: 'UNCLASSIFIED' };
  }

  const [users, total] = await Promise.all([
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
        // Include legacy points for backward compatibility
        totalPoints: true,
        weeklyPoints: true,
      },
      orderBy: { strengthRatio: 'desc' },
      skip: parseInt(offset),
      take: parseInt(limit),
    }),
    prisma.user.count({ where }),
  ]);

  // Add ranks and format response
  const leaderboard = users.map((user, index) => ({
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
    rank: parseInt(offset) + index + 1,
    // Legacy field for backward compatibility
    points: Math.round((user.strengthRatio || 0) * 100),
  }));

  // Find current user's position
  let currentUserRank = null;
  if (req.user) {
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (currentUser) {
      const userRatio = currentUser.strengthRatio || 0;

      // Check if user qualifies for this filtered view
      const userQualifies = (!weightClass || currentUser.weightClass === weightClass.toUpperCase()) &&
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

  res.json({
    success: true,
    data: {
      leaderboard,
      total,
      currentUser: currentUserRank,
      limit: parseInt(limit),
      offset: parseInt(offset),
      filters: { region, weightClass },
    },
  });
}));

// GET /api/leaderboard/top - Get top users
router.get('/top', asyncHandler(async (req, res) => {
  const { count = 10, region = 'Global' } = req.query;

  const where = region !== 'Global' ? { region } : {};

  const users = await prisma.user.findMany({
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

  const topUsers = users.map((user, index) => ({
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

// GET /api/leaderboard/weekly - Get weekly leaderboard
router.get('/weekly', optionalAuth, asyncHandler(async (req, res) => {
  const { region = 'Global', limit = 50 } = req.query;

  const where = region !== 'Global' ? { region } : {};

  const users = await prisma.user.findMany({
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

  const rankedList = users.map((user, index) => ({
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

// GET /api/leaderboard/monthly - Get monthly competition leaderboard (top 3)
// This is specifically for the Monthly Drop feature
router.get('/monthly', optionalAuth, asyncHandler(async (req, res) => {
  const { region = 'Global' } = req.query;

  const where = region !== 'Global' ? { region } : {};

  // Get top 3 users for monthly podium
  const users = await prisma.user.findMany({
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

  const monthlyPodium = users.map((user, index) => ({
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

  // Also include current user's rank if not in top 3
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

// GET /api/leaderboard/around-me - Get users around current user
router.get('/around-me', optionalAuth, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.json({
      success: true,
      data: [],
    });
  }

  const { region = 'Global', range = 5 } = req.query;

  const currentUser = await prisma.user.findUnique({
    where: { id: req.user.id }
  });
  if (!currentUser) {
    return res.json({
      success: true,
      data: [],
    });
  }

  const where = region !== 'Global' ? { region } : {};

  // Get users above current user
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

  // Get users below current user
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

  // Combine and sort
  const allUsers = [...usersAbove.reverse(), currentUser, ...usersBelow];

  // Calculate ranks
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

// GET /api/leaderboard/weight-classes - Get available weight classes with user counts
router.get('/weight-classes', asyncHandler(async (req, res) => {
  const weightClasses = [
    { id: 'W55_64', label: '55-64 kg', minWeight: 55, maxWeight: 64 },
    { id: 'W65_74', label: '65-74 kg', minWeight: 65, maxWeight: 74 },
    { id: 'W75_84', label: '75-84 kg', minWeight: 75, maxWeight: 84 },
    { id: 'W85_94', label: '85-94 kg', minWeight: 85, maxWeight: 94 },
    { id: 'W95_109', label: '95-109 kg', minWeight: 95, maxWeight: 109 },
    { id: 'W110_PLUS', label: '110+ kg', minWeight: 110, maxWeight: null },
  ];

  // Get user counts per weight class
  const counts = await Promise.all(
    weightClasses.map(async (wc) => {
      const count = await prisma.user.count({
        where: { weightClass: wc.id }
      });
      return { ...wc, userCount: count };
    })
  );

  // Also get count of unclassified users
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
