require('dotenv').config();
const prisma = require('../src/prisma');

async function debugChallengeQuery() {
  try {
    const now = new Date();

    // Get first user to check their region
    const user = await prisma.user.findFirst();
    console.log('User region:', user.region);
    console.log('User region type:', typeof user.region);
    console.log('');

    // Simulate the API query for this user
    const region = user.region || 'global';
    const normalizedRegion = region.toLowerCase();
    const includeExpired = 'false';

    console.log('Query params:', { region, normalizedRegion, includeExpired });
    console.log('');

    // Build the WHERE clause as the API does
    const where = {
      OR: [
        { regionScope: 'global' },
        { regionScope: 'Global' },
        { regionScope: normalizedRegion },
        { regionScope: normalizedRegion.charAt(0).toUpperCase() + normalizedRegion.slice(1) },
      ],
    };

    if (includeExpired !== 'true') {
      where.isActive = true;
      where.endDate = { gt: now };
    }

    console.log('WHERE clause OR conditions:');
    where.OR.forEach(cond => {
      console.log('  -', JSON.stringify(cond));
    });
    console.log('');

    // Run the query
    const challenges = await prisma.challenge.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    console.log('Challenges returned by query:', challenges.length);
    challenges.forEach(c => {
      console.log(`  - ${c.title} (regionScope: "${c.regionScope}")`);
    });
    console.log('');

    // Check each challenge
    const allChallenges = await prisma.challenge.findMany();
    console.log('=== DETAILED MATCH CHECK ===');
    allChallenges.forEach(c => {
      const isActive = c.isActive;
      const notExpired = new Date(c.endDate) > now;
      const regionMatch = where.OR.some(cond => cond.regionScope === c.regionScope);

      console.log(`\n${c.title}:`);
      console.log(`  isActive: ${isActive} ${isActive ? '✅' : '❌'}`);
      console.log(`  notExpired: ${notExpired} ${notExpired ? '✅' : '❌'}`);
      console.log(`  regionScope: "${c.regionScope}"`);
      console.log(`  regionMatch: ${regionMatch} ${regionMatch ? '✅' : '❌'}`);
      console.log(`  WOULD SHOW: ${isActive && notExpired && regionMatch ? 'YES ✅' : 'NO ❌'}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

debugChallengeQuery();
