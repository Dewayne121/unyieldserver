const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

// Setup before all tests
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  // Set environment variables for tests
  process.env.MONGODB_URI = mongoUri;
  process.env.JWT_SECRET = 'test-jwt-secret-key-12345';
  process.env.NODE_ENV = 'test';
});

// Cleanup after all tests
afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});
