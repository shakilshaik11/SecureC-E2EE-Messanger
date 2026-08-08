import express, { Request, Response, Application } from 'express';
import http from 'http';
import WebSocket from 'ws';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import { errorHandler } from './middleware/error.middleware';
import { sanitizeInput } from './middleware/security.middleware';
import { connectDB } from './config/db';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import chatRoutes from './routes/chat.routes';
import fileRoutes from './routes/file.routes';
import { handleWebSocketConnection } from './sockets/socket.handler';

// Load environment variables
dotenv.config();

const app: Application = express();
const server = http.createServer(app);

// 1. Security Headers via Helmet (configured for local static web assets)
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

// 2. Cross-Origin Resource Sharing (CORS) Configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// 3. JSON & URL-encoded Request Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Input Sanitization (NoSQL Injection & XSS Guard)
app.use(sanitizeInput);

// 5. Serve Glassmorphism Frontend Static Assets
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));

// 6. Rate Limiting Middleware for API routes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.'
  }
});
app.use('/api', globalLimiter);

// 7. System Health Check Endpoint
app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    service: 'SecureC E2EE Backend API',
    status: 'ONLINE',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 8. Register API Feature Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/chats', chatRoutes);
app.use('/api/v1/files', fileRoutes);

// 9. Root Route Fallback: Serve Index HTML
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// 10. Global Error Handler Middleware
app.use(errorHandler);

// 11. Initialize Native WebSockets (WSS) Server
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  handleWebSocketConnection(ws);
});

// 12. Start Server & Connect Database
const PORT = Number(process.env.PORT) || 5000;

const getLocalIpAddresses = (): string[] => {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
};

const startServer = async () => {
  if (process.env.MONGODB_URI) {
    try {
      await connectDB();
    } catch (e) {
      console.warn('[Database Warning] Running in memory mode until DB available');
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIpAddresses();
    console.log(`====================================================`);
    console.log(`🛡️ SecureC Production E2EE Messenger is RUNNING!`);
    console.log(`👉 Local (Laptop):   http://localhost:${PORT}`);
    ips.forEach(ip => {
      console.log(`👉 Mobile (LAN Wi-Fi): http://${ip}:${PORT}`);
    });
    console.log(`👉 Health Check:     http://localhost:${PORT}/api/v1/health`);
    console.log(`👉 WebSockets:       ws://0.0.0.0:${PORT}/ws`);
    console.log(`====================================================`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, server, wss };
