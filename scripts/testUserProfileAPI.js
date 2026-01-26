/**
 * Test API Response for User Profile
 * This simulates what the frontend receives when fetching user profile
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');

// Copy the formatUserResponse function inline
const formatUserResponse = (user) => ({
  id: user._id,
  email: user.email,
  username: user.username,
  name: user.name,
  profileImage: user.profileImage,
  region: user.region,
  goal: user.goal,
  bio: user.bio || '',
  accolades: user.accolades || [],
  fitnessLevel: user.fitnessLevel,
  workoutFrequency: user.workoutFrequency,
  preferredDays: user.preferredDays || [],
  weight: user.weight,
  height: user.height,
  age: user.age,
  totalPoints: user.totalPoints,
  weeklyPoints: user.weeklyPoints,
  rank: user.rank,
  streak: user.streak,
  streakBest: user.streakBest,
  provider: user.provider,
  createdAt: user.createdAt,
});

async function testAPI() {
  try {
    console.log('========================================');
    console.log('BRUTAL API TEST - User Profile Response');
    console.log('========================================\n');

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected\n');

    // Find dewayne user
    const dewayne = await User.findOne({ username: 'dewayne' });

    if (!dewayne) {
      console.log('❌ ERROR: dewayne user not found!');
      process.exit(1);
    }

    console.log('────────────────────────────────────────────');
    console.log('RAW DOCUMENT FROM MONGODB:');
    console.log('────────────────────────────────────────────');
    const rawDoc = dewayne.toObject();
    console.log(JSON.stringify(rawDoc, null, 2));

    console.log('\n────────────────────────────────────────────');
    console.log('formatUserResponse() OUTPUT (What API returns):');
    console.log('────────────────────────────────────────────');
    const apiResponse = formatUserResponse(dewayne);
    console.log(JSON.stringify(apiResponse, null, 2));

    console.log('\n────────────────────────────────────────────');
    console.log('CRITICAL FIELD CHECK:');
    console.log('────────────────────────────────────────────');
    console.log(`weight: ${apiResponse.weight} (type: ${typeof apiResponse.weight})`);
    console.log(`height: ${apiResponse.height} (type: ${typeof apiResponse.height})`);
    console.log(`age: ${apiResponse.age} (type: ${typeof apiResponse.age})`);

    // Check if values would show as dash in UI
    const wouldShowWeightAsDash = !apiResponse.weight && apiResponse.weight !== 0;
    const wouldShowHeightAsDash = !apiResponse.height && apiResponse.height !== 0;
    const wouldShowAgeAsDash = !apiResponse.age && apiResponse.age !== 0;

    console.log('\n────────────────────────────────────────────');
    console.log('UI DISPLAY PREDICTION:');
    console.log('────────────────────────────────────────────');
    console.log(`Weight would show as: ${wouldShowWeightAsDash ? '❌ DASH (bug!)' : '✅ VALUE: ' + apiResponse.weight}`);
    console.log(`Height would show as: ${wouldShowHeightAsDash ? '❌ DASH (bug!)' : '✅ VALUE: ' + apiResponse.height}`);
    console.log(`Age would show as: ${wouldShowAgeAsDash ? '❌ DASH (bug!)' : '✅ VALUE: ' + apiResponse.age}`);

    if (wouldShowWeightAsDash || wouldShowHeightAsDash || wouldShowAgeAsDash) {
      console.log('\n❌❌❌ BUG FOUND: Values are falsy and will show as DASH! ❌❌❌');
    } else {
      console.log('\n✅ All values should display correctly');
    }

    // Test the exact condition DashboardScreen uses
    console.log('\n────────────────────────────────────────────');
    console.log('DashboardScreen DISPLAY LOGIC:');
    console.log('────────────────────────────────────────────');
    console.log(`Dashboard weight check: !user?.weight = ${!apiResponse.weight}`);
    console.log(`Dashboard height check: !user?.height = ${!apiResponse.height}`);
    console.log(`If true → shows "--"`);

  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

testAPI()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
