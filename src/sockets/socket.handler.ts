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
          const { userId, username, avatar, maxParticipants, isPersistent, customCode, publicKey } = payload;
          currentUserId = userId;
          const isPersistentRoom = !!isPersistent || (customCode && customCode.trim().toUpperCase().startsWith('MYDATA_'));
          const code = (isPersistentRoom && customCode) ? customCode.trim().toUpperCase() : CryptoService.generateRandomCode(6);

          roomManager.createRoom(code, userId, maxParticipants || 50, isPersistentRoom);
          roomManager.joinRoom(code, {
            socket: ws,
            userId,
            username: username || 'User 1',
            avatar: avatar || '🧑‍💻',
            publicKey: publicKey,
            joinedAt: new Date()
          }, isPersistentRoom);

          currentRoomCode = code;

          const activeRoom = roomManager.getRoom(code);
          const membersList = activeRoom
            ? Array.from(activeRoom.participants.values()).map((p) => ({
                userId: p.userId,
                username: p.username,
                avatar: p.avatar,
                publicKey: p.publicKey,
                isOnline: p.isOnline
              }))
            : [];

          ws.send(
            JSON.stringify({
              action: 'room-created',
              success: true,
              roomCode: code,
              isPersistent: isPersistentRoom,
              maxParticipants: maxParticipants || 50,
              members: membersList
            })
          );

          // Send room history if persistent room (even if empty, so client knows it is ready)
          if (isPersistentRoom) {
            const history = await roomManager.getRoomHistoryAsync(code);
            ws.send(
              JSON.stringify({
                action: 'room-history',
                roomCode: code,
                history: history || []
              })
            );
          }

          // Broadcast to existing room members if any
          roomManager.broadcastToRoom(code, userId, {
            action: 'user-joined',
            user: {
              userId,
              username: username || 'User 1',
              avatar: avatar || '🧑‍💻',
              publicKey: publicKey
            }
          });
          break;
        }

        case 'join-room': {
          const { roomCode, userId, username, avatar, isPersistent, publicKey } = payload;
          currentUserId = userId;
          const targetRoomCode = (roomCode || '').trim().toUpperCase();
          const shouldBePersistent = !!isPersistent || targetRoomCode.startsWith('MYDATA_');

          const result = roomManager.joinRoom(targetRoomCode, {
            socket: ws,
            userId,
            username: username || 'User 2',
            avatar: avatar || '⚡',
            publicKey: publicKey,
            joinedAt: new Date()
          }, shouldBePersistent);

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
          const isFinalPersistent = !!result.room.isPersistent || currentRoomCode.startsWith('MYDATA_');

          // Notify joining user of success and active member list
          ws.send(
            JSON.stringify({
              action: 'room-joined',
              success: true,
              roomCode: currentRoomCode,
              isPersistent: isFinalPersistent,
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
          if (isFinalPersistent) {
            const history = await roomManager.getRoomHistoryAsync(currentRoomCode);
            ws.send(
              JSON.stringify({
                action: 'room-history',
                roomCode: currentRoomCode,
                history: history || []
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
          const { roomCode, userId, username, avatar, publicKey, isPersistent } = payload;
          if (!roomCode || !userId) return;

          const targetRoomCode = roomCode.toUpperCase();
          currentUserId = userId;
          currentRoomCode = targetRoomCode;
          const shouldBePersistent = !!isPersistent || targetRoomCode.startsWith('MYDATA_') || !!roomManager.getRoom(targetRoomCode)?.isPersistent;

          const result = roomManager.rejoinRoom(targetRoomCode, {
            socket: ws,
            userId,
            username: username || 'User',
            avatar: avatar || '🧑‍💻',
            publicKey: publicKey,
            joinedAt: new Date()
          }, shouldBePersistent);

          if (result.success && result.room) {
            const isFinalPersistent = !!result.room.isPersistent || targetRoomCode.startsWith('MYDATA_');
            ws.send(
              JSON.stringify({
                action: 'room-joined',
                success: true,
                roomCode: targetRoomCode,
                isPersistent: isFinalPersistent,
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

            if (isFinalPersistent) {
              const history = await roomManager.getRoomHistoryAsync(targetRoomCode);
              ws.send(
                JSON.stringify({
                  action: 'room-history',
                  roomCode: targetRoomCode,
                  history: history || []
                })
              );
            }

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

        case 'leave-room': {
          if (currentUserId) {
            const { roomCode } = roomManager.leaveRoom(currentUserId, true);
            if (roomCode) {
              roomManager.broadcastToRoom(roomCode, currentUserId, {
                action: 'user-status-changed',
                userId: currentUserId,
                isOnline: false,
                isTemporary: false
              });
            }
            currentRoomCode = null;
          }
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
