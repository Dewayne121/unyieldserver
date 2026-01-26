/**
 * MongoDB to PostgreSQL Migration Script
 *
 * This script migrates all data from MongoDB to PostgreSQL (Railway).
 * It respects foreign key relationships and preserves timestamps.
 *
 * Usage:
 *   MONGODB_URI="mongodb://..." DATABASE_URL="postgresql://..." node scripts/migrate-to-postgres.js
 */

const { MongoClient } = require('mongodb');
const { PrismaClient } = require('@prisma/client');

// Source MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://dewayneshields19_db_user:T8xbe5Fejize96Vc@cluster0.jmsudaz.mongodb.net/unyielding?retryWrites=true&w=majority';

// Target PostgreSQL (Prisma)
const prisma = new PrismaClient();

// ID mapping stores
const idMaps = {
  users: new Map(),           // Mongo ObjectId -> Prisma CUID
  challenges: new Map(),       // Mongo ObjectId -> Prisma CUID
  workouts: new Map(),        // Mongo ObjectId -> Prisma CUID
  videoSubmissions: new Map(), // Mongo ObjectId -> Prisma CUID
};

// MongoDB ObjectId to CUID helper
function toCuid() {
  // Generate a simple unique ID (Prisma will use its own cuid() on create)
  return null; // We'll use the IDs returned by Prisma after create
}

// Helper to convert MongoDB dates to ISO strings
function toDate(mongoDate) {
  if (!mongoDate) return null;
  if (mongoDate instanceof Date) return mongoDate;
  if (mongoDate.$date) return new Date(mongoDate.$date);
  return new Date(mongoDate);
}

// Helper to safely get array value
function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

