/**
 * Update weight classes for all users based on their current weight
 * Run this script to fix users who have weight but incorrect weightClass
 */

const prisma = require('../src/prisma');
const { getWeightClass } = require('../src/utils/strengthRatio');

async function updateWeightClasses() {
  console.log('🔄 Starting weight class update...\n');

  try {
    // Get all users who have a weight set
    const users = await prisma.user.findMany({
      where: {
        weight: {
          not: null,
        },
      },
      select: {
        id: true,
        username: true,
        weight: true,
        weightClass: true,
      },
    });

    console.log(`📊 Found ${users.length} users with weight data\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      const correctWeightClass = getWeightClass(user.weight);

      if (user.weightClass !== correctWeightClass) {
        await prisma.user.update({
          where: { id: user.id },
          data: { weightClass: correctWeightClass },
        });

        console.log(`✅ Updated ${user.username}: ${user.weight}kg → ${correctWeightClass}`);
        updatedCount++;
      } else {
        console.log(`⏭️  Skipped ${user.username}: already ${correctWeightClass}`);
        skippedCount++;
      }
    }

    console.log(`\n✨ Update complete!`);
    console.log(`   Updated: ${updatedCount} users`);
    console.log(`   Skipped: ${skippedCount} users`);

    // Show summary by weight class
    const weightClassCounts = await prisma.user.groupBy({
      by: ['weightClass'],
      _count: {
        weightClass: true,
      },
      where: {
        weightClass: {
          not: 'UNCLASSIFIED',
        },
      },
    });

    console.log(`\n📈 Weight Class Distribution:`);
    const labels = {
      W55_64: '55-64 kg',
      W65_74: '65-74 kg',
      W75_84: '75-84 kg',
      W85_94: '85-94 kg',
      W95_109: '95-109 kg',
      W110_PLUS: '110+ kg',
    };

    for (const wc of weightClassCounts) {
      const label = labels[wc.weightClass] || wc.weightClass;
      console.log(`   ${label}: ${wc._count.weightClass} users`);
    }
  } catch (error) {
    console.error('❌ Error updating weight classes:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateWeightClasses()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
