require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Workout = require('../models/Workout');

async function cleanDatabase() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!\n');

    // Delete all workouts
    console.log('=== DELETING ALL WORKOUTS ===');
    const workoutCount = await Workout.countDocuments();
    console.log(`Found ${workoutCount} workouts in the database.`);

    if (workoutCount > 0) {
      const workoutResult = await Workout.deleteMany({});
      console.log(`✅ Deleted ${workoutResult.deletedCount} workouts.\n`);
    } else {
      console.log('No workouts to delete.\n');
    }

    // Delete all users except dewayne and tadshi
    console.log('=== DELETING USERS (except dewayne and tadshi) ===');
    const userCount = await User.countDocuments();
    console.log(`Found ${userCount} users in the database.`);

    if (userCount > 0) {
      // Find users to delete (all except dewayne and tadshi)
      const usersToDelete = await User.find({
        username: { $nin: ['dewayne', 'tadshi'] }
      });

      console.log(`Users to keep: dewayne, tadshi`);
      console.log(`Users to delete: ${usersToDelete.length}`);

      if (usersToDelete.length > 0) {
        console.log('\nUsers that will be deleted:');
        usersToDelete.forEach(u => console.log(`  - ${u.username || '(no username)'} (${u.email || '(no email)'})`));

        console.log('\n⚠️  WARNING: This will DELETE the above users!');
        console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');

        await new Promise(resolve => setTimeout(resolve, 3000));

        const userResult = await User.deleteMany({
          username: { $nin: ['dewayne', 'tadshi'] }
        });
        console.log(`\n✅ Deleted ${userResult.deletedCount} users.`);
      } else {
        console.log('No users to delete (only dewayne and tadshi exist).');
      }
    } else {
      console.log('No users in database.\n');
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Remaining users: ${await User.countDocuments()}`);
    console.log(`Remaining workouts: ${await Workout.countDocuments()}`);
    console.log('\n✅ Database cleanup complete!');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

cleanDatabase();
