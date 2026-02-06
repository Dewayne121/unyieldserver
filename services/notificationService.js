/**
 * Notification Service
 * Handles all notification creation and push notification delivery via Expo
 */

const { Expo } = require('expo-server-sdk');
const prisma = require('../src/prisma');
const PUSH_CHANNEL_ID = 'unyield_high_priority';

// Create Expo client
const expo = new Expo();

// Streak milestone thresholds (in days)
const STREAK_MILESTONES = [7, 14, 30, 60, 100, 365];

/**
 * Create a notification record in the database and optionally send push notification
 * @param {string} userId - User ID to notify
 * @param {string} type - Notification type (rank_up, rank_down, streak_milestone, etc.)
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} data - Additional data for deep linking
 * @returns {Promise<object>} Created notification
 */
const notifyUser = async (userId, type, title, message, data = {}) => {
  try {
    // Get user to check notification preferences
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
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
      console.log(`notifyUser: User ${userId} not found`);
      return null;
    }

    // Check if user has notifications enabled globally
    if (!user.notificationsEnabled) {
      console.log(`notifyUser: User ${userId} has notifications disabled`);
      return null;
    }

    // Check granular preferences based on notification type
    let shouldSendPush = false;
    switch (type) {
      case 'rank_up':
        shouldSendPush = user.notifyRankUp;
        break;
      case 'rank_down':
        shouldSendPush = user.notifyRankDownWeekly;
        break;
      case 'streak_milestone':
        shouldSendPush = user.notifyStreakMilestone;
        break;
      case 'new_challenge':
        shouldSendPush = user.notifyNewChallenges;
        break;
      case 'challenge_ending':
        shouldSendPush = user.notifyChallengeEnding;
        break;
      default:
        shouldSendPush = true; // Default for other types
    }

    // Create notification record
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data,
      },
    });

    // Send push notification if enabled and user has push token
    if (shouldSendPush && user.pushToken) {
      await sendPushNotification(user.pushToken, title, message, data, notification.id);
    }

    console.log(`notifyUser: Created notification ${notification.id} for user ${userId}`);
    return notification;
  } catch (error) {
    console.error('notifyUser error:', error);
    return null;
  }
};

/**
 * Send push notification via Expo
 * @param {string} pushToken - Expo push token
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} data - Additional data for deep linking
 * @param {string} notificationId - Database notification ID
 * @returns {Promise<boolean>} Success status
 */
const sendPushNotification = async (pushToken, title, message, data = {}, notificationId = null) => {
  try {
    // Check if token is valid
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`sendPushNotification: Invalid push token: ${pushToken}`);
      return false;
    }

    // Create notification message
    const expoMessage = {
      to: pushToken,
      sound: 'default',
      channelId: PUSH_CHANNEL_ID,
      title,
      body: message,
      data: data,
      priority: 'high',
    };

    // Send notification
    const tickets = await expo.sendPushNotificationsAsync([expoMessage]);

    // Handle response
    const ticket = tickets[0];
    if (ticket.status === 'ok') {
      console.log(`sendPushNotification: Push notification sent successfully`);

      // Update notification record with push notification ID
      if (notificationId) {
        await prisma.notification.update({
          where: { id: notificationId },
          data: {
            pushNotificationId: ticket.id,
            pushNotificationSent: true,
          },
        });
      }

      return true;
    } else if (ticket.status === 'error') {
      console.error(`sendPushNotification: Expo error - ${ticket.message}`);

      // If token is invalid, remove it from user
      if (ticket.details && ticket.details.error === 'DeviceNotRegistered') {
        console.log(`sendPushNotification: Removing invalid push token`);
        await prisma.user.updateMany({
          where: { pushToken },
          data: { pushToken: null },
        });
      }

      return false;
    }

    return false;
  } catch (error) {
    console.error('sendPushNotification error:', error);
    return false;
  }
};

/**
 * Check and notify streak milestone
 * @param {string} userId - User ID
 * @param {number} streak - Current streak value
 * @returns {Promise<boolean>} True if milestone was notified
 */
const checkAndNotifyStreakMilestone = async (userId, streak) => {
  try {
    // Check if streak is a milestone
    if (!STREAK_MILESTONES.includes(streak)) {
      return false;
    }

    const title = 'Streak Milestone!';
    const message = `Congratulations! You've reached a ${streak}-day streak! Keep pushing!`;

    await notifyUser(userId, 'streak_milestone', title, message, {
      screen: 'Profile',
      userId,
    });

    console.log(`checkAndNotifyStreakMilestone: Notified user ${userId} of ${streak} day milestone`);
    return true;
  } catch (error) {
    console.error('checkAndNotifyStreakMilestone error:', error);
    return false;
  }
};

/**
 * Notify rank up (immediate)
 * @param {string} userId - User ID
 * @param {number} oldRank - Previous rank
 * @param {number} newRank - New rank
 * @returns {Promise<boolean>} Success status
 */
