const { PrismaClient } = require('@prisma/client');

// Create Prisma client for tests immediately (uses DATABASE_URL from .env)
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
