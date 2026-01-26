/**
 * Script to clear all video submissions and challenge submissions from database
 * and optionally from Oracle Cloud Object Storage
 *
 * Usage: node scripts/clearAllVideos.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const VideoSubmission = require('../models/VideoSubmission');
const ChallengeSubmission = require('../models/ChallengeSubmission');
const { deleteVideo } = require('../services/objectStorage');

async function clearAllVideos() {
  console.log('====================================');
  console.log('CLEARING ALL VIDEO SUBMISSIONS');
  console.log('====================================\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in environment variables');
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB\n');

    // Get all video submissions
    console.log('Fetching all VideoSubmission documents...');
    const videoSubmissions = await VideoSubmission.find({});
    console.log(`Found ${videoSubmissions.length} video submissions\n`);

    // Get all challenge submissions
    console.log('Fetching all ChallengeSubmission documents...');
    const challengeSubmissions = await ChallengeSubmission.find({});
    console.log(`Found ${challengeSubmissions.length} challenge submissions\n`);

    const totalVideos = videoSubmissions.length + challengeSubmissions.length;
    console.log(`Total videos to delete: ${totalVideos}\n`);

    if (totalVideos === 0) {
      console.log('No videos found. Nothing to delete.');
      return;
    }

    // Delete VideoSubmissions
    console.log('----------------------------------------');
    console.log('DELETING VIDEO SUBMISSIONS');
    console.log('----------------------------------------\n');

    for (let i = 0; i < videoSubmissions.length; i++) {
      const submission = videoSubmissions[i];
      console.log(`[${i + 1}/${videoSubmissions.length}] Deleting VideoSubmission: ${submission._id}`);

      // Delete from Oracle Cloud Storage
      if (submission.videoUrl) {
        try {
          await deleteVideo(submission.videoUrl);
          console.log(`  ✓ Deleted from storage: ${submission.videoUrl.substring(0, 60)}...`);
        } catch (storageErr) {
          console.log(`  ✗ Storage deletion failed (will continue): ${storageErr.message}`);
        }
      }

      // Delete from database
      await VideoSubmission.findByIdAndDelete(submission._id);
      console.log(`  ✓ Deleted from database\n`);
    }

    // Delete ChallengeSubmissions
    console.log('----------------------------------------');
    console.log('DELETING CHALLENGE SUBMISSIONS');
    console.log('----------------------------------------\n');

    for (let i = 0; i < challengeSubmissions.length; i++) {
      const submission = challengeSubmissions[i];
      console.log(`[${i + 1}/${challengeSubmissions.length}] Deleting ChallengeSubmission: ${submission._id}`);

      // Delete from Oracle Cloud Storage
      if (submission.videoUrl) {
        try {
          await deleteVideo(submission.videoUrl);
          console.log(`  ✓ Deleted from storage: ${submission.videoUrl.substring(0, 60)}...`);
        } catch (storageErr) {
          console.log(`  ✗ Storage deletion failed (will continue): ${storageErr.message}`);
        }
      }

      // Delete from database
      await ChallengeSubmission.findByIdAndDelete(submission._id);
      console.log(`  ✓ Deleted from database\n`);
    }

    console.log('====================================');
    console.log('CLEANUP COMPLETE!');
    console.log('====================================');
    console.log(`Deleted ${videoSubmissions.length} video submissions`);
    console.log(`Deleted ${challengeSubmissions.length} challenge submissions`);
    console.log(`Total: ${totalVideos} videos deleted\n`);

  } catch (error) {
    console.error('\nERROR during cleanup:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the cleanup
clearAllVideos()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nScript failed:', err);
    process.exit(1);
  });
