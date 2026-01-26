/**
 * Check all users and their profile fields
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');

async function checkUsers() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Get all users
    const allUsers = await User.find({}, {
      username: 1,
      email: 1,
      weight: 1,
      height: 1,
      age: 1,
    });

    console.log(`Total users in database: ${allUsers.length}\n`);

    allUsers.forEach((user) => {
      console.log('────────────────────────────────────');
      console.log(`User: ${user.username || user.email}`);
      console.log(`  ID: ${user._id}`);
      console.log(`  Weight: ${user.weight ?? 'MISSING'}`);
      console.log(`  Height: ${user.height ?? 'MISSING'}`);
      console.log(`  Age: ${user.age ?? 'MISSING'}`);
    });

    console.log('\n────────────────────────────────────');
    console.log('Summary:');
    const missingWeight = allUsers.filter(u => u.weight === undefined || u.weight === null).length;
    const missingHeight = allUsers.filter(u => u.height === undefined || u.height === null).length;
    const missingAge = allUsers.filter(u => u.age === undefined || u.age === null).length;

    console.log(`  Users without weight: ${missingWeight}`);
    console.log(`  Users without height: ${missingHeight}`);
    console.log(`  Users without age: ${missingAge}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

checkUsers()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
