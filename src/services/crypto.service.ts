import crypto from 'crypto';

/**
 * Server & Client Cryptographic Utility Service
 * Provides helpers for fingerprint calculations, nonce generation, and verification.
 */
export class CryptoService {
  /**
   * Generate 12-byte random Initialization Vector (IV) for AES-GCM
   */
  static generateIV(): string {
    return crypto.randomBytes(12).toString('base64');
  }

  /**
   * Compute SHA-256 E2EE Security Fingerprint between two public key JWKs
   */
  static computeFingerprint(jwk1: string, jwk2: string): string {
    const sorted = [jwk1, jwk2].sort().join('::');
    const hash = crypto.createHash('sha256').update(sorted).digest('hex');
    // Format into 16 double-hex octets (e.g. A1:B2:C3:D4...)
    return hash.substring(0, 32).toUpperCase().match(/.{1,2}/g)?.join(':') || hash;
  }

  /**
   * Secure random token generation for room codes or session IDs
   */
  static generateRandomCode(length = 6): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }
}
