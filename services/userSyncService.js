const { MongoClient } = require('mongodb');
const { PrismaClient } = require('@prisma/client');

const VALID_REGIONS = new Set(['Global', 'London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow']);
const VALID_GOALS = new Set(['Hypertrophy', 'Leanness', 'Performance']);
const VALID_PROVIDERS = new Set(['email', 'google', 'apple', 'anonymous']);
const VALID_FITNESS_LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'elite']);
const VALID_ACCOLADES = new Set([
  'admin',
  'community_support',
  'beta',
  'staff',
  'verified_athlete',
  'founding_member',
  'challenge_master',
]);
const VALID_WEIGHT_CLASSES = new Set(['W55_64', 'W65_74', 'W75_84', 'W85_94', 'W95_109', 'W110_PLUS', 'UNCLASSIFIED']);

const asDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const asString = (value) => {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result ? result : null;
};

const asLowerString = (value) => {
  const str = asString(value);
  return str ? str.toLowerCase() : null;
};

const asInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const asFloatOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const sanitizeEnum = (value, allowed, fallback) => {
  const normalized = asString(value);
  if (normalized && allowed.has(normalized)) {
    return normalized;
  }
  return fallback;
};

const sanitizeAccolades = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item) => item && VALID_ACCOLADES.has(item));
};

const sanitizeDays = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter(Boolean);
};

const buildUserData = (mongoUser) => {
  const email = asLowerString(mongoUser.email);
  const username = asLowerString(mongoUser.username);
  const name = asString(mongoUser.name) || username || 'Grinder';
  const password = asString(mongoUser.password);

  return {
    email,
    username,
    name,
    password: password || null,
    profileImage: asString(mongoUser.profileImage),
    region: sanitizeEnum(mongoUser.region, VALID_REGIONS, 'Global'),
    goal: sanitizeEnum(mongoUser.goal, VALID_GOALS, 'Hypertrophy'),
    bio: asString(mongoUser.bio) || '',
    fitnessLevel: sanitizeEnum(mongoUser.fitnessLevel, VALID_FITNESS_LEVELS, 'beginner'),
    workoutFrequency: asString(mongoUser.workoutFrequency) || '3-4',
    preferredDays: sanitizeDays(mongoUser.preferredDays),
    weight: asFloatOrNull(mongoUser.weight),
    height: asFloatOrNull(mongoUser.height),
    age: asInt(mongoUser.age, 0) || null,
    accolades: sanitizeAccolades(mongoUser.accolades),
    provider: sanitizeEnum(mongoUser.provider, VALID_PROVIDERS, 'email'),
    totalPoints: asInt(mongoUser.totalPoints, 0),
    weeklyPoints: asInt(mongoUser.weeklyPoints, 0),
    rank: asInt(mongoUser.rank, 99),
    streak: asInt(mongoUser.streak, 0),
    streakBest: asInt(mongoUser.streakBest, 0),
    lastWorkoutDate: asDate(mongoUser.lastWorkoutDate),
    weightClass: sanitizeEnum(mongoUser.weightClass, VALID_WEIGHT_CLASSES, 'UNCLASSIFIED'),
    strengthRatio: asFloatOrNull(mongoUser.strengthRatio) ?? 0,
    createdAt: asDate(mongoUser.createdAt) || new Date(),
    updatedAt: asDate(mongoUser.updatedAt) || new Date(),
  };
};

const parseDbNameFromMongoUri = (uri) => {
  try {
    const parsed = new URL(uri);
    return (parsed.pathname || '').replace(/^\//, '') || 'unyielding';
  } catch {
    return 'unyielding';
  }
};

const shouldAttemptMongoUserSync = () => {
  if (!process.env.MONGODB_URI) {
    return false;
  }
  if (process.env.ENABLE_MONGO_USER_SYNC === 'false') {
    return false;
  }
  if (process.env.ENABLE_MONGO_USER_SYNC === 'true') {
    return true;
  }
  return process.env.NODE_ENV !== 'production';
};

async function syncMongoUsersToPostgres(options = {}) {
  const {
    dryRun = false,
    onlyIfPostgresUserCountBelow = null,
    logPrefix = '[USER SYNC]',
  } = options;

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not configured.');
  }

  const prisma = new PrismaClient();
  const mongoClient = new MongoClient(mongoUri);
  const mongoDbName = parseDbNameFromMongoUri(mongoUri);

  const stats = {
    mongoUsers: 0,
    postgresUsersBefore: 0,
    postgresUsersAfter: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    dryRun,
    skippedByThreshold: false,
  };

  try {
    await prisma.$connect();
    await mongoClient.connect();

    const mongoDb = mongoClient.db(mongoDbName);
    const usersCollection = mongoDb.collection('users');
    stats.postgresUsersBefore = await prisma.user.count();

    if (
      Number.isFinite(onlyIfPostgresUserCountBelow) &&
      stats.postgresUsersBefore >= onlyIfPostgresUserCountBelow
    ) {
      stats.skippedByThreshold = true;
      return stats;
    }

    const mongoUsers = await usersCollection.find({}).toArray();
    stats.mongoUsers = mongoUsers.length;
    console.log(`${logPrefix} Mongo users found: ${stats.mongoUsers}`);

    for (const mongoUser of mongoUsers) {
      const data = buildUserData(mongoUser);
      if (!data.email && !data.username) {
        stats.skipped += 1;
        continue;
      }

      try {
        if (data.email) {
          const existing = await prisma.user.findUnique({
            where: { email: data.email },
            select: { id: true },
          });

          if (existing) {
            if (!dryRun) {
              await prisma.user.update({ where: { email: data.email }, data });
            }
            stats.updated += 1;
          } else {
            if (!dryRun) {
              await prisma.user.create({ data });
            }
            stats.created += 1;
          }
          continue;
        }

        const existing = await prisma.user.findUnique({
          where: { username: data.username },
          select: { id: true },
        });

        if (existing) {
          if (!dryRun) {
            await prisma.user.update({ where: { username: data.username }, data });
          }
          stats.updated += 1;
        } else {
          if (!dryRun) {
            await prisma.user.create({ data });
          }
          stats.created += 1;
        }
      } catch (error) {
        stats.errors += 1;
        console.warn(`${logPrefix} Failed user sync`, {
          mongoId: String(mongoUser._id),
          email: data.email,
          username: data.username,
          error: error.message,
        });
      }
    }

    stats.postgresUsersAfter = await prisma.user.count();
    return stats;
  } finally {
    await mongoClient.close();
    await prisma.$disconnect();
  }
}

module.exports = {
  syncMongoUsersToPostgres,
  shouldAttemptMongoUserSync,
};
