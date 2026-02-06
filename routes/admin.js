const express = require('express');
const prisma = require('../src/prisma');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requireSuperAdmin, logAdminAction, isSuperAdmin } = require('../middleware/admin');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { REGIONS, GOALS, ACCOLADES } = require('../services/userService');
const { sendPushNotification } = require('../services/notificationService');
const { getWeightClass } = require('../src/utils/strengthRatio');

const router = express.Router();

const VALID_NOTIFICATION_TYPES = new Set([
  'rank_up',
  'rank_down',
  'streak_milestone',
  'new_challenge',
  'challenge_ending',
  'challenge_complete',
  'welcome',
]);
const DEFAULT_NOTIFICATION_TYPE = 'welcome';
const NOTIFICATION_CHUNK_SIZE = 50;

const normalizeNotificationType = (type) => {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return DEFAULT_NOTIFICATION_TYPE;
  return VALID_NOTIFICATION_TYPES.has(normalized) ? normalized : DEFAULT_NOTIFICATION_TYPE;
};

const sanitizeNotificationData = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data;
};

const sendAdminNotifications = async ({
  users,
  requestedType,
  normalizedType,
  title,
  message,
  adminUser,
  extraData = {},
  recipientMode = 'direct',
}) => {
  let createdCount = 0;
  let pushAttempted = 0;
  let pushSent = 0;

  for (let i = 0; i < users.length; i += NOTIFICATION_CHUNK_SIZE) {
    const chunk = users.slice(i, i + NOTIFICATION_CHUNK_SIZE);
    // Process a bounded batch in parallel to avoid overwhelming Expo or DB connections.
    const chunkResults = await Promise.all(chunk.map(async (user) => {
      const data = {
        ...extraData,
        source: 'admin_panel',
        recipientMode,
        screen: 'Notifications',
        requestedType: requestedType || DEFAULT_NOTIFICATION_TYPE,
        sentByAdminId: adminUser?.id || null,
        sentByAdminName: adminUser?.name || null,
      };

      const notification = await prisma.notification.create({
        data: {
          userId: user.id,
          type: normalizedType,
          title,
          message,
          read: false,
          data,
        },
      });

      if (!user.pushToken) {
        return { created: true, pushAttempted: false, pushSent: false };
      }

      const sent = await sendPushNotification(
        user.pushToken,
        title,
        message,
        data,
        notification.id
      );

      return { created: true, pushAttempted: true, pushSent: sent };
    }));

    for (const result of chunkResults) {
      if (result.created) createdCount++;
      if (result.pushAttempted) pushAttempted++;
      if (result.pushSent) pushSent++;
    }
  }

  return { createdCount, pushAttempted, pushSent };
};

// ============================================================================
// DASHBOARD & ANALYTICS
// ============================================================================

