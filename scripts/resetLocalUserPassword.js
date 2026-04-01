const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const prisma = require('../src/prisma');

const loadEnvFiles = () => {
  const projectRoot = path.resolve(__dirname, '..');
  const envCandidates = [
    path.join(projectRoot, '.env'),
    path.join(projectRoot, '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
  ];

  const loaded = new Set();
  envCandidates.forEach((envPath) => {
    if (loaded.has(envPath) || !fs.existsSync(envPath)) {
      return;
    }
    dotenv.config({ path: envPath, override: false });
    loaded.add(envPath);
  });
};

const parseArg = (name) => {
  const index = process.argv.findIndex((value) => value === `--${name}`);
  if (index === -1) return '';
  return String(process.argv[index + 1] || '').trim();
};

const main = async () => {
  loadEnvFiles();

  const email = parseArg('email').toLowerCase();
  const username = parseArg('username').toLowerCase();
  const password = parseArg('password');

  if ((!email && !username) || !password) {
    console.error('Usage: node scripts/resetLocalUserPassword.js --email user@example.com --password NewPassword123!');
    console.error('   or: node scripts/resetLocalUserPassword.js --username yourname --password NewPassword123!');
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: email
      ? {
          email: {
            equals: email,
            mode: 'insensitive',
          },
        }
      : {
          username: {
            equals: username,
            mode: 'insensitive',
          },
        },
    select: {
      id: true,
      email: true,
      username: true,
    },
  });

  if (!user) {
    console.error('User not found.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: passwordHash,
      updatedAt: new Date(),
      provider: 'email',
    },
  });

  console.log(`Password reset for ${user.email} (${user.username}).`);
};

main()
  .catch((error) => {
    console.error('Failed to reset password:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