const checkAndNotifyRankUp = async (userId, oldRank, newRank) => {
  try {
    // Only notify if rank improved (lower number is better)
    if (newRank >= oldRank) {
      return false;
    }

    const rankChange = oldRank - newRank;
    const title = 'Rank Up!';
    const message = `You moved up ${rankChange} position${rankChange > 1 ? 's' : ''}! Your new rank is #${newRank}.`;

    await notifyUser(userId, 'rank_up', title, message, {
      screen: 'Leaderboard',
    });

    console.log(`checkAndNotifyRankUp: Notified user ${userId} of rank up from ${oldRank} to ${newRank}`);
    return true;
  } catch (error) {
    console.error('checkAndNotifyRankUp error:', error);
    return false;
  }
};

/**
 * Notify all opted-in users of a new challenge
 * @param {object} challenge - Challenge object
 * @returns {Promise<number>} Number of users notified
 */
const notifyNewChallenge = async (challenge) => {
  try {
    // Find all users with new challenge notifications enabled
    const users = await prisma.user.findMany({
      where: {
        notificationsEnabled: true,
        notifyNewChallenges: true,
      },
      select: {
        id: true,
      },
    });

    const title = 'New Challenge!';
    const message = `New challenge "${challenge.title}" is now available! Check it out.`;

    let notifiedCount = 0;
    for (const user of users) {
      const notification = await notifyUser(user.id, 'new_challenge', title, message, {
        screen: 'ChallengeDetail',
        challengeId: challenge.id,
      });
      if (notification) {
        notifiedCount++;
      }
    }

    console.log(`notifyNewChallenge: Notified ${notifiedCount} users of new challenge ${challenge.id}`);
    return notifiedCount;
  } catch (error) {
    console.error('notifyNewChallenge error:', error);
    return 0;
  }
};

/**
 * Notify participants of a challenge ending soon (24 hours before)
 * @param {object} challenge - Challenge object
 * @returns {Promise<number>} Number of users notified
 */
const notifyChallengeEndingSoon = async (challenge) => {
  try {
    // Find all users who joined this challenge and have notifications enabled
    const userChallenges = await prisma.userChallenge.findMany({
      where: {
        challengeId: challenge.id,
        completed: false, // Only notify those who haven't completed it
      },
      include: {
        user: {
          select: {
            id: true,
            pushToken: true,
            notificationsEnabled: true,
            notifyChallengeEnding: true,
          },
        },
      },
    });

    const title = 'Challenge Ending Soon!';
    const message = `"${challenge.title}" ends in 24 hours! Make sure to submit your entry.`;

    let notifiedCount = 0;
    for (const uc of userChallenges) {
      if (uc.user.notificationsEnabled && uc.user.notifyChallengeEnding) {
        const notification = await notifyUser(uc.user.id, 'challenge_ending', title, message, {
          screen: 'ChallengeDetail',
          challengeId: challenge.id,
        });
        if (notification) {
          notifiedCount++;
        }
      }
    }

    console.log(`notifyChallengeEndingSoon: Notified ${notifiedCount} users of challenge ending ${challenge.id}`);
    return notifiedCount;
  } catch (error) {
    console.error('notifyChallengeEndingSoon error:', error);
    return 0;
  }
};

/**
 * Send weekly rank digest to a user
 * @param {string} userId - User ID
 * @param {number} oldRank - Previous rank
 * @param {number} newRank - New rank
 * @returns {Promise<boolean>} Success status
 */
const sendWeeklyRankDigest = async (userId, oldRank, newRank) => {
  try {
    const rankChange = oldRank - newRank;
    let title, message;

    if (rankChange > 0) {
      title = 'Weekly Rank Report';
      message = `You moved up ${rankChange} position${rankChange > 1 ? 's' : ''} this week! Your new rank is #${newRank}.`;
    } else if (rankChange < 0) {
      title = 'Weekly Rank Report';
      message = `You moved down ${Math.abs(rankChange)} position${Math.abs(rankChange) > 1 ? 's' : ''} this week. Your current rank is #${newRank}. Keep pushing!`;
    } else {
      title = 'Weekly Rank Report';
      message = `Your rank remained stable this week at #${newRank}.`;
    }

    await notifyUser(userId, 'rank_down', title, message, {
      screen: 'Leaderboard',
    });

    // Update last rank digest timestamp
    await prisma.user.update({
      where: { id: userId },
      data: { lastRankDigestSentAt: new Date() },
    });

    console.log(`sendWeeklyRankDigest: Sent weekly digest to user ${userId}`);
    return true;
  } catch (error) {
    console.error('sendWeeklyRankDigest error:', error);
    return false;
  }
};

module.exports = {
  notifyUser,
  sendPushNotification,
  checkAndNotifyStreakMilestone,
  checkAndNotifyRankUp,
  notifyNewChallenge,
  notifyChallengeEndingSoon,
  sendWeeklyRankDigest,
  STREAK_MILESTONES,
};