// GET /api/admin/stats - Get platform-wide statistics
router.get('/stats', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // User stats
  const [totalUsers, newUsersToday, newUsersWeek, newUsersMonth] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
  ]);

  // Active users (users who logged workout in last 7 days)
  // Get distinct user IDs from workouts
  const activeWorkouts = await prisma.workout.findMany({
    where: { date: { gte: weekAgo } },
    select: { userId: true },
    distinct: ['userId'],
  });
  const activeUsersCount = activeWorkouts.length;

  // Workout stats
  const [totalWorkouts, workoutsToday, workoutsWeek, workoutsMonth] = await Promise.all([
    prisma.workout.count(),
    prisma.workout.count({ where: { date: { gte: today } } }),
    prisma.workout.count({ where: { date: { gte: weekAgo } } }),
    prisma.workout.count({ where: { date: { gte: monthAgo } } }),
  ]);

  // Video stats
  const [totalVideos, pendingVideos, approvedVideos, rejectedVideos, videosToday] = await Promise.all([
    prisma.videoSubmission.count(),
    prisma.videoSubmission.count({ where: { status: 'pending' } }),
    prisma.videoSubmission.count({ where: { status: 'approved' } }),
    prisma.videoSubmission.count({ where: { status: 'rejected' } }),
    prisma.videoSubmission.count({ where: { createdAt: { gte: today } } }),
  ]);

  // Report & Appeal stats
  const [pendingReports, pendingAppeals] = await Promise.all([
    prisma.report.count({ where: { status: 'pending' } }),
    prisma.appeal.count({ where: { status: 'pending' } }),
  ]);

  // Points awarded - use Prisma aggregate
  const totalPointsResult = await prisma.user.aggregate({
    _sum: { totalPoints: true },
  });
  const totalPointsAwarded = totalPointsResult._sum.totalPoints || 0;

  const pointsTodayResult = await prisma.videoSubmission.aggregate({
    _sum: { pointsAwarded: true },
    where: {
      status: 'approved',
      createdAt: { gte: today },
    },
  });
  const pointsToday = pointsTodayResult._sum.pointsAwarded || 0;

  // Active challenges
  const activeChallenges = await prisma.challenge.count({
    where: { isActive: true }
  });

  // User growth by month (last 12 months)
  const userGrowth = [];
  for (let i = 11; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const count = await prisma.user.count({
      where: {
        createdAt: { gte: monthStart, lte: monthEnd }
      },
    });
    userGrowth.push({
      month: monthStart.toLocaleString('default', { month: 'short', year: '2-digit' }),
      count
    });
  }

  // Workout activity by month (last 12 months)
  const workoutActivity = [];
  for (let i = 11; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const count = await prisma.workout.count({
      where: {
        date: { gte: monthStart, lte: monthEnd }
      },
    });
    workoutActivity.push({
      month: monthStart.toLocaleString('default', { month: 'short', year: '2-digit' }),
      count
    });
  }

  // Region distribution - use Prisma groupBy
  const regionDistributionRaw = await prisma.user.groupBy({
    by: ['region'],
    _count: { id: true },
  });
  const regionDistribution = regionDistributionRaw
    .map(r => ({ _id: r.region, count: r._count.id }))
    .sort((a, b) => b.count - a.count);

  // Top users by points
  const topUsers = await prisma.user.findMany({
    orderBy: { totalPoints: 'desc' },
    take: 10,
    select: {
      id: true,
      name: true,
      username: true,
      totalPoints: true,
      weeklyPoints: true,
      streak: true,
      region: true,
      profileImage: true,
    },
  });

  res.json({
    success: true,
    data: {
      users: {
        total: totalUsers,
        newToday: newUsersToday,
        newWeek: newUsersWeek,
        newMonth: newUsersMonth,
        active: activeUsersCount,
      },
      workouts: {
        total: totalWorkouts,
        today: workoutsToday,
        week: workoutsWeek,
        month: workoutsMonth,
      },
      videos: {
        total: totalVideos,
        pending: pendingVideos,
        approved: approvedVideos,
        rejected: rejectedVideos,
        today: videosToday,
      },
      moderation: {
        pendingReports,
        pendingAppeals,
      },
      points: {
        totalAwarded,
        today: pointsToday,
      },
      challenges: {
        active: activeChallenges,
      },
      userGrowth,
      workoutActivity,
      regionDistribution,
      topUsers,
    },
  });
}));

// ============================================================================
// USER MANAGEMENT
// ============================================================================

// Helper to format user response with all details
const formatUserDetailResponse = async (user) => {
  // Get user's workout count
  const workoutCount = await prisma.workout.count({
    where: { userId: user.id }
  });

  // Get user's video submissions stats
  const videoStatsRaw = await prisma.videoSubmission.groupBy({
    by: ['status'],
    where: { userId: user.id },
    _count: { id: true },
  });

  const videoStats = { pending: 0, approved: 0, rejected: 0 };
  videoStatsRaw.forEach(stat => {
    videoStats[stat.status] = stat._count.id;
  });

  const totalVideos = await prisma.videoSubmission.count({
    where: { userId: user.id }
  });

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    profileImage: user.profileImage,
    region: user.region,
    goal: user.goal,
    bio: user.bio || '',
    accolades: user.accolades || [],
    provider: user.provider,
    weight: user.weight,
    height: user.height,
    age: user.age,
    weightClass: user.weightClass,
    strengthRatio: user.strengthRatio,
    totalPoints: user.totalPoints,
    weeklyPoints: user.weeklyPoints,
    rank: user.rank,
    streak: user.streak,
    streakBest: user.streakBest,
    lastWorkoutDate: user.lastWorkoutDate,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    workoutCount,
    videos: {
      total: totalVideos,
      ...videoStats,
    },
  };
};

