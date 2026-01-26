const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function makeAdmin() {
  try {
    console.log('Connected to database');

    const email = 'dewayneshields19@gmail.com';

    // Get the user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      console.log('User not found!');
      return;
    }

    console.log('Found user:', user.email);

    // Update accolades to include 'admin'
    const currentAccolades = user.accolades || [];
    const updatedAccolades = [...new Set([...currentAccolades, 'admin'])];

    await prisma.user.update({
      where: { email },
      data: { accolades: updatedAccolades }
    });

    console.log('User is now admin!');
    console.log('Accolades:', updatedAccolades);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

makeAdmin();
