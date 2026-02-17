const express = require('express');
const prisma = require('../src/prisma');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { deleteVideo } = require('../services/objectStorage');
const { calculateStrengthRatio, getWeightClass } = require('../src/utils/strengthRatio');

const router = express.Router();

// GET /api/challenges/user/active - Get user's active challenges (must be before /:id)
router.get('/user/active', authenticate, asyncHandler(async (req, res) => {
  const now = new Date();

  const userChallenges = await prisma.userChallenge.findMany({
    where: { userId: req.user.id },
    include: {
      challenge: {
        where: {
          isActive: true,
          endDate: { gt: now },
        },
      },
    },
  });

  const activeChallenges = userChallenges
    .filter(uc => uc.challenge)
    .map(uc => ({
      id: uc.challenge.id,
      title: uc.challenge.title,
      description: uc.challenge.description,
      challengeType: uc.challenge.challengeType,
      exercises: uc.challenge.exercises,
      customMetricName: uc.challenge.customMetricName,
      metricType: uc.challenge.metricType,
      target: uc.challenge.target,
      startDate: uc.challenge.startDate,
      endDate: uc.challenge.endDate,
      regionScope: uc.challenge.regionScope,
      reward: uc.challenge.reward,
      requiresVideo: uc.challenge.requiresVideo,
      minVideoDuration: uc.challenge.minVideoDuration,
      rules: uc.challenge.rules,
      completionType: uc.challenge.completionType,
      winnerCriteria: uc.challenge.winnerCriteria,
      maxParticipants: uc.challenge.maxParticipants,
      createdBy: uc.challenge.createdBy,
      isActive: uc.challenge.isActive,
      createdAt: uc.challenge.createdAt,
      updatedAt: uc.challenge.updatedAt,
      progress: uc.progress,
      completed: uc.completed,
      joinedAt: uc.createdAt,
    }));

  res.json({
    success: true,
    data: activeChallenges,
  });
}));

// GET /api/challenges/my-submissions - Get user's challenge submissions (must be before /:id)
router.get('/my-submissions', authenticate, asyncHandler(async (req, res) => {
  console.log('[CHALLENGES] Getting user submissions for user:', req.user.id);

  const submissions = await prisma.challengeSubmission.findMany({
    where: { userId: req.user.id },
    include: {
      challenge: {
        select: { title: true },
      },
    },
    orderBy: { submittedAt: 'desc' },
  });

  console.log('[CHALLENGES] Found submissions:', submissions.length);

  res.json({
    success: true,
    data: submissions.map(s => ({
      id: s.id,
      challenge: s.challenge,
      exercise: s.exercise,
      reps: s.reps,
      weight: s.weight,
      duration: s.duration,
      value: s.value,
      videoUrl: s.videoUrl,
      status: s.status,
      rejectionReason: s.rejectionReason,
      verifiedAt: s.verifiedAt,
      submittedAt: s.submittedAt,
      createdAt: s.createdAt,
    })),
  });
}));

// GET /api/challenges - Get all active challenges
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { region = 'global', includeExpired = 'false' } = req.query;
  const now = new Date();

  // Normalize region to lowercase for comparison
  const normalizedRegion = region.toLowerCase();

  const where = {
    OR: [
      { regionScope: 'global' },
      { regionScope: 'Global' },
      { regionScope: normalizedRegion },
      // Also check with first letter capitalized (common pattern)
      { regionScope: normalizedRegion.charAt(0).toUpperCase() + normalizedRegion.slice(1) },
    ],
  };

  if (includeExpired !== 'true') {
    where.isActive = true;
    where.endDate = { gt: now };
  }

  let challenges = await prisma.challenge.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  console.log('[CHALLENGES] Query params:', { region, includeExpired, normalizedRegion });
  console.log('[CHALLENGES] Found challenges:', challenges.length);
  console.log('[CHALLENGES] Challenge regions:', challenges.map(c => ({ id: c.id, title: c.title, regionScope: c.regionScope, isActive: c.isActive, endDate: c.endDate })));

  // Add user progress if authenticated
  if (req.user) {
    const userChallenges = await prisma.userChallenge.findMany({
      where: {
        userId: req.user.id,
        challengeId: { in: challenges.map(c => c.id) },
      },
    });

    const ucMap = new Map(userChallenges.map(uc => [uc.challengeId, uc]));

    challenges = challenges.map(challenge => ({
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
      joined: ucMap.has(challenge.id),
      progress: ucMap.get(challenge.id)?.progress || 0,
      completed: ucMap.get(challenge.id)?.completed || false,
    }));
  }

  res.json({
    success: true,
    data: challenges,
  });
}));

