import { Request, Response, NextFunction } from 'express';
import { User } from '../models/user.model';
import { ApiError } from '../utils/apiError';
import { ApiResponse } from '../utils/apiResponse';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/token';

/**
 * Register New User
 * POST /api/v1/auth/register
 */
export const registerUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { username, email, password, avatar, publicKey } = req.body;

    if (!username || !email || !password) {
      throw ApiError.badRequest('Username, email, and password are required fields.');
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      throw ApiError.badRequest('A user with this email or username already exists.');
    }

    // Create user instance
    const newUser = new User({
      username,
      email,
      passwordHash: password,
      avatar: avatar || '🧑‍💻',
      publicKey: publicKey || null,
      isOnline: true
    });

    await newUser.save();

    const userIdStr = String(newUser._id);

    // Generate tokens
    const accessToken = generateAccessToken({ userId: userIdStr, email: newUser.email });
    const refreshToken = generateRefreshToken({ userId: userIdStr, email: newUser.email });

    // Store refresh token
    newUser.refreshToken = refreshToken;
    await newUser.save();

    res.status(201).json(
      ApiResponse.created(
        {
          user: {
            id: newUser._id,
            username: newUser.username,
            email: newUser.email,
            avatar: newUser.avatar,
            publicKey: newUser.publicKey
          },
          tokens: {
            accessToken,
            refreshToken
          }
        },
        'User registered successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * User Login
 * POST /api/v1/auth/login
 */
export const loginUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw ApiError.badRequest('Email and password are required.');
    }

    // Explicitly select passwordHash & refreshToken
    const user = await User.findOne({ email }).select('+passwordHash +refreshToken');
    if (!user) {
      throw ApiError.unauthorized('Invalid email or password credentials.');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw ApiError.unauthorized('Invalid email or password credentials.');
    }

    const userIdStr = String(user._id);

    // Generate fresh tokens
    const accessToken = generateAccessToken({ userId: userIdStr, email: user.email });
    const refreshToken = generateRefreshToken({ userId: userIdStr, email: user.email });

    user.refreshToken = refreshToken;
    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    res.status(200).json(
      ApiResponse.success(
        {
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            publicKey: user.publicKey
          },
          tokens: {
            accessToken,
            refreshToken
          }
        },
        'Logged in successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh Access Token
 * POST /api/v1/auth/refresh-token
 */
export const refreshSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw ApiError.badRequest('Refresh token is required.');
    }

    const decoded = verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.userId).select('+refreshToken');

    if (!user || user.refreshToken !== refreshToken) {
      throw ApiError.unauthorized('Invalid or expired refresh token.');
    }

    const userIdStr = String(user._id);

    const newAccessToken = generateAccessToken({ userId: userIdStr, email: user.email });
    const newRefreshToken = generateRefreshToken({ userId: userIdStr, email: user.email });

    user.refreshToken = newRefreshToken;
    await user.save();

    res.status(200).json(
      ApiResponse.success(
        {
          tokens: {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken
          }
        },
        'Token refreshed successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Logout User
 * POST /api/v1/auth/logout
 */
export const logoutUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user) {
      req.user.refreshToken = undefined;
      req.user.isOnline = false;
      req.user.lastSeen = new Date();
      await req.user.save();
    }

    res.status(200).json(ApiResponse.success(null, 'Logged out successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get Authenticated User Profile
 * GET /api/v1/auth/me
 */
export const getCurrentUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      throw ApiError.unauthorized();
    }

    res.status(200).json(
      ApiResponse.success(
        {
          user: {
            id: req.user._id,
            username: req.user.username,
            email: req.user.email,
            avatar: req.user.avatar,
            publicKey: req.user.publicKey,
            isOnline: req.user.isOnline,
            lastSeen: req.user.lastSeen
          }
        },
        'User profile retrieved successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};
