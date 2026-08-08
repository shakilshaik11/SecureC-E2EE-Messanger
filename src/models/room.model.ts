import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRoom extends Document {
  code: string;
  hostId?: any;
  name?: string;
  maxParticipants: number;
  participants: any[];
  isActive: boolean;
  isEncrypted: boolean;
  isPersistent?: boolean;
  disappearingTimer: number; // in seconds (0 = disabled)
  createdAt: Date;
  updatedAt: Date;
}

const RoomSchema: Schema<IRoom> = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },
    hostId: {
      type: Schema.Types.Mixed,
      required: false
    },
    name: {
      type: String,
      default: 'Secure Room'
    },
    maxParticipants: {
      type: Number,
      default: 2,
      min: 2,
      max: 50
    },
    participants: [
      {
        type: Schema.Types.Mixed
      }
    ],
    isActive: {
      type: Boolean,
      default: true
    },
    isEncrypted: {
      type: Boolean,
      default: true
    },
    isPersistent: {
      type: Boolean,
      default: false
    },
    disappearingTimer: {
      type: Number,
      default: 0 // Default: off
    }
  },
  {
    timestamps: true
  }
);

export const Room = mongoose.model<IRoom>('Room', RoomSchema);
