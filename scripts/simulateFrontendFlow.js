/**
 * Simulate Frontend Flow
 * This simulates exactly what happens when the frontend loads user data
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');

// Copy the formatUserResponse function
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

async function testFrontendFlow() {
  try {
    console.log('========================================');
    console.log('SIMULATING FRONTEND DATA FLOW');
    console.log('========================================\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // STEP 1: Backend receives request and gets user from DB
    const userFromDB = await User.findOne({ username: 'dewayne' });
    console.log('STEP 1: User from MongoDB');
    console.log('─────────────────────────────────────');
    console.log(`weight: ${userFromDB.weight} (type: ${typeof userFromDB.weight})`);
    console.log(`height: ${userFromDB.height} (type: ${typeof userFromDB.height})`);
    console.log(`age: ${userFromDB.age} (type: ${typeof userFromDB.age})`);

    // STEP 2: Backend formats response
    const apiResponse = formatUserResponse(userFromDB);
    console.log('\nSTEP 2: API Response (formatUserResponse)');
    console.log('─────────────────────────────────────');
    console.log(`weight: ${apiResponse.weight} (type: ${typeof apiResponse.weight})`);
    console.log(`height: ${apiResponse.height} (type: ${typeof apiResponse.height})`);
    console.log(`age: ${apiResponse.age} (type: ${typeof apiResponse.age})`);

    // STEP 3: Simulate what the API returns
    const backendResponse = {
      success: true,
      data: apiResponse
    };
    console.log('\nSTEP 3: Full Backend Response');
    console.log('─────────────────────────────────────');
    console.log(JSON.stringify(backendResponse, null, 2));

    // STEP 4: Simulate what AuthContext does
    console.log('\nSTEP 4: AuthContext Processing');
    console.log('─────────────────────────────────────');
    console.log('Code: const responseUser = response?.data?.user ?? response?.data ?? {};');
    const responseUser = backendResponse?.data?.user ?? backendResponse?.data ?? {};
    console.log(`responseUser:`, responseUser);
    console.log(`responseUser.weight:`, responseUser.weight);
    console.log(`responseUser.height:`, responseUser.height);
    console.log(`responseUser.age:`, responseUser.age);

    // STEP 5: Simulate what AppContext does (DashboardScreen uses this)
    console.log('\nSTEP 5: AppContext (DashboardScreen uses this)');
    console.log('─────────────────────────────────────');
    console.log('Code: const { user } = useApp();');
    const appContextUser = responseUser;
    console.log(`user:`, appContextUser);
    console.log(`user?.weight:`, appContextUser?.weight);
    console.log(`user?.height:`, appContextUser?.height);
    console.log(`user?.age:`, appContextUser?.age);

    // STEP 6: Simulate DashboardScreen display logic
    console.log('\nSTEP 6: DashboardScreen Display Logic');
    console.log('─────────────────────────────────────');
    console.log('Code: if (!user?.weight) return "--";');
    const weightDisplay = !appContextUser?.weight ? '--' : appContextUser.weight;
    const heightDisplay = !appContextUser?.height ? '--' : appContextUser.height;
    console.log(`WEIGHT DISPLAY: "${weightDisplay}"`);
    console.log(`HEIGHT DISPLAY: "${heightDisplay}"`);

    if (weightDisplay === '--' || heightDisplay === '--') {
      console.log('\n❌❌❌ BUG CONFIRMED! Values show as DASH! ❌❌❌');
      console.log('\nROOT CAUSE:');
      if (!appContextUser?.weight) console.log('  - user.weight is falsy!');
      if (!appContextUser?.height) console.log('  - user.height is falsy!');
      if (!appContextUser?.age) console.log('  - user.age is falsy!');
    } else {
      console.log('\n✅ Values would display correctly');
    }

  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

testFrontendFlow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
