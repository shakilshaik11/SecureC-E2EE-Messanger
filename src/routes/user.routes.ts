import { Router } from 'express';
import {
  updateProfile,
  updatePublicKey,
  getPublicKey,
  searchUsers,
  getUserProfileById
} from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Protect all user profile endpoints
router.use(authenticate);

router.put('/profile', updateProfile);
router.put('/public-key', updatePublicKey);
router.get('/public-key/:userId', getPublicKey);
router.get('/search', searchUsers);
router.get('/:userId', getUserProfileById);

export default router;
