import jwt, { SignOptions } from 'jsonwebtoken';

export interface TokenPayload {
  userId: string;
  email: string;
}

/**
 * Generate Short-Lived Access Token (15m)
 */
export const generateAccessToken = (payload: TokenPayload): string => {
  const secret = process.env.JWT_SECRET || 'default_access_secret_securec';
  const options: SignOptions = {
    expiresIn: '15m'
  };
  return jwt.sign(payload, secret, options);
};

/**
 * Generate Long-Lived Refresh Token (7d)
 */
export const generateRefreshToken = (payload: TokenPayload): string => {
  const secret = process.env.JWT_REFRESH_SECRET || 'default_refresh_secret_securec';
  const options: SignOptions = {
    expiresIn: '7d'
  };
  return jwt.sign(payload, secret, options);
};

/**
 * Verify Access Token
 */
export const verifyAccessToken = (token: string): TokenPayload => {
  const secret = process.env.JWT_SECRET || 'default_access_secret_securec';
  return jwt.verify(token, secret) as TokenPayload;
};

/**
 * Verify Refresh Token
 */
export const verifyRefreshToken = (token: string): TokenPayload => {
  const secret = process.env.JWT_REFRESH_SECRET || 'default_refresh_secret_securec';
  return jwt.verify(token, secret) as TokenPayload;
};
