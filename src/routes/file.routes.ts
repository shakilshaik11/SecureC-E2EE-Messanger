import { Router } from 'express';
import { uploadEncryptedFile } from '../controllers/file.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);
router.post('/upload-encrypted', uploadEncryptedFile);

export default router;
