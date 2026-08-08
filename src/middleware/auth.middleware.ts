import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/token';
import { ApiError } from '../utils/apiError';
import { User } from '../models/user.model';
import mongoose from 'mongoose';

/**
 * Bearer JWT Authentication Guard Middleware
 * Validates access token and attaches user model instance to req.user.
 */
export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Access denied. Bearer token missing.');
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (mongoose.connection.readyState === 1) {
      const user = await User.findById(decoded.userId);
      if (user) {
        req.user = user;
        return next();
      }
    }

    // Zero-knowledge fallback: construct user object from decoded JWT payload
    req.user = {
      _id: decoded.userId,
      email: decoded.email,
      username: decoded.email ? decoded.email.split('@')[0] : 'User',
      avatar: '🧑‍💻'
    } as any;

    next();
  } catch (error) {
    next(error);
  }
};
