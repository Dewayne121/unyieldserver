const express = require('express');
const prisma = require('../src/prisma');
const { hashPassword, comparePassword, validatePasswordStrength } = require('../services/userService');
const { generateToken, authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authRateLimiter, inviteRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();
const MAX_INVITE_CODES_PER_USER = 3;
const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const normalizeInviteCode = (value = '') => value.trim().toUpperCase();

const generateInviteCodeValue = () => {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    const index = Math.floor(Math.random() * INVITE_CODE_ALPHABET.length);
    code += INVITE_CODE_ALPHABET[index];
  }
  return code;
};

const isUserAdmin = (user) => Array.isArray(user?.accolades) && user.accolades.includes('admin');

const getInvitePolicy = (isUnlimitedInvites, totalCodes) => ({
  maxInviteCodes: isUnlimitedInvites ? null : MAX_INVITE_CODES_PER_USER,
  remainingInviteCodes: isUnlimitedInvites ? null : Math.max(0, MAX_INVITE_CODES_PER_USER - totalCodes),
  isUnlimitedInvites,
});

const formatInviteCodeResponse = (inviteCode) => ({
  id: inviteCode.id,
  code: inviteCode.code,
  isUsed: inviteCode.isUsed,
  usedAt: inviteCode.usedAt,
  createdAt: inviteCode.createdAt,
  usedBy: inviteCode.usedBy ? {
    id: inviteCode.usedBy.id,
    username: inviteCode.usedBy.username,
    name: inviteCode.usedBy.name,
  } : null,
});

// Helper to format user response
const formatUserResponse = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  name: user.name,
  profileImage: user.profileImage,
  region: user.region,
  goal: user.goal,
  bio: user.bio,
  accolades: user.accolades || [],
  fitnessLevel: user.fitnessLevel,
  workoutFrequency: user.workoutFrequency,
  preferredDays: user.preferredDays || [],
  weight: user.weight,
  height: user.height,
  age: user.age,
  weightClass: user.weightClass,
  strengthRatio: user.strengthRatio,
  totalPoints: user.totalPoints,
  weeklyPoints: user.weeklyPoints,
  rank: user.rank,
  streak: user.streak,
  streakBest: user.streakBest,
  provider: user.provider,
});

// POST /api/auth/register - Register new user
router.post('/register', authRateLimiter, asyncHandler(async (req, res) => {
  const { email, password, username, inviteCode } = req.body;

  if (!email || !password || !username || !inviteCode) {
    throw new AppError('Email, password, username, and invite code are required', 400);
  }

  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    throw new AppError(passwordValidation.message, 400);
  }

  if (username.length < 3 || username.length > 20) {
    throw new AppError('Username must be 3-20 characters', 400);
  }

  // Check if username is valid (alphanumeric and underscores only)
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new AppError('Username can only contain letters, numbers, and underscores', 400);
  }

  const normalizedInviteCode = normalizeInviteCode(inviteCode);
  if (normalizedInviteCode.length < INVITE_CODE_LENGTH) {
    throw new AppError('Invalid invite code format', 400);
  }

  // Check if email already exists
  const existingEmail = await prisma.user.findUnique({
    where: { email: email.toLowerCase() }
  });
  if (existingEmail) {
    throw new AppError('Email already in use', 409);
  }

  // Check if username already exists
  const existingUsername = await prisma.user.findUnique({
    where: { username: username.toLowerCase() }
  });
  if (existingUsername) {
    throw new AppError('Username already taken', 409);
  }

  // Hash password manually (replaces Mongoose pre-save hook)
  const hashedPassword = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const invite = await tx.inviteCode.findUnique({
      where: { code: normalizedInviteCode }
    });

    if (!invite) {
      throw new AppError('Invalid invite code', 400);
    }

    if (invite.isUsed || invite.usedById) {
      throw new AppError('Invite code has already been used', 409);
    }

    const createdUser = await tx.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        username: username.toLowerCase(),
        name: username, // Default name to username, can be changed in onboarding
        provider: 'email',
        invitedById: invite.createdById,
      },
    });

    const consumeInviteResult = await tx.inviteCode.updateMany({
      where: {
        id: invite.id,
        isUsed: false,
        usedById: null,
      },
      data: {
        isUsed: true,
        usedById: createdUser.id,
        usedAt: new Date(),
      },
    });

    if (consumeInviteResult.count !== 1) {
      throw new AppError('Invite code has already been used', 409);
    }

    return createdUser;
  });

  console.log(`New user registered: ${user.username} (${user.email})`);

  const token = generateToken(user);

  res.status(201).json({
    success: true,
    data: {
      user: formatUserResponse(user),
      token,
    },
  });
}));

