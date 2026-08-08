import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISettings extends Document {
  userId: Types.ObjectId;
  readReceiptsEnabled: boolean;
  lastSeenPrivacy: 'everyone' | 'contacts' | 'nobody';
  disappearingMessagesDefault: number; // in seconds
  theme: 'light' | 'dark' | 'system';
}

const SettingsSchema: Schema<ISettings> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    readReceiptsEnabled: {
      type: Boolean,
      default: true
    },
    lastSeenPrivacy: {
      type: String,
      enum: ['everyone', 'contacts', 'nobody'],
      default: 'everyone'
    },
    disappearingMessagesDefault: {
      type: Number,
      default: 0
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'light'
    }
  },
  {
    timestamps: true
  }
);

export const Settings = mongoose.model<ISettings>('Settings', SettingsSchema);
