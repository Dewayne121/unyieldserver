const mongoose = require('mongoose');

const VIDEO_STATUS = ['pending', 'approved', 'rejected'];

const videoSubmissionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  workout: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workout',
  },
  exercise: {
    type: String,
    required: true,
  },
  reps: {
    type: Number,
    required: true,
  },
  weight: {
    type: Number,
    default: 0,
  },
  duration: {
    type: Number, // video duration in seconds
  },
  videoUrl: {
    type: String, // URL or path to stored video
  },
  thumbnailUrl: {
    type: String,
  },
  status: {
    type: String,
    enum: VIDEO_STATUS,
    default: 'pending',
  },
  // Verification info
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  verifiedByName: {
    type: String, // Store name for display
  },
  verifiedAt: {
    type: Date,
  },
  rejectionReason: {
    type: String,
  },
  // Points awarded after verification
  pointsAwarded: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
videoSubmissionSchema.index({ user: 1, createdAt: -1 });
videoSubmissionSchema.index({ status: 1, createdAt: 1 }); // For verification queue

module.exports = mongoose.model('VideoSubmission', videoSubmissionSchema);
module.exports.VIDEO_STATUS = VIDEO_STATUS;