// GET /api/admin/users - List all users with pagination and filters
router.get('/users', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search = '',
    region = '',
    accolade = '',
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Build query
  const where = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { username: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (region && region !== 'all') {
    where.region = region;
  }

  if (accolade && accolade !== 'all') {
    where.accolades = { has: accolade };
  }

  // Build sort
  const orderBy = {};
  orderBy[sortBy] = sortOrder === 'asc' ? 'asc' : 'desc';

  // Execute query
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip,
      take: parseInt(limit),
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        profileImage: true,
        region: true,
        totalPoints: true,
        weeklyPoints: true,
        rank: true,
        streak: true,
        accolades: true,
        provider: true,
        createdAt: true,
        lastWorkoutDate: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      users: users.map(user => ({
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        profileImage: user.profileImage,
        region: user.region,
        totalPoints: user.totalPoints,
        weeklyPoints: user.weeklyPoints,
        rank: user.rank,
        streak: user.streak,
        accolades: user.accolades || [],
        provider: user.provider,
        createdAt: user.createdAt,
        lastWorkoutDate: user.lastWorkoutDate,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
}));

// GET /api/admin/users/:id - Get detailed user info
router.get('/users/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      profileImage: true,
      region: true,
      goal: true,
      bio: true,
      accolades: true,
      provider: true,
      totalPoints: true,
      weeklyPoints: true,
      rank: true,
      streak: true,
      streakBest: true,
      lastWorkoutDate: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  const userData = await formatUserDetailResponse(user);

  // Get recent workouts
  const recentWorkouts = await prisma.workout.findMany({
    where: { userId: user.id },
    orderBy: { date: 'desc' },
    take: 10,
  });

  // Get recent video submissions
  const recentVideos = await prisma.videoSubmission.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      verifiedBy: {
        select: { id: true, name: true, username: true },
      },
    },
  });

  // Get audit log for this user
  const auditLog = await prisma.adminAction.findMany({
    where: {
      targetType: 'user',
      targetId: user.id,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      admin: {
        select: { id: true, name: true, username: true },
      },
    },
  });

  res.json({
    success: true,
    data: {
      user: userData,
      recentWorkouts,
      recentVideos,
      auditLog,
    },
  });
}));

// PATCH /api/admin/users/:id - Update user (admin only)
router.patch('/users/:id',
  authenticate,
  requireAdmin,
  logAdminAction('user_updated', 'user', ':id', null),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const allowedUpdates = ['name', 'username', 'email', 'region', 'goal', 'bio', 'profileImage', 'accolades', 'weight', 'height', 'age', 'totalPoints', 'weeklyPoints', 'rank', 'streak', 'streakBest'];

    // Store changes for audit log
    const changes = {};

    const updateData = {};

    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        // Special handling for accolades - only super admin can modify
        if (key === 'accolades' && !isSuperAdmin(req.adminUser)) {
          continue;
        }

        // Validate region
        if (key === 'region' && !REGIONS.includes(req.body[key])) {
          throw new AppError(`Invalid region. Must be one of: ${REGIONS.join(', ')}`, 400);
        }

        // Validate goal
        if (key === 'goal' && !GOALS.includes(req.body[key])) {
          throw new AppError(`Invalid goal. Must be one of: ${GOALS.join(', ')}`, 400);
        }

        // Validate accolades
        if (key === 'accolades') {
          if (!Array.isArray(req.body[key])) {
            throw new AppError('Accolades must be an array', 400);
          }
          for (const acc of req.body[key]) {
            if (!ACCOLADES.includes(acc)) {
              throw new AppError(`Invalid accolade: ${acc}`, 400);
            }
          }
        }

        // Track changes
        if (JSON.stringify(user[key]) !== JSON.stringify(req.body[key])) {
          changes[key] = {
            from: user[key],
            to: req.body[key],
          };
        }

        updateData[key] = req.body[key];
      }
    }

    // Calculate weightClass if weight is being updated
    if (updateData.weight !== undefined) {
      const weightKg = updateData.weight;
      updateData.weightClass = weightKg && weightKg > 0 ? getWeightClass(weightKg) : 'UNCLASSIFIED';
    }

    // Update the request's admin action data with changes
    if (req.adminActionData) {
      req.adminActionData.details = changes;
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json({
      success: true,
      data: await formatUserDetailResponse(updatedUser),
    });
}));

