const mongoose = require('mongoose');

const challengeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  challengeType: {
    type: String,
    enum: ['exercise', 'metric', 'custom'],
    default: 'exercise',
    required: true,
  },
  // For exercise-based challenges - list of exercise IDs
  exercises: [{
    type: String,
  }],
  // For custom metric challenges
  customMetricName: {
    type: String,
    trim: true,
  },
  metricType: {
    type: String,
    enum: ['reps', 'weight', 'duration', 'workouts'],
    default: 'reps',
  },
  target: {
    type: Number,
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  regionScope: {
    type: String,
    default: 'global',
    lowercase: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  reward: {
    type: Number,
    default: 100,
  },
  // Verification requirements
  requiresVideo: {
    type: Boolean,
    default: true,
  },
  minVideoDuration: {
    type: Number,
    default: 5,
  },
  // Challenge rules
  rules: {
    type: String,
    default: '',
  },
  // Completion criteria
  completionType: {
    type: String,
    enum: ['cumulative', 'single_session', 'best_effort'],
    default: 'cumulative',
  },
  // Winner selection
  winnerCriteria: {
    type: String,
    enum: ['first_to_complete', 'highest_total', 'best_single'],
    default: 'first_to_complete',
  },
  // Max participants (0 = unlimited)
  maxParticipants: {
    type: Number,
    default: 0,
  },
  // Challenge creator
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// Index for active challenges
challengeSchema.index({ isActive: 1, endDate: 1 });

module.exports = mongoose.model('Challenge', challengeSchema);
