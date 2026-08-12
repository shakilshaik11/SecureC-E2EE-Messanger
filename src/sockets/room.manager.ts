import WebSocket from 'ws';
import mongoose from 'mongoose';
import { Message } from '../models/message.model';

export interface RoomParticipant {
  socket: WebSocket;
  userId: string;
  username: string;
  avatar: string;
  publicKey?: string;
  joinedAt: Date;
  isOnline?: boolean;
  lastSeen?: Date;
  disconnectTimeout?: NodeJS.Timeout;
}

export interface ActiveRoom {
  code: string;
  hostId: string;
  maxParticipants: number;
  participants: Map<string, RoomParticipant>; // userId -> RoomParticipant
  createdAt: Date;
  isPersistent?: boolean;
  encryptedHistory?: Array<{
    id?: string;
    senderUserId: string;
    senderUsername?: string;
    encryptedPayload: any;
    timestamp: string;
  }>;
}

/**
 * In-Memory & Persistent E2EE Room & WebSocket Session Manager
 */
export class RoomManager {
  private static instance: RoomManager;
  private rooms: Map<string, ActiveRoom> = new Map(); // roomCode -> ActiveRoom
  private userToRoom: Map<string, string> = new Map(); // socketId/userId -> roomCode

  private constructor() { }

  public static getInstance(): RoomManager {
    if (!RoomManager.instance) {
      RoomManager.instance = new RoomManager();
    }
    return RoomManager.instance;
  }

  /**
   * Create or Get Active Room with Configurable User Capacity & Persistence
   */
  public createRoom(code: string, hostId: string, maxParticipants = 2, isPersistent = false): ActiveRoom {
    const roomCode = code.toUpperCase();
    let existingRoom = this.rooms.get(roomCode);

    if (existingRoom) {
      if (isPersistent) {
        existingRoom.isPersistent = true;
      }
      return existingRoom;
    }

    const room: ActiveRoom = {
      code: roomCode,
      hostId,
      maxParticipants: Math.min(Math.max(maxParticipants, 2), 50),
      participants: new Map(),
      createdAt: new Date(),
      isPersistent: !!isPersistent,
      encryptedHistory: []
    };

    this.rooms.set(room.code, room);
    return room;
  }

  /**
   * Get Active Room by Code
   */
  public getRoom(code: string): ActiveRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /**
   * Add or Re-connect Participant in Room
   */
  public joinRoom(
    code: string,
    participant: RoomParticipant,
    isPersistent = false
  ): { success: boolean; message?: string; room?: ActiveRoom; isRejoin?: boolean } {
    const roomCode = code.toUpperCase();
    let room = this.rooms.get(roomCode);

    if (!room) {
      if (isPersistent) {
        room = this.createRoom(roomCode, participant.userId, 50, true);
      } else {
        return { success: false, message: 'Room code not found or expired.' };
      }
    }

    const existingParticipant = room.participants.get(participant.userId);
    if (existingParticipant) {
      // Clear pending disconnect grace period timeout if user re-connected
      if (existingParticipant.disconnectTimeout) {
        clearTimeout(existingParticipant.disconnectTimeout);
        existingParticipant.disconnectTimeout = undefined;
      }

      existingParticipant.socket = participant.socket;
      existingParticipant.username = participant.username || existingParticipant.username;
      existingParticipant.avatar = participant.avatar || existingParticipant.avatar;
      if (participant.publicKey) {
        existingParticipant.publicKey = participant.publicKey;
      }
      existingParticipant.isOnline = true;
      existingParticipant.lastSeen = new Date();

      this.userToRoom.set(participant.userId, roomCode);
      return { success: true, room, isRejoin: true };
    }

    if (room.participants.size >= room.maxParticipants) {
      return {
        success: false,
        message: `Room is at full capacity (Maximum ${room.maxParticipants} participants allowed).`
      };
    }

    participant.isOnline = true;
    participant.lastSeen = new Date();
    room.participants.set(participant.userId, participant);
    this.userToRoom.set(participant.userId, roomCode);

    return { success: true, room, isRejoin: false };
  }

  /**
   * Rejoin Room helper for mobile background reconnects
   */
  public rejoinRoom(
    code: string,
    participant: RoomParticipant
  ): { success: boolean; message?: string; room?: ActiveRoom } {
    return this.joinRoom(code, participant, false);
  }

