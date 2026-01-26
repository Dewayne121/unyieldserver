const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function makeAdmin(email) {
  if (!email) {
    console.log('Usage: node scripts/makeAdmin.js <email>');
    process.exit(1);
  }

  console.log(`Making user with email "${email}" an admin...`);

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    console.log(`❌ User with email "${email}" not found`);
    process.exit(1);
  }

  console.log(`Found user: ${user.name} (${user.username})`);
  console.log(`Current accolades: ${user.accolades || 'none'}`);

  // Add admin accolade
  const updatedAccolades = user.accolades || [];
  if (!updatedAccolades.includes('admin')) {
    updatedAccolades.push('admin');
  }

  const updatedUser = await prisma.user.update({
    where: { email },
    data: { accolades: updatedAccolades }
  });

  console.log(`\n✅ User "${email}" is now an admin!`);
  console.log(`New accolades: ${updatedUser.accolades.join(', ')}`);

  await prisma.$disconnect();
}

makeAdmin(process.argv[2]);