// DELETE /api/admin/users/:id - Delete user (super admin only)
router.delete('/users/:id',
  authenticate,
  requireSuperAdmin,
  logAdminAction('user_deleted', 'user', ':id', null),
  asyncHandler(async (req, res) => {
    const userId = req.params.id;

    // Cannot delete yourself
    if (userId === req.user.id) {
      throw new AppError('Cannot delete your own account through admin panel', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Store user info for audit log
    if (req.adminActionData) {
      req.adminActionData.details = {
        userName: user.name,
        username: user.username,
        email: user.email,
      };
    }

    // Delete the user - cascading deletes will handle related records
    await prisma.user.delete({
      where: { id: userId }
    });

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  }));

// POST /api/admin/users/:id/accolades - Add accolade to user (super admin only)
router.post('/users/:id/accolades',
  authenticate,
  requireSuperAdmin,
  logAdminAction('accolade_added', 'user', ':id', null),
  asyncHandler(async (req, res) => {
    const { accolade } = req.body;

    if (!accolade) {
      throw new AppError('Accolade is required', 400);
    }

    if (!ACCOLADES.includes(accolade)) {
      throw new AppError(`Invalid accolade. Must be one of: ${ACCOLADES.join(', ')}`, 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const currentAccolades = user.accolades || [];
    if (currentAccolades.includes(accolade)) {
      throw new AppError('User already has this accolade', 400);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        accolades: [...currentAccolades, accolade],
      },
    });

    if (req.adminActionData) {
      req.adminActionData.details = { accolade, newAccolades: updatedUser.accolades };
    }

    res.json({
      success: true,
      data: { accolades: updatedUser.accolades },
    });
  }));

// DELETE /api/admin/users/:id/accolades/:accolade - Remove accolade from user (super admin only)
router.delete('/users/:id/accolades/:accolade',
  authenticate,
  requireSuperAdmin,
  logAdminAction('accolade_removed', 'user', ':id', null),
  asyncHandler(async (req, res) => {
    const { accolade } = req.params;

    if (!ACCOLADES.includes(accolade)) {
      throw new AppError(`Invalid accolade`, 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const currentAccolades = user.accolades || [];
    if (!currentAccolades.includes(accolade)) {
      throw new AppError('User does not have this accolade', 400);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        accolades: currentAccolades.filter(a => a !== accolade),
      },
    });

    if (req.adminActionData) {
      req.adminActionData.details = { accolade, newAccolades: updatedUser.accolades };
    }

    res.json({
      success: true,
      data: { accolades: updatedUser.accolades },
    });
}));

// ============================================================================
// VIDEO MODERATION (ENHANCED)
// ============================================================================

// GET /api/admin/videos/pending - Get all pending videos with enhanced info
router.get('/videos/pending', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  console.log('[ADMIN VIDEO] Fetching pending videos...');
  const { page = 1, limit = 20, exercise = '' } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = { status: 'pending' };

  if (exercise) {
    where.exercise = { contains: exercise, mode: 'insensitive' };
  }

  console.log('[ADMIN VIDEO] Query:', JSON.stringify(where));

  const [videos, total] = await Promise.all([
    prisma.videoSubmission.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip,
      take: parseInt(limit),
      include: {
        user: {
          select: { id: true, name: true, username: true, profileImage: true, region: true, accolades: true },
        },
        workout: {
          select: { id: true, exercise: true, reps: true, weight: true },
        },
      },
    }),
    prisma.videoSubmission.count({ where }),
  ]);

  console.log('[ADMIN VIDEO] Found:', {
    count: videos.length,
    total,
    page,
    limit
  });

  // Log video details
  videos.forEach((v, i) => {
    console.log(`[ADMIN VIDEO] Video ${i + 1}:`, {
      id: v.id,
      exercise: v.exercise,
      reps: v.reps,
      user: v.user?.username,
      videoUrl: v.videoUrl?.substring(0, 50) + '...'
    });
  });

  res.json({
    success: true,
    data: {
      videos: videos.map(v => ({
        id: v.id,
        user: v.user,
        workout: v.workout,
        exercise: v.exercise,
        reps: v.reps,
        weight: v.weight,
        duration: v.duration,
        points: v.points,
        pointsAwarded: v.pointsAwarded,
        videoUrl: v.videoUrl,
        thumbnailUrl: v.thumbnailUrl,
        status: v.status,
        verifiedByName: v.verifiedByName,
        verifiedById: v.verifiedById,
        verifiedAt: v.verifiedAt,
        rejectionReason: v.rejectionReason,
        createdAt: v.createdAt,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
  console.log('[ADMIN VIDEO] Response sent with', videos.length, 'videos');
}));

// GET /api/admin/videos/:id - Get video with full details for moderation
router.get('/videos/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const video = await prisma.videoSubmission.findUnique({
    where: { id: req.params.id },
    include: {
      user: {
        select: { id: true, name: true, username: true, profileImage: true, region: true, accolades: true, totalPoints: true, streak: true },
      },
      verifiedBy: {
        select: { id: true, name: true, username: true },
      },
      workout: {
        select: { id: true, exercise: true, reps: true, weight: true },
      },
    },
  });

  if (!video) {
    throw new AppError('Video not found', 404);
  }

  // Get user's video history
  const userVideoHistory = await prisma.videoSubmission.findMany({
    where: {
      userId: video.userId,
      status: { in: ['approved', 'rejected'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      verifiedBy: {
        select: { id: true, name: true, username: true },
      },
    },
  });

  // Get any reports on this video
  const reports = await prisma.report.findMany({
    where: { videoSubmissionId: video.id },
    orderBy: { createdAt: 'desc' },
    include: {
      reporter: {
        select: { id: true, name: true, username: true },
      },
    },
  });

  // Get any appeals on this video
  const appeal = await prisma.appeal.findFirst({
    where: { videoSubmissionId: video.id },
    include: {
      user: {
        select: { id: true, name: true, username: true },
      },
    },
  });

  res.json({
    success: true,
    data: {
      video,
      userVideoHistory,
      reports,
      appeal,
    },
  });
}));

// POST /api/admin/videos/:id/verify - Verify video with enhanced logging
router.post('/videos/:id/verify',
  authenticate,
  requireAdmin,
  logAdminAction('video_approved', 'video', ':id', null),
  asyncHandler(async (req, res) => {
    const { action, rejectionReason, pointsAwarded } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      throw new AppError('Action must be approve or reject', 400);
    }

    const video = await prisma.videoSubmission.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: { id: true, name: true, username: true },
        },
      },
    });

    if (!video) {
      throw new AppError('Video not found', 404);
    }

    if (video.status !== 'pending') {
      throw new AppError('Video has already been verified', 400);
    }

    // Check if user exists (handle orphan videos from deleted accounts)
    if (!video.user) {
      // Delete orphan video and return success
      await prisma.videoSubmission.delete({
        where: { id: req.params.id }
      });
      return res.json({
        success: true,
        message: 'Orphan video removed (user account was deleted)',
        data: { deleted: true },
      });
    }

    // Cannot verify your own submission
    if (video.userId === req.user.id) {
      throw new AppError('You cannot verify your own submission', 400);
    }

    const updateData = {
      status: action === 'approve' ? 'approved' : 'rejected',
      verifiedById: req.adminUser.id,
      verifiedByName: req.adminUser.name,
      verifiedAt: new Date(),
    };

    if (action === 'reject') {
      updateData.rejectionReason = rejectionReason || 'No reason provided';
      updateData.pointsAwarded = 0;
    } else if (pointsAwarded !== undefined) {
      updateData.pointsAwarded = parseInt(pointsAwarded) || 0;
    }

    const updatedVideo = await prisma.videoSubmission.update({
      where: { id: req.params.id },
      data: updateData,
    });

    // Update action type and details for audit log
    if (req.adminActionData) {
      req.adminActionData.action = action === 'approve' ? 'video_approved' : 'video_rejected';
      req.adminActionData.details = {
        action,
        exercise: video.exercise,
        reps: video.reps,
        weight: video.weight,
        userId: video.userId,
        userName: video.user.name || 'Unknown',
        rejectionReason,
        pointsAwarded: updatedVideo.pointsAwarded,
      };
    }

    res.json({
      success: true,
      data: updatedVideo,
    });
  }));

