import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { listRecordingsQuerySchema } from '../schemas/recording.schemas';
import * as recordingController from '../controllers/recording.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(authenticate);

router.get('/', validate(listRecordingsQuerySchema, 'query'), asyncHandler(recordingController.listRecordings));
router.get('/:id', validateUuidParam(), asyncHandler(recordingController.getRecording));
router.get('/:id/stream', validateUuidParam(), asyncHandler(recordingController.streamRecording));
router.get('/:id/analyze', validateUuidParam(), asyncHandler(recordingController.analyzeRecording));
router.get('/:id/video', validateUuidParam(), asyncHandler(recordingController.exportVideo));
router.get('/:id/audit-trail', validateUuidParam(), asyncHandler(recordingController.getAuditTrail));
router.delete('/:id', validateUuidParam(), asyncHandler(recordingController.deleteRecording));

export default router;
