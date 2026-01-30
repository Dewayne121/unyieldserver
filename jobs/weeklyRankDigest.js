/**
 * Weekly Rank Digest Job
 * Runs every Sunday at 9:00 AM UTC to send weekly rank change notifications
 */

const cron = require('node-cron');
const prisma = require('../src/prisma');
const { sendWeeklyRankDigest } = require('../services/notificationService');

/**
 * Calculate user rank based on total points
 * @param {number} totalPoints - User's total points
 * @returns {number} Calculated rank (1-99)
 */
const calculateRank = (totalPoints) => {
  return Math.max(1, 100 - Math.floor(totalPoints / 250));
};

/**
 * Process weekly rank digest for all opted-in users
 */
const processWeeklyRankDigest = async () => {
  console.log('Starting weekly rank digest job...');
  const startTime = Date.now();

  try {
    // Find all users with weekly rank digest enabled
    const users = await prisma.user.findMany({
      where: {
        notificationsEnabled: true,
        notifyRankDownWeekly: true,
      },
      select: {
        id: true,
        username: true,
        totalPoints: true,
        rank: true,
        lastRankDigestSentAt: true,
      },
    });

    console.log(`Found ${users.length} users with weekly digest enabled`);

    let processedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      // Skip if already sent digest this week (within last 7 days)
      if (user.lastRankDigestSentAt) {
        const daysSinceLastDigest = (Date.now() - new Date(user.lastRankDigestSentAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceLastDigest < 6) {
          skippedCount++;
          continue;
        }
      }

      // Calculate what the user's rank was last week
      // We'll estimate this by recalculating based on current points
      // In a real production system, you'd want to store historical rank data
      const currentRank = user.rank;
      const estimatedOldRank = calculateRank(user.totalPoints - 50); // Assume ~50 points gained per week

      // Send weekly digest
      await sendWeeklyRankDigest(user.id, estimatedOldRank, currentRank);
      processedCount++;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Weekly rank digest completed in ${duration}s`);
    console.log(`Processed: ${processedCount}, Skipped: ${skippedCount}`);
  } catch (error) {
    console.error('Error processing weekly rank digest:', error);
  }
};

/**
 * Initialize the weekly rank digest cron job
 * Schedule: Every Sunday at 9:00 AM UTC
 */
const initializeWeeklyRankDigest = () => {
  // Cron expression: 0 9 * * 0 (9:00 AM every Sunday)
  cron.schedule('0 9 * * 0', () => {
    console.log('Running weekly rank digest job - Sunday at 9:00 AM UTC');
    processWeeklyRankDigest();
  }, {
    timezone: 'UTC',
  });

  console.log('Weekly rank digest job scheduled: Every Sunday at 9:00 AM UTC');
};

// Auto-start if this file is run directly
if (require.main === module) {
  console.log('Running weekly rank digest job manually...');
  processWeeklyRankDigest()
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
  initializeWeeklyRankDigest,
  processWeeklyRankDigest,
};