// ============================================================================
// APPEALS MANAGEMENT
// ============================================================================

// GET /api/admin/appeals - Get all appeals with filtering
router.get('/appeals', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { status = 'pending', page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status !== 'all') {
    where.status = status;
  }

  const [appeals, total] = await Promise.all([
    prisma.appeal.findMany({
      where,
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      skip,
      take: parseInt(limit),
      include: {
        user: {
          select: { id: true, name: true, username: true, profileImage: true },
        },
        videoSubmission: {
          select: { id: true, exercise: true, reps: true, weight: true, videoUrl: true },
        },
        reviewedBy: {
          select: { id: true, name: true, username: true },
        },
      },
    }),
    prisma.appeal.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      appeals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
}));

// GET /api/admin/appeals/:id - Get appeal details
router.get('/appeals/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const appeal = await prisma.appeal.findUnique({
    where: { id: req.params.id },
    include: {
      user: {
        select: { id: true, name: true, username: true, profileImage: true, region: true, totalPoints: true },
      },
      videoSubmission: {
        select: { id: true, exercise: true, reps: true, weight: true, videoUrl: true, status: true },
      },
      reviewedBy: {
        select: { id: true, name: true, username: true },
      },
    },
  });

  if (!appeal) {
    throw new AppError('Appeal not found', 404);
  }

  // Get user's video history
  const userVideoHistory = await prisma.videoSubmission.findMany({
    where: {
      userId: appeal.userId,
      status: { in: ['approved', 'rejected'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  res.json({
    success: true,
    data: {
      appeal,
      userVideoHistory,
    },
  });
}));

// POST /api/admin/appeals/:id/review - Review appeal
router.post('/appeals/:id/review',
  authenticate,
  requireAdmin,
  logAdminAction('appeal_approved', 'appeal', ':id', null),
  asyncHandler(async (req, res) => {
    const { action, reviewNotes } = req.body;

    if (!['approve', 'deny'].includes(action)) {
      throw new AppError('Action must be approve or deny', 400);
    }

    const appeal = await prisma.appeal.findUnique({
      where: { id: req.params.id },
      include: {
        videoSubmission: {
          select: { id: true },
        },
      },
    });

    if (!appeal) {
      throw new AppError('Appeal not found', 404);
    }

    if (appeal.status !== 'pending') {
      throw new AppError('Appeal has already been reviewed', 400);
    }

    const updatedAppeal = await prisma.appeal.update({
      where: { id: req.params.id },
      data: {
        status: action === 'approve' ? 'approved' : 'denied',
        reviewedById: req.adminUser.id,
        reviewedByName: req.adminUser.name,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes || '',
      },
    });

    // Update action type and details for audit log
    if (req.adminActionData) {
      req.adminActionData.action = action === 'approve' ? 'appeal_approved' : 'appeal_denied';
      req.adminActionData.details = {
        action,
        userId: appeal.userId,
        videoId: appeal.videoSubmissionId,
        reviewNotes,
      };
    }

    // If appeal approved, update the video submission status
    if (action === 'approve') {
      await prisma.videoSubmission.update({
        where: { id: appeal.videoSubmissionId },
        data: {
          status: 'approved',
          verifiedById: req.adminUser.id,
          verifiedByName: req.adminUser.name,
          verifiedAt: new Date(),
          rejectionReason: null,
        },
      });
    }

    res.json({
      success: true,
      data: updatedAppeal,
    });
  }));

// ============================================================================
// REPORTS MANAGEMENT
// ============================================================================

// GET /api/admin/reports - Get all reports with filtering
router.get('/reports', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { status = 'pending', reportType = '', page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status !== 'all') {
    where.status = status;
  }
  if (reportType) {
    where.reportType = reportType;
  }

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      skip,
      take: parseInt(limit),
      include: {
        reporter: {
          select: { id: true, name: true, username: true },
        },
        videoSubmission: {
          select: { id: true, exercise: true, reps: true, weight: true, videoUrl: true },
        },
        reviewedBy: {
          select: { id: true, name: true, username: true },
        },
      },
    }),
    prisma.report.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      reports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
}));

