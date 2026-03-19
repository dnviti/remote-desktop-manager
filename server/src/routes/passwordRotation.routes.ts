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
router.get(
  '/:id/rotation/status',
  validateUuidParam(),
  asyncHandler(passwordRotationController.getRotationStatus),
);

// Get rotation history for a secret
router.get(
  '/:id/rotation/history',
  validateUuidParam(),
  asyncHandler(passwordRotationController.getRotationHistory),
);

export default router;
