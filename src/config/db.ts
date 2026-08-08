import mongoose from 'mongoose';

/**
 * MongoDB Database Connection Manager
 * Establishes connection to MongoDB Atlas or local instance.
 * Gracefully falls back to zero-knowledge in-memory mode if DB server is offline.
 */
export const connectDB = async (): Promise<boolean> => {
  try {
    const connStr = process.env.MONGODB_URI || 'mongodb://localhost:27017/securec_db';

    const conn = await mongoose.connect(connStr, {
      autoIndex: true,
      serverSelectionTimeoutMS: 3000 // 3-second timeout for quick fallback
    });

    console.log(`[Database] MongoDB Connected Successfully: ${conn.connection.host}`);
    return true;
  } catch (error: any) {
    console.warn(`[Database Warning] Could not connect to MongoDB: ${error.message || error}`);
    console.warn(`[Database Warning] Running in Zero-Knowledge In-Memory Mode.`);
    return false;
  }
};