// POST /api/admin/reports/:id/review - Review report
router.post('/reports/:id/review',
  authenticate,
  requireAdmin,
  logAdminAction('report_resolved', 'report', ':id', null),
  asyncHandler(async (req, res) => {
    const { action, reviewNotes, actionTaken } = req.body;

    if (!['resolve', 'dismiss'].includes(action)) {
      throw new AppError('Action must be resolve or dismiss', 400);
    }

    const report = await prisma.report.findUnique({
      where: { id: req.params.id }
    });

    if (!report) {
      throw new AppError('Report not found', 404);
    }

    if (report.status !== 'pending') {
      throw new AppError('Report has already been reviewed', 400);
    }

    const updatedReport = await prisma.report.update({
      where: { id: req.params.id },
      data: {
        status: action === 'resolve' ? 'resolved' : 'dismissed',
        reviewedById: req.adminUser.id,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes || '',
        actionTaken: actionTaken || 'no_action',
      },
    });

    // Update action type and details for audit log
    if (req.adminActionData) {
      req.adminActionData.action = action === 'resolve' ? 'report_resolved' : 'report_dismissed';
      req.adminActionData.details = {
        action,
        reportType: report.reportType,
        actionTaken: updatedReport.actionTaken,
        reviewNotes,
      };
    }

    // If resolved and action is to reject the video
    if (action === 'resolve' && actionTaken === 'video_removed') {
      await prisma.videoSubmission.update({
        where: { id: report.videoSubmissionId },
        data: {
          status: 'rejected',
          verifiedById: req.adminUser.id,
          verifiedByName: req.adminUser.name,
          verifiedAt: new Date(),
          rejectionReason: 'Rejected due to report: ' + report.reportType,
        },
      });
    }

    res.json({
      success: true,
      data: updatedReport,
    });
  }));

