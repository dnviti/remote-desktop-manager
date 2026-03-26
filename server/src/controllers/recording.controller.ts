import { Response } from 'express';
import { open } from 'fs/promises';
import fs from 'fs';
import { AuthRequest, assertAuthenticated } from '../types';
import * as recordingService from '../services/recording.service';
import * as auditService from '../services/audit.service';
import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { hasAnyRole } from '../middleware/tenant.middleware';
import { validatedQuery } from '../middleware/validate.middleware';
import { logger } from '../utils/logger';
import { getClientIp } from '../utils/ip';
import type { ListRecordingsQueryInput } from '../schemas/recording.schemas';

export async function listRecordings(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const query = validatedQuery<ListRecordingsQueryInput>(req);
  const result = await recordingService.listRecordings({
    userId: req.user.userId,
    tenantId: req.user.tenantId,
    ...query,
  });
  res.json(result);
}

export async function getRecording(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const recording = await recordingService.getRecording(req.params.id as string, req.user.userId);
  if (!recording) throw new AppError('Recording not found', 404);

  auditService.log({
    userId: req.user.userId,
    action: 'RECORDING_VIEW',
    targetType: 'Recording',
    targetId: recording.id,
    details: { recordingId: recording.id, protocol: recording.protocol, connectionId: recording.connectionId },
    ipAddress: getClientIp(req),
  });

  res.json(recording);
}

export async function streamRecording(req: AuthRequest, res: Response) {
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
}

/**
 * Parse a .guac recording file and return instruction statistics.
 * Useful for diagnosing black-screen recording issues.
 */
export async function analyzeRecording(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const recording = await recordingService.getRecording(req.params.id as string, req.user.userId);
  if (!recording) throw new AppError('Recording not found', 404);
  if (recording.format !== 'guac') throw new AppError('Only .guac recordings can be analyzed', 400);

  // Read only the first maxBytes from the file to avoid OOM on large recordings
  const maxBytes = 10 * 1024 * 1024;
  let content: string;
  let bytesRead = 0;
  let fh;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fh = await open(recording.filePath, 'r');
    const buf = Buffer.alloc(maxBytes);
    ({ bytesRead } = await fh.read(buf, 0, maxBytes, 0));
    content = buf.subarray(0, bytesRead).toString('ascii');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('Recording file not found on disk', 404);
    }
    throw err;
  } finally {
    await fh?.close();
  }

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
    fileSize: bytesRead,
    truncated: bytesRead >= maxBytes,
    instructions,
    syncCount: instructions['sync'] || 0,
    displayWidth,
    displayHeight,
    hasLayer0Image,
  });
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

export async function exportVideo(req: AuthRequest, res: Response) {
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
    details: { recordingId: req.params.id as string },
    ipAddress: getClientIp(req),
  });
}

export async function getAuditTrail(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const recordingId = req.params.id as string;

  // Find recording without userId filter — then check ownership or tenant role
  const recording = await prisma.sessionRecording.findUnique({
    where: { id: recordingId },
    select: { id: true, sessionId: true, userId: true },
  });
  if (!recording) throw new AppError('Recording not found', 404);

  const isOwner = recording.userId === req.user.userId;
  const isAuditor = Boolean(req.user.tenantId) && hasAnyRole(req.user.tenantRole, 'ADMIN', 'OWNER', 'AUDITOR');

  if (!isOwner && !isAuditor) {
    throw new AppError('Recording not found', 404);
  }

  if (!recording.sessionId) {
    res.json({ data: [], hasMore: false });
    return;
  }

  const LIMIT = 200;
  const logs = await prisma.auditLog.findMany({
    where: {
      // Scope to user's own logs unless they're an auditor
      ...(!isAuditor ? { userId: req.user.userId } : {}),
      OR: [
        { details: { path: ['sessionId'], equals: recording.sessionId } },
        { details: { path: ['recordingId'], equals: recordingId } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: LIMIT + 1,
  });

  const hasMore = logs.length > LIMIT;
  if (hasMore) logs.pop();

  res.json({ data: logs, hasMore });
}

export async function deleteRecording(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const deleted = await recordingService.deleteRecording(req.params.id as string, req.user.userId);
  if (!deleted) throw new AppError('Recording not found', 404);

  auditService.log({
    userId: req.user.userId,
    action: 'RECORDING_DELETE',
    targetType: 'Recording',
    targetId: req.params.id as string,
    details: { recordingId: req.params.id as string },
    ipAddress: getClientIp(req),
  });

  res.json({ ok: true });
}
