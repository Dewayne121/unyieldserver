const mongoose = require('mongoose');

const APPEAL_STATUS = ['pending', 'approved', 'denied'];

const appealSchema = new mongoose.Schema({
  // The user appealing
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // The rejected video submission
  videoSubmission: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VideoSubmission',
    required: true,
  },
  reason: {
    type: String,
    required: true,
    maxlength: 1000,
  },
  status: {
    type: String,
    enum: APPEAL_STATUS,
    default: 'pending',
  },
  // Admin review
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  reviewedByName: {
    type: String,
  },
  reviewedAt: {
    type: Date,
  },
  reviewNotes: {
    type: String,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
appealSchema.index({ status: 1, createdAt: 1 }); // For appeal queue
appealSchema.index({ user: 1 }); // To find appeals by user
appealSchema.index({ videoSubmission: 1 }); // To find appeal for a video

// Only one appeal per video submission
appealSchema.index({ videoSubmission: 1 }, { unique: true });

module.exports = mongoose.model('Appeal', appealSchema);
module.exports.APPEAL_STATUS = APPEAL_STATUS;
