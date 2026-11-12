import http from 'http';
import WebSocket from 'ws';
import express from 'express';
import { handleWebSocketConnection } from '../../src/sockets/socket.handler';
import { RoomManager } from '../../src/sockets/room.manager';

describe('Personal Saved Room & MyData Vault WebSocket Integration Tests', () => {
  let server: http.Server;
  let wss: WebSocket.Server;
  let serverPort: number;

  beforeAll((done) => {
    const app = express();
    server = http.createServer(app);
    wss = new WebSocket.Server({ server, path: '/ws' });

    wss.on('connection', (ws: WebSocket) => {
      handleWebSocketConnection(ws);
    });

    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        serverPort = addr.port;
      }
      done();
    });
  });

  afterAll((done) => {
    wss.close(() => {
      server.close(done);
    });
  });

  // Helper to open a client WS connection
  const createWsClient = (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
      client.on('open', () => resolve(client));
      client.on('error', reject);
    });
  };

  // Helper to wait for a specific WS action
  const waitForMessage = (client: WebSocket, targetAction: string, timeoutMs = 4000): Promise<any> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for WS action: "${targetAction}"`));
      }, timeoutMs);

      const messageHandler = (raw: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed.action === targetAction) {
            clearTimeout(timer);
            client.off('message', messageHandler);
            resolve(parsed);
          }
        } catch (e) {
          // ignore parsing error for non-json
        }
      };

      client.on('message', messageHandler);
    });
  };

  test('User can create and initialize a Personal Saved Room via WebSocket', async () => {
    const client = await createWsClient();

    const createPromise = waitForMessage(client, 'room-created');
    const historyPromise = waitForMessage(client, 'room-history');

    client.send(JSON.stringify({
      action: 'create-room',
      payload: {
        userId: 'alice_ws_1',
        username: 'Alice',
        avatar: '🔐',
        isPersistent: true,
        customCode: 'WS_SECRET_PERSONAL'
      }
    }));

    const roomCreatedRes = await createPromise;
    expect(roomCreatedRes.success).toBe(true);
    expect(roomCreatedRes.roomCode).toBe('WS_SECRET_PERSONAL');
    expect(roomCreatedRes.isPersistent).toBe(true);
    expect(roomCreatedRes.members).toBeDefined();
    expect(roomCreatedRes.members.length).toBe(1);

    const historyRes = await historyPromise;
    expect(historyRes.roomCode).toBe('WS_SECRET_PERSONAL');
    expect(Array.isArray(historyRes.history)).toBe(true);

    client.close();
  });

  test('Persistent Personal Room preserves chat history across multiple participants', async () => {
    const clientAlice = await createWsClient();
    const clientBob = await createWsClient();

    // Alice joins her personal room
    const aliceJoinedPromise = waitForMessage(clientAlice, 'room-joined');
    clientAlice.send(JSON.stringify({
      action: 'join-room',
      payload: {
        roomCode: 'WS_SECRET_PERSONAL',
        userId: 'alice_ws_1',
        username: 'Alice',
        avatar: '🔐',
        isPersistent: true
      }
    }));
    await aliceJoinedPromise;

    // Alice sends an encrypted message
    const encryptedMsg = {
      id: 'pers_msg_101',
      isBinary: false,
      mediaType: 'text',
      senderUserId: 'alice_ws_1',
      senderUsername: 'Alice',
      payload: {
        iv: 'iv_pers_123',
        ciphertext: 'cipher_personal_notes_data'
      }
    };

    clientAlice.send(JSON.stringify({
      action: 'send-encrypted-message',
      payload: {
        roomCode: 'WS_SECRET_PERSONAL',
        userId: 'alice_ws_1',
        senderUsername: 'Alice',
        encryptedPayload: encryptedMsg
      }
    }));

    // Bob joins the room: Bob must receive room-joined and the persistent room-history!
    const bobJoinedPromise = waitForMessage(clientBob, 'room-joined');
    const bobHistoryPromise = waitForMessage(clientBob, 'room-history');
    const aliceUserJoinedPromise = waitForMessage(clientAlice, 'user-joined');

    clientBob.send(JSON.stringify({
      action: 'join-room',
      payload: {
        roomCode: 'WS_SECRET_PERSONAL',
        userId: 'bob_ws_2',
        username: 'Bob',
        avatar: '⚡',
        isPersistent: true
      }
    }));

    const bobJoined = await bobJoinedPromise;
    expect(bobJoined.success).toBe(true);
    expect(bobJoined.isPersistent).toBe(true);

    const bobHistory = await bobHistoryPromise;
    expect(bobHistory.history.length).toBeGreaterThanOrEqual(1);
    expect(bobHistory.history.some((m: any) => m.encryptedPayload?.payload?.ciphertext === 'cipher_personal_notes_data')).toBe(true);

    const aliceNotified = await aliceUserJoinedPromise;
    expect(aliceNotified.user.userId).toBe('bob_ws_2');

    clientAlice.close();
    clientBob.close();
  });

  test('MyData Cloud Vault allows storing, disconnecting, and restoring Zero-Knowledge data', async () => {
    const vaultCode = 'MYDATA_TAX_RECORDS';
    const client = await createWsClient();

    // Unlock / Open MyData Vault
    const joinedPromise = waitForMessage(client, 'room-joined');
    client.send(JSON.stringify({
      action: 'join-room',
      payload: {
        roomCode: vaultCode,
        userId: 'vault_owner_1',
        username: 'Owner',
        avatar: '☁️',
        isPersistent: true
      }
    }));

    const joinedRes = await joinedPromise;
    expect(joinedRes.success).toBe(true);
    expect(joinedRes.isPersistent).toBe(true);

    // Store private encrypted document
    const documentPayload = {
      id: 'doc_tax_2026',
      isBinary: false,
      mediaType: 'text',
      senderUserId: 'vault_owner_1',
      senderUsername: 'Owner',
      payload: {
        iv: 'iv_vault_pass_999',
        ciphertext: 'tax_return_financial_records_zero_knowledge'
      }
    };

    client.send(JSON.stringify({
      action: 'send-encrypted-message',
      payload: {
        roomCode: vaultCode,
        userId: 'vault_owner_1',
        senderUsername: 'Owner',
        encryptedPayload: documentPayload
      }
    }));

    // Leave the vault
    client.send(JSON.stringify({
      action: 'leave-room',
      payload: {}
    }));

    client.close();

    // Give server tick to process leave
    await new Promise((r) => setTimeout(r, 100));

    // Re-open/unlock MyData Vault from a new connection
    const reconnectClient = await createWsClient();
    const rejoinPromise = waitForMessage(reconnectClient, 'room-joined');
    const historyPromise = waitForMessage(reconnectClient, 'room-history');

    reconnectClient.send(JSON.stringify({
      action: 'join-room',
      payload: {
        roomCode: vaultCode,
        userId: 'vault_owner_1',
        username: 'Owner',
        avatar: '☁️',
        isPersistent: true
      }
    }));

    const rejoinRes = await rejoinPromise;
    expect(rejoinRes.success).toBe(true);
    expect(rejoinRes.isPersistent).toBe(true);

    const historyRes = await historyPromise;
    expect(historyRes.history.length).toBeGreaterThanOrEqual(1);
    const savedDoc = historyRes.history.find((m: any) => m.id === 'doc_tax_2026');
    expect(savedDoc).toBeDefined();
    expect(savedDoc.encryptedPayload.payload.ciphertext).toBe('tax_return_financial_records_zero_knowledge');

    reconnectClient.close();
  });
});

