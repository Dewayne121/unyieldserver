const { PrismaClient } = require('@prisma/client');

const isSafeTestDbUrl = (url) => {
  const value = String(url || '').toLowerCase();
  if (!value) return false;
  // Require an explicit test database name/marker unless override is set.
  return value.includes('test');
};

// Allow a dedicated test DB override without touching dev data.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (
  process.env.ALLOW_TESTS_ON_DEV_DB !== 'true' &&
  !isSafeTestDbUrl(process.env.DATABASE_URL)
) {
  throw new Error(
    `Unsafe test database configuration. Refusing to run tests against DATABASE_URL="${process.env.DATABASE_URL}". ` +
    'Set TEST_DATABASE_URL to a dedicated test DB (recommended), or set ALLOW_TESTS_ON_DEV_DB=true to override.'
  );
}

// Create Prisma client for tests (uses DATABASE_URL after safety checks)
const prisma = new PrismaClient({
  log: ['error'],
});

// Setup before all tests
beforeAll(async () => {
  // Set environment variables for tests
  process.env.JWT_SECRET = 'test-jwt-secret-key-12345';
  process.env.NODE_ENV = 'test';

  // Connect to database
  await prisma.$connect();

  // Make prisma available globally for tests
  global.prisma = prisma;
});

// Cleanup after all tests
afterAll(async () => {
  await prisma.$disconnect();
});

// Clean database before each test
beforeEach(async () => {
  // Delete all test data in correct order due to foreign keys
  await prisma.report.deleteMany({});
  await prisma.appeal.deleteMany({});
  await prisma.challengeSubmission.deleteMany({});
  await prisma.userChallenge.deleteMany({});
  await prisma.videoSubmission.deleteMany({});
  await prisma.workout.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.adminAction.deleteMany({});
  await prisma.challenge.deleteMany({});
  await prisma.user.deleteMany({});
});

module.exports = { prisma };
