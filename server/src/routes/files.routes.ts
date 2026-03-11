import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { fileNameSchema } from '../schemas/files.schemas';
import { AuthRequest, assertAuthenticated } from '../types';
import * as filesController from '../controllers/files.controller';
import { config } from '../config';
import { ensureUserDrive, checkQuota } from '../services/file.service';

const storage = multer.diskStorage({
  destination: async (req: Request, _file, cb) => {
    try {
      const authReq = req as AuthRequest;
      assertAuthenticated(authReq);
      const dirPath = await ensureUserDrive(authReq.user.userId);
      cb(null, dirPath);
    } catch (err) {
      cb(err as Error, '');
    }
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.fileUploadMaxSize },
});

const router = Router();

router.use(authenticate);

const quotaCheck = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    assertAuthenticated(req);
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    await checkQuota(req.user.userId, contentLength);
    next();
  } catch (err) {
    next(err);
  }
};

router.get('/', filesController.list);
router.get('/:name', validate(fileNameSchema, 'params'), filesController.download);
router.post('/', quotaCheck as never, upload.single('file'), filesController.upload as never);
router.delete('/:name', validate(fileNameSchema, 'params'), filesController.remove);

export default router;
