import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMessage extends Document {
  roomId?: any;
  roomCode?: string;
  senderId?: any;
  senderUserId?: string;
  encryptedContent?: string; // Base64 AES-256-GCM Ciphertext
  iv?: string; // Base64 12-byte Initialization Vector
  encryptedPayload?: Schema.Types.Mixed; // Zero-Knowledge Full Ciphertext Payload
  mediaType?: 'text' | 'image' | 'file' | 'voice' | 'video';
  fileMeta?: {
    fileName?: string;
    fileSize?: string;
    mimeType?: string;
    encryptedUrl?: string;
  };
  deliveredTo?: {
    userId: any;
    deliveredAt: Date;
  }[];
  readBy?: {
    userId: any;
    readAt: Date;
  }[];
  deletedFor?: any[];
  expiresAt?: Date; // TTL Index for Disappearing Messages
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema: Schema<IMessage> = new Schema(
  {
    roomId: {
      type: Schema.Types.Mixed,
      required: false,
      index: true
    },
    roomCode: {
      type: String,
      required: false,
      uppercase: true,
      index: true
    },
    senderId: {
      type: Schema.Types.Mixed,
      required: false,
      index: true
    },
    senderUserId: {
      type: String,
      required: false
    },
    encryptedContent: {
      type: String,
      required: false // ZERO-KNOWLEDGE: Plaintext NEVER stored
    },
    iv: {
      type: String,
      required: false // AES-GCM 12-byte Initialization Vector
    },
    encryptedPayload: {
      type: Schema.Types.Mixed,
      required: false
    },
    mediaType: {
      type: String,
      enum: ['text', 'image', 'file', 'voice', 'video'],
      default: 'text'
    },
    fileMeta: {
      fileName: String,
      fileSize: String,
      mimeType: String,
      encryptedUrl: String
    },
    deliveredTo: [
      {
        userId: { type: Schema.Types.Mixed },
        deliveredAt: { type: Date, default: Date.now }
      }
    ],
    readBy: [
      {
        userId: { type: Schema.Types.Mixed },
        readAt: { type: Date, default: Date.now }
      }
    ],
    deletedFor: [
      {
        type: Schema.Types.Mixed
      }
    ],
    expiresAt: {
      type: Date,
      index: { expires: 0 } // TTL automatic deletion when expiresAt is reached
    }
  },
  {
    timestamps: true
  }
);

// Compound Index for efficient chat feed query performance
MessageSchema.index({ roomId: 1, createdAt: -1 });

export const Message = mongoose.model<IMessage>('Message', MessageSchema);
