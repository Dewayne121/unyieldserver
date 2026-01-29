const express = require('express');
const prisma = require('../src/prisma');
const { hashPassword, comparePassword } = require('../services/userService');
const { generateToken, authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

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
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password || !username) {
    throw new AppError('Email, password, and username are required', 400);
  }

  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400);
  }

  if (username.length < 3 || username.length > 20) {
    throw new AppError('Username must be 3-20 characters', 400);
  }

  // Check if username is valid (alphanumeric and underscores only)
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    throw new AppError('Username can only contain letters, numbers, and underscores', 400);
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

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      password: hashedPassword,
      username: username.toLowerCase(),
      name: username, // Default name to username, can be changed in onboarding
      provider: 'email',
    },
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

// POST /api/auth/login - Login user
router.post('/login', asyncHandler(async (req, res) => {
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
