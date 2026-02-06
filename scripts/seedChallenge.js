require('dotenv').config();
const prisma = require('../src/prisma');

async function seedChallenge() {
  try {
    console.log('[SEED] Connecting to database...');

    // First, get an admin user to be the creator
    const adminUser = await prisma.user.findFirst({
      where: {
        accolades: {
          has: 'admin'
        }
      }
    });

    if (!adminUser) {
      console.log('[SEED] No admin user found. Creating one...');
      // This won't have a password hash, so it's just for reference
      const newAdmin = await prisma.user.create({
        data: {
          email: 'admin@unyield.com',
          username: 'admin',
          name: 'Admin User',
          provider: 'email',
          password: 'placeholder_hash',
          accolades: ['admin'],
          totalPoints: 0,
        }
      });
      console.log('[SEED] Created admin user:', newAdmin.id);
    }

    const creator = adminUser || await prisma.user.findFirst();

    if (!creator) {
      throw new Error('No users found in database. Please create a user first.');
    }

    console.log('[SEED] Using creator:', creator.username || creator.name);

    // Check if challenge already exists
    const existing = await prisma.challenge.findFirst({
      where: { title: '100 Push-Ups Challenge' }
    });

    if (existing) {
      console.log('[SEED] Challenge already exists. Deleting old one...');
      await prisma.challenge.delete({
        where: { id: existing.id }
      });
    }

    // Create a new challenge with dates that are guaranteed to be active
    const now = new Date();
    const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Started yesterday
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // Ends in 30 days

    const challenge = await prisma.challenge.create({
      data: {
        title: '100 Push-Ups Challenge',
        description: 'Complete 100 push-ups and prove your strength! Submit your best effort video for verification.',
        challengeType: 'exercise',
        exercises: ['Push-ups', 'Diamond Push-ups', 'Wide Push-ups'],
        metricType: 'reps',
        target: 100,
        startDate,
        endDate,
        regionScope: 'global',
        isActive: true,
        reward: 500,
        requiresVideo: true,
        minVideoDuration: 5,
        rules: 'Video must show full body and clear rep counting. No resting excessively between reps.',
        completionType: 'cumulative',
        winnerCriteria: 'first_to_complete',
        maxParticipants: 0,
        createdById: creator.id,
      }
    });

    console.log('[SEED] Challenge created successfully!');
    console.log('[SEED] Challenge ID:', challenge.id);
    console.log('[SEED] Challenge:', {
      title: challenge.title,
      endDate: challenge.endDate,
      isActive: challenge.isActive,
    });

    // Test query to verify it shows up in API
    const activeChallenges = await prisma.challenge.findMany({
      where: {
        isActive: true,
        endDate: { gt: now }
      }
    });

    console.log('[SEED] Active challenges in DB:', activeChallenges.length);
    console.log('[SEED] Done!');

  } catch (error) {
    console.error('[SEED] Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

seedChallenge();
