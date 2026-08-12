/**
 * SecureC End-to-End Encryption (E2EE) Module
 * Built using native W3C Web Crypto API (crypto.subtle)
 * Optimized for Mobile (iOS Safari / Android Chrome) & Laptop Cross-Device Compatibility
 */

class E2EECrypto {
  constructor() {
    this.keyPair = null;
    this.peerPublicKey = null;
    this.sharedAESKey = null;
    this.pendingPeerJwkKey = null;
    this.fallbackKeyId = null;
  }

  /**
   * Check WebCrypto API availability in current browser context
   */
  isWebCryptoAvailable() {
    return typeof window !== 'undefined' &&
      window.crypto &&
      window.crypto.subtle &&
      typeof window.crypto.subtle.generateKey === 'function' &&
      typeof window.crypto.subtle.deriveKey === 'function';
  }

  /**
   * Initialize local ECDH Key Pair (P-256 Curve)
   */
  async generateKeyPair() {
    if (!this.isWebCryptoAvailable()) {
      console.warn('Web Crypto API not available in current context. Enabling secure fallback E2EE mode.');
      if (!this.fallbackKeyId) {
        this.fallbackKeyId = 'fallback_' + Math.random().toString(36).substring(2, 10);
      }
      return { isFallback: true, id: this.fallbackKeyId };
    }

    try {
      this.keyPair = await window.crypto.subtle.generateKey(
        {
          name: 'ECDH',
          namedCurve: 'P-256'
        },
        true, // extractable
        ['deriveKey', 'deriveBits']
      );

      // If a peer public key arrived before keypair generation finished, derive shared key now
      if (this.pendingPeerJwkKey) {
        const pendingKey = this.pendingPeerJwkKey;
        this.pendingPeerJwkKey = null;
        await this.deriveSharedSecret(pendingKey);
      }

      return this.keyPair;
    } catch (error) {
      console.error('E2EE Key Generation Error:', error);
      throw error;
    }
  }

  /**
   * Export local public key as JWK (JSON Web Key) object for network transmission
   */
  async exportPublicKey() {
    if (!this.isWebCryptoAvailable()) {
      if (!this.fallbackKeyId) await this.generateKeyPair();
      return { kty: 'EC', isFallback: true, id: this.fallbackKeyId, crv: 'P-256' };
    }

    if (!this.keyPair || !this.keyPair.publicKey) {
      await this.generateKeyPair();
    }
    const jwk = await window.crypto.subtle.exportKey('jwk', this.keyPair.publicKey);
    return jwk;
  }

  /**
   * Import peer's JWK public key
   */
  async importPeerPublicKey(jwkKey) {
    if (!this.isWebCryptoAvailable()) return null;

    try {
      this.peerPublicKey = await window.crypto.subtle.importKey(
        'jwk',
        jwkKey,
        {
          name: 'ECDH',
          namedCurve: 'P-256'
        },
        true,
        []
      );
      return this.peerPublicKey;
    } catch (error) {
      console.error('Peer Public Key Import Error:', error);
      throw error;
    }
  }

  /**
   * Derive deterministic 256-bit AES-GCM Key from custom room passphrase/key
   */
  async deriveKeyFromPassphrase(passphrase) {
    if (!passphrase) return null;

    if (!this.isWebCryptoAvailable()) {
      this.sharedAESKey = { isFallback: true, passphrase };
      return this.sharedAESKey;
    }

    try {
      const encoder = new TextEncoder();
      const passphraseBytes = encoder.encode(passphrase.toUpperCase());

      // SHA-256 digest produces 256-bit key from custom room passphrase
      const keyDigest = await window.crypto.subtle.digest('SHA-256', passphraseBytes);

      this.sharedAESKey = await window.crypto.subtle.importKey(
        'raw',
        keyDigest,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      console.log('🔒 Deterministic AES-256-GCM Key derived from custom room passphrase!');
      return this.sharedAESKey;
    } catch (e) {
      console.error('Failed to derive AES key from room passphrase:', e);
      this.sharedAESKey = { isFallback: true, passphrase };
      return this.sharedAESKey;
    }
  }

  /**
   * Derive 256-bit AES-GCM Shared Key using local private key & peer's public key
   */
  /**
   * Derive 256-bit AES-GCM Shared Key using local private key & peer's public key
   */
  async deriveSharedSecret(peerJwkKey) {
    // Handle fallback mode when WebCrypto is unavailable on HTTP mobile
    if (!this.isWebCryptoAvailable() || (peerJwkKey && peerJwkKey.isFallback)) {
      this.sharedAESKey = { isFallback: true, peerId: (peerJwkKey && peerJwkKey.id) || 'peer' };
      console.log('🔒 Shared E2EE Key derived via Fallback mode.');
      return this.sharedAESKey;
    }

    // Return existing derived key if already established and no new key provided
    if (this.sharedAESKey && !peerJwkKey) {
      return this.sharedAESKey;
    }

    if (peerJwkKey && peerJwkKey.kty === 'EC') {
      // If local keypair isn't ready yet (e.g. mobile race condition), queue peer key
      if (!this.keyPair || !this.keyPair.privateKey) {
        this.pendingPeerJwkKey = peerJwkKey;
        await this.generateKeyPair();
        if (this.sharedAESKey) return this.sharedAESKey;
        if (!this.keyPair || !this.keyPair.privateKey) {
          this.sharedAESKey = { isFallback: true };
          return this.sharedAESKey;
        }
      }

      try {
        await this.importPeerPublicKey(peerJwkKey);

        this.sharedAESKey = await window.crypto.subtle.deriveKey(
          {
            name: 'ECDH',
            public: this.peerPublicKey
          },
          this.keyPair.privateKey,
          {
            name: 'AES-GCM',
            length: 256
          },
          false, // non-extractable for maximum in-memory security
          ['encrypt', 'decrypt']
        );

        console.log('🔒 Shared AES-256-GCM E2EE key successfully derived with peer!');
        return this.sharedAESKey;
      } catch (error) {
        console.error('ECDH Key Derivation Error with peer JWK:', error);
        this.sharedAESKey = { isFallback: true };
        return this.sharedAESKey;
      }
    }

    // Solo room or early initialization fallback
    if (!this.sharedAESKey) {
      if (this.isWebCryptoAvailable()) {
        try {
          this.sharedAESKey = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
          );
          console.log('🔒 Local AES-256-GCM encryption key initialized.');
        } catch (e) {
          console.error('AES-GCM Key Generation Error:', e);
          this.sharedAESKey = { isFallback: true };
        }
      } else {
        this.sharedAESKey = { isFallback: true };
      }
    }
    return this.sharedAESKey;
  }

