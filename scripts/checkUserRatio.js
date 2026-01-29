/**
 * Check and update user's strength ratio based on their workouts
 */

const prisma = require('../src/prisma');
const { calculateStrengthRatio, getWeightClass } = require('../src/utils/strengthRatio');

async function checkUserRatio(username) {
  console.log(`🔍 Checking user: ${username}\n`);

  try {
    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: {
        workouts: {
          where: {
            OR: [
              { videoSubmission: { status: 'approved' } },
              { videoSubmission: null },
            ],
          },
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!user) {
      console.log(`❌ User not found: ${username}`);
      return;
    }

    console.log(`📊 User: ${user.username}`);
    console.log(`   Weight: ${user.weight} kg`);
    console.log(`   Current Strength Ratio: ${user.strengthRatio || 0}`);
    console.log(`   Workouts: ${user.workouts.length}\n`);

    if (user.workouts.length === 0) {
      console.log('⚠️  No workouts found. Submit workouts to build your strength ratio!\n');
      console.log('💡 Strength ratio formula: (Weight lifted ÷ Bodyweight) × (Reps × 0.1)');
      console.log('   Example: Bench press 80kg × 8 reps with 80kg bodyweight');
      console.log('   = (640 ÷ 80) × 0.8 = 8 × 0.8 = 6.400');
      return;
    }

    console.log('💪 Workouts:\n');
    let totalRatio = 0;

    for (const workout of user.workouts) {
      const hasVideo = workout.videoSubmission
        ? `[${workout.videoSubmission.status}]`
        : '[personal]';

      let workoutRatio = workout.strengthRatio || 0;

      // Calculate if missing
      if (workoutRatio === 0 && user.weight && workout.weight && workout.reps) {
        const weightLifted = workout.reps * workout.weight;
        workoutRatio = calculateStrengthRatio({
          weightLifted,
          bodyweight: user.weight,
          reps: workout.reps,
        });

        // Update the workout
        await prisma.workout.update({
          where: { id: workout.id },
          data: { strengthRatio: workoutRatio },
        });

        console.log(`   ✅ Updated: ${workout.exercise} - ${workout.reps} × ${workout.weight}kg = ${workoutRatio.toFixed(3)} ${hasVideo}`);
      } else {
        console.log(`   ${workout.exercise} - ${workout.reps} × ${workout.weight}kg = ${workoutRatio.toFixed(3)} ${hasVideo}`);
      }

      totalRatio += workoutRatio;
    }

    // Update user's total strength ratio
    const weightClass = user.weight ? getWeightClass(user.weight) : 'UNCLASSIFIED';

    await prisma.user.update({
      where: { id: user.id },
      data: {
        strengthRatio: totalRatio,
        weightClass,
      },
    });

    console.log(`\n✅ Updated user profile:`);
    console.log(`   Total Strength Ratio: ${totalRatio.toFixed(3)}`);
    console.log(`   Weight Class: ${weightClass}`);

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get username from command line or use 'digga' as default
const username = process.argv[2] || 'digga';
checkUserRatio(username)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
