import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Agent } from 'undici';
import prisma from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import type { SessionProtocol, RecordingStatus } from '../lib/prisma';
import { createNotificationAsync } from './notification.service';
import { emitNotification } from '../socket/notification.handler';
import * as auditService from './audit.service';

// ── Guacenc sidecar fetch helpers ────────────────────────────────────

/** Build common headers for guacenc sidecar requests (auth token when configured). */
function guacencHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (config.guacencAuthToken) {
    headers['Authorization'] = `Bearer ${config.guacencAuthToken}`;
  }
  return headers;
}

/** Build extra fetch options for guacenc TLS (custom CA when configured). */
function guacencFetchOptions(): Record<string, unknown> {
  if (config.guacencUseTls && config.guacencTlsCa) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const ca = fs.readFileSync(config.guacencTlsCa);
      return { dispatcher: new Agent({ connect: { ca } }) };
    } catch (err) {
      logger.warn(`Failed to load guacenc TLS CA from ${config.guacencTlsCa}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
  return {};
}

/** Resolve the effective URL for a guacenc sidecar endpoint, upgrading to https:// when configured. */
function resolveGuacencUrl(baseUrl: string): string {
  if (config.guacencUseTls) {
    return baseUrl.replace(/^http:\/\//, 'https://');
  }
  return baseUrl;
}

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

  auditService.log({
    userId: params.userId,
    action: 'RECORDING_START',
    targetType: 'Recording',
    targetId: recording.id,
    details: {
      recordingId: recording.id,
      protocol: params.protocol,
      connectionId: params.connectionId,
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    },
  });

  return recording.id;
}

export async function completeRecording(
  recordingId: string,
  fileSize: number,
  duration: number,
): Promise<void> {
  const recording = await prisma.sessionRecording.update({
    where: { id: recordingId },
    data: {
      status: 'COMPLETE',
      fileSize,
      duration,
      completedAt: new Date(),
    },
    select: {
      id: true,
      userId: true,
      protocol: true,
      connection: { select: { name: true } },
    },
  });
  logger.info(`[recording] Completed recording ${recordingId} (${fileSize} bytes, ${duration}s)`);

  const label = recording.connection?.name ?? recording.protocol;
  const msg = `Your ${label} session recording is ready`;

  createNotificationAsync({
    userId: recording.userId,
    type: 'RECORDING_READY',
    message: msg,
    relatedId: recordingId,
  });

  emitNotification(recording.userId, {
    id: recording.id,
    type: 'RECORDING_READY',
    message: msg,
    read: false,
    relatedId: recordingId,
    createdAt: new Date(),
  });
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
      take: params.limit ?? DEFAULT_RECORDINGS_LIMIT,
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

  // Also delete the converted video sidecar if it exists (.m4v for guac, .mp4 for asciicast)
  if (recording.format === 'guac') {
    const m4vPath = recording.filePath + '.m4v';
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    try { await fsp.unlink(m4vPath); } catch { /* may not exist */ }
  } else if (recording.format === 'asciicast') {
    const mp4Path = recording.filePath + '.mp4';
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    try { await fsp.unlink(mp4Path); } catch { /* may not exist */ }
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

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_VIDEO_WIDTH = 1024;
const DEFAULT_VIDEO_HEIGHT = 768;
const DEFAULT_RECORDINGS_LIMIT = 50;
const GUACENC_SUBMIT_TIMEOUT_MS = 10_000;
const GUACENC_STATUS_TIMEOUT_MS = 5_000;

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
  if (recording.format !== 'guac' && recording.format !== 'asciicast') {
    throw new AppError('Video export is only available for RDP/VNC/SSH recordings', 400);
  }

  const isAsciicast = recording.format === 'asciicast';
  const videoExt = isAsciicast ? '.mp4' : '.m4v';
  const videoPath = recording.filePath + videoExt;

  // Return cached file if it already exists
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const stat = await fsp.stat(videoPath);
    return { videoPath, fileSize: stat.size };
  } catch { /* not cached — proceed with conversion */ }

  // Deduplicate concurrent conversion requests for the same recording
  const existing = activeConversions.get(recordingId);
  if (existing) return existing;

  const conversionPromise = (async () => {
    const deadline = Date.now() + config.guacencTimeoutMs;

    // Select endpoint and service URL based on recording format
    const serviceUrl = resolveGuacencUrl(isAsciicast ? config.asciicastConverterUrl : config.guacencServiceUrl);
    const endpoint = isAsciicast ? '/convert-asciicast' : '/convert';
    const tlsOptions = guacencFetchOptions();

    // Step 1: Submit async conversion job
    let jobId: string;
    try {
      const body: Record<string, unknown> = {
        filePath: toContainerPath(recording.filePath),
      };

      // Only include width/height for guac recordings (asciicast auto-detects from terminal size)
      if (!isAsciicast) {
        body.width = recording.width || DEFAULT_VIDEO_WIDTH;
        body.height = recording.height || DEFAULT_VIDEO_HEIGHT;
      }

      const res = await fetch(`${serviceUrl}${endpoint}`, {
        method: 'POST',
        headers: guacencHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GUACENC_SUBMIT_TIMEOUT_MS),
        ...tlsOptions,
      });

      if (!res.ok) {
        const resBody = await res.json().catch(() => ({})) as Record<string, unknown>;
        const detail = (resBody.error as string) || `HTTP ${res.status}`;
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
        const res = await fetch(`${serviceUrl}/status/${jobId}`, {
          headers: guacencHeaders(),
          signal: AbortSignal.timeout(GUACENC_STATUS_TIMEOUT_MS),
          ...tlsOptions,
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

const SAFE_PATH_COMPONENT = /^(?!\.\.?$)[a-zA-Z0-9._-]+$/;

export function buildRecordingPath(
  userId: string,
  connectionId: string,
  protocol: string,
  ext: string,
  gatewayDir?: string,
): string {
  const subdir = gatewayDir || 'default';
  // Validate all user-influenced path components to prevent directory traversal
  for (const [label, value] of [['userId', userId], ['connectionId', connectionId], ['protocol', protocol], ['ext', ext], ['gatewayDir', subdir]] as const) {
    if (!SAFE_PATH_COMPONENT.test(value)) {
      throw new AppError(`Invalid recording path component (${label})`, 400);
    }
  }
  const timestamp = Date.now();
  const dir = path.join(config.recordingPath, subdir, userId);
  const result = path.join(dir, `${connectionId}-${protocol.toLowerCase()}-${timestamp}.${ext}`);
  // Belt-and-suspenders: ensure resolved path stays within recording root
  // Use path.relative() instead of startsWith() to prevent prefix-collision bypass
  // (e.g. /recordings vs /recordings_evil)
  const recordingRoot = path.resolve(config.recordingPath);
  const resolvedResult = path.resolve(result);
  const relative = path.relative(recordingRoot, resolvedResult);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('Recording path escapes allowed directory', 400);
  }
  return result;
}

export async function cleanupExpiredRecordings(): Promise<number> {
  if (config.recordingRetentionDays <= 0) return 0;

  // Build per-tenant retention map (tenants with custom retention override)
  const tenantsWithCustomRetention = await prisma.tenant.findMany({
    where: { recordingRetentionDays: { not: null } },
    select: { id: true, recordingRetentionDays: true },
  });
  const tenantRetentionMap = new Map<string, number>();
  for (const t of tenantsWithCustomRetention) {
    if (t.recordingRetentionDays !== null) {
      tenantRetentionMap.set(t.id, t.recordingRetentionDays);
    }
  }

  // Pre-filter in DB using the most conservative (smallest) retention across all tenants
  // and the global default, so we only load recordings that *might* be expired.
  const allRetentionValues = [...tenantRetentionMap.values(), config.recordingRetentionDays];
  const minRetention = Math.min(...allRetentionValues);
  const broadCutoff = new Date();
  broadCutoff.setDate(broadCutoff.getDate() - minRetention);

  const candidates = await prisma.sessionRecording.findMany({
    where: { status: 'COMPLETE', createdAt: { lt: broadCutoff } },
    select: {
      id: true,
      filePath: true,
      createdAt: true,
      user: {
        select: {
          tenantMemberships: {
            where: { isActive: true },
            select: { tenantId: true },
            orderBy: { joinedAt: 'asc' },
            take: 1,
          },
        },
      },
    },
  });

  // Refine: apply the exact per-tenant (or global) retention to each recording
  const expired = candidates.filter((rec) => {
    const tenantId = rec.user?.tenantMemberships?.[0]?.tenantId;
    const retentionDays = tenantId && tenantRetentionMap.has(tenantId)
      ? tenantRetentionMap.get(tenantId)!
      : config.recordingRetentionDays;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    return rec.createdAt < cutoff;
  });

  // Optional: Also ask the guacenc sidecar to clean up any orphaned .m4v files
  try {
    await fetch(`${resolveGuacencUrl(config.guacencServiceUrl)}/cleanup`, {
      method: 'POST',
      headers: guacencHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ maxAgeDays: config.recordingRetentionDays }),
      signal: AbortSignal.timeout(GUACENC_SUBMIT_TIMEOUT_MS),
      ...guacencFetchOptions(),
    });
  } catch (err) {
    // Ignore errors — sidecar might be down or not configured
    logger.warn(`Failed to run guacenc cleanup: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const rec of expired) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    try { await fsp.unlink(rec.filePath); } catch { /* file may already be gone */ }
    // Also delete converted video sidecars if they exist (.m4v for guac, .mp4 for asciicast)
    const m4vPath = rec.filePath + '.m4v';
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    try { await fsp.unlink(m4vPath); } catch { /* may not exist */ }
    const mp4Path = rec.filePath + '.mp4';
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    try { await fsp.unlink(mp4Path); } catch { /* may not exist */ }
  }

  if (expired.length > 0) {
    await prisma.sessionRecording.deleteMany({
      where: { id: { in: expired.map((r) => r.id) } },
    });
    logger.info(`[recording] Cleaned up ${expired.length} expired recordings`);
  }

  return expired.length;
}
