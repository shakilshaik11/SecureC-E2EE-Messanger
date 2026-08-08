import { Router } from 'express';
import {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
  getCurrentUser
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public Authentication Endpoints
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/refresh-token', refreshSession);

// Protected Authentication Endpoints
router.post('/logout', authenticate, logoutUser);
router.get('/me', authenticate, getCurrentUser);

export default router;
