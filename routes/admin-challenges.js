const express = require('express');
const prisma = require('../src/prisma');
const { authenticate } = require('../middleware/auth');
const { requireChallengeMaster, requireChallengeModerator, logAdminAction } = require('../middleware/admin');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { notifyNewChallenge } = require('../services/notificationService');

const router = express.Router();

// GET /api/admin/challenges/pending-submissions - Get all pending submissions across all challenges
router.get('/pending-submissions',
  authenticate,
  requireChallengeModerator,
  asyncHandler(async (req, res) => {
    console.log('[ADMIN CHALLENGE SERVER] Fetching pending submissions...');
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [submissions, total] = await Promise.all([
      prisma.challengeSubmission.findMany({
        where: { status: 'pending' },
        include: {
          user: {
            select: { id: true, name: true, username: true, profileImage: true },
          },
          challenge: {
            select: { id: true, title: true },
          },
          verifiedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.challengeSubmission.count({ where: { status: 'pending' } }),
    ]);

    console.log('[ADMIN CHALLENGE SERVER] Found submissions:', {
      count: submissions.length,
      total,
      page,
      limit
    });

    console.log('[ADMIN CHALLENGE SERVER] Sending response with', submissions.length, 'submissions');
    res.json({
      success: true,
      data: submissions.map((s) => ({
        id: s.id,
        user: {
          id: s.user.id,
          name: s.user.name,
          username: s.user.username,
          profileImage: s.user.profileImage,
        },
        challenge: {
          id: s.challenge.id,
          title: s.challenge.title || 'Unknown Challenge',
        },
        exercise: s.exercise,
        reps: s.reps,
        weight: s.weight,
        duration: s.duration,
        value: s.value,
        videoUrl: s.videoUrl,
        status: s.status,
        verifiedBy: s.verifiedBy ? { id: s.verifiedBy.id, name: s.verifiedBy.name } : null,
        verifiedAt: s.verifiedAt,
        rejectionReason: s.rejectionReason,
        notes: s.notes,
        submittedAt: s.submittedAt,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  })
);

// GET /api/admin/challenges - List all challenges (paginated)
router.get('/',
  authenticate,
  requireChallengeMaster,
  asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = 'all',
      regionScope = 'all',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const where = {};

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status === 'active') {
      where.isActive = true;
      where.endDate = { gt: new Date() };
    } else if (status === 'ended') {
      where.endDate = { lt: new Date() };
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    if (regionScope !== 'all') {
      where.regionScope = regionScope.toLowerCase();
    }

    const [challenges, total] = await Promise.all([
      prisma.challenge.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.challenge.count({ where }),
    ]);

    // Get participant counts for each challenge
    const challengesWithCounts = await Promise.all(
      challenges.map(async (challenge) => {
        const [participantCount, pendingSubmissions] = await Promise.all([
          prisma.userChallenge.count({
            where: { challengeId: challenge.id },
          }),
          prisma.challengeSubmission.count({
            where: {
              challengeId: challenge.id,
              status: 'pending',
            },
          }),
        ]);

        return {
          id: challenge.id,
          title: challenge.title,
          description: challenge.description,
          challengeType: challenge.challengeType,
          exercises: challenge.exercises,
          customMetricName: challenge.customMetricName,
          metricType: challenge.metricType,
          target: challenge.target,
          startDate: challenge.startDate,
          endDate: challenge.endDate,
          regionScope: challenge.regionScope,
          reward: challenge.reward,
          requiresVideo: challenge.requiresVideo,
          minVideoDuration: challenge.minVideoDuration,
          rules: challenge.rules,
          completionType: challenge.completionType,
          winnerCriteria: challenge.winnerCriteria,
          maxParticipants: challenge.maxParticipants,
          createdBy: challenge.createdBy,
          isActive: challenge.isActive,
          createdAt: challenge.createdAt,
          updatedAt: challenge.updatedAt,
          participantCount,
          pendingSubmissions,
        };
      })
    );

    res.json({
      success: true,
      data: challengesWithCounts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  })
);

// GET /api/admin/challenges/:id - Get challenge details with participants
router.get('/:id',
  authenticate,
  requireChallengeMaster,
  asyncHandler(async (req, res) => {
    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id }
    });

    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    // Get participants with progress
    const participants = await prisma.userChallenge.findMany({
      where: { challengeId: challenge.id },
      include: {
        user: {
          select: { id: true, name: true, username: true, profileImage: true, region: true },
        },
      },
      orderBy: [{ progress: 'desc' }, { createdAt: 'asc' }],
    });

    // Get submission stats
    const submissionStats = await prisma.challengeSubmission.groupBy({
      by: ['status'],
      where: { challengeId: challenge.id },
      _count: { id: true },
    });

    const statsMap = { pending: 0, approved: 0, rejected: 0 };
    submissionStats.forEach((s) => {
      statsMap[s.status] = s._count.id;
    });

    res.json({
      success: true,
      data: {
        challenge,
        participants: participants.map((p) => ({
          userId: p.user.id,
          name: p.user.name,
          username: p.user.username,
          profileImage: p.user.profileImage,
          region: p.user.region,
          progress: p.progress,
          completed: p.completed,
          completedAt: p.completedAt,
          joinedAt: p.createdAt,
        })),
        participantCount: participants.length,
        submissionStats: statsMap,
      },
    });
  })
);

// POST /api/admin/challenges - Create new challenge
router.post('/',
  authenticate,
  requireChallengeMaster,
  logAdminAction('challenge_created', 'challenge', null, null),
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      challengeType = 'exercise',
      exercises = [],
      customMetricName = '',
      metricType = 'reps',
      target,
      startDate,
      endDate,
      regionScope = 'global',
      reward = 100,
      requiresVideo = true,
      minVideoDuration = 5,
      rules = '',
      completionType = 'cumulative',
      winnerCriteria = 'first_to_complete',
      maxParticipants = 0,
    } = req.body;

    // Validation
    if (!title || !description || !target || !startDate || !endDate) {
      throw new AppError('Missing required fields', 400);
    }

    if (new Date(endDate) <= new Date(startDate)) {
      throw new AppError('End date must be after start date', 400);
    }

    if (challengeType === 'exercise' && (!exercises || exercises.length === 0)) {
      throw new AppError('Exercise-based challenges require at least one exercise', 400);
    }

    if (challengeType === 'custom' && !customMetricName) {
      throw new AppError('Custom challenges require a metric name', 400);
    }

    const challenge = await prisma.challenge.create({
      data: {
        title,
        description,
        challengeType,
        exercises: challengeType === 'exercise' ? exercises : [],
        customMetricName: challengeType === 'custom' ? customMetricName : '',
        metricType,
        target,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        regionScope: regionScope.toLowerCase(),
        reward,
        requiresVideo,
        minVideoDuration,
        rules,
        completionType,
        winnerCriteria,
        maxParticipants,
        createdById: req.user.id,
        isActive: true,
      },
    });

    // Add challenge ID to admin action data
    if (req.adminActionData) {
      req.adminActionData.targetId = challenge.id;
      req.adminActionData.details = {
        title: challenge.title,
        challengeType: challenge.challengeType,
        target: challenge.target,
        regionScope: challenge.regionScope,
      };
    }

    // Notify opted-in users of new challenge
    await notifyNewChallenge(challenge);

    res.status(201).json({
      success: true,
      data: challenge,
    });
  })
);

// PATCH /api/admin/challenges/:id - Update challenge
router.patch('/:id',
  authenticate,
  requireChallengeMaster,
  logAdminAction('challenge_updated', 'challenge', ':id', null),
  asyncHandler(async (req, res) => {
    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id }
    });

    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    const allowedUpdates = [
      'title',
      'description',
      'exercises',
      'customMetricName',
      'metricType',
      'target',
      'startDate',
      'endDate',
      'regionScope',
      'reward',
      'requiresVideo',
      'minVideoDuration',
      'rules',
      'completionType',
      'winnerCriteria',
      'maxParticipants',
      'isActive',
    ];

    const updates = {};
    Object.keys(req.body).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    // Validate end date
    if (updates.endDate && new Date(updates.endDate) <= new Date(challenge.startDate)) {
      throw new AppError('End date must be after start date', 400);
    }

    const updatedChallenge = await prisma.challenge.update({
      where: { id: req.params.id },
      data: updates,
    });

    // Add details to admin action
    if (req.adminActionData) {
      req.adminActionData.details = {
        updatedFields: Object.keys(updates),
      };
    }

    res.json({
      success: true,
      data: updatedChallenge,
    });
  })
);

