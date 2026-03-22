import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { createCheckoutSchema, listCheckoutSchema } from '../schemas/checkout.schemas';
import * as checkoutController from '../controllers/checkout.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use(authenticate);

// List / search checkout requests
router.get('/', validate(listCheckoutSchema, 'query'), asyncHandler(checkoutController.listCheckouts));

// Request a new checkout
router.post('/', validate(createCheckoutSchema), asyncHandler(checkoutController.requestCheckout));

// Get a single checkout request
router.get('/:id', validateUuidParam(), asyncHandler(checkoutController.getCheckout));

// Approve a pending checkout
router.post('/:id/approve', validateUuidParam(), asyncHandler(checkoutController.approveCheckout));

// Reject a pending checkout
router.post('/:id/reject', validateUuidParam(), asyncHandler(checkoutController.rejectCheckout));

// Check in (return) a checked-out credential
router.post('/:id/checkin', validateUuidParam(), asyncHandler(checkoutController.checkinCheckout));

export default router;