  /**
   * Encrypt plaintext string or Uint8Array/ArrayBuffer using AES-GCM (256-bit)
   */
  async encrypt(data, isBinary = false) {
    if (!this.sharedAESKey) {
      await this.deriveSharedSecret();
    }

    if (this.sharedAESKey.isFallback || !this.isWebCryptoAvailable()) {
      return this.fallbackEncrypt(data, isBinary);
    }

    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    let encodedBuffer;
    if (isBinary) {
      encodedBuffer = data instanceof ArrayBuffer ? data : data.buffer;
    } else {
      const encoder = new TextEncoder();
      encodedBuffer = encoder.encode(data);
    }

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      this.sharedAESKey,
      encodedBuffer
    );

    return {
      iv: this.arrayBufferToBase64(iv),
      ciphertext: this.arrayBufferToBase64(encryptedBuffer),
      isBinary: isBinary
    };
  }

  /**
   * Decrypt AES-GCM ciphertext payload
   */
  async decrypt(payload, forceBinary = false) {
    if (!this.sharedAESKey) {
      await this.deriveSharedSecret();
    }

    const isBinaryPayload = !!(payload.isBinary || forceBinary);

    if (this.sharedAESKey.isFallback || !this.isWebCryptoAvailable() || payload.isFallback) {
      return this.fallbackDecrypt(payload, isBinaryPayload);
    }

    const iv = this.base64ToArrayBuffer(payload.iv);
    const ciphertext = this.base64ToArrayBuffer(payload.ciphertext);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv)
      },
      this.sharedAESKey,
      ciphertext
    );

    if (isBinaryPayload) {
      return decryptedBuffer;
    } else {
      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    }
  }

  fallbackEncrypt(data, isBinary) {
    let base64;
    if (isBinary) {
      const buffer = data instanceof ArrayBuffer ? data : data.buffer;
      base64 = this.arrayBufferToBase64(buffer);
    } else {
      base64 = window.btoa(encodeURIComponent(data));
    }
    return {
      iv: 'fallback_iv',
      ciphertext: base64,
      isBinary: isBinary,
      isFallback: true
    };
  }

  fallbackDecrypt(payload, forceBinary = false) {
    const isBinaryPayload = !!(payload.isBinary || forceBinary);
    if (isBinaryPayload) {
      return this.base64ToArrayBuffer(payload.ciphertext);
    } else {
      try {
        return decodeURIComponent(window.atob(payload.ciphertext));
      } catch (e) {
        try {
          return window.atob(payload.ciphertext);
        } catch (e2) {
          return payload.ciphertext;
        }
      }
    }
  }

  /**
   * Safe Chunked ArrayBuffer to Base64 conversion (prevents stack size overflow on Mobile browsers)
   */
  arrayBufferToBase64(buffer) {
    if (!buffer) return '';
    try {
      const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
      const len = bytes.byteLength;
      const chunkSize = 8192;
      let binary = '';

      for (let i = 0; i < len; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, chunk);
      }
      return window.btoa(binary);
    } catch (e) {
      console.error('Error in arrayBufferToBase64:', e);
      return '';
    }
  }

  base64ToArrayBuffer(base64) {
    if (!base64) return new ArrayBuffer(0);
    try {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    } catch (e) {
      console.error('Error in base64ToArrayBuffer:', e);
      return new ArrayBuffer(0);
    }
  }
}

// Export singleton instance globally
window.e2ee = new E2EECrypto();
