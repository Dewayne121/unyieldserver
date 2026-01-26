/**
 * Database Migration Script: Add Missing Profile Fields
 *
 * This script adds weight, height, and age fields (set to null) to all existing
 * user documents that don't have these fields.
 *
 * This is needed because these fields were added to the User schema on Dec 30, 2025,
 * and user accounts created before this date don't have these fields.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import User model
const User = require('../models/User');

async function migrate() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find all users that are missing any of the profile fields
    console.log('\nSearching for users missing profile fields...');
    const usersToUpdate = await User.find({
      $or: [
        { weight: { $exists: false } },
        { height: { $exists: false } },
        { age: { $exists: false } },
      ],
    });

    console.log(`Found ${usersToUpdate.length} users missing profile fields`);

    if (usersToUpdate.length === 0) {
      console.log('No users need migration. All users have profile fields.');
      return;
    }

    // Update each user
    let updatedCount = 0;
    for (const user of usersToUpdate) {
      const needsUpdate = {};

      // Use lean() to get plain JS object, or check if field exists in document
      const userObj = user.toObject();

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
        await User.updateOne(
          { _id: user._id },
          { $set: needsUpdate }
        );
        updatedCount++;
        console.log(`Updated user: ${user.username || user.email} (${user._id})`);
        console.log(`  Added fields: ${Object.keys(needsUpdate).join(', ')}`);
      }
    }

    console.log(`\n✅ Migration complete! Updated ${updatedCount} users.`);
    console.log('All users now have weight, height, and age fields.');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
