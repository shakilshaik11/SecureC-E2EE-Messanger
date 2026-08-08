import WebSocket from 'ws';
import { RoomManager } from './room.manager';
import { CryptoService } from '../services/crypto.service';

const roomManager = RoomManager.getInstance();

export const handleWebSocketConnection = (ws: WebSocket): void => {
  let currentUserId: string | null = null;
  let currentRoomCode: string | null = null;

  ws.on('message', async (rawMessage: WebSocket.RawData) => {
    try {
      const data = JSON.parse(rawMessage.toString());
      const { action, payload } = data;

      switch (action) {
        case 'ping':
          ws.send(JSON.stringify({ action: 'pong', timestamp: Date.now() }));
          break;

        case 'create-room': {
          const { userId, username, avatar, maxParticipants, isPersistent, customCode } = payload;
          currentUserId = userId;
          const code = (isPersistent && customCode) ? customCode.trim().toUpperCase() : CryptoService.generateRandomCode(6);

          roomManager.createRoom(code, userId, maxParticipants || 50, !!isPersistent);
          roomManager.joinRoom(code, {
            socket: ws,
            userId,
            username: username || 'User 1',
            avatar: avatar || '🧑‍💻',
            joinedAt: new Date()
          }, !!isPersistent);

          currentRoomCode = code;

          ws.send(
            JSON.stringify({
              action: 'room-created',
              success: true,
              roomCode: code,
              isPersistent: !!isPersistent,
              maxParticipants: maxParticipants || 50
            })
          );

          // Send room history if persistent room has saved messages (fetched from memory or DB)
          const history = await roomManager.getRoomHistoryAsync(code);
          if (history && history.length > 0) {
            ws.send(
              JSON.stringify({
                action: 'room-history',
                roomCode: code,
                history
              })
            );
          }
          break;
        }

        case 'join-room': {
          const { roomCode, userId, username, avatar, isPersistent, publicKey } = payload;
          currentUserId = userId;

          const result = roomManager.joinRoom(roomCode, {
            socket: ws,
            userId,
            username: username || 'User 2',
            avatar: avatar || '⚡',
            publicKey: publicKey,
            joinedAt: new Date()
          }, !!isPersistent);

          if (!result.success || !result.room) {
            ws.send(
              JSON.stringify({
                action: 'join-failed',
                success: false,
                message: result.message
              })
            );
            return;
          }

          currentRoomCode = result.room.code;

          // Notify joining user of success and active member list
          ws.send(
            JSON.stringify({
              action: 'room-joined',
              success: true,
              roomCode: currentRoomCode,
              isPersistent: !!result.room.isPersistent,
              maxParticipants: result.room.maxParticipants,
              members: Array.from(result.room.participants.values()).map((p) => ({
                userId: p.userId,
                username: p.username,
                avatar: p.avatar,
                publicKey: p.publicKey,
                isOnline: p.isOnline
              }))
            })
          );

          // If room has persistent history, send previous encrypted chat history to joining user
          const history = await roomManager.getRoomHistoryAsync(currentRoomCode);
          if (history && history.length > 0) {
            ws.send(
              JSON.stringify({
                action: 'room-history',
                roomCode: currentRoomCode,
                history
              })
            );
          }

          // Broadcast to existing room members that new user joined
          roomManager.broadcastToRoom(currentRoomCode, userId, {
            action: 'user-joined',
            user: {
              userId,
              username: username || 'User 2',
              avatar: avatar || '⚡',
              publicKey: publicKey
            }
          });
          break;
        }

        case 'rejoin-room': {
          const { roomCode, userId, username, avatar, publicKey } = payload;
          if (!roomCode || !userId) return;

          const targetRoomCode = roomCode.toUpperCase();
          currentUserId = userId;
          currentRoomCode = targetRoomCode;

          const result = roomManager.rejoinRoom(targetRoomCode, {
            socket: ws,
            userId,
            username: username || 'User',
            avatar: avatar || '🧑‍💻',
            publicKey: publicKey,
            joinedAt: new Date()
          });

          if (result.success && result.room) {
            ws.send(
              JSON.stringify({
                action: 'room-joined',
                success: true,
                roomCode: targetRoomCode,
                isPersistent: !!result.room.isPersistent,
                isRejoin: true,
                maxParticipants: result.room.maxParticipants,
                members: Array.from(result.room.participants.values()).map((p) => ({
                  userId: p.userId,
                  username: p.username,
                  avatar: p.avatar,
                  publicKey: p.publicKey,
                  isOnline: p.isOnline
                }))
              })
            );

            // Broadcast to room members that user reconnected
            roomManager.broadcastToRoom(targetRoomCode, userId, {
              action: 'user-rejoined',
              user: {
                userId,
                username: username || 'User',
                avatar: avatar || '🧑‍💻',
                publicKey: publicKey
              }
            });
          } else {
            ws.send(
              JSON.stringify({
                action: 'rejoin-failed',
                success: false,
                message: result.message || 'Room code no longer active.'
              })
            );
          }
          break;
        }

        case 'share-public-key': {
          const { roomCode, userId, publicKey } = payload || {};
          const effectiveUserId = userId || currentUserId;
          const targetRoomCode = (roomCode || currentRoomCode)?.toUpperCase();
          if (!targetRoomCode || !effectiveUserId) return;

          currentUserId = effectiveUserId;
          currentRoomCode = targetRoomCode;

          const room = roomManager.getRoom(targetRoomCode);
          if (room) {
            const participant = room.participants.get(effectiveUserId);
            if (participant) {
              participant.publicKey = publicKey;
            }
          }

          // Broadcast public key to room members
          roomManager.broadcastToRoom(targetRoomCode, effectiveUserId, {
            action: 'peer-public-key',
            senderUserId: effectiveUserId,
            publicKey
          });
          break;
        }

        case 'send-encrypted-message': {
          const targetRoom = (payload.roomCode || currentRoomCode)?.toUpperCase();
          const targetUser = payload.userId || payload.encryptedPayload?.senderUserId || currentUserId;
          if (!targetRoom || !targetUser) return;

          currentRoomCode = targetRoom;
          currentUserId = targetUser;

          const senderUsername = payload.encryptedPayload?.senderUsername || payload.senderUsername || 'User';

          const msgEntry = {
            id: payload.encryptedPayload ? payload.encryptedPayload.id : ('msg_' + Date.now()),
            senderUserId: targetUser,
            senderUsername: senderUsername,
            encryptedPayload: {
              ...payload.encryptedPayload,
              senderUserId: targetUser,
              senderUsername: senderUsername
            },
            timestamp: new Date().toISOString()
          };

          // Store in room history if persistent room
          roomManager.addMessageToHistory(targetRoom, msgEntry);

          // ZERO-KNOWLEDGE RELAY: Broadcast encrypted payload as-is
          roomManager.broadcastToRoom(targetRoom, targetUser, {
            action: 'receive-encrypted-message',
            senderUserId: targetUser,
            encryptedPayload: payload.encryptedPayload, // { iv, ciphertext, isBinary, mediaType }
            timestamp: new Date().toISOString()
          });
          break;
        }

        case 'edit-encrypted-message': {
          const targetRoom = (payload.roomCode || currentRoomCode)?.toUpperCase();
          const targetUser = payload.userId || currentUserId;
          if (!targetRoom || !targetUser) return;

          roomManager.editMessageInHistory(targetRoom, payload.messageId, payload.encryptedPayload);
          roomManager.broadcastToRoom(targetRoom, targetUser, {
            action: 'receive-edited-message',
            senderUserId: targetUser,
            messageId: payload.messageId,
            encryptedPayload: payload.encryptedPayload
          });
          break;
        }

        case 'message-reaction': {
          const targetRoom = (payload.roomCode || currentRoomCode)?.toUpperCase();
          const targetUser = payload.userId || currentUserId;
          if (!targetRoom || !targetUser) return;

          roomManager.broadcastToRoom(targetRoom, targetUser, {
            action: 'receive-message-reaction',
            senderUserId: targetUser,
            messageId: payload.messageId,
            emoji: payload.emoji
          });
          break;
        }

        case 'pin-message': {
          const targetRoom = (payload.roomCode || currentRoomCode)?.toUpperCase();
          if (!targetRoom) return;

          roomManager.broadcastToRoom(targetRoom, currentUserId || '', {
            action: 'receive-pinned-message',
            messageId: payload.messageId,
            text: payload.text,
            isPinned: payload.isPinned
          });
          break;
        }

        case 'typing': {
          const targetRoom = (payload.roomCode || currentRoomCode)?.toUpperCase();
          const targetUser = payload.userId || currentUserId;
          if (!targetRoom || !targetUser) return;

          roomManager.broadcastToRoom(targetRoom, targetUser, {
            action: 'peer-typing',
            senderUserId: targetUser,
            isTyping: payload.isTyping
          });
          break;
        }

        case 'read-receipt': {
          const targetRoom = (payload.roomCode || currentRoomCode)?.toUpperCase();
          if (!targetRoom) return;

          roomManager.broadcastToRoom(targetRoom, currentUserId || '', {
            action: 'peer-read-receipt',
            messageId: payload.messageId,
            status: payload.status // 'delivered' | 'read'
          });
          break;
        }

        default:
          console.warn(`[WSS Warning] Unrecognized action: ${action}`);
      }
    } catch (err) {
      console.error('[WSS Processing Error]:', err);
    }
  });

  ws.on('close', () => {
    if (currentUserId) {
      const { roomCode, remainingCount, isTemporary } = roomManager.leaveRoom(currentUserId, false);
      if (roomCode) {
        roomManager.broadcastToRoom(roomCode, currentUserId, {
          action: 'user-status-changed',
          userId: currentUserId,
          isOnline: false,
          isTemporary: isTemporary
        });
      }
    }
  });
};
