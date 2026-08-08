import request from 'supertest';
import { app } from '../../src/server';
import mongoose from 'mongoose';
import { generateAccessToken } from '../../src/utils/token';

describe('SecureC Express Backend API Integration Tests', () => {
  let authToken: string;

  beforeAll(() => {
    // Generate valid JWT token for authenticated route testing
    authToken = generateAccessToken({
      userId: '65c9f1a2e3b4c5d6e7f8a9b0',
      email: 'test@securec.io'
    });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  describe('GET /api/v1/health', () => {
    test('should return 200 OK with system status ONLINE', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.service).toBe('SecureC E2EE Backend API');
      expect(response.body.status).toBe('ONLINE');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('POST /api/v1/chats/rooms', () => {
    test('should reject unauthorized request without Bearer token', async () => {
      const response = await request(app)
        .post('/api/v1/chats/rooms')
        .send({ maxParticipants: 4 });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('should generate a valid 6-character room code when creating a new room with token', async () => {
      const response = await request(app)
        .post('/api/v1/chats/rooms')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ maxParticipants: 4 });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.roomCode).toBeDefined();
      expect(response.body.data.roomCode.length).toBe(6);
    });
  });

  describe('GET /api/v1/chats/rooms/:roomCode', () => {
    test('should return room metadata for an active room code', async () => {
      // First create a room with token
      const createRes = await request(app)
        .post('/api/v1/chats/rooms')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ maxParticipants: 2 });

      const roomCode = createRes.body.data.roomCode;

      // Verify room details
      const response = await request(app)
        .get(`/api/v1/chats/rooms/${roomCode}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.code).toBe(roomCode);
    });

    test('should return 404 for an invalid room code', async () => {
      const response = await request(app)
        .get('/api/v1/chats/rooms/INVALID999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});
