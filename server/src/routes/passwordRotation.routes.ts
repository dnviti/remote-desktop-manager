import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { enableRotationSchema } from '../schemas/passwordRotation.schemas';
import * as passwordRotationController from '../controllers/passwordRotation.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use(authenticate);

// Enable/disable rotation on a secret
router.post(
  '/:id/rotation/enable',
  validateUuidParam(),
  validate(enableRotationSchema),
  asyncHandler(passwordRotationController.enableRotation),
);

router.post(
  '/:id/rotation/disable',
  validateUuidParam(),
  asyncHandler(passwordRotationController.disableRotation),
);

// Manually trigger rotation
router.post(
  '/:id/rotation/trigger',
  validateUuidParam(),
  asyncHandler(passwordRotationController.triggerRotation),
);

// Get rotation status for a secret
router.post(
  '/rotation/status',
  asyncHandler(passwordRotationController.getRotationStatus),
);

// Get rotation history for a secret
router.post(
  '/rotation/history',
  asyncHandler(passwordRotationController.getRotationHistory),
);

export default router;
