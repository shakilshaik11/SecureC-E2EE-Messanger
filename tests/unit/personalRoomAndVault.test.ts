import { RoomManager } from '../../src/sockets/room.manager';
import WebSocket from 'ws';

const mockSocket1 = {
  readyState: WebSocket.OPEN,
  send: jest.fn()
} as unknown as WebSocket;

const mockSocket2 = {
  readyState: WebSocket.OPEN,
  send: jest.fn()
} as unknown as WebSocket;

describe('Personal Saved Room & MyData Vault Unit Tests', () => {
  let roomManager: RoomManager;

  beforeEach(() => {
    roomManager = RoomManager.getInstance();
  });

  describe('Personal Saved Room (Persistent E2EE)', () => {
    const personalCode = 'SECRETPERSONAL1';
    const userId1 = 'user_pers_1';
    const userId2 = 'user_pers_2';

    test('should create a persistent personal room with custom room key', () => {
      const room = roomManager.createRoom(personalCode, userId1, 50, true);

      expect(room).toBeDefined();
      expect(room.code).toBe(personalCode);
      expect(room.isPersistent).toBe(true);
      expect(room.encryptedHistory).toEqual([]);
    });

    test('should allow participants to join the personal room with custom key', () => {
      const result = roomManager.joinRoom(personalCode, {
        socket: mockSocket1,
        userId: userId1,
        username: 'Alice',
        avatar: '🔐',
        joinedAt: new Date()
      }, true);

      expect(result.success).toBe(true);
      expect(result.room?.code).toBe(personalCode);
      expect(result.room?.isPersistent).toBe(true);
      expect(result.room?.participants.size).toBe(1);
    });

    test('should allow a second user to join the persistent personal room', () => {
      const result = roomManager.joinRoom(personalCode, {
        socket: mockSocket2,
        userId: userId2,
        username: 'Bob',
        avatar: '⚡',
        joinedAt: new Date()
      }, true);

      expect(result.success).toBe(true);
      expect(result.room?.participants.size).toBe(2);
      expect(result.room?.participants.has(userId1)).toBe(true);
      expect(result.room?.participants.has(userId2)).toBe(true);
    });

    test('should store and preserve encrypted messages in personal room history', () => {
      const msg1 = {
        id: 'msg_pers_1',
        senderUserId: userId1,
        senderUsername: 'Alice',
        encryptedPayload: {
          iv: 'mock_iv_base64_1',
          ciphertext: 'mock_ciphertext_alice',
          isBinary: false
        },
        timestamp: new Date().toISOString()
      };

      const msg2 = {
        id: 'msg_pers_2',
        senderUserId: userId2,
        senderUsername: 'Bob',
        encryptedPayload: {
          iv: 'mock_iv_base64_2',
          ciphertext: 'mock_ciphertext_bob',
          isBinary: false
        },
        timestamp: new Date().toISOString()
      };

      roomManager.addMessageToHistory(personalCode, msg1);
      roomManager.addMessageToHistory(personalCode, msg2);

      const history = roomManager.getRoomHistory(personalCode);
      expect(history.length).toBe(2);
      expect(history[0].id).toBe('msg_pers_1');
      expect(history[0].encryptedPayload.ciphertext).toBe('mock_ciphertext_alice');
      expect(history[1].id).toBe('msg_pers_2');
      expect(history[1].encryptedPayload.ciphertext).toBe('mock_ciphertext_bob');
    });

    test('should update edited message in personal room history', () => {
      const updatedPayload = {
        iv: 'mock_iv_base64_1',
        ciphertext: 'mock_ciphertext_alice_edited',
        isBinary: false
      };

      roomManager.editMessageInHistory(personalCode, 'msg_pers_1', updatedPayload);

      const history = roomManager.getRoomHistory(personalCode);
      expect(history[0].encryptedPayload.ciphertext).toBe('mock_ciphertext_alice_edited');
    });

    test('should NOT delete persistent personal room when all participants leave immediately', () => {
      // User 1 leaves
      roomManager.leaveRoom(userId1, true);
      // User 2 leaves
      roomManager.leaveRoom(userId2, true);

      const roomAfterLeave = roomManager.getRoom(personalCode);
      expect(roomAfterLeave).toBeDefined();
      expect(roomAfterLeave?.code).toBe(personalCode);
      expect(roomAfterLeave?.isPersistent).toBe(true);
      // History remains preserved!
      expect(roomAfterLeave?.encryptedHistory?.length).toBe(2);
    });

    test('should allow user to re-open/re-enter persistent personal room and retrieve history', async () => {
      const result = roomManager.joinRoom(personalCode, {
        socket: mockSocket1,
        userId: userId1,
        username: 'Alice',
        avatar: '🔐',
        joinedAt: new Date()
      }, true);

      expect(result.success).toBe(true);
      const history = await roomManager.getRoomHistoryAsync(personalCode);
      expect(history.length).toBe(2);
      expect(history[0].encryptedPayload.ciphertext).toBe('mock_ciphertext_alice_edited');
    });
  });

  describe('MyData Cloud Vault (Zero-Knowledge)', () => {
    const vaultName = 'MYVAULT2026';
    const vaultCode = `MYDATA_${vaultName}`;
    const vaultUser = 'user_vault_owner';

    test('should automatically detect MYDATA_ prefix and enforce persistence even if flag omitted', () => {
      // joinRoom called without isPersistent flag explicitly set to true
      const result = roomManager.joinRoom(vaultCode, {
        socket: mockSocket1,
        userId: vaultUser,
        username: 'VaultOwner',
        avatar: '☁️',
        joinedAt: new Date()
      }, false);

      expect(result.success).toBe(true);
      expect(result.room?.code).toBe(vaultCode);
      expect(result.room?.isPersistent).toBe(true);
    });

    test('should store zero-knowledge encrypted vault entries (files/notes/documents)', () => {
      const vaultNoteEntry = {
        id: 'entry_note_1',
        senderUserId: vaultUser,
        senderUsername: 'VaultOwner',
        encryptedPayload: {
          id: 'entry_note_1',
          isBinary: false,
          mediaType: 'text',
          payload: {
            iv: 'vault_iv_1',
            ciphertext: 'cipher_secret_passwords_and_bank_details'
          }
        },
        timestamp: new Date().toISOString()
      };

      const vaultFileEntry = {
        id: 'entry_file_2',
        senderUserId: vaultUser,
        senderUsername: 'VaultOwner',
        encryptedPayload: {
          id: 'entry_file_2',
          isBinary: true,
          mediaType: 'file',
          meta: {
            fileName: 'Financial_Records.pdf',
            fileSize: '1.2 MB',
            mimeType: 'application/pdf'
          },
          payload: {
            iv: 'vault_iv_2',
            ciphertext: 'cipher_encrypted_pdf_binary_stream'
          }
        },
        timestamp: new Date().toISOString()
      };

      roomManager.addMessageToHistory(vaultCode, vaultNoteEntry);
      roomManager.addMessageToHistory(vaultCode, vaultFileEntry);

      const history = roomManager.getRoomHistory(vaultCode);
      expect(history.length).toBe(2);
      expect(history[0].id).toBe('entry_note_1');
      expect(history[0].encryptedPayload.payload.ciphertext).toBe('cipher_secret_passwords_and_bank_details');
      expect(history[1].id).toBe('entry_file_2');
      expect(history[1].encryptedPayload.meta.fileName).toBe('Financial_Records.pdf');
    });

    test('should NOT delete MyData Vault when owner leaves or closes tab', () => {
      roomManager.leaveRoom(vaultUser, true);

      const vaultRoom = roomManager.getRoom(vaultCode);
      expect(vaultRoom).toBeDefined();
      expect(vaultRoom?.code).toBe(vaultCode);
      expect(vaultRoom?.isPersistent).toBe(true);
      expect(vaultRoom?.participants.size).toBe(0);
      expect(vaultRoom?.encryptedHistory?.length).toBe(2);
    });

    test('should restore all encrypted vault entries when user unlocks MyData Vault again', async () => {
      const unlockResult = roomManager.joinRoom(vaultCode, {
        socket: mockSocket1,
        userId: vaultUser,
        username: 'VaultOwner',
        avatar: '☁️',
        joinedAt: new Date()
      }, true);

      expect(unlockResult.success).toBe(true);

      const retrievedHistory = await roomManager.getRoomHistoryAsync(vaultCode);
      expect(retrievedHistory.length).toBe(2);
      expect(retrievedHistory[0].id).toBe('entry_note_1');
      expect(retrievedHistory[1].id).toBe('entry_file_2');
    });
  });

  describe('Comparison: Ephemeral Rooms vs Persistent Rooms', () => {
    test('should destroy ephemeral room when last participant leaves', () => {
      const ephemeralCode = 'EPH123';
      const ephUser = 'eph_user_1';

      roomManager.createRoom(ephemeralCode, ephUser, 2, false);
      roomManager.joinRoom(ephemeralCode, {
        socket: mockSocket1,
        userId: ephUser,
        username: 'Guest',
        avatar: '🧑',
        joinedAt: new Date()
      }, false);

      expect(roomManager.getRoom(ephemeralCode)).toBeDefined();

      // Immediate leave
      roomManager.leaveRoom(ephUser, true);

      // Ephemeral room MUST be deleted!
      expect(roomManager.getRoom(ephemeralCode)).toBeUndefined();
    });

    test('should cleanly switch rooms when user navigates to a new room', () => {
      const roomA = 'ROOMA_1';
      const roomB = 'ROOMB_1';
      const testUser = 'switching_user';

      roomManager.createRoom(roomA, testUser, 2, true);
      roomManager.createRoom(roomB, testUser, 2, true);

      // Join Room A
      roomManager.joinRoom(roomA, {
        socket: mockSocket1,
        userId: testUser,
        username: 'Switcher',
        avatar: '⚡',
        joinedAt: new Date()
      }, true);

      expect(roomManager.getRoom(roomA)?.participants.has(testUser)).toBe(true);

      // Join Room B directly without manual leave
      roomManager.joinRoom(roomB, {
        socket: mockSocket1,
        userId: testUser,
        username: 'Switcher',
        avatar: '⚡',
        joinedAt: new Date()
      }, true);

      expect(roomManager.getRoom(roomB)?.participants.has(testUser)).toBe(true);
      // Cleaned up from Room A!
      expect(roomManager.getRoom(roomA)?.participants.has(testUser)).toBe(false);
    });
  });
});

