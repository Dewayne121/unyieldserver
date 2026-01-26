const mongoose = require('mongoose');

const challengeSubmissionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  challenge: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Challenge',
    required: true,
  },
  // Exercise information
  exercise: {
    type: String, // exercise ID
  },
  // Performance data
  reps: {
    type: Number,
    default: 0,
  },
  weight: {
    type: Number, // stored in kg
    default: 0,
  },
  duration: {
    type: Number, // for cardio/time-based (seconds)
    default: 0,
  },
  // Video information
  videoUri: {
    type: String, // local URI from app
  },
  videoUrl: {
    type: String, // server URL
  },
  serverVideoId: {
    type: String, // video ID on server
  },
  // Calculated value (e.g., total volume, reps, etc.)
  value: {
    type: Number,
    required: true,
  },
  // Verification status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  // Verification details
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  verifiedAt: {
    type: Date,
  },
  rejectionReason: {
    type: String,
    trim: true,
  },
  // User notes
  notes: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  // Timestamps
  submittedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
challengeSubmissionSchema.index({ challenge: 1, status: 1 });
challengeSubmissionSchema.index({ user: 1, challenge: 1 });
challengeSubmissionSchema.index({ status: 1, submittedAt: -1 });

// Ensure one user can't have duplicate pending submissions for the same challenge
challengeSubmissionSchema.index({ user: 1, challenge: 1, status: 1 }, {
  unique: true,
  partialFilterExpression: { status: 'pending' },
});

module.exports = mongoose.model('ChallengeSubmission', challengeSubmissionSchema);
