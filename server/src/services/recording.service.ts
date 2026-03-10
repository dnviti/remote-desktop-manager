import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import prisma from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import type { SessionProtocol, RecordingStatus } from '../lib/prisma';

// ── Video conversion concurrency lock ────────────────────────────────
const activeConversions = new Map<string, Promise<{ videoPath: string; fileSize: number }>>();

// ── Asciicast v2 writer (SSH recordings) ────────────────────────────

export class AsciicastWriter {
  private fd: number | null = null;
  private startTime: number = 0;
  private filePath: string;
  private bytesWritten = 0;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async open(cols: number, rows: number): Promise<void> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    this.fd = fs.openSync(this.filePath, 'w');
    this.startTime = Date.now();
    const header = JSON.stringify({
      version: 2,
      width: cols,
      height: rows,
      timestamp: Math.floor(this.startTime / 1000),
      env: { TERM: 'xterm-256color' },
    });
    fs.writeSync(this.fd, header + '\n');
    this.bytesWritten += Buffer.byteLength(header) + 1;
  }

  writeOutput(data: string): void {
    if (!this.fd) return;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const line = JSON.stringify([elapsed, 'o', data]);
    fs.writeSync(this.fd, line + '\n');
    this.bytesWritten += Buffer.byteLength(line) + 1;
  }

  writeInput(data: string): void {
    if (!this.fd) return;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const line = JSON.stringify([elapsed, 'i', data]);
    fs.writeSync(this.fd, line + '\n');
    this.bytesWritten += Buffer.byteLength(line) + 1;
  }

  close(): { fileSize: number; duration: number } {
    const duration = Math.round((Date.now() - this.startTime) / 1000);
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    return { fileSize: this.bytesWritten, duration };
  }
}

// ── CRUD operations ─────────────────────────────────────────────────

export async function startRecording(params: {
  userId: string;
  connectionId: string;
  sessionId?: string;
  protocol: SessionProtocol;
  format: string;
  filePath: string;
  width?: number;
  height?: number;
}): Promise<string> {
  const recording = await prisma.sessionRecording.create({
    data: {
      userId: params.userId,
      connectionId: params.connectionId,
      sessionId: params.sessionId,
      protocol: params.protocol,
      format: params.format,
      filePath: params.filePath,
      width: params.width,
      height: params.height,
      status: 'RECORDING',
    },
  });
  return recording.id;
}

export async function completeRecording(
  recordingId: string,
  fileSize: number,
  duration: number,
): Promise<void> {
  await prisma.sessionRecording.update({
    where: { id: recordingId },
    data: {
      status: 'COMPLETE',
      fileSize,
      duration,
      completedAt: new Date(),
    },
  });
  logger.info(`[recording] Completed recording ${recordingId} (${fileSize} bytes, ${duration}s)`);
}

export async function failRecording(recordingId: string): Promise<void> {
  await prisma.sessionRecording.update({
    where: { id: recordingId },
    data: { status: 'ERROR', completedAt: new Date() },
  });
  logger.info(`[recording] Recording ${recordingId} failed`);
}

/**
 * Finalize a guacd-written recording (RDP/VNC) when the guacamole connection closes.
 * guacd writes the .guac file to disk; we read its size and compute duration from DB timestamps.
 */
export async function completeGuacRecording(recordingId: string): Promise<void> {
  const recording = await prisma.sessionRecording.findUnique({
    where: { id: recordingId },
  });
  if (!recording || recording.status !== 'RECORDING') return;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const stat = await fsp.stat(recording.filePath);
    const duration = Math.round((Date.now() - recording.createdAt.getTime()) / 1000);
    await completeRecording(recordingId, stat.size, duration);
  } catch {
    // File doesn't exist — guacd may not have written it (connection too short, error, etc.)
    logger.warn(`[recording] Recording file not found for ${recordingId}: ${recording.filePath}`);
    await failRecording(recordingId);
  }
}

export async function getRecording(recordingId: string, userId: string) {
  return prisma.sessionRecording.findFirst({
    where: { id: recordingId, userId },
    include: {
      connection: { select: { id: true, name: true, type: true, host: true, port: true } },
    },
  });
}

export async function listRecordings(params: {
  userId: string;
  tenantId?: string;
  connectionId?: string;
  protocol?: SessionProtocol;
  status?: RecordingStatus;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};

  // If tenantId is set, show recordings for all tenant members (admin view)
  if (params.tenantId) {
    where.user = {
      tenantMemberships: { some: { tenantId: params.tenantId, isActive: true } },
    };
  } else {
    where.userId = params.userId;
  }

  if (params.connectionId) where.connectionId = params.connectionId;
  if (params.protocol) where.protocol = params.protocol;
  if (params.status) where.status = params.status;

  const [recordings, total] = await Promise.all([
    prisma.sessionRecording.findMany({
      where,
      include: {
        connection: { select: { id: true, name: true, type: true, host: true } },
        user: { select: { id: true, email: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    }),
    prisma.sessionRecording.count({ where }),
  ]);

  return { recordings, total };
}

export async function deleteRecording(recordingId: string, userId: string): Promise<boolean> {
  const recording = await prisma.sessionRecording.findFirst({
    where: { id: recordingId, userId },
  });
  if (!recording) return false;

  // Delete file from disk
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fsp.unlink(recording.filePath);
  } catch {
    logger.warn(`Recording file not found on disk: ${recording.filePath}`);
  }

  // Also delete the converted .m4v file if it exists
  if (recording.format === 'guac') {
    const m4vPath = recording.filePath + '.m4v';
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    try { await fsp.unlink(m4vPath); } catch { /* may not exist */ }
  }

  await prisma.sessionRecording.delete({ where: { id: recordingId } });
  return true;
}

export function streamRecordingFile(filePath: string): Readable | null {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(filePath)) return null;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return fs.createReadStream(filePath);
  } catch {
    return null;
  }
}