// ============================================================================
// NOTIFICATION MANAGEMENT
// ============================================================================

// POST /api/admin/notifications/send - Send notification to user(s)
router.post('/notifications/send',
  authenticate,
  requireAdmin,
  logAdminAction('notification_sent', 'notification', null, null),
  asyncHandler(async (req, res) => {
    const { userIds, type, title, message, data } = req.body;

    if (!title || !message) {
      throw new AppError('Title and message are required', 400);
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new AppError('userIds must be a non-empty array', 400);
    }

    const titleValue = String(title).trim();
    const messageValue = String(message).trim();
    if (!titleValue || !messageValue) {
      throw new AppError('Title and message cannot be empty', 400);
    }

    const uniqueUserIds = [...new Set(userIds
      .map(id => String(id || '').trim())
      .filter(Boolean))];

    if (uniqueUserIds.length === 0) {
      throw new AppError('No valid user IDs provided', 400);
    }

    const requestedType = String(type || '').trim().toLowerCase();
    const normalizedType = normalizeNotificationType(requestedType);

    const users = await prisma.user.findMany({
      where: { id: { in: uniqueUserIds } },
      select: {
        id: true,
        pushToken: true,
      },
    });

    if (users.length === 0) {
      throw new AppError('No users found for the provided IDs', 404);
    }

    const foundUserIds = new Set(users.map(u => u.id));
    const missingUserIds = uniqueUserIds.filter(id => !foundUserIds.has(id));

    const result = await sendAdminNotifications({
      users,
      requestedType,
      normalizedType,
      title: titleValue,
      message: messageValue,
      adminUser: req.adminUser,
      extraData: sanitizeNotificationData(data),
      recipientMode: 'direct',
    });

    if (req.adminActionData) {
      req.adminActionData.details = {
        recipientCount: users.length,
        missingRecipients: missingUserIds.length,
        requestedType: requestedType || DEFAULT_NOTIFICATION_TYPE,
        storedType: normalizedType,
        title: titleValue,
        pushAttempted: result.pushAttempted,
        pushSent: result.pushSent,
      };
    }

    res.json({
      success: true,
      message: `Notification sent to ${users.length} user(s)`,
      data: {
        recipientCount: users.length,
        missingUserIds,
        requestedType: requestedType || DEFAULT_NOTIFICATION_TYPE,
        storedType: normalizedType,
        pushAttempted: result.pushAttempted,
        pushSent: result.pushSent,
      },
    });
  }));

