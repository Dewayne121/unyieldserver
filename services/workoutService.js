/**
 * Workout Service
 * Contains exercise data, points calculation, and streak computation
 * Extracted from Mongoose static methods for Prisma compatibility
 */

const prisma = require('../src/prisma');

// Exercise catalog with intensity multipliers
const EXERCISES = [
  { id: 'bench_press', name: 'Bench Press', intensity: 1.2 },
  { id: 'squat', name: 'Squat', intensity: 1.5 },
  { id: 'deadlift', name: 'Deadlift', intensity: 1.8 },
  { id: 'pushups', name: 'Pushups', intensity: 0.5 },
  { id: 'pullups', name: 'Pullups', intensity: 1.0 },
  { id: 'run', name: 'Run (Km)', intensity: 10.0 },
  { id: 'lunges', name: 'Lunges', intensity: 0.8 },
  { id: 'burpees', name: 'Burpees', intensity: 1.5 },
  { id: 'plank', name: 'Plank (seconds)', intensity: 0.1 },
  { id: 'situps', name: 'Sit-ups', intensity: 0.4 },
  { id: 'dumbbell_press', name: 'Dumbbell Press', intensity: 1.1 },
  { id: 'overhead_press', name: 'Overhead Press', intensity: 1.0 },
  { id: 'bicep_curls', name: 'Bicep Curls', intensity: 0.6 },
  { id: 'tricep_dips', name: 'Tricep Dips', intensity: 0.7 },
];

/**
 * Calculate points for a workout
 * @param {string} exercise - Exercise ID or name
 * @param {number} reps - Number of repetitions
 * @param {number} weight - Weight used (in kg)
 * @param {number} streak - Current streak count
 * @returns {number} Points awarded
 */
const calcPoints = (exercise, reps, weight, streak) => {
  const exerciseData = EXERCISES.find(e => e.id === exercise || e.name === exercise);
  const intensity = exerciseData?.intensity ?? 1;
  const base = reps * intensity;
  const weightBonus = Math.max(0, Math.round((weight || 0) * 0.1));
  const streakBonus = Math.min(50, (streak || 0) * 4);
  return Math.max(1, Math.round(base + weightBonus + streakBonus));
};

/**
 * Compute streak from user's workout history
 * @param {string} userId - User ID
 * @returns {Promise<{streak: number, best: number}>} Current streak and best streak
 */
const computeStreak = async (userId) => {
  const workouts = await prisma.workout.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    select: { date: true },
  });

  if (workouts.length === 0) return { streak: 0, best: 0 };

  // Get unique days
  const uniqueDays = [];
  const seen = new Set();
  for (const w of workouts) {
    const day = w.date.toISOString().split('T')[0];
    if (!seen.has(day)) {
      seen.add(day);
      uniqueDays.push(day);
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const gapToToday = Math.round(
    (new Date(today) - new Date(uniqueDays[0])) / (1000 * 60 * 60 * 24)
  );

  // If last workout was more than 1 day ago, streak is broken
  if (gapToToday !== 0 && gapToToday !== 1) {
    return { streak: 0, best: uniqueDays.length };
  }

  // Count consecutive days
  let streak = 1;
  for (let i = 0; i < uniqueDays.length - 1; i++) {
    const gap = Math.round(
      (new Date(uniqueDays[i]) - new Date(uniqueDays[i + 1])) / (1000 * 60 * 60 * 24)
    );
    if (gap === 1) streak++;
    else break;
  }

  return { streak, best: Math.max(streak, uniqueDays.length) };
};

/**
 * Get exercise by ID or name
 * @param {string} exerciseIdOrName - Exercise ID or name
 * @returns {object|undefined} Exercise data
 */
const getExercise = (exerciseIdOrName) => {
  return EXERCISES.find(e => e.id === exerciseIdOrName || e.name === exerciseIdOrName);
};

module.exports = {
  EXERCISES,
  calcPoints,
  computeStreak,
  getExercise,
};
