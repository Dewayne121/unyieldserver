const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Models - import after setup runs
let User, VideoSubmission, Report, Appeal, app;

// Helper to generate test JWT
const generateTestToken = (userId) => {
  return jwt.sign(
    { id: userId, email: 'test@test.com', provider: 'email' },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
};

// Mock data
let testUser, testUser2, adminUser;
let testToken, testToken2, adminToken;
let testVideo, testVideo2;

describe('Video Routes', () => {
  // Import modules after setup has configured env vars
  beforeAll(async () => {
    // Import app and models after setup has configured the environment
    app = require('../server');
    User = require('../models/User');
    VideoSubmission = require('../models/VideoSubmission');
    Report = require('../models/Report');
    Appeal = require('../models/Appeal');

    // Wait for connection to be ready
    if (mongoose.connection.readyState !== 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  // Clean up and set up test data before each test
  beforeEach(async () => {
    // Clear collections
    await User.deleteMany({});
    await VideoSubmission.deleteMany({});
    await Report.deleteMany({});
    await Appeal.deleteMany({});

    // Create test users
    testUser = await User.create({
      email: 'testuser1@test.com',
      password: 'password123',
      username: 'testuser1',
      name: 'Test User 1',
    });

    testUser2 = await User.create({
      email: 'testuser2@test.com',
      password: 'password123',
      username: 'testuser2',
      name: 'Test User 2',
    });

    adminUser = await User.create({
      email: 'admin@test.com',
      password: 'password123',
      username: 'adminuser',
      name: 'Admin User',
      accolades: ['admin'],
    });

    // Generate tokens
    testToken = generateTestToken(testUser._id.toString());
    testToken2 = generateTestToken(testUser2._id.toString());
    adminToken = generateTestToken(adminUser._id.toString());

    // Create test videos
    testVideo = await VideoSubmission.create({
      user: testUser._id,
      exercise: 'Bench Press',
      reps: 10,
      weight: 100,
      videoUrl: 'https://example.com/video1.mp4',
      status: 'pending',
    });

    testVideo2 = await VideoSubmission.create({
      user: testUser2._id,
      exercise: 'Squat',
      reps: 8,
      weight: 150,
      videoUrl: 'https://example.com/video2.mp4',
      status: 'approved',
    });
  });

  // ==========================================
  // DELETE /api/videos/:id TESTS
  // ==========================================
  describe('DELETE /api/videos/:id', () => {

    test('should delete video successfully when owner requests', async () => {
      const response = await request(app)
        .delete(`/api/videos/${testVideo._id}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Video deleted successfully');

      // Verify video was actually deleted
      const deletedVideo = await VideoSubmission.findById(testVideo._id);
      expect(deletedVideo).toBeNull();
    });

    test('should return 401 when no auth token provided', async () => {
      const response = await request(app)
        .delete(`/api/videos/${testVideo._id}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('No token');
    });

    test('should return 401 when invalid token provided', async () => {
      const response = await request(app)
        .delete(`/api/videos/${testVideo._id}`)
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    test('should return 404 when video does not exist', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .delete(`/api/videos/${fakeId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    test('should return 403 when trying to delete another user\'s video', async () => {
      // testUser tries to delete testUser2's video
      const response = await request(app)
        .delete(`/api/videos/${testVideo2._id}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('only delete your own');

      // Verify video still exists
      const video = await VideoSubmission.findById(testVideo2._id);
      expect(video).not.toBeNull();
    });

    test('should delete associated reports when video is deleted', async () => {
      // Create a report for the video
      const report = await Report.create({
        reporter: testUser2._id,
        videoSubmission: testVideo._id,
        reportType: 'suspicious_lift',
        reason: 'Looks fake',
        status: 'pending',
      });

      // Delete the video
      const response = await request(app)
        .delete(`/api/videos/${testVideo._id}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);

      // Verify report was deleted
      const deletedReport = await Report.findById(report._id);
      expect(deletedReport).toBeNull();
    });

    test('should delete associated appeals when video is deleted', async () => {
      // First reject the video
      testVideo.status = 'rejected';
      testVideo.rejectionReason = 'Invalid form';
      await testVideo.save();

      // Create an appeal
      const appeal = await Appeal.create({
        user: testUser._id,
        videoSubmission: testVideo._id,
        reason: 'My form was correct',
        status: 'pending',
      });

      // Delete the video
      const response = await request(app)
        .delete(`/api/videos/${testVideo._id}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);

      // Verify appeal was deleted
      const deletedAppeal = await Appeal.findById(appeal._id);
      expect(deletedAppeal).toBeNull();
    });

    test('should allow deletion of approved videos', async () => {
      // Set video to approved
      testVideo.status = 'approved';
      await testVideo.save();

      const response = await request(app)
        .delete(`/api/videos/${testVideo._id}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should allow deletion of rejected videos', async () => {
      // Set video to rejected
      testVideo.status = 'rejected';
      testVideo.rejectionReason = 'Invalid exercise';
      await testVideo.save();

      const response = await request(app)
        .delete(`/api/videos/${testVideo._id}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should allow deletion of pending videos', async () => {
      const response = await request(app)
        .delete(`/api/videos/${testVideo._id}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should handle invalid MongoDB ID format', async () => {
      const response = await request(app)
        .delete('/api/videos/invalid-id')
        .set('Authorization', `Bearer ${testToken}`);

      // Should return 404 or 400 depending on how mongoose handles it
      expect([400, 404, 500]).toContain(response.status);
    });

    test('admin should only be able to delete their own videos', async () => {
      // Create a video for admin
      const adminVideo = await VideoSubmission.create({
        user: adminUser._id,
        exercise: 'Deadlift',
        reps: 5,
        weight: 200,
        videoUrl: 'https://example.com/admin-video.mp4',
        status: 'approved',
      });

      // Admin deletes their own video - should succeed
      const response = await request(app)
        .delete(`/api/videos/${adminVideo._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);

      // Admin tries to delete another user's video - should fail
      const response2 = await request(app)
        .delete(`/api/videos/${testVideo._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response2.status).toBe(403);
    });
  });

  // ==========================================
  // GET /api/videos/:id TESTS
  // ==========================================
  describe('GET /api/videos/:id', () => {
    test('should get video details successfully', async () => {
      const response = await request(app)
        .get(`/api/videos/${testVideo._id}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.exercise).toBe('Bench Press');
      expect(response.body.data.reps).toBe(10);
    });

    test('should return 404 for non-existent video', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/videos/${fakeId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(404);
    });
  });

  // ==========================================
  // GET /api/videos TESTS (List user's videos)
  // ==========================================
  describe('GET /api/videos', () => {
    test('should list user videos', async () => {
      const response = await request(app)
        .get('/api/videos')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(1); // Only testUser's video
    });

    test('should filter videos by status', async () => {
      // Create an approved video for testUser
      await VideoSubmission.create({
        user: testUser._id,
        exercise: 'Pull-ups',
        reps: 15,
        videoUrl: 'https://example.com/video3.mp4',
        status: 'approved',
      });

      const response = await request(app)
        .get('/api/videos?status=approved')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.every(v => v.status === 'approved')).toBe(true);
    });
  });

  // ==========================================
  // POST /api/videos TESTS (Create video)
  // ==========================================
  describe('POST /api/videos', () => {
    test('should create video submission successfully', async () => {
      const response = await request(app)
        .post('/api/videos')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          exercise: 'Overhead Press',
          reps: 12,
          weight: 60,
          videoUrl: 'https://example.com/new-video.mp4',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.exercise).toBe('Overhead Press');
      expect(response.body.data.status).toBe('pending');
    });

    test('should auto-approve admin video submissions', async () => {
      const response = await request(app)
        .post('/api/videos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          exercise: 'Admin Lift',
          reps: 5,
          weight: 100,
          videoUrl: 'https://example.com/admin-new.mp4',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('approved');
      expect(response.body.autoVerified).toBe(true);
    });

    test('should require exercise and reps', async () => {
      const response = await request(app)
        .post('/api/videos')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          videoUrl: 'https://example.com/video.mp4',
        });

      expect(response.status).toBe(400);
    });

    test('should require video URL', async () => {
      const response = await request(app)
        .post('/api/videos')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          exercise: 'Squat',
          reps: 10,
        });

      expect(response.status).toBe(400);
    });
  });

  // ==========================================
  // REPORT VIDEO TESTS
  // ==========================================
  describe('POST /api/videos/:id/report', () => {
    test('should report video successfully', async () => {
      const response = await request(app)
        .post(`/api/videos/${testVideo._id}/report`)
        .set('Authorization', `Bearer ${testToken2}`)
        .send({
          reportType: 'suspicious_lift',
          reason: 'Weight looks unrealistic',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    test('should not allow reporting own video', async () => {
      const response = await request(app)
        .post(`/api/videos/${testVideo._id}/report`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          reportType: 'fake_video',
          reason: 'Testing',
        });

      expect(response.status).toBe(400);
    });

    test('should not allow duplicate reports', async () => {
      // First report
      await request(app)
        .post(`/api/videos/${testVideo._id}/report`)
        .set('Authorization', `Bearer ${testToken2}`)
        .send({
          reportType: 'suspicious_lift',
          reason: 'First report',
        });

      // Second report from same user
      const response = await request(app)
        .post(`/api/videos/${testVideo._id}/report`)
        .set('Authorization', `Bearer ${testToken2}`)
        .send({
          reportType: 'fake_video',
          reason: 'Second report',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('already reported');
    });
  });

  // ==========================================
  // APPEAL VIDEO TESTS
  // ==========================================
  describe('POST /api/videos/:id/appeal', () => {
    beforeEach(async () => {
      // Set video to rejected for appeal tests
      testVideo.status = 'rejected';
      testVideo.rejectionReason = 'Invalid form';
      await testVideo.save();
    });

    test('should appeal rejected video successfully', async () => {
      const response = await request(app)
        .post(`/api/videos/${testVideo._id}/appeal`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          reason: 'My form was correct, please review again',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    test('should not allow appealing non-rejected video', async () => {
      testVideo.status = 'pending';
      await testVideo.save();

      const response = await request(app)
        .post(`/api/videos/${testVideo._id}/appeal`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          reason: 'Please approve',
        });

      expect(response.status).toBe(400);
    });

    test('should not allow appealing another user\'s video', async () => {
      const response = await request(app)
        .post(`/api/videos/${testVideo._id}/appeal`)
        .set('Authorization', `Bearer ${testToken2}`)
        .send({
          reason: 'Trying to appeal',
        });

      expect(response.status).toBe(403);
    });
  });
});
