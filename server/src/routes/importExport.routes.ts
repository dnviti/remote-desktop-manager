import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { exportSchema, importSchema } from '../schemas/importExport.schemas';
import * as importExportController from '../controllers/importExport.controller';

const router = Router();

router.use(authenticate);

router.post('/export', validate(exportSchema), importExportController.exportConnections);
router.post('/import', validate(importSchema), importExportController.importConnections);

export default router;
