const fs = require('fs');
const path = require('path');
const net = require('net');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

const maskDatabaseUrl = (value) => {
  const input = String(value || '');
  if (!input) return '(missing)';
  return input.replace(/\/\/([^:/]+):([^@]+)@/, '//$1:****@');
};

const loadEnvFiles = () => {
  const envCandidates = [
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '..', '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
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

const checkTcpReachability = (host, port, timeoutMs = 3000) => new Promise((resolve) => {
  const socket = new net.Socket();
  let done = false;

  const finish = (reachable) => {
    if (done) return;
    done = true;
    socket.destroy();
    resolve(reachable);
  };

  socket.setTimeout(timeoutMs);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
  socket.connect(port, host);
});

const main = async () => {
  loadEnvFiles();

  const databaseUrl = String(process.env.DATABASE_URL || '');
  if (!databaseUrl) {
    console.error('[DB CHECK] DATABASE_URL is missing.');
    process.exit(1);
  }

  if (!databaseUrl.toLowerCase().startsWith('postgresql://')) {
    console.error('[DB CHECK] DATABASE_URL must start with "postgresql://".');
    process.exit(1);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch (error) {
    console.error('[DB CHECK] DATABASE_URL is not a valid URL.');
    process.exit(1);
  }

  const host = parsedUrl.hostname || 'localhost';
  const port = Number(parsedUrl.port || 5432);

  console.log(`[DB CHECK] Target: ${maskDatabaseUrl(databaseUrl)}`);
  const reachable = await checkTcpReachability(host, port);
  if (!reachable) {
    console.error(`[DB CHECK] Can't reach PostgreSQL at ${host}:${port}.`);
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      console.error('[DB CHECK] Local PostgreSQL is not running or not listening on 5432.');
      console.error('[DB CHECK] Start the PostgreSQL service, then re-run: npm run db:check');
    }
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('[DB CHECK] Prisma connected successfully.');
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    console.error(`[DB CHECK] Prisma connection failed: ${message}`);
    if (/password authentication failed|authentication failed/i.test(message)) {
      console.error('[DB CHECK] Verify the username/password in DATABASE_URL.');
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
};

main().catch((error) => {
  console.error(`[DB CHECK] Unexpected failure: ${error.message}`);
  process.exit(1);
});
