const express = require('express');
const prisma = require('../src/prisma');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/notifications - Get user's notifications
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { limit = 50, unreadOnly = 'false' } = req.query;

  const where = { userId: req.user.id };
  if (unreadOnly === 'true') {
    where.read = false;
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    }),
    prisma.notification.count({
      where: {
        userId: req.user.id,
        read: false,
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      notifications,
      unreadCount,
    },
  });
}));

// PATCH /api/notifications/:id/read - Mark notification as read
router.patch('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const notification = await prisma.notification.findUnique({
    where: { id: req.params.id }
  });

  if (!notification) {
    throw new AppError('Notification not found', 404);
  }

  if (notification.userId !== req.user.id) {
    throw new AppError('Not authorized', 403);
  }

  const updatedNotification = await prisma.notification.update({
    where: { id: req.params.id },
    data: {
      read: true,
      readAt: new Date(),
    },
  });

  res.json({
    success: true,
    data: updatedNotification,
  });
}));

// POST /api/notifications/mark-all-read - Mark all notifications as read
router.post('/mark-all-read', authenticate, asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, read: false },
    data: { read: true, readAt: new Date() },
  });

  res.json({
    success: true,
    message: `Marked ${result.count} notifications as read`,
    data: { markedCount: result.count },
  });
}));

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const notification = await prisma.notification.findUnique({
    where: { id: req.params.id }
  });

  if (!notification) {
    throw new AppError('Notification not found', 404);
  }

  if (notification.userId !== req.user.id) {
    throw new AppError('Not authorized', 403);
  }

  await prisma.notification.delete({
    where: { id: req.params.id }
  });

  res.json({
    success: true,
    message: 'Notification deleted',
  });
}));

// DELETE /api/notifications - Delete all notifications for user
router.delete('/', authenticate, asyncHandler(async (req, res) => {
  const result = await prisma.notification.deleteMany({
    where: { userId: req.user.id }
  });

  res.json({
    success: true,
    message: `Deleted ${result.count} notifications`,
    data: { deletedCount: result.count },
  });
}));

// POST /api/notifications/push-token - Register Expo push token
router.post('/push-token', authenticate, asyncHandler(async (req, res) => {
  const { pushToken } = req.body;

  if (!pushToken) {
    throw new AppError('Push token is required', 400);
  }

  // Validate Expo push token format
  const { Expo } = require('expo-server-sdk');
  if (!Expo.isExpoPushToken(pushToken)) {
    throw new AppError('Invalid push token format', 400);
  }

  await prisma.user.update({
    where: { id: req.user.id },
    data: { pushToken },
  });

  console.log(`User ${req.user.id} registered push token`);

  res.json({
    success: true,
    message: 'Push token registered successfully',
  });
}));

// GET /api/notifications/preferences - Get user's notification preferences
router.get('/preferences', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      notificationsEnabled: true,
      pushToken: true,
      notifyRankUp: true,
      notifyRankDownWeekly: true,
      notifyStreakMilestone: true,
      notifyNewChallenges: true,
      notifyChallengeEnding: true,
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: user,
  });
}));

// PATCH /api/notifications/preferences - Update notification preferences
router.patch('/preferences', authenticate, asyncHandler(async (req, res) => {
  const allowedUpdates = [
    'notificationsEnabled',
    'notifyRankUp',
    'notifyRankDownWeekly',
    'notifyStreakMilestone',
    'notifyNewChallenges',
    'notifyChallengeEnding',
  ];

  const updateData = {};

  for (const key of allowedUpdates) {
    if (req.body[key] !== undefined) {
      // Validate boolean values
      if (typeof req.body[key] !== 'boolean') {
        throw new AppError(`${key} must be a boolean`, 400);
      }
      updateData[key] = req.body[key];
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: req.user.id },
    data: updateData,
    select: {
      notificationsEnabled: true,
      notifyRankUp: true,
      notifyRankDownWeekly: true,
      notifyStreakMilestone: true,
      notifyNewChallenges: true,
      notifyChallengeEnding: true,
    },
  });

  console.log(`User ${req.user.id} updated notification preferences`, updateData);

  res.json({
    success: true,
    data: updatedUser,
    message: 'Notification preferences updated successfully',
  });
}));

module.exports = router;