// Helper to safely get string value
function toString(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

// Main migration function
async function migrate() {
  console.log('='.repeat(60));
  console.log('MONGODB TO POSTGRESQL MIGRATION');
  console.log('='.repeat(60));
  console.log(`MongoDB: ${MONGO_URI.replace(/:[^:]+@/, ':****@')}`);
  console.log(`PostgreSQL: Connected via Prisma`);
  console.log('='.repeat(60));
  console.log();

  let mongoClient;
  let totalMigrated = 0;

  try {
    // Connect to MongoDB
    console.log('[1/11] Connecting to MongoDB...');
    mongoClient = await MongoClient.connect(MONGO_URI);
    const mongoDb = mongoClient.db();
    console.log('       Connected to MongoDB\n');

    // Clear existing data from PostgreSQL (optional - remove if you want to keep existing data)
    console.log('[2/11] Checking existing PostgreSQL data...');
    const existingUserCount = await prisma.user.count();
    if (existingUserCount > 0) {
      console.log(`       Warning: PostgreSQL has ${existingUserCount} users already.`);
      console.log('       Press Ctrl+C to abort, or wait 5 seconds to continue...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    console.log('       Ready to migrate\n');

    // ========================================
    // 1. Migrate Users (no dependencies)
    // ========================================
    console.log('[3/11] Migrating Users...');
    const mongoUsers = await mongoDb.collection('users').find({}).toArray();
    console.log(`       Found ${mongoUsers.length} users in MongoDB`);

    let migratedUsers = 0;
    for (const mongoUser of mongoUsers) {
      try {
        const userData = {
          email: mongoUser.email,
          password: mongoUser.password,
          username: mongoUser.username,
          name: mongoUser.name,
          profileImage: mongoUser.profileImage || null,
          region: mongoUser.region || 'Global',
          goal: mongoUser.goal || null,
          bio: mongoUser.bio || '',
          accolades: toArray(mongoUser.accolades),
          fitnessLevel: mongoUser.fitnessLevel || null,
          workoutFrequency: mongoUser.workoutFrequency || null,
          preferredDays: toArray(mongoUser.preferredDays),
          weight: mongoUser.weight || null,
          height: mongoUser.height || null,
          age: mongoUser.age || null,
          totalPoints: mongoUser.totalPoints || 0,
          weeklyPoints: mongoUser.weeklyPoints || 0,
          rank: mongoUser.rank || null,
          streak: mongoUser.streak || 0,
          streakBest: mongoUser.streakBest || 0,
          lastWorkoutDate: toDate(mongoUser.lastWorkoutDate),
          provider: mongoUser.provider || 'local',
          createdAt: toDate(mongoUser.createdAt),
          updatedAt: toDate(mongoUser.updatedAt),
        };

        // Handle anonymous users
        if (!userData.email && !userData.username) {
          userData.username = `anon_${mongoUser._id.toString()}`;
        }

        const prismaUser = await prisma.user.create({ data: userData });
        idMaps.users.set(mongoUser._id.toString(), prismaUser.id);
        migratedUsers++;
      } catch (err) {
        console.warn(`       Warning: Could not migrate user ${mongoUser._id}: ${err.message}`);
      }
    }
    console.log(`       Migrated ${migratedUsers}/${mongoUsers.length} users\n`);
    totalMigrated += migratedUsers;

    // ========================================
    // 2. Migrate Challenges (optional FK to Users)
    // ========================================
    console.log('[4/11] Migrating Challenges...');
    const mongoChallenges = await mongoDb.collection('challenges').find({}).toArray();
    console.log(`       Found ${mongoChallenges.length} challenges in MongoDB`);

    let migratedChallenges = 0;
    for (const mongoChallenge of mongoChallenges) {
      try {
        const mappedCreatedBy = mongoChallenge.createdBy
          ? idMaps.users.get(mongoChallenge.createdBy.toString())
          : null;

        // Build challenge data - handle foreign key relation properly
        const challengeData = {
          title: mongoChallenge.title,
          description: mongoChallenge.description,
          challengeType: mongoChallenge.challengeType || 'exercise',
          exercises: toArray(mongoChallenge.exercises),
          customMetricName: mongoChallenge.customMetricName || '',
          metricType: mongoChallenge.metricType || 'reps',
          target: mongoChallenge.target,
          startDate: toDate(mongoChallenge.startDate),
          endDate: toDate(mongoChallenge.endDate),
          regionScope: mongoChallenge.regionScope || 'global',
          reward: mongoChallenge.reward || 100,
          requiresVideo: mongoChallenge.requiresVideo !== false,
          minVideoDuration: mongoChallenge.minVideoDuration || 5,
          rules: mongoChallenge.rules || '',
          completionType: mongoChallenge.completionType || 'cumulative',
          winnerCriteria: mongoChallenge.winnerCriteria || 'first_to_complete',
          maxParticipants: mongoChallenge.maxParticipants || 0,
          isActive: mongoChallenge.isActive !== false,
          createdAt: toDate(mongoChallenge.createdAt),
          updatedAt: toDate(mongoChallenge.updatedAt),
        };

        // Add createdBy relation if mapped user exists
        if (mappedCreatedBy) {
          challengeData.createdBy = {
            connect: { id: mappedCreatedBy }
          };
        }

        const prismaChallenge = await prisma.challenge.create({ data: challengeData });
        idMaps.challenges.set(mongoChallenge._id.toString(), prismaChallenge.id);
        migratedChallenges++;
      } catch (err) {
        console.warn(`       Warning: Could not migrate challenge ${mongoChallenge._id}: ${err.message}`);
      }
    }
    console.log(`       Migrated ${migratedChallenges}/${mongoChallenges.length} challenges\n`);
    totalMigrated += migratedChallenges;

    // ========================================
    // 3. Migrate Workouts (FK to Users)
    // ========================================
    console.log('[5/11] Migrating Workouts...');
    const mongoWorkouts = await mongoDb.collection('workouts').find({}).toArray();
    console.log(`       Found ${mongoWorkouts.length} workouts in MongoDB`);

    let migratedWorkouts = 0;
    for (const mongoWorkout of mongoWorkouts) {
      try {
        const mappedUserId = idMaps.users.get(mongoWorkout.user?.toString());

        if (!mappedUserId) {
          console.warn(`       Warning: Workout ${mongoWorkout._id} has no valid user, skipping`);
          continue;
        }

        const workoutData = {
          userId: mappedUserId,
          exercise: mongoWorkout.exercise,
          reps: mongoWorkout.reps || 0,
          weight: mongoWorkout.weight || null,
          duration: mongoWorkout.duration || null,
          points: mongoWorkout.points || 0,
          notes: mongoWorkout.notes || null,
          date: toDate(mongoWorkout.date),
          createdAt: toDate(mongoWorkout.createdAt),
          updatedAt: toDate(mongoWorkout.updatedAt),
        };

        const prismaWorkout = await prisma.workout.create({ data: workoutData });
        idMaps.workouts.set(mongoWorkout._id.toString(), prismaWorkout.id);
        migratedWorkouts++;
      } catch (err) {
        console.warn(`       Warning: Could not migrate workout ${mongoWorkout._id}: ${err.message}`);
      }
    }
    console.log(`       Migrated ${migratedWorkouts}/${mongoWorkouts.length} workouts\n`);
    totalMigrated += migratedWorkouts;

    // ========================================
    // 4. Migrate VideoSubmissions (FK to Users, optional FK to Workouts)
    // ========================================
    console.log('[6/11] Migrating VideoSubmissions...');
    const mongoVideos = await mongoDb.collection('videosubmissions').find({}).toArray();
    console.log(`       Found ${mongoVideos.length} video submissions in MongoDB`);

    let migratedVideos = 0;
    for (const mongoVideo of mongoVideos) {
      try {
        const mappedUserId = idMaps.users.get(mongoVideo.user?.toString());
        const mappedWorkoutId = mongoVideo.workout
          ? idMaps.workouts.get(mongoVideo.workout.toString())
          : null;
        const mappedVerifiedBy = mongoVideo.verifiedBy
          ? idMaps.users.get(mongoVideo.verifiedBy.toString())
          : null;

        if (!mappedUserId) {
          console.warn(`       Warning: Video ${mongoVideo._id} has no valid user, skipping`);
          continue;
        }

        const videoData = {
          userId: mappedUserId,
          workoutId: mappedWorkoutId,
          exercise: mongoVideo.exercise,
          reps: mongoVideo.reps || 0,
          weight: mongoVideo.weight || null,
          duration: mongoVideo.duration || null,
          points: mongoVideo.points || 0,
          pointsAwarded: mongoVideo.pointsAwarded || 0,
          videoUrl: mongoVideo.videoUrl || null,
          thumbnailUrl: mongoVideo.thumbnailUrl || null,
          status: mongoVideo.status || 'pending',
          verifiedById: mappedVerifiedBy || null,
          verifiedByName: mongoVideo.verifiedByName || null,
          verifiedAt: toDate(mongoVideo.verifiedAt),
          rejectionReason: mongoVideo.rejectionReason || null,
          createdAt: toDate(mongoVideo.createdAt),
          updatedAt: toDate(mongoVideo.updatedAt),
        };

        const prismaVideo = await prisma.videoSubmission.create({ data: videoData });
        idMaps.videoSubmissions.set(mongoVideo._id.toString(), prismaVideo.id);
        migratedVideos++;
      } catch (err) {
        console.warn(`       Warning: Could not migrate video ${mongoVideo._id}: ${err.message}`);
      }
    }
    console.log(`       Migrated ${migratedVideos}/${mongoVideos.length} video submissions\n`);
    totalMigrated += migratedVideos;

    // ========================================
    // 5. Migrate UserChallenges (FK to Users, FK to Challenges)
    // ========================================
    console.log('[7/11] Migrating UserChallenges...');
    const mongoUserChallenges = await mongoDb.collection('userchallenges').find({}).toArray();
    console.log(`       Found ${mongoUserChallenges.length} user challenges in MongoDB`);

    let migratedUserChallenges = 0;
    for (const mongoUC of mongoUserChallenges) {
      try {
        const mappedUserId = idMaps.users.get(mongoUC.user?.toString());
        const mappedChallengeId = idMaps.challenges.get(mongoUC.challenge?.toString());

        if (!mappedUserId || !mappedChallengeId) {
          console.warn(`       Warning: UserChallenge ${mongoUC._id} missing user or challenge, skipping`);
          continue;
        }

        const ucData = {
          userId: mappedUserId,
          challengeId: mappedChallengeId,
          progress: mongoUC.progress || 0,
          completed: mongoUC.completed || false,
          completedAt: toDate(mongoUC.completedAt),
          createdAt: toDate(mongoUC.createdAt),
          updatedAt: toDate(mongoUC.updatedAt),
        };

        await prisma.userChallenge.create({ data: ucData });
        migratedUserChallenges++;
      } catch (err) {
        // Handle unique constraint violations gracefully
        if (err.code === 'P2002') {
          console.warn(`       Warning: UserChallenge already exists, skipping`);
        } else {
          console.warn(`       Warning: Could not migrate userChallenge ${mongoUC._id}: ${err.message}`);
        }
      }
    }
    console.log(`       Migrated ${migratedUserChallenges}/${mongoUserChallenges.length} user challenges\n`);
    totalMigrated += migratedUserChallenges;

    // ========================================
    // 6. Migrate ChallengeSubmissions (FK to Users, FK to Challenges)
    // ========================================
    console.log('[8/11] Migrating ChallengeSubmissions...');
    const mongoChallengeSubmissions = await mongoDb.collection('challengesubmissions').find({}).toArray();
    console.log(`       Found ${mongoChallengeSubmissions.length} challenge submissions in MongoDB`);

    let migratedChallengeSubmissions = 0;
    for (const mongoCS of mongoChallengeSubmissions) {
      try {
        const mappedUserId = idMaps.users.get(mongoCS.user?.toString());
        const mappedChallengeId = idMaps.challenges.get(mongoCS.challenge?.toString());
        const mappedVerifiedBy = mongoCS.verifiedBy
          ? idMaps.users.get(mongoCS.verifiedBy.toString())
          : null;

        if (!mappedUserId || !mappedChallengeId) {
          console.warn(`       Warning: ChallengeSubmission ${mongoCS._id} missing user or challenge, skipping`);
          continue;
        }

        const csData = {
          userId: mappedUserId,
          challengeId: mappedChallengeId,
          exercise: mongoCS.exercise,
          reps: mongoCS.reps || 0,
          weight: mongoCS.weight || null,
          duration: mongoCS.duration || null,
          value: mongoCS.value || 0,
          videoUri: mongoCS.videoUri || null,
          videoUrl: mongoCS.videoUrl || null,
          serverVideoId: mongoCS.serverVideoId || null,
          status: mongoCS.status || 'pending',
          verifiedAt: toDate(mongoCS.verifiedAt),
          rejectionReason: mongoCS.rejectionReason || null,
          notes: mongoCS.notes || null,
          submittedAt: toDate(mongoCS.submittedAt),
          createdAt: toDate(mongoCS.createdAt),
          updatedAt: toDate(mongoCS.updatedAt),
        };

        // Add verifiedBy relation if exists
        if (mappedVerifiedBy) {
          csData.verifiedBy = { connect: { id: mappedVerifiedBy } };
          delete csData.verifiedById;
        }

        await prisma.challengeSubmission.create({ data: csData });
        migratedChallengeSubmissions++;
      } catch (err) {
        console.warn(`       Warning: Could not migrate challengeSubmission ${mongoCS._id}: ${err.message}`);
      }
    }
    console.log(`       Migrated ${migratedChallengeSubmissions}/${mongoChallengeSubmissions.length} challenge submissions\n`);
    totalMigrated += migratedChallengeSubmissions;

    // ========================================
    // 7. Migrate Appeals (FK to Users, FK to VideoSubmissions)
    // ========================================
    console.log('[9/11] Migrating Appeals...');
    const mongoAppeals = await mongoDb.collection('appeals').find({}).toArray();
    console.log(`       Found ${mongoAppeals.length} appeals in MongoDB`);

    let migratedAppeals = 0;
    for (const mongoAppeal of mongoAppeals) {
      try {
        const mappedUserId = idMaps.users.get(mongoAppeal.user?.toString());
        const mappedVideoId = idMaps.videoSubmissions.get(mongoAppeal.videoSubmission?.toString());
        const mappedReviewedBy = mongoAppeal.reviewedBy
          ? idMaps.users.get(mongoAppeal.reviewedBy.toString())
          : null;

        if (!mappedUserId || !mappedVideoId) {
          console.warn(`       Warning: Appeal ${mongoAppeal._id} missing user or video, skipping`);
          continue;
        }

        const appealData = {
          userId: mappedUserId,
          videoSubmissionId: mappedVideoId,
          reason: mongoAppeal.reason || '',
          status: mongoAppeal.status || 'pending',
          reviewedById: mappedReviewedBy || null,
          reviewedByName: mongoAppeal.reviewedByName || null,
          reviewedAt: toDate(mongoAppeal.reviewedAt),
          reviewNotes: mongoAppeal.reviewNotes || null,
          createdAt: toDate(mongoAppeal.createdAt),
          updatedAt: toDate(mongoAppeal.updatedAt),
        };

        await prisma.appeal.create({ data: appealData });
        migratedAppeals++;
      } catch (err) {
        console.warn(`       Warning: Could not migrate appeal ${mongoAppeal._id}: ${err.message}`);
      }
    }
    console.log(`       Migrated ${migratedAppeals}/${mongoAppeals.length} appeals\n`);
    totalMigrated += migratedAppeals;

    // ========================================
    // 8. Migrate Reports (FK to Users, FK to VideoSubmissions)
    // ========================================
    console.log('[10/11] Migrating Reports...');
    const mongoReports = await mongoDb.collection('reports').find({}).toArray();
    console.log(`       Found ${mongoReports.length} reports in MongoDB`);

    let migratedReports = 0;
    for (const mongoReport of mongoReports) {
      try {
        const mappedReporterId = idMaps.users.get(mongoReport.reporter?.toString());
        const mappedVideoId = idMaps.videoSubmissions.get(mongoReport.videoSubmission?.toString());
        const mappedReviewedBy = mongoReport.reviewedBy
          ? idMaps.users.get(mongoReport.reviewedBy.toString())
          : null;

        if (!mappedReporterId || !mappedVideoId) {
          console.warn(`       Warning: Report ${mongoReport._id} missing reporter or video, skipping`);
          continue;
        }

        const reportData = {
          reporterId: mappedReporterId,
          videoSubmissionId: mappedVideoId,
          reportType: mongoReport.reportType,
          reason: mongoReport.reason || '',
          status: mongoReport.status || 'pending',
          reviewedById: mappedReviewedBy || null,
          reviewedAt: toDate(mongoReport.reviewedAt),
          reviewNotes: mongoReport.reviewNotes || null,
          actionTaken: mongoReport.actionTaken || null,
          createdAt: toDate(mongoReport.createdAt),
          updatedAt: toDate(mongoReport.updatedAt),
        };

        await prisma.report.create({ data: reportData });
        migratedReports++;
      } catch (err) {
        console.warn(`       Warning: Could not migrate report ${mongoReport._id}: ${err.message}`);
      }
    }
    console.log(`       Migrated ${migratedReports}/${mongoReports.length} reports\n`);
    totalMigrated += migratedReports;

    // ========================================
    // 9. Migrate Notifications (FK to Users)
    // ========================================
    console.log('[11/11] Migrating Notifications...');
    const mongoNotifications = await mongoDb.collection('notifications').find({}).toArray();
    console.log(`       Found ${mongoNotifications.length} notifications in MongoDB`);

    let migratedNotifications = 0;
    for (const mongoNotification of mongoNotifications) {
      try {
        const mappedUserId = idMaps.users.get(mongoNotification.user?.toString());

        if (!mappedUserId) {
          console.warn(`       Warning: Notification ${mongoNotification._id} has no valid user, skipping`);
          continue;
        }

        const notificationData = {
          userId: mappedUserId,
          type: mongoNotification.type || 'info',
          title: mongoNotification.title || '',
          message: mongoNotification.message || '',
          read: mongoNotification.read || false,
          readAt: toDate(mongoNotification.readAt),
          createdAt: toDate(mongoNotification.createdAt),
          updatedAt: toDate(mongoNotification.updatedAt),
        };

        await prisma.notification.create({ data: notificationData });
        migratedNotifications++;
      } catch (err) {
        console.warn(`       Warning: Could not migrate notification ${mongoNotification._id}: ${err.message}`);
      }
    }
    console.log(`       Migrated ${migratedNotifications}/${mongoNotifications.length} notifications\n`);
    totalMigrated += migratedNotifications;

    // ========================================
    // 10. Migrate AdminActions (FK to Users)
    // ========================================
    console.log('[12/12] Migrating AdminActions...');
    const mongoAdminActions = await mongoDb.collection('adminactions').find({}).toArray();
    console.log(`       Found ${mongoAdminActions.length} admin actions in MongoDB`);

    let migratedAdminActions = 0;
    for (const mongoAction of mongoAdminActions) {
      try {
        const mappedAdminId = idMaps.users.get(mongoAction.admin?.toString());

        if (!mappedAdminId) {
          console.warn(`       Warning: AdminAction ${mongoAction._id} has no valid admin, skipping`);
          continue;
        }

        // Convert targetId from Buffer to string if needed
        let targetId = mongoAction.targetId;
        if (targetId && typeof targetId === 'object' && Buffer.isBuffer(targetId)) {
          targetId = targetId.toString('hex');
        } else if (targetId && typeof targetId === 'object') {
          targetId = JSON.stringify(targetId);
        }

        const actionData = {
          adminId: mappedAdminId,
          adminName: mongoAction.adminName || 'Admin',
          action: mongoAction.action || 'unknown',
          targetType: mongoAction.targetType || null,
          targetId: targetId,
          details: mongoAction.details || {},
          ipAddress: mongoAction.ipAddress || null,
          userAgent: mongoAction.userAgent || null,
          createdAt: toDate(mongoAction.createdAt),
        };

        await prisma.adminAction.create({ data: actionData });
        migratedAdminActions++;
      } catch (err) {
        console.warn(`       Warning: Could not migrate adminAction ${mongoAction._id}: ${err.message}`);
      }
    }
    console.log(`       Migrated ${migratedAdminActions}/${mongoAdminActions.length} admin actions\n`);
    totalMigrated += migratedAdminActions;

    // ========================================
    // Summary
    // ========================================
    console.log('='.repeat(60));
    console.log('MIGRATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total records migrated: ${totalMigrated}`);
    console.log(`  - Users:               ${migratedUsers}`);
    console.log(`  - Challenges:          ${migratedChallenges}`);
    console.log(`  - Workouts:            ${migratedWorkouts}`);
    console.log(`  - VideoSubmissions:    ${migratedVideos}`);
    console.log(`  - UserChallenges:      ${migratedUserChallenges}`);
    console.log(`  - ChallengeSubmissions: ${migratedChallengeSubmissions}`);
    console.log(`  - Appeals:             ${migratedAppeals}`);
    console.log(`  - Reports:             ${migratedReports}`);
    console.log(`  - Notifications:       ${migratedNotifications}`);
    console.log(`  - AdminActions:        ${migratedAdminActions}`);
    console.log('='.repeat(60));
    console.log();
    console.log('Next steps:');
    console.log('1. Verify the data in PostgreSQL');
    console.log('2. Test the application with the new database');
    console.log('3. Remove mongoose from package.json when verified');
    console.log();

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    // Cleanup
    await mongoClient?.close();
    await prisma.$disconnect();
  }
}

// Run the migration
migrate().catch((error) => {
  console.error('Fatal error during migration:', error);
  process.exit(1);
});
