import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDevice extends Document {
  userId: Types.ObjectId;
  deviceId: string;
  fcmToken?: string;
  deviceOS: 'android' | 'ios' | 'web';
  deviceName?: string;
  lastActive: Date;
}

const DeviceSchema: Schema<IDevice> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    deviceId: {
      type: String,
      required: true
    },
    fcmToken: {
      type: String,
      default: null
    },
    deviceOS: {
      type: String,
      enum: ['android', 'ios', 'web'],
      default: 'web'
    },
    deviceName: {
      type: String,
      default: 'Unknown Device'
    },
    lastActive: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

export const Device = mongoose.model<IDevice>('Device', DeviceSchema);
