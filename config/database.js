const prisma = require('../src/prisma');

const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log('PostgreSQL Connected via Prisma');
  } catch (error) {
    const databaseUrl = String(process.env.DATABASE_URL || '');
    const maskedDatabaseUrl = databaseUrl.replace(/\/\/([^:/]+):([^@]+)@/, '//$1:****@');
    console.error(`PostgreSQL Error: ${error.message}`);
    if (databaseUrl) {
      console.error(`[DB] DATABASE_URL: ${maskedDatabaseUrl}`);
    }
    if (/can't reach database server/i.test(error.message)) {
      console.error('[DB] PostgreSQL is unreachable. Ensure the DB service is running and listening on the configured host/port.');
      console.error('[DB] Run `npm run db:check` for a targeted connection diagnosis.');
    } else if (/password authentication failed|authentication failed/i.test(error.message)) {
      console.error('[DB] Authentication failed. Verify DATABASE_URL username/password and role permissions.');
    }
    process.exit(1);
  }
};

const disconnectDB = async () => {
  await prisma.$disconnect();
};

module.exports = { connectDB, disconnectDB, prisma };
