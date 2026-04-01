const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

const projectRoot = path.resolve(__dirname, '..');

// Load test env first (if present), then fall back to default .env values.
dotenv.config({ path: path.join(projectRoot, '.env.test'), override: true });
dotenv.config({ path: path.join(projectRoot, '.env') });
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-jwt-secret-key-12345-test-jwt-secret';

const isSafeTestDbUrl = (url) => {
  const value = String(url || '').toLowerCase();
  if (!value) return false;
  // Require an explicit test database name/marker unless override is set.
  return value.includes('test');
};

const deriveTestDatabaseUrl = (databaseUrl) => {
  if (!databaseUrl) return '';

  try {
    const parsed = new URL(databaseUrl);
    const currentSchema = parsed.searchParams.get('schema');
    const testSchema =
      currentSchema && currentSchema !== 'public'
        ? `${currentSchema}_test`
        : 'test';
    parsed.searchParams.set('schema', testSchema);
    parsed.searchParams.set('application_name', 'unyield_tests');
    return parsed.toString();
  } catch {
    return '';
  }
};

// Prefer explicit test DB URL, otherwise derive a dedicated test schema URL.
if (!process.env.TEST_DATABASE_URL) {
  process.env.TEST_DATABASE_URL = deriveTestDatabaseUrl(process.env.DATABASE_URL);
}

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

const ensureTestSchema = () => {
  const prismaCliEntrypoint = path.join(
    projectRoot,
    'node_modules',
    'prisma',
    'build',
    'index.js'
  );

  try {
    execFileSync(process.execPath, [prismaCliEntrypoint, 'db', 'push', '--skip-generate'], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'pipe',
    });
  } catch (error) {
    const details = String(error?.stderr || error?.message || '').trim();
    throw new Error(
      `Unable to prepare test schema using TEST_DATABASE_URL="${process.env.TEST_DATABASE_URL || ''}". ` +
      `Ensure PostgreSQL is reachable and this database URL is valid. ${details}`
    );
  }
};

// Create Prisma client for tests (uses DATABASE_URL after safety checks)
const prisma = new PrismaClient({
  log: ['error'],
});

// Setup before all tests
beforeAll(async () => {
  // Set environment variables for tests
  process.env.JWT_SECRET = 'test-jwt-secret-key-12345-test-jwt-secret';
  process.env.NODE_ENV = 'test';

  // Ensure test schema exists and matches latest Prisma schema before running tests.
  ensureTestSchema();

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
