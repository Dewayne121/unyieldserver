const express = require('express');
const prisma = require('../src/lib/prisma');
const { EXERCISES, calcPoints, computeStreak } = require('../services/workoutService');
const { updateRank } = require('../services/userService');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/workouts/exercises/list - Get available exercises (must be before /:id)
router.get('/exercises/list', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: EXERCISES,
  });
}));

// GET /api/workouts - Get user's workouts
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0, startDate, endDate } = req.query;

  const where = { userId: req.user.id };

  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  const [workouts, total] = await Promise.all([
    prisma.workout.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: parseInt(offset),
      take: parseInt(limit),
    }),
    prisma.workout.count({ where: { userId: req.user.id } }),
  ]);

  res.json({
    success: true,
    data: {
      workouts,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    },
  });
}));

// POST /api/workouts - Log a new workout
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { exercise, reps, weight, duration, notes } = req.body;

  if (!exercise) {
    throw new AppError('Exercise is required', 400);
  }

  if (!reps || reps <= 0) {
    throw new AppError('Reps must be greater than 0', 400);
  }

  if (reps > 2000) {
    throw new AppError('Reps cannot exceed 2000', 400);
  }

  if (weight && weight > 1000) {
    throw new AppError('Weight cannot exceed 1000 kg', 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Calculate points
  const points = calcPoints(exercise, reps, weight || 0, user.streak);

  // Create workout
  const workout = await prisma.workout.create({
    data: {
      userId: req.user.id,
      exercise,
      reps,
      weight: weight || null,
      duration: duration || null,
      points,
      notes: notes || null,
      date: new Date(),
    },
  });

  // Update user stats
  const { streak, best } = await computeStreak(req.user.id);

  // Calculate weekly points
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyWorkouts = await prisma.workout.findMany({
    where: {
      userId: req.user.id,
      date: { gte: oneWeekAgo },
    },
  });
  const weeklyPoints = weeklyWorkouts.reduce((sum, w) => sum + w.points, 0);

  const newTotalPoints = user.totalPoints + points;
  const newRank = updateRank(newTotalPoints);

  const updatedUser = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      totalPoints: newTotalPoints,
      weeklyPoints,
      streak,
      streakBest: Math.max(user.streakBest, best),
      lastWorkoutDate: workout.date,
      rank: newRank,
    },
  });

  res.status(201).json({
    success: true,
    data: {
      workout,
      pointsEarned: points,
      newTotal: updatedUser.totalPoints,
      streak: updatedUser.streak,
    },
  });
}));

// GET /api/workouts/:id - Get specific workout
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const workout = await prisma.workout.findUnique({
    where: { id: req.params.id }
  });

  if (!workout) {
    throw new AppError('Workout not found', 404);
  }

  if (workout.userId !== req.user.id) {
    throw new AppError('Not authorized to view this workout', 403);
  }

  res.json({
    success: true,
    data: workout,
  });
}));

// DELETE /api/workouts/:id - Delete a workout
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const workout = await prisma.workout.findUnique({
    where: { id: req.params.id }
  });

  if (!workout) {
    throw new AppError('Workout not found', 404);
  }

  if (workout.userId !== req.user.id) {
    throw new AppError('Not authorized to delete this workout', 403);
  }

  // Update user points
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (user) {
    // Recalculate weekly points (excluding the workout being deleted)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weeklyWorkouts = await prisma.workout.findMany({
      where: {
        userId: req.user.id,
        id: { not: req.params.id },
        date: { gte: oneWeekAgo },
      },
    });
    const weeklyPoints = weeklyWorkouts.reduce((sum, w) => sum + w.points, 0);
    const newTotalPoints = Math.max(0, user.totalPoints - workout.points);
    const newRank = updateRank(newTotalPoints);

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        totalPoints: newTotalPoints,
        weeklyPoints,
        rank: newRank,
      },
    });
  }

  await prisma.workout.delete({
    where: { id: req.params.id }
  });

  res.json({
    success: true,
    message: 'Workout deleted successfully',
  });
}));

module.exports = router;
