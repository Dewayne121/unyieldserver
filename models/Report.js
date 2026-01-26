const mongoose = require('mongoose');

const REPORT_STATUS = ['pending', 'reviewed', 'resolved', 'dismissed'];
const REPORT_TYPES = ['suspicious_lift', 'fake_video', 'inappropriate', 'spam', 'other'];

const reportSchema = new mongoose.Schema({
  // Who is reporting
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // What is being reported
  videoSubmission: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VideoSubmission',
    required: true,
  },
  // Type of report
  reportType: {
    type: String,
    enum: REPORT_TYPES,
    required: true,
  },
  reason: {
    type: String,
    required: true,
    maxlength: 500,
  },
  status: {
    type: String,
    enum: REPORT_STATUS,
    default: 'pending',
  },
  // Admin review
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  reviewedAt: {
    type: Date,
  },
  reviewNotes: {
    type: String,
  },
  // Action taken
  actionTaken: {
    type: String, // e.g., 'video_removed', 'user_warned', 'no_action'
  },
}, {
  timestamps: true,
});

// Index for efficient queries
reportSchema.index({ status: 1, createdAt: 1 }); // For moderation queue
reportSchema.index({ videoSubmission: 1 }); // To find reports for a video
reportSchema.index({ reporter: 1 }); // To find reports by a user

module.exports = mongoose.model('Report', reportSchema);
module.exports.REPORT_STATUS = REPORT_STATUS;
module.exports.REPORT_TYPES = REPORT_TYPES;
