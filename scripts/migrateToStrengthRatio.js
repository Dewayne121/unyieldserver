/**
 * Migration Script: Convert to Strength Ratio System
 *
 * This script migrates the existing database from the points-based system
 * to the new strength ratio scoring system with weight classes.
 *
 * Run: node unyieldserver/scripts/migrateToStrengthRatio.js
 */

const prisma = require('../src/prisma');
const { calculateStrengthRatio, getWeightClass, getWeightClassLabel } = require('../src/utils/strengthRatio');

async function migrate() {
  console.log('='.repeat(60));
  console.log('Starting migration to Strength Ratio system...');
  console.log('='.repeat(60));

  try {
    // Get all users with their workouts
    const users = await prisma.user.findMany({
      include: {
        workouts: {
          where: {
            OR: [
              { videoSubmission: { status: 'approved' } },
              { videoSubmission: null }
            ]
          }
        }
      }
    });

    console.log(`\nFound ${users.length} users to migrate\n`);

    let migratedCount = 0;
    let skippedCount = 0;
    let unclassifiedCount = 0;

    for (const user of users) {
      try {
        // Determine weight class
        const weightClass = user.weight ? getWeightClass(user.weight) : 'UNCLASSIFIED';

        // Calculate aggregate strength ratio
        let totalRatio = 0;
        let workoutCount = 0;

        for (const workout of user.workouts) {
          if (user.weight && user.weight > 0 && workout.weight && workout.reps) {
            const weightLifted = workout.reps * workout.weight;
            const ratio = calculateStrengthRatio({
              weightLifted,
              bodyweight: user.weight,
              reps: workout.reps
            });

            totalRatio += ratio;
            workoutCount++;

            // Store individual workout ratio
            await prisma.workout.update({
              where: { id: workout.id },
              data: { strengthRatio: ratio }
            });
          }
        }

        // Update user
        await prisma.user.update({
          where: { id: user.id },
          data: {
            weightClass,
            strengthRatio: totalRatio
          }
        });

        migratedCount++;

        const weightLabel = getWeightClassLabel(weightClass);
        const ratioDisplay = totalRatio.toFixed(3);

        if (weightClass === 'UNCLASSIFIED') {
          unclassifiedCount++;
          console.log(`⚠️  ${user.username || user.id}: UNCLASSIFIED (no weight), ${workoutCount} workouts`);
        } else {
          console.log(`✅ ${user.username || user.id}: ${weightLabel}, ratio: ${ratioDisplay}, ${workoutCount} workouts`);
        }

      } catch (error) {
        console.error(`❌ Error migrating user ${user.username || user.id}:`, error.message);
        skippedCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Migration Summary:');
    console.log(`  ✅ Migrated: ${migratedCount} users`);
    console.log(`  ⚠️  Unclassified (no weight): ${unclassifiedCount}`);
    console.log(`  ❌ Skipped: ${skippedCount}`);
    console.log(`  📊 Total: ${users.length} users`);
    console.log('='.repeat(60));

    // Show weight class distribution
    console.log('\nWeight Class Distribution:');
    const weightClasses = ['W55_64', 'W65_74', 'W75_84', 'W85_94', 'W95_109', 'W110_PLUS', 'UNCLASSIFIED'];

    for (const wc of weightClasses) {
      const count = await prisma.user.count({
        where: { weightClass: wc }
      });
      const label = getWeightClassLabel(wc);
      console.log(`  ${label}: ${count} users`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Verify the migration by checking the leaderboard');
    console.log('  2. Test the new strength ratio calculations');
    console.log('  3. Update any remaining references to "points" with "strength ratio"');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\nPlease check:');
    console.log('  - Database connection is working');
    console.log('  - Prisma schema is up to date (run: npx prisma migrate deploy)');
    console.log('  - Database has valid data');
    process.exit(1);
  }
}

// Run the migration
migrate();