// GET /api/auth/invites - Get current user's invite codes
router.get('/invites', authenticate, asyncHandler(async (req, res) => {
  const requester = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { accolades: true },
  });

  if (!requester) {
    throw new AppError('User not found', 404);
  }

  const isUnlimitedInvites = isUserAdmin(requester);

  const inviteCodes = await prisma.inviteCode.findMany({
    where: { createdById: req.user.id },
    include: {
      usedBy: {
        select: {
          id: true,
          username: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    success: true,
    data: {
      inviteCodes: inviteCodes.map(formatInviteCodeResponse),
      ...getInvitePolicy(isUnlimitedInvites, inviteCodes.length),
    },
  });
}));

// POST /api/auth/invites - Generate a new invite code (max 3 per user, unlimited for admins)
router.post('/invites', authenticate, inviteRateLimiter, asyncHandler(async (req, res) => {
  const requester = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { accolades: true },
  });

  if (!requester) {
    throw new AppError('User not found', 404);
  }

  const isUnlimitedInvites = isUserAdmin(requester);

  const generatedInviteCode = await prisma.$transaction(async (tx) => {
    if (!isUnlimitedInvites) {
      const existingInviteCount = await tx.inviteCode.count({
        where: { createdById: req.user.id },
      });

      if (existingInviteCount >= MAX_INVITE_CODES_PER_USER) {
        throw new AppError(`Invite code limit reached (${MAX_INVITE_CODES_PER_USER} maximum)`, 400);
      }
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateInviteCodeValue();
      try {
        return await tx.inviteCode.create({
          data: {
            code,
            createdById: req.user.id,
          },
          include: {
            usedBy: {
              select: {
                id: true,
                username: true,
                name: true,
              },
            },
          },
        });
      } catch (error) {
        // Prisma unique constraint error - retry with a new generated code
        if (error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    throw new AppError('Failed to generate a unique invite code. Please try again.', 500);
  });

  const totalCodes = await prisma.inviteCode.count({
    where: { createdById: req.user.id },
  });

  res.status(201).json({
    success: true,
    data: {
      inviteCode: formatInviteCodeResponse(generatedInviteCode),
      ...getInvitePolicy(isUnlimitedInvites, totalCodes),
    },
  });
}));

// POST /api/auth/login - Login user
router.post('/login', authRateLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  // Find user with password field
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() }
  });

  if (!user || !user.password) {
    throw new AppError('Invalid email or password', 401);
  }

  const isPasswordValid = await comparePassword(password, user.password);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401);
  }

  console.log(`User logged in: ${user.username} (${user.email})`);

  const token = generateToken(user);

  res.json({
    success: true,
    data: {
      user: formatUserResponse(user),
      token,
    },
  });
}));

// GET /api/auth/me - Get current user
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: formatUserResponse(user),
  });
}));

// POST /api/auth/refresh - Refresh token
router.post('/refresh', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  const token = generateToken(user);

  res.json({
    success: true,
    data: { token },
  });
}));

// POST /api/auth/logout - Logout
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}));

// GET /api/auth/check-username/:username - Check if username is available
router.get('/check-username/:username', asyncHandler(async (req, res) => {
  const { username } = req.params;

  if (!username || username.length < 3) {
    return res.json({ success: true, available: false, message: 'Username too short' });
  }

  const existing = await prisma.user.findUnique({
    where: { username: username.toLowerCase() }
  });

  res.json({
    success: true,
    available: !existing,
    message: existing ? 'Username taken' : 'Username available',
  });
}));

module.exports = router;
