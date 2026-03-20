// Rank Movement & Notification Service
// Tracks rank changes and sends overtaken notifications

const prisma = require('../src/prisma');
const { sendPushNotification } = require('./notifications');

/**
 * Take rank snapshot for movement tracking
 *
 * @param {string} userId - User ID
 * @param {string} context - 'core_lift' | 'challenge'
 * @param {string} contextId - Challenge ID or lift type
 * @param {Object} extraContext - Additional context (weightClass, region, etc.)
 */
async function takeRankSnapshot(userId, context, contextId, extraContext = {}) {
  let rank = null;

  if (context === 'core_lift') {
    const record = await prisma.coreLiftRecord.findFirst({
      where: {
        userId,
        liftType: contextId,
        verified: true
      },
      orderBy: { estimated1RM: 'desc' }
    });

    if (record) {
      const ahead = await prisma.coreLiftRecord.count({
        where: {
          verified: true,
          liftType: contextId,
          userId: { not: userId },
          estimated1RM: { gt: record?.estimated1RM || 0 }
        }
      });
      rank = ahead + 1;
    }
  } else if (context === 'challenge') {
    const uc = await prisma.userChallenge.findUnique({
      where: { userId_challengeId: { userId, challengeId: contextId } }
    });

    if (uc) {
      const progress = uc.progress || 0;
      const ahead = await prisma.userChallenge.count({
        where: {
          challengeId: contextId,
          userId: { not: userId },
          progress: { gt: progress }
        }
      });
      rank = ahead + 1;
    }
  }

  if (rank !== null) {
    await prisma.rankSnapshot.create({
      data: {
        userId,
        context,
        contextId,
        liftType: context === 'core_lift' ? contextId : null,
        rank,
        ...extraContext
      }
    });
  }
}

/**
 * Check for overtaken users and notify when a new record is verified
 *
 * @param {string} liftType - 'bench_press' | 'deadlift' | 'squat'
 * @param {string} newRecordUserId - User who submitted the new record
 * @param {string} newRecordId - ID of the new record
 * @param {number} newRecord1RM - The 1RM value of the new record
 */
async function notifyOvertakenUsers(liftType, newRecordUserId, newRecordId) {
  const newRecord = await prisma.coreLiftRecord.findUnique({
    where: { id: newRecordId },
    include: { user: true }
  });

  if (!newRecord) {
    console.log('[RankNotifications] New record not found:', newRecordId);
    return;
  }

  const overtakenRecords = await prisma.coreLiftRecord.findMany({
    where: {
      liftType,
      verified: true,
      userId: { not: newRecordUserId },
      estimated1RM: { lt: newRecord.estimated1RM }
    },
    include: { user: true }
  });

  for (const record of overtakenRecords) {
    // Check if user has opted into rank down notifications
    if (record.user.notifyRankDownWeekly) {
      await sendPushNotification({
        to: record.user.pushToken,
        title: 'Rank Update',
        body: `You were overtaken in ${liftType.replace('_', ' ').toUpperCase()}!`,
        data: {
          type: 'rank_down',
          screen: 'CoreLiftLeaderboard',
          params: { liftType }
        }
      });
    }
  }
}

/**
 * Get rank movement from snapshots
 * Shows +/- change compared to previous snapshot
 *
 * @param {string} userId - User ID
 * @param {string} context - 'core_lift' | 'challenge'
 * @param {string} contextId - Challenge ID or lift type
 * @returns {Promise<Object>} Current rank, previous rank, movement
 */
async function getRankMovement(userId, context, contextId) {
  const snapshots = await prisma.rankSnapshot.findMany({
    where: {
      userId,
      context,
      contextId
    },
    orderBy: { createdAt: 'desc' },
    take: 2
  });

  if (snapshots.length < 2) {
    return { current: snapshots[0]?.rank || null, previous: null, movement: 0 };
  }

  const current = snapshots[0].rank;
  const previous = snapshots[1].rank;
  const movement = previous - current;

  return {
    current,
    previous,
    movement
  };
}

/**
 * Get current progress for a user in a challenge
 */
async function getCurrentProgress(userId, challengeId) {
  const uc = await prisma.userChallenge.findUnique({
    where: { userId_challengeId: { userId, challengeId } }
  });
  return uc?.progress || 0;
}

module.exports = {
  takeRankSnapshot,
  notifyOvertakenUsers,
  getRankMovement,
  getCurrentProgress
};
