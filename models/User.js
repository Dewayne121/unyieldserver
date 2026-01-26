const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const REGIONS = [
  'Global',
  'London',
  'Manchester',
  'Birmingham',
  'Leeds',
  'Glasgow',
];

const GOALS = ['Hypertrophy', 'Leanness', 'Performance'];

const ACCOLADES = ['admin', 'community_support', 'beta', 'staff', 'verified_athlete', 'founding_member', 'challenge_master'];

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    unique: true,
    sparse: true, // Allows null for anonymous users
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    select: false, // Don't include password in queries by default
  },
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    minlength: 3,
    maxlength: 20,
  },
  name: {
    type: String,
    trim: true,
    default: 'Grinder',
  },
  profileImage: {
    type: String, // Base64 or URL
    default: null,
  },
  region: {
    type: String,
    enum: REGIONS,
    default: 'Global',
  },
  goal: {
    type: String,
    enum: GOALS,
    default: 'Hypertrophy',
  },
  bio: {
    type: String,
    trim: true,
    maxlength: 300,
    default: '',
  },
  // Onboarding fields
  fitnessLevel: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'elite'],
    default: 'beginner',
  },
  workoutFrequency: {
    type: String,
    default: '3-4',
  },
  preferredDays: [{
    type: String,
  }],
  weight: {
    type: Number,
    default: null,
  },
  height: {
    type: Number,
    default: null,
  },
  age: {
    type: Number,
    default: null,
  },
  accolades: [{
    type: String,
    enum: ACCOLADES,
  }],
  provider: {
    type: String,
    enum: ['email', 'google', 'apple', 'anonymous'],
    default: 'email',
  },
  totalPoints: {
    type: Number,
    default: 0,
  },
  weeklyPoints: {
    type: Number,
    default: 0,
  },
  rank: {
    type: Number,
    default: 99,
  },
  streak: {
    type: Number,
    default: 0,
  },
  streakBest: {
    type: Number,
    default: 0,
  },
  lastWorkoutDate: {
    type: Date,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
});

// Hash password before saving
userSchema.pre('save', async function() {
  if (!this.isModified('password') || !this.password) {
    return;
  }
  this.password = await bcrypt.hash(this.password, 12);
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Update rank based on total points
userSchema.methods.updateRank = function() {
  this.rank = Math.max(1, 100 - Math.floor(this.totalPoints / 250));
};

// Static method to get leaderboard
userSchema.statics.getLeaderboard = async function(options = {}) {
  const { region = 'Global', type = 'total', limit = 50, skip = 0 } = options;

  const query = region !== 'Global' ? { region } : {};
  const sortField = type === 'weekly' ? 'weeklyPoints' : 'totalPoints';

  return this.find(query)
    .select('name region totalPoints weeklyPoints streak')
    .sort({ [sortField]: -1 })
    .skip(skip)
    .limit(limit);
};

module.exports = mongoose.model('User', userSchema);
module.exports.REGIONS = REGIONS;
module.exports.GOALS = GOALS;
module.exports.ACCOLADES = ACCOLADES;
