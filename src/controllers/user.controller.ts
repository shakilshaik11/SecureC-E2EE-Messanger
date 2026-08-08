import { Request, Response, NextFunction } from 'express';
import { User } from '../models/user.model';
import { ApiError } from '../utils/apiError';
import { ApiResponse } from '../utils/apiResponse';

/**
 * Update Profile (Username & Avatar)
 * PUT /api/v1/users/profile
 */
export const updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw ApiError.unauthorized();

    const { username, avatar } = req.body;

    if (username && username !== req.user.username) {
      const existing = await User.findOne({ username });
      if (existing) {
        throw ApiError.badRequest('Username is already taken by another user.');
      }
      req.user.username = username;
    }

    if (avatar) {
      req.user.avatar = avatar;
    }

    await req.user.save();

    res.status(200).json(
      ApiResponse.success(
        {
          user: {
            id: req.user._id,
            username: req.user.username,
            email: req.user.email,
            avatar: req.user.avatar,
            publicKey: req.user.publicKey
          }
        },
        'Profile updated successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Publish or Rotate ECDH Public Key for E2EE Key Exchange
 * PUT /api/v1/users/public-key
 */
export const updatePublicKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw ApiError.unauthorized();

    const { publicKey } = req.body;
    if (!publicKey) {
      throw ApiError.badRequest('Public key JWK string is required.');
    }

    req.user.publicKey = typeof publicKey === 'object' ? JSON.stringify(publicKey) : publicKey;
    await req.user.save();

    res.status(200).json(
      ApiResponse.success(
        {
          publicKey: req.user.publicKey
        },
        'ECDH Public Key published successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Fetch Peer Public Key for E2EE Diffie-Hellman Key Agreement
 * GET /api/v1/users/public-key/:userId
 */
export const getPublicKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('username publicKey isOnline');

    if (!user) {
      throw ApiError.notFound('User not found.');
    }

    if (!user.publicKey) {
      throw ApiError.badRequest('Target user has not registered an E2EE public key yet.');
    }

    res.status(200).json(
      ApiResponse.success(
        {
          userId: user._id,
          username: user.username,
          publicKey: user.publicKey
        },
        'Public key retrieved successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Search Users by Username or Email
 * GET /api/v1/users/search?q=alex
 */
export const searchUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = (req.query.q as string || '').trim();
    if (!query) {
      res.status(200).json(ApiResponse.success([], 'Search query empty'));
      return;
    }

    const currentUserId = req.user?._id;

    const users = await User.find({
      _id: { $ne: currentUserId },
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ]
    }).select('username avatar email isOnline lastSeen publicKey').limit(20);

    res.status(200).json(ApiResponse.success(users, 'Users found'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get User Profile by ID
 * GET /api/v1/users/:userId
 */
export const getUserProfileById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('username avatar email isOnline lastSeen publicKey');

    if (!user) {
      throw ApiError.notFound('User not found.');
    }

    res.status(200).json(ApiResponse.success(user, 'User profile retrieved'));
  } catch (error) {
    next(error);
  }
};
