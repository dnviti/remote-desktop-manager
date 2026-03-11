import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { listRecordingsQuerySchema } from '../schemas/recording.schemas';
import * as recordingController from '../controllers/recording.controller';

const router = Router();
router.use(authenticate);

router.get('/', validate(listRecordingsQuerySchema, 'query'), recordingController.listRecordings);
router.get('/:id', validateUuidParam(), recordingController.getRecording);
router.get('/:id/stream', validateUuidParam(), recordingController.streamRecording);
router.get('/:id/analyze', validateUuidParam(), recordingController.analyzeRecording);
router.get('/:id/video', validateUuidParam(), recordingController.exportVideo);
router.delete('/:id', validateUuidParam(), recordingController.deleteRecording);

export default router;
