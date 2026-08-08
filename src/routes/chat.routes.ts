import { Router } from 'express';
import {
  createRoom,
  joinRoom,
  getRoomInfo,
  storeEncryptedMessage,
  getRoomMessages
} from '../controllers/chat.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Protect all chat endpoints with Bearer JWT Guard
router.use(authenticate);

router.post('/rooms', createRoom);
router.post('/rooms/join', joinRoom);
router.get('/rooms/:roomCode', getRoomInfo);
router.post('/messages', storeEncryptedMessage);
router.get('/rooms/:roomId/messages', getRoomMessages);

export default router;
