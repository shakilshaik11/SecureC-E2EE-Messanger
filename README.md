# 🛡️ SecureC E2EE Messenger

> **Production-Ready, Zero-Knowledge End-to-End Encrypted Real-Time Messaging Platform**

![SecureC Logo](public/logo.svg)

**SecureC E2EE Messenger** is a privacy-first, zero-knowledge messaging application designed for instant, real-time encrypted communication across mobile and desktop devices. Client-side cryptography ensures that raw messages, file attachments, and voice notes are encrypted on the sender's device and decrypted only by the intended recipient — leaving zero unencrypted data on the server.

---

## ✨ Key Features

- 🔒 **Zero-Knowledge Architecture**: All messages, media, and voice notes are encrypted client-side using AES-GCM (256-bit) and Elliptic Curve Diffie-Hellman (ECDH) key exchange.
- ⚡ **Real-Time WebSockets**: Instant message delivery with live online/offline indicators, typing notifications, and read receipts.
- 🎙️ **Encrypted Voice Notes**: Record and transmit end-to-end encrypted audio voice notes directly inside the chat feed.
- 📁 **Chunked File Transfer**: High-speed, encrypted chunked file sharing for documents, images, and media.
- 🔑 **Ephemeral & Persistent Rooms**: Create temporary 6-digit room codes for quick chats or personal persistent vault rooms using custom passcodes.
- 🎨 **Glassmorphism UI**: Modern aesthetic design system with light/dark glass theme switcher, fluid responsive layouts for mobile and desktop, and zero horizontal overflow.
- 💾 **Dual Storage Engine**: Automatic MongoDB Atlas integration for persistent sessions with zero-knowledge in-memory fallback.
- 🧪 **Automated Testing Suite**: 100% automated test pass rate with Jest & Supertest unit and integration tests.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, ESNext JavaScript, Glassmorphism Vanilla CSS, FontAwesome 6, W3C Web Crypto API
- **Backend**: Node.js, Express, TypeScript, Native WebSockets (`ws`), Mongoose / MongoDB Atlas
- **Security & Auth**: JSON Web Tokens (JWT), Helmet.js Security Headers, Express Rate Limiting, AES-GCM & ECDH Cryptography
- **Testing**: Jest, Supertest, `ts-jest`
- **Deployment**: Docker, Render, Vercel ready

---

## 🚀 Quick Start Guide

### 1. Clone & Install
```bash
git clone https://github.com/shakilshaik11/SecureC-E2EE-Messenger.git
cd SecureC-E2EE-Messenger
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

---

## 🌐 Deploying to Render.com (100% Free)

1. Push this repository to your GitHub account:
   ```bash
   git add .
   git commit -m "Initial release"
   git push -u origin main
   ```
2. Log in to [Render.com](https://render.com) → Click **New Web Service** → Connect your repository `SecureC-E2EE-Messenger`.
3. Set **Build Command**: `npm install && npm run build` and **Start Command**: `npm start`.
4. Add environment variables (`NODE_ENV=production`, `PORT=10000`, `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`).
5. Click **Create Web Service** to launch your live 24/7 HTTPS & WebSocket URL!
