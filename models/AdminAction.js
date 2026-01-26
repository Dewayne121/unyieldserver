const mongoose = require('mongoose');

const ACTION_TYPES = [
  'user_viewed',
  'user_updated',
  'user_deleted',
  'user_banned',
  'user_unbanned',
  'accolade_added',
  'accolade_removed',
  'video_approved',
  'video_rejected',
  'appeal_approved',
  'appeal_denied',
  'report_resolved',
  'report_dismissed',
  'notification_sent',
  'challenge_created',
  'challenge_updated',
  'challenge_deleted',
  'settings_updated',
];

const adminActionSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  adminName: {
    type: String,
    required: true,
  },
  action: {
    type: String,
    enum: ACTION_TYPES,
    required: true,
  },
  targetType: {
    type: String,
    enum: ['user', 'video', 'appeal', 'report', 'challenge', 'notification', 'settings'],
    required: true,
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
  },
  ipAddress: {
    type: String,
  },
  userAgent: {
    type: String,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
adminActionSchema.index({ admin: 1, createdAt: -1 });
adminActionSchema.index({ action: 1, createdAt: -1 });
adminActionSchema.index({ targetType: 1, targetId: 1 });

// Static method to log an admin action
adminActionSchema.statics.logAction = async function(data) {
  const action = await this.create(data);
  return action;
};

// Static method to get recent actions by admin
adminActionSchema.statics.getRecentByAdmin = async function(adminId, limit = 100) {
  return this.find({ admin: adminId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('targetId');
};

// Static method to get audit log for a target
adminActionSchema.statics.getAuditLog = async function(targetType, targetId, limit = 100) {
  return this.find({ targetType, targetId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('admin', 'name username');
};

module.exports = mongoose.model('AdminAction', adminActionSchema);
module.exports.ACTION_TYPES = ACTION_TYPES;
