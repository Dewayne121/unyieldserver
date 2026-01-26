const mongoose = require('mongoose');

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

const workoutSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  exercise: {
    type: String,
    required: true,
  },
  reps: {
    type: Number,
    required: true,
    min: 1,
    max: 2000,
  },
  weight: {
    type: Number,
    min: 0,
    max: 1000,
  },
  duration: {
    type: Number, // in seconds
    min: 0,
  },
  points: {
    type: Number,
    required: true,
    default: 0,
  },
  notes: {
    type: String,
    maxlength: 500,
  },
  date: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
workoutSchema.index({ user: 1, date: -1 });

// Static method to calculate points
workoutSchema.statics.calcPoints = function(exercise, reps, weight, streak) {
  const exerciseData = EXERCISES.find(e => e.id === exercise || e.name === exercise);
  const intensity = exerciseData?.intensity ?? 1;
  const base = reps * intensity;
  const weightBonus = Math.max(0, Math.round((weight || 0) * 0.1));
  const streakBonus = Math.min(50, (streak || 0) * 4);
  return Math.max(1, Math.round(base + weightBonus + streakBonus));
};

// Static method to compute streak from workouts
workoutSchema.statics.computeStreak = async function(userId) {
  const workouts = await this.find({ user: userId })
    .sort({ date: -1 })
    .select('date');

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

  if (gapToToday !== 0 && gapToToday !== 1) {
    return { streak: 0, best: uniqueDays.length };
  }

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

module.exports = mongoose.model('Workout', workoutSchema);
module.exports.EXERCISES = EXERCISES;
