import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { webauthnRegisterSchema, webauthnRenameSchema } from '../schemas/mfa.schemas';
import * as webauthnController from '../controllers/webauthn.controller';

const router = Router();
router.use(authenticate);

router.post('/registration-options', webauthnController.registrationOptions);
router.post('/register', validate(webauthnRegisterSchema, 'body', 'Invalid registration data'), webauthnController.register);
router.get('/credentials', webauthnController.getCredentials);
router.delete('/credentials/:id', validateUuidParam(), webauthnController.removeCredential);
router.patch('/credentials/:id', validateUuidParam(), validate(webauthnRenameSchema, 'body', 'Invalid name'), webauthnController.renameCredential);
router.get('/status', webauthnController.status);

export default router;
