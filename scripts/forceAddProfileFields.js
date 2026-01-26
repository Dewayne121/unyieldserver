/**
 * Force add profile fields to ALL users using raw MongoDB
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');

async function forceAddFields() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Get ALL users and update them all
    const allUsers = await User.find({});

    console.log(`Found ${allUsers.length} users\n`);

    let updatedCount = 0;

    for (const user of allUsers) {
      const userObj = user.toObject();
      const needsUpdate = {};

      // Check and set to null if missing
      if (userObj.weight === undefined) {
        needsUpdate.weight = null;
      }
      if (userObj.height === undefined) {
        needsUpdate.height = null;
      }
      if (userObj.age === undefined) {
        needsUpdate.age = null;
      }

      if (Object.keys(needsUpdate).length > 0) {
        console.log(`Updating user: ${user.username || user.email} (${user._id})`);
        console.log(`  Adding: ${Object.keys(needsUpdate).join(', ')}`);

        await User.updateOne(
          { _id: user._id },
          { $set: needsUpdate }
        );
        updatedCount++;
      } else {
        console.log(`Skipping: ${user.username || user.email} - already has all fields`);
      }
      console.log('');
    }

    console.log(`\n✅ Complete! Updated ${updatedCount} users.`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

forceAddFields()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
