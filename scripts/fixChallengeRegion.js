require('dotenv').config();
const prisma = require('../src/prisma');

async function fixChallengeRegion() {
  try {
    console.log('[FIX] Updating "Push-Ups to Escape" challenge region to GLOBAL...\n');

    // Find the challenge
    const challenge = await prisma.challenge.findFirst({
      where: { title: 'Push-Ups to Escape' }
    });

    if (!challenge) {
      console.log('[FIX] Challenge "Push-Ups to Escape" not found!');
      return;
    }

    console.log('[FIX] Found challenge:');
    console.log('  Title:', challenge.title);
    console.log('  Current regionScope:', challenge.regionScope);
    console.log('  ID:', challenge.id);
    console.log('');

    // Update to global
    const updated = await prisma.challenge.update({
      where: { id: challenge.id },
      data: { regionScope: 'global' }
    });

    console.log('[FIX] ✅ Updated successfully!');
    console.log('  New regionScope:', updated.regionScope);
    console.log('');

    // Verify it shows up now
    const now = new Date();
    const wouldShow = updated.isActive && new Date(updated.endDate) > now;

    console.log('[FIX] Challenge Status:');
    console.log('  isActive:', updated.isActive);
    console.log('  endDate:', updated.endDate);
    console.log('  Expired:', new Date(updated.endDate) < now);
    console.log('  regionScope:', updated.regionScope);
    console.log('');
    console.log('[FIX] Will show in Compete for ALL users:', wouldShow ? 'YES ✅' : 'NO ❌');

  } catch (error) {
    console.error('[FIX] Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

fixChallengeRegion();