// GET /api/challenges/:id - Get specific challenge
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: req.params.id }
  });

  if (!challenge) {
    throw new AppError('Challenge not found', 404);
  }

  let responseData = {
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
    joined: false,
    progress: 0,
    completed: false,
  };

  // Add user progress if authenticated
  if (req.user) {
    const userChallenge = await prisma.userChallenge.findUnique({
      where: {
        userId_challengeId: {
          userId: req.user.id,
          challengeId: challenge.id,
        },
      },
    });

    responseData.joined = !!userChallenge;
    responseData.progress = userChallenge?.progress || 0;
    responseData.completed = userChallenge?.completed || false;
  }

  // Get participant count
  const participantCount = await prisma.userChallenge.count({
    where: { challengeId: challenge.id }
  });
  responseData.participantCount = participantCount;

  res.json({
    success: true,
    data: responseData,
  });
}));

// POST /api/challenges/:id/join - Join a challenge
router.post('/:id/join', authenticate, asyncHandler(async (req, res) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: req.params.id }
  });

  if (!challenge) {
    throw new AppError('Challenge not found', 404);
  }

  if (!challenge.isActive) {
    throw new AppError('This challenge is no longer active', 400);
  }

  if (new Date(challenge.endDate) < new Date()) {
    throw new AppError('This challenge has ended', 400);
  }

  const existing = await prisma.userChallenge.findUnique({
    where: {
      userId_challengeId: {
        userId: req.user.id,
        challengeId: challenge.id,
      },
    },
  });

  if (existing) {
    throw new AppError('You have already joined this challenge', 400);
  }

  const userChallenge = await prisma.userChallenge.create({
    data: {
      userId: req.user.id,
      challengeId: challenge.id,
      progress: 0,
      completed: false,
    },
  });

  res.status(201).json({
    success: true,
    data: {
      challenge,
      userProgress: userChallenge,
    },
  });
}));

// POST /api/challenges/:id/leave - Leave a challenge
router.post('/:id/leave', authenticate, asyncHandler(async (req, res) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: req.params.id }
  });

  if (!challenge) {
    throw new AppError('Challenge not found', 404);
  }

  const result = await prisma.userChallenge.delete({
    where: {
      userId_challengeId: {
        userId: req.user.id,
        challengeId: challenge.id,
      },
    },
  });

  if (!result) {
    throw new AppError('You have not joined this challenge', 400);
  }

  res.json({
    success: true,
    message: 'Successfully left the challenge',
  });
}));

// GET /api/challenges/:id/leaderboard - Get challenge leaderboard
router.get('/:id/leaderboard', asyncHandler(async (req, res) => {
  const { limit = 20 } = req.query;
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
        select: { name: true },
      },
    },
    orderBy: { progress: 'desc' },
    take: parseInt(limit),
  });

  const leaderboard = participants.map((p, index) => ({
    userId: p.userId,
    name: p.user.name,
    progress: p.progress,
    completed: p.completed,
    joinedAt: p.createdAt,
    rank: index + 1,
  }));

  const totalParticipants = await prisma.userChallenge.count({
    where: { challengeId: challenge.id }
  });

  res.json({
    success: true,
    data: {
      challenge: {
        id: challenge.id,
        title: challenge.title,
        target: challenge.target,
      },
      leaderboard,
      totalParticipants,
    },
  });
}));

// POST /api/challenges/:id/submit - Submit a challenge entry
router.post('/:id/submit', authenticate, asyncHandler(async (req, res) => {
  const { exercise, reps, weight, duration, videoUri, videoUrl, originalVideoUrl, serverVideoId, notes = '' } = req.body;

  const challenge = await prisma.challenge.findUnique({
    where: { id: req.params.id }
  });

  if (!challenge) {
    throw new AppError('Challenge not found', 404);
  }

  if (!challenge.isActive) {
    throw new AppError('This challenge is no longer active', 400);
  }

  if (new Date(challenge.endDate) < new Date()) {
    throw new AppError('This challenge has ended', 400);
  }

  // Check if user has joined the challenge
  const userChallenge = await prisma.userChallenge.findUnique({
    where: {
      userId_challengeId: {
        userId: req.user.id,
        challengeId: challenge.id,
      },
    },
  });

  if (!userChallenge) {
    throw new AppError('You must join this challenge before submitting entries', 400);
  }

  // Validate exercise if required
  if (challenge.challengeType === 'exercise') {
    if (!exercise || !challenge.exercises.includes(exercise)) {
      throw new AppError('Invalid exercise for this challenge', 400);
    }
  }

  // Validate required video
  if (challenge.requiresVideo && !videoUrl && !serverVideoId) {
    throw new AppError('Video evidence is required for this challenge', 400);
  }

  // Calculate the value based on metric type
  let value = 0;
  switch (challenge.metricType) {
    case 'reps':
      value = reps || 0;
      break;
    case 'weight':
      value = weight || 0;
      break;
    case 'duration':
      value = duration || 0;
      break;
    case 'workouts':
      value = 1; // Each submission counts as 1 workout
      break;
  }

  // Check for existing pending submission
  const existingPending = await prisma.challengeSubmission.findFirst({
    where: {
      userId: req.user.id,
      challengeId: challenge.id,
      status: 'pending',
    },
  });

  if (existingPending) {
    throw new AppError('You already have a pending submission. Wait for it to be verified.', 400);
  }

  const submission = await prisma.challengeSubmission.create({
    data: {
      userId: req.user.id,
      challengeId: challenge.id,
      exercise,
      reps: reps || 0,
      weight: weight || 0,
      duration: duration || 0,
      videoUri,
      videoUrl,
      originalVideoUrl, // Store original unblurred video for admin view
      serverVideoId,
      value,
      notes,
      submittedAt: new Date(),
    },
  });

  // Also create a workout log to update the user's strength ratio for main leaderboard
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { weight: true }
  });

  let strengthRatio = 0;
  if (user?.weight && user.weight > 0 && weight && reps) {
    const weightLifted = reps * weight;
    strengthRatio = calculateStrengthRatio({
      weightLifted,
      bodyweight: user.weight,
      reps
    });
  }

  // Create workout log (this will trigger the strength ratio update)
  await prisma.workout.create({
    data: {
      userId: req.user.id,
      exercise: exercise || 'Challenge',
      reps: reps || 0,
      weight: weight || 0,
      duration: duration || 0,
      points: 0, // Deprecated
      strengthRatio,
      date: new Date(),
    },
  });

  // Recalculate user's aggregate strength ratio
  const allWorkouts = await prisma.workout.findMany({
    where: { userId: req.user.id }
  });

  const totalStrengthRatio = allWorkouts.reduce((sum, w) => sum + (w.strengthRatio || 0), 0);
  const weightClass = getWeightClass(user?.weight || 0);

  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      strengthRatio: totalStrengthRatio,
      weightClass,
    },
  });

  res.status(201).json({
    success: true,
    message: 'Challenge entry submitted for verification',
    data: {
      ...submission,
      strengthRatio: totalStrengthRatio,
      weightClass,
    },
  });
}));

