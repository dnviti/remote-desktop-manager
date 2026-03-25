import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fsp from 'fs/promises';
import path from 'path';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { fileNameSchema } from '../schemas/files.schemas';
import { asyncHandler } from '../middleware/asyncHandler';
import { AuthRequest, assertAuthenticated } from '../types';
import * as filesController from '../controllers/files.controller';
import { config } from '../config';
import { ensureUserDrive, checkQuota } from '../services/file.service';
import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';

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
    // Resolve tenant-level quota override
    let tenantQuotaBytes: number | null | undefined;
    if (req.user.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { userDriveQuotaBytes: true, fileUploadMaxSizeBytes: true },
      });
      tenantQuotaBytes = tenant?.userDriveQuotaBytes;
    }
    await checkQuota(req.user.userId, contentLength, tenantQuotaBytes);
    next();
  } catch (err) {
    next(err);
  }
};

// Post-upload middleware: enforce tenant-specific file size limit
const tenantFileSizeCheck = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    assertAuthenticated(req);
    if (!req.file || !req.user.tenantId) { next(); return; }
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { fileUploadMaxSizeBytes: true },
    });
    const maxSize = tenant?.fileUploadMaxSizeBytes;
    if (maxSize && req.file.size > maxSize) {
      // Delete the uploaded file that exceeds tenant limit.
      // Validate path stays within the drive base to satisfy CodeQL path-traversal check.
      const resolvedPath = path.resolve(req.file.path);
      const driveRoot = path.resolve(config.driveBasePath);
      const rel = path.relative(driveRoot, resolvedPath);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fsp.unlink(resolvedPath).catch(() => {});
      }
      throw new AppError(
        `File exceeds organization limit of ${Math.round(maxSize / 1024 / 1024)}MB`,
        413,
      );
    }
    next();
  } catch (err) {
    next(err);
  }
};

router.get('/', asyncHandler(filesController.list));
router.get('/:name', validate(fileNameSchema, 'params'), asyncHandler(filesController.download));
router.post('/', quotaCheck as never, upload.single('file'), tenantFileSizeCheck as never, asyncHandler(filesController.upload) as never);
router.delete('/:name', validate(fileNameSchema, 'params'), asyncHandler(filesController.remove));

export default router;