// DELETE /api/admin/challenges/:id - Delete challenge
router.delete('/:id',
  authenticate,
  requireChallengeMaster,
  logAdminAction('challenge_deleted', 'challenge', ':id', null),
  asyncHandler(async (req, res) => {
    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id }
    });

    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    // Check if challenge has participants
    const participantCount = await prisma.userChallenge.count({
      where: { challengeId: challenge.id }
    });

    if (participantCount > 0) {
      throw new AppError(
        `Cannot delete challenge with ${participantCount} participants. Deactivate it instead.`,
        400
      );
    }

    await prisma.challenge.delete({
      where: { id: req.params.id }
    });

    // Add details to admin action
    if (req.adminActionData) {
      req.adminActionData.details = {
        title: challenge.title,
        participantCount,
      };
    }

    res.json({
      success: true,
      message: 'Challenge deleted successfully',
    });
  })
);

// GET /api/admin/challenges/:id/participants - Get challenge participants
router.get('/:id/participants',
  authenticate,
  requireChallengeMaster,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, status = 'all' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id }
    });

    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    const where = { challengeId: challenge.id };
    if (status === 'completed') {
      where.completed = true;
    } else if (status === 'in_progress') {
      where.completed = false;
    }

    const [participants, total] = await Promise.all([
      prisma.userChallenge.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, username: true, profileImage: true, region: true },
          },
        },
        orderBy: [{ progress: 'desc' }, { createdAt: 'asc' }],
        skip,
        take: parseInt(limit),
      }),
      prisma.userChallenge.count({ where }),
    ]);

    res.json({
      success: true,
      data: participants.map((p) => ({
        userId: p.user.id,
        name: p.user.name,
        username: p.user.username,
        profileImage: p.user.profileImage,
        region: p.user.region,
        progress: p.progress,
        completed: p.completed,
        completedAt: p.completedAt,
        joinedAt: p.createdAt,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  })
);

// GET /api/admin/challenges/:id/submissions - Get submissions queue
router.get('/:id/submissions',
  authenticate,
  requireChallengeMaster,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status = 'pending' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id }
    });

    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    const where = { challengeId: challenge.id };
    if (status !== 'all') {
      where.status = status;
    }

    const [submissions, total] = await Promise.all([
      prisma.challengeSubmission.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, username: true, profileImage: true },
          },
          verifiedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.challengeSubmission.count({ where }),
    ]);

    res.json({
      success: true,
      data: submissions.map((s) => ({
        id: s.id,
        user: {
          id: s.user.id,
          name: s.user.name,
          username: s.user.username,
          profileImage: s.user.profileImage,
        },
        exercise: s.exercise,
        reps: s.reps,
        weight: s.weight,
        duration: s.duration,
        value: s.value,
        videoUrl: s.videoUrl,
        status: s.status,
        verifiedBy: s.verifiedBy ? { id: s.verifiedBy.id, name: s.verifiedBy.name } : null,
        verifiedAt: s.verifiedAt,
        rejectionReason: s.rejectionReason,
        notes: s.notes,
        submittedAt: s.submittedAt,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  })
);

// POST /api/admin/challenges/submissions/:id/verify - Approve or reject submission
router.post('/submissions/:id/verify',
  authenticate,
  requireChallengeModerator,
  logAdminAction('challenge_submission_verified', 'challenge_submission', ':id', null),
  asyncHandler(async (req, res) => {
    const { action, rejectionReason = '' } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      throw new AppError('Invalid action. Must be "approve" or "reject"', 400);
    }

    const submission = await prisma.challengeSubmission.findUnique({
      where: { id: req.params.id },
      include: {
        challenge: true,
        user: true,
      },
    });

    if (!submission) {
      throw new AppError('Submission not found', 404);
    }

    if (submission.status !== 'pending') {
      throw new AppError('Submission has already been verified', 400);
    }

    const updatedSubmission = await prisma.challengeSubmission.update({
      where: { id: req.params.id },
      data: {
        status: action === 'approve' ? 'approved' : 'rejected',
        verifiedById: req.user.id,
        verifiedAt: new Date(),
        rejectionReason: action === 'reject' ? (rejectionReason || 'Submission did not meet requirements') : null,
      },
    });

    // If approved, update user's challenge progress
    if (action === 'approve') {
      const userChallenge = await prisma.userChallenge.findUnique({
        where: {
          userId_challengeId: {
            userId: submission.userId,
            challengeId: submission.challengeId,
          },
        },
      });

      if (userChallenge) {
        let newProgress;
        // Update progress based on completion type
        if (submission.challenge.completionType === 'cumulative') {
          newProgress = userChallenge.progress + submission.value;
        } else if (submission.challenge.completionType === 'best_effort') {
          newProgress = Math.max(userChallenge.progress, submission.value);
        } else {
          // single_session - use the current submission value
          newProgress = submission.value;
        }

        const updateData = { progress: newProgress };

        // Check if challenge is completed
        if (newProgress >= submission.challenge.target && !userChallenge.completed) {
          updateData.completed = true;
          updateData.completedAt = new Date();

          // Award bonus points (reward)
          await prisma.user.update({
            where: { id: submission.userId },
            data: {
              totalPoints: { increment: submission.challenge.reward || 0 },
            },
          });
        }

        await prisma.userChallenge.update({
          where: {
            userId_challengeId: {
              userId: submission.userId,
              challengeId: submission.challengeId,
            },
          },
          data: updateData,
        });
      }
    }

    // Add details to admin action
    if (req.adminActionData) {
      req.adminActionData.details = {
        action,
        challengeId: submission.challengeId,
        challengeTitle: submission.challenge.title,
        userId: submission.userId,
        userName: submission.user.name,
        value: submission.value,
        rejectionReason: action === 'reject' ? rejectionReason : undefined,
      };
    }

    res.json({
      success: true,
      message: action === 'approve'
        ? 'Submission approved and progress updated'
        : 'Submission rejected',
      data: updatedSubmission,
    });
  })
);

// GET /api/admin/challenges/:id/leaderboard - View challenge leaderboard
router.get('/:id/leaderboard',
  authenticate,
  requireChallengeMaster,
  asyncHandler(async (req, res) => {
    const { limit = 100 } = req.query;

    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id }
    });

    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    const participants = await prisma.userChallenge.findMany({
      where: { challengeId: challenge.id },
      include: {
        user: {
          select: { id: true, name: true, username: true, profileImage: true, region: true },
        },
      },
      orderBy: { progress: 'desc' },
      take: parseInt(limit),
    });

    const leaderboard = participants.map((p, index) => ({
      rank: index + 1,
      userId: p.user.id,
      name: p.user.name,
      username: p.user.username,
      profileImage: p.user.profileImage,
      region: p.user.region,
      progress: p.progress,
      completed: p.completed,
      completedAt: p.completedAt,
      joinedAt: p.createdAt,
      percentage: Math.min(100, (p.progress / challenge.target) * 100),
    }));

    // Get top submissions for best_effort challenges
    let topSubmissions = [];
    if (challenge.winnerCriteria === 'best_single' || challenge.completionType === 'best_effort') {
      topSubmissions = await prisma.challengeSubmission.findMany({
        where: {
          challengeId: challenge.id,
          status: 'approved',
        },
        include: {
          user: {
            select: { id: true, name: true, username: true },
          },
        },
        orderBy: { value: 'desc' },
        take: 10,
      });
    }

    res.json({
      success: true,
      data: {
        challenge: {
          id: challenge.id,
          title: challenge.title,
          target: challenge.target,
          metricType: challenge.metricType,
          winnerCriteria: challenge.winnerCriteria,
        },
        leaderboard,
        totalParticipants: participants.length,
        topSubmissions: topSubmissions.map((s) => ({
          id: s.id,
          value: s.value,
          exercise: s.exercise,
          reps: s.reps,
          weight: s.weight,
          user: { id: s.user.id, name: s.user.name, username: s.user.username },
        })),
      },
    });
  })
);

module.exports = router;
