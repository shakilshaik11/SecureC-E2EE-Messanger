import { RoomManager } from '../../src/sockets/room.manager';
import WebSocket from 'ws';

// Mock WebSocket
const mockSocket = {} as WebSocket;

describe('RoomManager Singleton Unit Tests', () => {
  let roomManager: RoomManager;

  beforeEach(() => {
    roomManager = RoomManager.getInstance();
  });

  test('should create a room with default maximum capacity of 2', () => {
    const roomCode = 'ROOM101';
    const hostId = 'user_host_123';
    const room = roomManager.createRoom(roomCode, hostId);

    expect(room).toBeDefined();
    expect(room.code).toBe(roomCode);
    expect(room.hostId).toBe(hostId);
    expect(room.maxParticipants).toBe(2);
    expect(room.participants.size).toBe(0);
  });

  test('should allow participants to join created room', () => {
    const roomCode = 'ROOM102';
    const hostId = 'user_host_456';
    roomManager.createRoom(roomCode, hostId, 2);

    const participant1 = {
      socket: mockSocket,
      userId: 'user_1',
      username: 'Alice',
      avatar: '🧑‍💻',
      joinedAt: new Date()
    };

    const result = roomManager.joinRoom(roomCode, participant1);
    expect(result.success).toBe(true);
    expect(result.room?.participants.size).toBe(1);
  });

  test('should enforce max participants capacity limit', () => {
    const roomCode = 'ROOM103';
    const hostId = 'user_host_789';
    roomManager.createRoom(roomCode, hostId, 2);

    roomManager.joinRoom(roomCode, {
      socket: mockSocket,
      userId: 'user_1',
      username: 'Alice',
      avatar: '🧑‍💻',
      joinedAt: new Date()
    });

    roomManager.joinRoom(roomCode, {
      socket: mockSocket,
      userId: 'user_2',
      username: 'Bob',
      avatar: '⚡',
      joinedAt: new Date()
    });

    // 3rd participant attempting to join a 2-user room
    const overflowResult = roomManager.joinRoom(roomCode, {
      socket: mockSocket,
      userId: 'user_3',
      username: 'Charlie',
      avatar: '🔒',
      joinedAt: new Date()
    });

    expect(overflowResult.success).toBe(false);
    expect(overflowResult.message).toContain('full');
  });

  test('should save and retrieve encrypted room message history', () => {
    const roomCode = 'ROOM104';
    roomManager.createRoom(roomCode, 'host_id', 5, true);

    const messagePayload = {
      senderUserId: 'user_1',
      senderUsername: 'Alice',
      encryptedPayload: { ciphertext: 'EncryptedAESDataString' },
      timestamp: new Date().toISOString()
    };

    roomManager.addMessageToHistory(roomCode, messagePayload);
    const history = roomManager.getRoomHistory(roomCode);

    expect(history.length).toBe(1);
    expect(history[0].encryptedPayload.ciphertext).toBe('EncryptedAESDataString');
  });
});
