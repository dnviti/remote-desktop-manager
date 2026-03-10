import { Response, NextFunction } from 'express';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest, assertAuthenticated } from '../types';
import * as importExportService from '../services/importExport.service';
import * as auditService from '../services/audit.service';
import { z } from 'zod';
import multer from 'multer';
import { getClientIp } from '../utils/ip';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const exportHandler = upload.none();

export async function exportConnections(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const schema = z.object({
      format: z.enum(['CSV', 'JSON']),
      includeCredentials: z.boolean().default(false),
      connectionIds: z.array(z.string().uuid()).optional(),
      folderId: z.string().uuid().optional(),
    });

    const data = schema.parse(req.body);

    const result = await importExportService.exportConnections({
      format: data.format,
      includeCredentials: data.includeCredentials,
      userId: req.user.userId,
      connectionIds: data.connectionIds,
      folderId: data.folderId,
    });

    auditService.log({
      userId: req.user.userId,
      action: 'EXPORT_CONNECTIONS',
      targetType: 'Connection',
      details: {
        format: data.format,
        includeCredentials: data.includeCredentials,
        connectionCount: data.connectionIds?.length || 1,
      },
      ipAddress: getClientIp(req),
    });

    const contentType = data.format === 'JSON' ? 'application/json' : 'text/csv';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError(err.issues[0].message || 'Invalid request', 400));
    }
    next(err);
  }
}

export async function importConnections(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const schema = z.object({
      duplicateStrategy: z.enum(['SKIP', 'OVERWRITE', 'RENAME']).default('SKIP'),
      format: z.enum(['CSV', 'JSON', 'MREMOTENG', 'RDP']).optional(),
    });

    const validationResult = schema.parse(req.body);
    const { duplicateStrategy, format } = validationResult;

    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const fileContent = req.file.buffer.toString('utf8');
    const detectedFormat = detectFormat(req.file.originalname, format);

    let result: importExportService.ImportResult;

    switch (detectedFormat) {
      case 'CSV':
        result = await importExportService.importConnectionsFromCsv(fileContent, {
          duplicateStrategy,
          userId: req.user.userId,
        }, req.body.columnMapping || {});
        break;
      case 'JSON':
        const jsonData = JSON.parse(fileContent);
        result = await importExportService.importConnectionsFromJson(jsonData, {
          duplicateStrategy,
          userId: req.user.userId,
        });
        break;
      case 'MREMOTENG':
        result = await importExportService.importConnectionsFromMremoteng(fileContent, {
          duplicateStrategy,
          userId: req.user.userId,
        });
        break;
      case 'RDP':
        result = await importExportService.importConnectionsFromRdp(fileContent, {
          duplicateStrategy,
          userId: req.user.userId,
        });
        break;
      default:
        throw new AppError('Unsupported format', 400);
    }

    auditService.log({
      userId: req.user.userId,
      action: 'IMPORT_CONNECTIONS',
      targetType: 'Connection',
      details: {
        format: detectedFormat,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      },
      ipAddress: getClientIp(req),
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError(err.issues[0].message || 'Invalid request', 400));
    }
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
      return next(new AppError('Invalid JSON format', 400));
    }
    next(err);
  }
}

function detectFormat(filename: string, explicitFormat?: string): string {
  if (explicitFormat) {
    return explicitFormat.toUpperCase();
  }

  const lowerExt = filename.toLowerCase();
  if (lowerExt.endsWith('.csv')) {
    return 'CSV';
  }
  if (lowerExt.endsWith('.json')) {
    return 'JSON';
  }
  if (lowerExt.endsWith('.xml')) {
    return 'MREMOTENG';
  }
  if (lowerExt.endsWith('.rdp')) {
    return 'RDP';
  }

  return 'CSV';
}

export interface ColumnMapping {
  name?: string;
  host?: string;
  port?: string;
  type?: string;
  username?: string;
  password?: string;
  folder?: string;
  description?: string;
  [key: string]: string | undefined;
}
