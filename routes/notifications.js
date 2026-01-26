const express = require('express');
const prisma = require('../src/lib/prisma');
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

module.exports = router;
