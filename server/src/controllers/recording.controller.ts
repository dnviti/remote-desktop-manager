import { Response, NextFunction } from 'express';
import { readFile, stat } from 'fs/promises';
import fs from 'fs';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import * as recordingService from '../services/recording.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

const listQuerySchema = z.object({
  connectionId: z.string().uuid().optional(),
  protocol: z.enum(['SSH', 'RDP', 'VNC']).optional(),
  status: z.enum(['RECORDING', 'COMPLETE', 'ERROR']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function listRecordings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const query = listQuerySchema.parse(req.query);
    const result = await recordingService.listRecordings({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      ...query,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function getRecording(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const recording = await recordingService.getRecording(req.params.id as string, req.user.userId);
    if (!recording) throw new AppError('Recording not found', 404);

    auditService.log({
      userId: req.user.userId,
      action: 'RECORDING_VIEW',
      targetType: 'Recording',
      targetId: recording.id,
      details: { protocol: recording.protocol, connectionId: recording.connectionId },
      ipAddress: req.ip,
    });

    res.json(recording);
  } catch (err) {
    next(err);
  }
}

export async function streamRecording(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const recording = await recordingService.getRecording(req.params.id as string, req.user.userId);
    if (!recording) throw new AppError('Recording not found', 404);

    const stream = recordingService.streamRecordingFile(recording.filePath);
    if (!stream) throw new AppError('Recording file not found on disk', 404);

    const contentType = recording.format === 'asciicast' ? 'application/x-asciicast' : 'application/octet-stream';
    const ext = recording.format === 'asciicast' ? 'cast' : recording.format;
    const filename = `recording-${recording.id}.${ext}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (recording.fileSize) res.setHeader('Content-Length', recording.fileSize);

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

/**
 * Parse a .guac recording file and return instruction statistics.
 * Useful for diagnosing black-screen recording issues.
 */
export async function analyzeRecording(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const recording = await recordingService.getRecording(req.params.id as string, req.user.userId);
    if (!recording) throw new AppError('Recording not found', 404);
    if (recording.format !== 'guac') throw new AppError('Only .guac recordings can be analyzed', 400);

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const fileStat = await stat(recording.filePath).catch(() => null);
    if (!fileStat) throw new AppError('Recording file not found on disk', 404);

    // Read the file (limit to 10MB to avoid memory issues)
    const maxBytes = 10 * 1024 * 1024;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const buf = await readFile(recording.filePath);
    const content = buf.slice(0, maxBytes).toString('ascii');

    const instructions: Record<string, number> = {};
    let displayWidth = 0;
    let displayHeight = 0;
    let hasLayer0Image = false;

    // Parse guacamole instructions: LENGTH.OPCODE,LENGTH.ARG1,...;
    let pos = 0;
    while (pos < content.length) {
      // Find instruction end
      const semi = content.indexOf(';', pos);
      if (semi === -1) break;
      const raw = content.substring(pos, semi + 1);
      pos = semi + 1;

      // Extract opcode (first element: LENGTH.OPCODE)
      const dotIdx = raw.indexOf('.');
      if (dotIdx === -1) continue;
      const opcodeLen = parseInt(raw.substring(0, dotIdx), 10);
      if (isNaN(opcodeLen)) continue;
      const opcode = raw.substring(dotIdx + 1, dotIdx + 1 + opcodeLen);

      instructions[opcode] = (instructions[opcode] || 0) + 1;

      // Extract display dimensions from 'size' instruction for layer 0
      if (opcode === 'size') {
        const parts = parseGuacArgs(raw);
        if (parts.length >= 3 && parts[0] === '0') {
          displayWidth = parseInt(parts[1], 10) || displayWidth;
          displayHeight = parseInt(parts[2], 10) || displayHeight;
        }
      }

      // Check if any 'img' instruction targets layer 0
      if (opcode === 'img' && !hasLayer0Image) {
        const parts = parseGuacArgs(raw);
        if (parts.length >= 2 && parts[1] === '0') {
          hasLayer0Image = true;
        }
      }
    }

    res.json({
      fileSize: fileStat.size,
      truncated: buf.length > maxBytes,
      instructions,
      syncCount: instructions['sync'] || 0,
      displayWidth,
      displayHeight,
      hasLayer0Image,
    });
  } catch (err) {
    next(err);
  }
}

/** Extract argument values from a guacamole instruction string. */
function parseGuacArgs(instruction: string): string[] {
  const args: string[] = [];
  let pos = 0;
  while (pos < instruction.length) {
    const dotIdx = instruction.indexOf('.', pos);
    if (dotIdx === -1) break;
    const len = parseInt(instruction.substring(pos, dotIdx), 10);
    if (isNaN(len)) break;
    const value = instruction.substring(dotIdx + 1, dotIdx + 1 + len);
    args.push(value);
    pos = dotIdx + 1 + len + 1; // skip past value + comma/semicolon
  }
  // First arg is the opcode; return the rest
  return args.slice(1);
}

export async function exportVideo(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { videoPath, fileSize } = await recordingService.convertToVideo(
      req.params.id as string,
      req.user.userId,
    );

    const stream = recordingService.streamRecordingFile(videoPath);
    if (!stream) throw new AppError('Converted video file not found', 500);

    const filename = `recording-${req.params.id}.m4v`;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', fileSize);
    stream.pipe(res);

    // Delete the converted video file after successful download to save disk space
    res.on('finish', () => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.unlink(videoPath, (err) => {
        if (err && err.code !== 'ENOENT') logger.error(`[recording] Failed to delete video cache: ${err.message}`);
      });
    });

    auditService.log({
      userId: req.user.userId,
      action: 'RECORDING_EXPORT_VIDEO',
      targetType: 'Recording',
      targetId: req.params.id as string,
      ipAddress: req.ip,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteRecording(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const deleted = await recordingService.deleteRecording(req.params.id as string, req.user.userId);
    if (!deleted) throw new AppError('Recording not found', 404);

    auditService.log({
      userId: req.user.userId,
      action: 'RECORDING_DELETE',
      targetType: 'Recording',
      targetId: req.params.id as string,
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
