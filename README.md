# 🛡️ SecureC E2EE Messenger

> **Production-Ready, Zero-Knowledge End-to-End Encrypted Real-Time Messaging Platform**

![SecureC Logo](public/logo.svg)

**SecureC E2EE Messenger** is a privacy-first, zero-knowledge messaging application designed for instant, real-time encrypted communication across mobile and desktop devices. Client-side cryptography ensures that raw messages, file attachments, and voice notes are encrypted on the sender's device and decrypted only by the intended recipient — leaving zero unencrypted data on the server.

---

## ✨ Key Features

- 🔒 **Zero-Knowledge Architecture**: All messages, media, and voice notes are encrypted client-side using AES-GCM (256-bit) and ECDH key exchange.
- ⚡ **Real-Time WebSockets**: Instant message delivery with live online/offline status, typing indicators, and read receipts.
- 🔑 **Ephemeral & Personal Saved Rooms**: Temporary 6-character room codes or persistent personal rooms with custom passcodes.
- 🎙️ **Encrypted Voice Notes & Media**: Send end-to-end encrypted audio voice notes, images, and files directly inside the chat feed.
- 🎨 **Glassmorphism Design**: Responsive UI with light/dark glass theme switcher and mobile-first navigation bar.
- 💾 **Dual Storage Engine**: MongoDB Atlas persistence with zero-knowledge local client fallback.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, ESNext JavaScript, Glassmorphism Vanilla CSS, FontAwesome 6, W3C Web Crypto API
- **Backend**: Node.js, Express, TypeScript, Native WebSockets (`ws`), Mongoose / MongoDB
- **Security**: JWT Authentication, Helmet.js Security Headers, Rate Limiting, AES-GCM & ECDH Cryptography
- **Testing**: Jest, Supertest, `ts-jest`

---

## 🚀 Quick Start Guide

### 1. Clone & Install
```bash
git clone https://github.com/shakilshaik11/SecureC-E2EE-Messanger.git
cd SecureC-E2EE-Messanger
npm install
```

### 2. Configure Environment
Create a `.env` file in the root directory:
```env
PORT=5000
NODE_ENV=development
CORS_ORIGIN=*
MONGODB_URI=mongodb://localhost:27017/securec_db
JWT_SECRET=super_secret_securec_jwt_key_32bytes_2026
JWT_REFRESH_SECRET=super_secret_securec_refresh_key_32bytes_2026
```

### 3. Run Development Server & Tests
```bash
# Run Automated Test Suite
npm test

# Launch Local Dev Server
npm run dev

# Build & Start Production Server
npm run build
npm start
```