// POST /api/admin/notifications/broadcast - Send broadcast to all users
router.post('/notifications/broadcast',
  authenticate,
  requireSuperAdmin,
  logAdminAction('notification_sent', 'notification', null, null),
  asyncHandler(async (req, res) => {
    const { type, title, message, data } = req.body;

    if (!title || !message) {
      throw new AppError('Title and message are required', 400);
    }

    const titleValue = String(title).trim();
    const messageValue = String(message).trim();
    if (!titleValue || !messageValue) {
      throw new AppError('Title and message cannot be empty', 400);
    }

    const requestedType = String(type || '').trim().toLowerCase();
    const normalizedType = normalizeNotificationType(requestedType);

    // Get all users and send push notifications when tokens exist.
    const users = await prisma.user.findMany({
      select: {
        id: true,
        pushToken: true,
      },
    });

    const result = await sendAdminNotifications({
      users,
      requestedType,
      normalizedType,
      title: titleValue,
      message: messageValue,
      adminUser: req.adminUser,
      extraData: sanitizeNotificationData(data),
      recipientMode: 'broadcast',
    });

    if (req.adminActionData) {
      req.adminActionData.details = {
        recipientCount: users.length,
        requestedType: requestedType || DEFAULT_NOTIFICATION_TYPE,
        storedType: normalizedType,
        title: titleValue,
        pushAttempted: result.pushAttempted,
        pushSent: result.pushSent,
        broadcast: true,
      };
    }

    res.json({
      success: true,
      message: `Broadcast sent to ${users.length} user(s)`,
      data: {
        recipientCount: users.length,
        requestedType: requestedType || DEFAULT_NOTIFICATION_TYPE,
        storedType: normalizedType,
        pushAttempted: result.pushAttempted,
        pushSent: result.pushSent,
      },
    });
  }));

// ============================================================================
// AUDIT LOG
// ============================================================================

// GET /api/admin/audit-log - Get admin action audit log
router.get('/audit-log', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 50,
    action = '',
    targetType = '',
    adminId = '',
  } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};

  if (action) {
    where.action = action;
  }

  if (targetType) {
    where.targetType = targetType;
  }

  if (adminId) {
    where.adminId = adminId;
  }

  const [actions, total] = await Promise.all([
    prisma.adminAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
      include: {
        admin: {
          select: { id: true, name: true, username: true },
        },
      },
    }),
    prisma.adminAction.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      actions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
}));

// GET /api/admin/audit-log/:targetType/:targetId - Get audit log for specific target
router.get('/audit-log/:targetType/:targetId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { targetType, targetId } = req.params;

  const actions = await prisma.adminAction.findMany({
    where: {
      targetType,
      targetId,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      admin: {
        select: { id: true, name: true, username: true },
      },
    },
  });

  res.json({
    success: true,
    data: actions,
  });
}));

module.exports = router;
