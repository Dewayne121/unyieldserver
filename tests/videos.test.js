const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { prisma } = require('./setup');

let app;

// Helper to generate test JWT
const generateTestToken = (userId, email) => {
  return jwt.sign(
    { id: userId, email: email, provider: 'email' },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
};

// Mock data
let testUser, testUser2, adminUser;
let testToken, testToken2, adminToken;
let signupInviteCode;

describe('UNYIELD API Tests', () => {
  // Import modules after setup has configured env vars
  beforeAll(async () => {
    // Dynamic import to ensure env vars are set first
    app = require('../server');
  });

  // Set up test data before each test
  beforeEach(async () => {
    // Hash passwords
    const hashedPassword = await bcrypt.hash('password123', 10);

    // Create test users using Prisma
    testUser = await prisma.user.create({
      data: {
        email: 'testuser1@test.com',
        password: hashedPassword,
        username: 'testuser1',
        name: 'Test User 1',
        totalPoints: 0,
      },
    });

    testUser2 = await prisma.user.create({
      data: {
        email: 'testuser2@test.com',
        password: hashedPassword,
        username: 'testuser2',
        name: 'Test User 2',
        totalPoints: 0,
      },
    });

    adminUser = await prisma.user.create({
      data: {
        email: 'admin@test.com',
        password: hashedPassword,
        username: 'adminuser',
        name: 'Admin User',
        accolades: ['admin'],
        totalPoints: 0,
      },
    });

    signupInviteCode = await prisma.inviteCode.create({
      data: {
        code: 'INVITE01',
        createdById: testUser.id,
      },
    });

    // Generate tokens
    testToken = generateTestToken(testUser.id, testUser.email);
    testToken2 = generateTestToken(testUser2.id, testUser2.email);
    adminToken = generateTestToken(adminUser.id, adminUser.email);
  });

  // ==========================================
  // HEALTH CHECK TESTS
  // ==========================================
  describe('Health Check', () => {
    test('GET /health should return status ok', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    test('GET /api/health should return status ok', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });

  // ==========================================
  // AUTHENTICATION TESTS
  // ==========================================
  describe('Authentication', () => {
    test('POST /api/auth/register should create a new user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@test.com',
          password: 'password123',
          username: 'newuser',
          inviteCode: signupInviteCode.code,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('newuser@test.com');
      expect(response.body.data.token).toBeDefined();
    });

    test('POST /api/auth/register should fail without invite code', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'missinginvite@test.com',
          password: 'password123',
          username: 'missinginvite',
        });

      expect(response.status).toBe(400);
    });

    test('POST /api/auth/invites should enforce a maximum of 3 codes per user', async () => {
      const codeResponses = [];
      for (let i = 0; i < 3; i++) {
        // Generate one at a time to match expected user behavior.
        // Concurrent generation is still guarded by backend constraints.
        // eslint-disable-next-line no-await-in-loop
        const response = await request(app)
          .post('/api/auth/invites')
          .set('Authorization', `Bearer ${testToken2}`)
          .send({});
        codeResponses.push(response);
      }

      codeResponses.forEach((response) => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.data.inviteCode.code).toHaveLength(8);
      });

      const fourthResponse = await request(app)
        .post('/api/auth/invites')
        .set('Authorization', `Bearer ${testToken2}`)
        .send({});

      expect(fourthResponse.status).toBe(400);
    });

    test('POST /api/auth/invites should allow admins to generate unlimited codes', async () => {
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        const response = await request(app)
          .post('/api/auth/invites')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({});

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.data.inviteCode.code).toHaveLength(8);
        expect(response.body.data.isUnlimitedInvites).toBe(true);
      }
    });

    test('POST /api/auth/login should authenticate user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'testuser1@test.com',
          password: 'password123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.token).toBeDefined();
    });

    test('POST /api/auth/login should fail with wrong password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'testuser1@test.com',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
    });

    test('GET /api/auth/me should return current user', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe('testuser1@test.com');
    });

    test('GET /api/auth/me should fail without token', async () => {
      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(401);
    });
  });

  // ==========================================
  // USER PROFILE TESTS
  // ==========================================
  describe('User Profile', () => {
    test('GET /api/users/profile should return user profile', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.username).toBe('testuser1');
    });

    test('PATCH /api/users/profile should update user profile', async () => {
      const response = await request(app)
        .patch('/api/users/profile')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Updated Name',
          bio: 'This is my updated bio',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Updated Name');
      expect(response.body.data.bio).toBe('This is my updated bio');
    });
  });

  // ==========================================
  // WORKOUT TESTS
  // ==========================================
  describe('Workouts', () => {
    test('POST /api/workouts should log a workout', async () => {
      const response = await request(app)
        .post('/api/workouts')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          exercise: 'Bench Press',
          reps: 10,
          weight: 100,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.workout.exercise).toBe('Bench Press');
      expect(response.body.data.pointsEarned).toBeGreaterThan(0);
    });

    test('GET /api/workouts should return user workouts', async () => {
      // Create a workout first
      await request(app)
        .post('/api/workouts')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          exercise: 'Squat',
          reps: 8,
          weight: 120,
        });

      const response = await request(app)
        .get('/api/workouts')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.workouts)).toBe(true);
      expect(response.body.data.workouts.length).toBe(1);
    });

    test('DELETE /api/workouts/:id should delete a workout', async () => {
      // Create a workout first
      const createResponse = await request(app)
        .post('/api/workouts')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          exercise: 'Deadlift',
          reps: 5,
          weight: 150,
        });

      const workoutId = createResponse.body.data.workout.id;

      const deleteResponse = await request(app)
        .delete(`/api/workouts/${workoutId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);
    });
  });

  // ==========================================
  // LEADERBOARD TESTS
  // ==========================================
  describe('Leaderboard', () => {
    test('GET /api/leaderboard should return leaderboard', async () => {
      const response = await request(app)
        .get('/api/leaderboard')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });
});
