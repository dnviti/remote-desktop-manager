import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as importExportController from '../controllers/importExport.controller';

const router = Router();

router.use(authenticate);

router.post('/export', importExportController.exportConnections);
router.post('/import', importExportController.importConnections);

export default router;
