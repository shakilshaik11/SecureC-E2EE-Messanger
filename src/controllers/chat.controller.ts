import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Room } from '../models/room.model';
import { Message } from '../models/message.model';
import { ApiError } from '../utils/apiError';
import { ApiResponse } from '../utils/apiResponse';
import { CryptoService } from '../services/crypto.service';
import { RoomManager } from '../sockets/room.manager';

/**
 * Create New Room with Configurable User Capacity
 * POST /api/v1/chats/rooms
 */
export const createRoom = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw ApiError.unauthorized();

    const { name, maxParticipants, disappearingTimer } = req.body;

    const code = CryptoService.generateRandomCode(6);
    const capacity = maxParticipants ? Math.min(Math.max(Number(maxParticipants), 2), 50) : 2;

    let roomData: any = {
      roomCode: code,
      code,
      hostId: req.user._id,
      name: name || 'Secure Room',
      maxParticipants: capacity,
      participants: [req.user._id],
      disappearingTimer: disappearingTimer || 0
    };

    if (mongoose.connection.readyState === 1) {
      const room = new Room({
        code,
        hostId: req.user._id,
        name: name || 'Secure Room',
        maxParticipants: capacity,
        participants: [req.user._id],
        disappearingTimer: disappearingTimer || 0
      });
      await room.save();
      roomData = room.toObject();
      roomData.roomCode = code;
    }

    // Always keep active in RoomManager for real-time WebSockets
    RoomManager.getInstance().createRoom(code, String(req.user._id), capacity);

    res.status(201).json(
      ApiResponse.created(roomData, `Room created successfully with capacity of ${capacity} users.`)
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Join Existing Room by Code
 * POST /api/v1/chats/rooms/join
 */
export const joinRoom = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw ApiError.unauthorized();

    const { roomCode } = req.body;
    if (!roomCode) {
      throw ApiError.badRequest('Room code is required.');
    }

    const code = roomCode.trim().toUpperCase();

    if (mongoose.connection.readyState === 1) {
      const room = await Room.findOne({ code, isActive: true }).populate(
        'participants',
        'username avatar email publicKey isOnline'
      );

      if (room) {
        if (room.participants.length >= room.maxParticipants) {
          throw ApiError.forbidden(
            `Room is full. Maximum participant capacity is ${room.maxParticipants} users.`
          );
        }

        const isAlreadyMember = room.participants.some((p: any) => p._id.toString() === req.user?._id.toString());
        if (!isAlreadyMember) {
          room.participants.push(req.user._id as any);
          await room.save();
        }

        res.status(200).json(ApiResponse.success(room, 'Joined room successfully'));
        return;
      }
    }

    // Memory fallback
    const memRoom = RoomManager.getInstance().getRoom(code);
    if (!memRoom) {
      throw ApiError.notFound('Room code not found or room is inactive.');
    }

    res.status(200).json(ApiResponse.success(memRoom, 'Joined room successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get Room Info by Code
 * GET /api/v1/chats/rooms/:roomCode
 */
export const getRoomInfo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { roomCode } = req.params;
    const code = roomCode.trim().toUpperCase();

    if (mongoose.connection.readyState === 1) {
      const room = await Room.findOne({ code }).populate(
        'participants',
        'username avatar email publicKey isOnline lastSeen'
      );

      if (room) {
        res.status(200).json(ApiResponse.success(room, 'Room details retrieved'));
        return;
      }
    }

    const memRoom = RoomManager.getInstance().getRoom(code);
    if (!memRoom) {
      throw ApiError.notFound('Room not found.');
    }

    res.status(200).json(ApiResponse.success(memRoom, 'Room details retrieved'));
  } catch (error) {
    next(error);
  }
};

/**
 * Store Encrypted Message (Zero-Knowledge Ciphertext Only)
 * POST /api/v1/chats/messages
 */
export const storeEncryptedMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) throw ApiError.unauthorized();

    const { roomId, encryptedContent, iv, mediaType, fileMeta } = req.body;

    if (!roomId || !encryptedContent || !iv) {
      throw ApiError.badRequest('roomId, encryptedContent ciphertext, and iv are required.');
    }

    const message = new Message({
      roomId,
      senderId: req.user._id,
      encryptedContent, // Ciphertext
      iv,
      mediaType: mediaType || 'text',
      fileMeta: fileMeta || undefined,
      deliveredTo: [{ userId: req.user._id, deliveredAt: new Date() }],
      readBy: [{ userId: req.user._id, readAt: new Date() }]
    });

    await message.save();

    res.status(201).json(ApiResponse.created(message, 'Encrypted message stored'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get Room Encrypted Message History (Ciphertext Only)
 * GET /api/v1/chats/rooms/:roomId/messages
 */
export const getRoomMessages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { roomId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const skip = Number(req.query.skip) || 0;

    const messages = await Message.find({ roomId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'username avatar');

    res.status(200).json(ApiResponse.success(messages.reverse(), 'Encrypted messages history retrieved'));
  } catch (error) {
    next(error);
  }
};
