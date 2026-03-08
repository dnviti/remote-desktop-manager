import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as webauthnController from '../controllers/webauthn.controller';

const router = Router();
router.use(authenticate);

router.post('/registration-options', webauthnController.registrationOptions);
router.post('/register', webauthnController.register);
router.get('/credentials', webauthnController.getCredentials);
router.delete('/credentials/:id', webauthnController.removeCredential);
router.patch('/credentials/:id', webauthnController.renameCredential);
router.get('/status', webauthnController.status);

export default router;
