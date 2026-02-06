require('dotenv').config();
const prisma = require('../src/prisma');

async function listChallenges() {
  try {
    const now = new Date();

    const challenges = await prisma.challenge.findMany({
      orderBy: { createdAt: 'desc' }
    });

    console.log('\n=== ALL CHALLENGES IN DATABASE ===\n');
    console.log('Total:', challenges.length);
    console.log('Current time:', now.toISOString());
    console.log('');

    challenges.forEach((c, i) => {
      const isExpired = new Date(c.endDate) < now;
      const wouldShow = c.isActive && !isExpired;

      console.log(`[${i + 1}] ${c.title}`);
      console.log(`    ID: ${c.id}`);
      console.log(`    Active: ${c.isActive}`);
      console.log(`    End Date: ${c.endDate.toISOString()}`);
      console.log(`    Expired: ${isExpired}`);
      console.log(`    Region: ${c.regionScope}`);
      console.log(`    Would Show in Compete: ${wouldShow ? 'YES ✅' : 'NO ❌'}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

listChallenges();