// ── Video conversion ─────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2000;

/** Translate a host-local recording path to the guacenc container mount path. */
function toContainerPath(hostPath: string): string {
  if (hostPath.startsWith(config.recordingPath)) {
    return config.guacencRecordingPath + hostPath.slice(config.recordingPath.length);
  }
  return hostPath;
}

/** Translate a guacenc container path back to the host-local path. */
function toHostPath(containerPath: string): string {
  if (containerPath.startsWith(config.guacencRecordingPath)) {
    return config.recordingPath + containerPath.slice(config.guacencRecordingPath.length);
  }
  return containerPath;
}

function mapFetchError(err: unknown): AppError {
  const error = err as NodeJS.ErrnoException & { name?: string; cause?: NodeJS.ErrnoException };
  if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
    return new AppError('Video conversion service unavailable', 503);
  }
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return new AppError('Video conversion timed out', 504);
  }
  return new AppError('Video conversion failed', 500);
}

export async function convertToVideo(
  recordingId: string,
  userId: string,
): Promise<{ videoPath: string; fileSize: number }> {
  const recording = await getRecording(recordingId, userId);
  if (!recording) throw new AppError('Recording not found', 404);
  if (recording.status !== 'COMPLETE') throw new AppError('Recording is not complete', 400);
  if (recording.format !== 'guac') throw new AppError('Video export is only available for RDP/VNC recordings', 400);

  const m4vPath = recording.filePath + '.m4v';

  // Return cached file if it already exists
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const stat = await fsp.stat(m4vPath);
    return { videoPath: m4vPath, fileSize: stat.size };
  } catch { /* not cached — proceed with conversion */ }

  // Deduplicate concurrent conversion requests for the same recording
  const existing = activeConversions.get(recordingId);
  if (existing) return existing;

  const conversionPromise = (async () => {
    const width = recording.width || 1024;
    const height = recording.height || 768;
    const deadline = Date.now() + config.guacencTimeoutMs;

    // Step 1: Submit async conversion job
    let jobId: string;
    try {
      const res = await fetch(`${config.guacencServiceUrl}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: toContainerPath(recording.filePath), width, height }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const detail = (body.error as string) || `HTTP ${res.status}`;
        throw new AppError(`Video conversion failed: ${detail}`, res.status === 503 ? 503 : 500);
      }

      const result = await res.json() as { jobId: string; status: string };
      jobId = result.jobId;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw mapFetchError(err);
    }

    // Step 2: Poll until complete, error, or timeout
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      if (Date.now() >= deadline) break;

      try {
        const res = await fetch(`${config.guacencServiceUrl}/status/${jobId}`, {
          signal: AbortSignal.timeout(5_000),
        });

        if (!res.ok) {
          throw new AppError('Failed to check conversion status', 500);
        }

        const job = await res.json() as {
          jobId: string;
          status: string;
          outputPath?: string;
          fileSize?: number;
          error?: string;
        };

        if (job.status === 'complete') {
          return { videoPath: toHostPath(job.outputPath as string), fileSize: job.fileSize as number };
        }
        if (job.status === 'error') {
          throw new AppError(`Video conversion failed: ${job.error || 'unknown'}`, 500);
        }
        // pending or converting — continue polling
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw mapFetchError(err);
      }
    }

    throw new AppError('Video conversion timed out', 504);
  })();

  activeConversions.set(recordingId, conversionPromise);
  try {
    return await conversionPromise;
  } finally {
    activeConversions.delete(recordingId);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

export function buildRecordingPath(
  userId: string,
  connectionId: string,
  protocol: string,
  ext: string,
  gatewayDir?: string,
): string {
  const timestamp = Date.now();
  const subdir = gatewayDir || 'default';
  const dir = path.join(config.recordingPath, subdir, userId);
  return path.join(dir, `${connectionId}-${protocol.toLowerCase()}-${timestamp}.${ext}`);
}

export async function cleanupExpiredRecordings(): Promise<number> {
  if (config.recordingRetentionDays <= 0) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.recordingRetentionDays);

  const expired = await prisma.sessionRecording.findMany({
    where: { createdAt: { lt: cutoff }, status: 'COMPLETE' },
    select: { id: true, filePath: true },
  });

  // Optional: Also ask the guacenc sidecar to clean up any orphaned .m4v files
  try {
    await fetch(`${config.guacencServiceUrl}/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxAgeDays: config.recordingRetentionDays }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Ignore errors — sidecar might be down or not configured
    logger.warn(`Failed to run guacenc cleanup: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const rec of expired) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    try { await fsp.unlink(rec.filePath); } catch { /* file may already be gone */ }
    // Also delete the converted .m4v file if it exists
    const m4vPath = rec.filePath + '.m4v';
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    try { await fsp.unlink(m4vPath); } catch { /* may not exist */ }
  }

  if (expired.length > 0) {
    await prisma.sessionRecording.deleteMany({
      where: { id: { in: expired.map((r) => r.id) } },
    });
    logger.info(`[recording] Cleaned up ${expired.length} expired recordings`);
  }

  return expired.length;
}
