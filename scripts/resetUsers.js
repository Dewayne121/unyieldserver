const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const prisma = new PrismaClient();
const RESET_CONFIRM_TOKEN = 'RESET_USERS_CONFIRMED';

const assertDestructiveScriptConfirmed = () => {
  if (process.env.ALLOW_DESTRUCTIVE_SCRIPTS !== 'true' || process.env.CONFIRM_RESET_USERS !== RESET_CONFIRM_TOKEN) {
    throw new Error(
      'Blocked destructive reset. Re-run with ALLOW_DESTRUCTIVE_SCRIPTS=true and ' +
      `CONFIRM_RESET_USERS=${RESET_CONFIRM_TOKEN}`
    );
  }
};

async function resetUsers() {
  try {
    assertDestructiveScriptConfirmed();
    console.log('Connected to database');

    // Delete all users except dewayneshields19@gmail.com
    console.log('Deleting all users except dewayneshields19@gmail.com...');
    const deleteResult = await prisma.user.deleteMany({
      where: {
        email: { not: 'dewayneshields19@gmail.com' }
      }
    });
    console.log(`Deleted ${deleteResult.count} users`);

    // Check if dewayneshields19@gmail.com exists
    console.log('Checking for dewayneshields19@gmail.com...');
    const existingUser = await prisma.user.findUnique({
      where: { email: 'dewayneshields19@gmail.com' }
    });

    const hashedPassword = await bcrypt.hash('password', 10);

    if (existingUser) {
      // Reset password for existing user
      console.log('User exists. Resetting password to "password"...');
      await prisma.user.update({
        where: { email: 'dewayneshields19@gmail.com' },
        data: { password: hashedPassword }
      });
      console.log('Password reset to "password"');
    } else {
      // Create the user
      console.log('User does not exist. Creating user with password "password"...');
      await prisma.user.create({
        data: {
          email: 'dewayneshields19@gmail.com',
          password: hashedPassword,
          username: 'dewayneshields19',
          name: 'Dewayne Shields',
        }
      });
      console.log('User created with password "password"');
    }

    console.log('Database reset complete!');
    console.log('Email: dewayneshields19@gmail.com');
    console.log('Password: password');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

resetUsers();
