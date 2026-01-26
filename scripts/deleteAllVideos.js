require('dotenv').config();
const mongoose = require('mongoose');
const VideoSubmission = require('../models/VideoSubmission');

async function deleteAllVideos() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!');

    // Count videos before deletion
    const count = await VideoSubmission.countDocuments();
    console.log(`Found ${count} videos in the database.`);

    if (count === 0) {
      console.log('No videos to delete.');
      process.exit(0);
    }

    // Confirm deletion
    console.log('\n⚠️  WARNING: This will DELETE ALL VIDEOS from the database!');
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Delete all videos
    const result = await VideoSubmission.deleteMany({});
    console.log(`\n✅ Successfully deleted ${result.deletedCount} videos from the database.`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

deleteAllVideos();
