/**
 * Challenge Ending Notifier Job
 * Runs every hour to find challenges ending in the next 24 hours and notify participants
 */

const cron = require('node-cron');
const prisma = require('../src/prisma');
const { notifyChallengeEndingSoon } = require('../services/notificationService');

// Track notified challenges to avoid duplicate notifications
const notifiedChallenges = new Map(); // challengeId -> Set of userIds

/**
 * Clear old entries from notified challenges cache
 * Remove entries older than 48 hours
 */
const clearOldNotifiedChallenges = () => {
  const now = Date.now();
  const fortyEightHoursAgo = now - (48 * 60 * 60 * 1000);

  for (const [challengeId, users] of notifiedChallenges.entries()) {
    // Get the oldest timestamp for this challenge
    const oldestTimestamp = Math.min(...Array.from(users.values()));

    if (oldestTimestamp < fortyEightHoursAgo) {
      notifiedChallenges.delete(challengeId);
      console.log(`Cleared notified challenge cache for: ${challengeId}`);
    }
  }
};

/**
 * Process challenge ending notifications
 */
const processChallengeEndingNotifications = async () => {
  console.log('Starting challenge ending notification job...');
  const startTime = Date.now();

  try {
    // Clear old cache entries
    clearOldNotifiedChallenges();

    // Find active challenges ending in the next 24 hours (but more than 23 hours from now)
    // This ensures we only notify once per challenge
    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const twentyThreeHoursFromNow = new Date(now.getTime() + 23 * 60 * 60 * 1000);

    const challengesEndingSoon = await prisma.challenge.findMany({
      where: {
        isActive: true,
        endDate: {
          gte: twentyThreeHoursFromNow,
          lte: twentyFourHoursFromNow,
        },
      },
      select: {
        id: true,
        title: true,
        endDate: true,
      },
    });

    console.log(`Found ${challengesEndingSoon.length} challenges ending in 24 hours`);

    let notifiedCount = 0;

    for (const challenge of challengesEndingSoon) {
      // Skip if we've already notified users for this challenge
      if (notifiedChallenges.has(challenge.id)) {
        console.log(`Challenge ${challenge.id} already processed, skipping`);
        continue;
      }

      // Get participants for this challenge
      const userChallenges = await prisma.userChallenge.findMany({
        where: {
          challengeId: challenge.id,
          completed: false,
        },
        select: {
          userId: true,
        },
      });

      if (userChallenges.length === 0) {
        console.log(`No participants for challenge ${challenge.id}`);
        continue;
      }

      // Send notifications
      const notificationsSent = await notifyChallengeEndingSoon(challenge);
      notifiedCount += notificationsSent;

      // Mark this challenge as notified
      notifiedChallenges.set(challenge.id, new Map(
        userChallenges.map(uc => [uc.userId, Date.now()])
      ));

      console.log(`Notified ${notificationsSent} participants for challenge "${challenge.title}"`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Challenge ending notification job completed in ${duration}s`);
    console.log(`Total notifications sent: ${notifiedCount}`);
  } catch (error) {
    console.error('Error processing challenge ending notifications:', error);
  }
};

/**
 * Initialize the challenge ending notifier cron job
 * Schedule: Every hour at minute 0
 */
const initializeChallengeEndingNotifier = () => {
  // Cron expression: 0 * * * * (every hour)
  cron.schedule('0 * * * *', () => {
    console.log('Running challenge ending notification job - Hourly check');
    processChallengeEndingNotifications();
  }, {
    timezone: 'UTC',
  });

  console.log('Challenge ending notifier job scheduled: Every hour');
};

// Auto-start if this file is run directly
if (require.main === module) {
  console.log('Running challenge ending notification job manually...');
  processChallengeEndingNotifications()
    .then(() => {
      console.log('Job completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Job failed:', error);
      process.exit(1);
    });
}

module.exports = {
  initializeChallengeEndingNotifier,
  processChallengeEndingNotifications,
};