  /**
   * Remove Participant on Leave / Disconnect with Grace Period
   */
  public leaveRoom(
    userId: string,
    immediate = false
  ): { roomCode?: string; remainingCount: number; isTemporary: boolean } {
    const roomCode = this.userToRoom.get(userId);
    if (!roomCode) return { remainingCount: 0, isTemporary: false };

    const room = this.rooms.get(roomCode);
    if (!room) return { remainingCount: 0, isTemporary: false };

    const participant = room.participants.get(userId);
    if (!participant) return { roomCode, remainingCount: room.participants.size, isTemporary: false };

    if (immediate) {
      if (participant.disconnectTimeout) {
        clearTimeout(participant.disconnectTimeout);
      }
      room.participants.delete(userId);
      this.userToRoom.delete(userId);

      const remaining = room.participants.size;
      if (remaining === 0 && !room.isPersistent) {
        this.rooms.delete(roomCode);
        console.log(`[Room Manager] Ephemeral room closed: ${roomCode}`);
      }
      return { roomCode, remainingCount: remaining, isTemporary: false };
    }

    // Temporary disconnect (e.g. mobile tab backgrounded, network handoff)
    participant.isOnline = false;
    participant.lastSeen = new Date();

    if (participant.disconnectTimeout) {
      clearTimeout(participant.disconnectTimeout);
    }

    // 45-second grace period before purging participant from ephemeral room
    participant.disconnectTimeout = setTimeout(() => {
      const currentRoom = this.rooms.get(roomCode);
      if (currentRoom) {
        const currentP = currentRoom.participants.get(userId);
        if (currentP && !currentP.isOnline) {
          currentRoom.participants.delete(userId);
          this.userToRoom.delete(userId);
          console.log(`[Room Manager] Expired offline participant ${userId} from room ${roomCode}`);

          if (currentRoom.participants.size === 0 && !currentRoom.isPersistent) {
            this.rooms.delete(roomCode);
            console.log(`[Room Manager] Ephemeral room ${roomCode} cleaned up after grace period.`);
          }
        }
      }
    }, 45000);

    const activeCount = Array.from(room.participants.values()).filter(p => p.isOnline).length;
    return { roomCode, remainingCount: activeCount, isTemporary: true };
  }

  /**
   * Add encrypted message to room history for persistent rooms (in-memory + MongoDB)
   */
  public addMessageToHistory(roomCode: string, entry: any): void {
    const code = roomCode.toUpperCase();
    const room = this.rooms.get(code);
    if (room && room.isPersistent) {
      if (!room.encryptedHistory) room.encryptedHistory = [];
      room.encryptedHistory.push(entry);
    }

    // Persist to MongoDB if database connection is active
    if (mongoose.connection.readyState === 1) {
      Message.create({
        roomCode: code,
        senderUserId: entry.senderUserId,
        encryptedPayload: entry.encryptedPayload,
        timestamp: new Date(entry.timestamp || Date.now())
      }).catch((err) => console.error('[DB Message Persistence Error]:', err));
    }
  }

  /**
   * Update edited message in history
   */
  public editMessageInHistory(roomCode: string, messageId: string, encryptedPayload: any): void {
    const code = roomCode.toUpperCase();
    const room = this.rooms.get(code);
    if (room && room.isPersistent && room.encryptedHistory) {
      const msg = room.encryptedHistory.find(m => m.encryptedPayload && (m.encryptedPayload.id === messageId || m.id === messageId));
      if (msg) {
        msg.encryptedPayload = encryptedPayload;
      }
    }
  }

  /**
   * Get history of messages for a persistent room (Sync memory fallback)
   */
  public getRoomHistory(roomCode: string): any[] {
    const room = this.rooms.get(roomCode.toUpperCase());
    return (room && room.encryptedHistory) ? room.encryptedHistory : [];
  }

  /**
   * Get history of messages for a persistent room (Async with MongoDB query)
   */
  public async getRoomHistoryAsync(roomCode: string): Promise<any[]> {
    const code = roomCode.toUpperCase();
    const room = this.rooms.get(code);

    if (room && room.encryptedHistory && room.encryptedHistory.length > 0) {
      return room.encryptedHistory;
    }

    // Query database if connected
    if (mongoose.connection.readyState === 1) {
      try {
        const dbMessages = await Message.find({ roomCode: code })
          .sort({ createdAt: 1 })
          .lean()
          .exec();

        if (dbMessages && dbMessages.length > 0) {
          const history = dbMessages.map((msg: any) => ({
            id: msg._id ? msg._id.toString() : ('msg_' + Date.now()),
            senderUserId: msg.senderUserId || (msg.encryptedPayload && msg.encryptedPayload.senderUserId) || 'User',
            senderUsername: (msg.encryptedPayload && msg.encryptedPayload.senderUsername) || 'User',
            encryptedPayload: msg.encryptedPayload,
            timestamp: msg.createdAt ? new Date(msg.createdAt).toISOString() : new Date().toISOString()
          }));

          if (room) {
            room.encryptedHistory = history;
          }
          return history;
        }
      } catch (err) {
        console.warn('[DB Room History Fetch Notice]:', err);
      }
    }

    return (room && room.encryptedHistory) ? room.encryptedHistory : [];
  }

  /**
   * Broadcast payload to all participants in a room except the sender
   */
  public broadcastToRoom(roomCode: string, senderUserId: string, payload: any): void {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return;

    const messageStr = JSON.stringify(payload);
    room.participants.forEach((participant, userId) => {
      if (userId !== senderUserId && participant.socket.readyState === WebSocket.OPEN) {
        participant.socket.send(messageStr);
      }
    });
  }

  /**
   * Get all public keys of active room members for E2EE key agreement
   */
  public getRoomPublicKeys(roomCode: string): { userId: string; username: string; publicKey?: string }[] {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return [];

    const keys: { userId: string; username: string; publicKey?: string }[] = [];
    room.participants.forEach((p) => {
      keys.push({
        userId: p.userId,
        username: p.username,
        publicKey: p.publicKey
      });
    });
    return keys;
  }
}
