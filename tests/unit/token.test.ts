import { generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken } from '../../src/utils/token';

describe('Token Utility Unit Tests', () => {
  const samplePayload = {
    userId: '65c9f1a2e3b4c5d6e7f8a9b0',
    email: 'testuser@securec.io'
  };

  test('should generate valid JWT access token and verify it correctly', () => {
    const accessToken = generateAccessToken(samplePayload);
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(20);

    const decoded = verifyAccessToken(accessToken);
    expect(decoded.userId).toBe(samplePayload.userId);
    expect(decoded.email).toBe(samplePayload.email);
  });

  test('should generate valid JWT refresh token and verify it correctly', () => {
    const refreshToken = generateRefreshToken(samplePayload);
    expect(typeof refreshToken).toBe('string');
    expect(refreshToken.length).toBeGreaterThan(20);

    const decoded = verifyRefreshToken(refreshToken);
    expect(decoded.userId).toBe(samplePayload.userId);
    expect(decoded.email).toBe(samplePayload.email);
  });

  test('should throw error when verifying invalid token string', () => {
    expect(() => {
      verifyAccessToken('invalid.jwt.token');
    }).toThrow();
  });
});