// GET /api/challenges/:id/my-submissions - Get user's submissions for a challenge
router.get('/:id/my-submissions', authenticate, asyncHandler(async (req, res) => {
  const challenge = await prisma.challenge.findUnique({
    where: { id: req.params.id }
  });

  if (!challenge) {
    throw new AppError('Challenge not found', 404);
  }

  const submissions = await prisma.challengeSubmission.findMany({
    where: {
      userId: req.user.id,
      challengeId: challenge.id,
    },
    orderBy: { submittedAt: 'desc' },
    include: {
      verifiedBy: {
        select: { id: true, name: true },
      },
    },
  });

  res.json({
    success: true,
    data: submissions.map((s) => ({
      id: s.id,
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
  });
}));

// GET /api/challenges/:id/top-submissions - Get top submissions for a challenge
router.get('/:id/top-submissions', asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  const challenge = await prisma.challenge.findUnique({
    where: { id: req.params.id }
  });

  if (!challenge) {
    throw new AppError('Challenge not found', 404);
  }

  const topSubmissions = await prisma.challengeSubmission.findMany({
    where: {
      challengeId: challenge.id,
      status: 'approved',
    },
    include: {
      user: {
        select: { id: true, name: true, username: true, profileImage: true },
      },
    },
    orderBy: { value: 'desc' },
    take: parseInt(limit),
  });

  res.json({
    success: true,
    data: topSubmissions.map((s, index) => ({
      rank: index + 1,
      id: s.id,
      value: s.value,
      exercise: s.exercise,
      reps: s.reps,
      weight: s.weight,
      user: {
        id: s.user.id,
        name: s.user.name,
        username: s.user.username,
        profileImage: s.user.profileImage,
      },
      verifiedAt: s.verifiedAt,
    })),
  });
}));

// DELETE /api/challenges/submissions/:id - Delete a challenge submission (owner only)
router.delete('/submissions/:id', authenticate, asyncHandler(async (req, res) => {
  console.log('[CHALLENGE SUBMISSION] Delete request for:', req.params.id, 'by user:', req.user.id);

  const submission = await prisma.challengeSubmission.findUnique({
    where: { id: req.params.id }
  });

  if (!submission) {
    throw new AppError('Challenge submission not found', 404);
  }

  // Must be the owner of the submission to delete it
  if (submission.userId !== req.user.id) {
    throw new AppError('You can only delete your own challenge submissions', 403);
  }

  // Only allow deletion of pending or rejected submissions (not approved ones)
  if (submission.status === 'approved') {
    throw new AppError('Cannot delete an approved submission', 400);
  }

  // Delete from Object Storage
  if (submission.videoUrl) {
    try {
      await deleteVideo(submission.videoUrl);
      console.log('[CHALLENGE SUBMISSION] Deleted video from storage');
    } catch (storageErr) {
      console.log('[CHALLENGE SUBMISSION] Storage deletion error (continuing):', storageErr.message);
    }
  }

  // Delete the submission
  await prisma.challengeSubmission.delete({
    where: { id: req.params.id }
  });
  console.log('[CHALLENGE SUBMISSION] Deleted from database:', req.params.id);

  res.json({
    success: true,
    message: 'Challenge submission deleted successfully',
  });
}));

module.exports = router;
