import fs from 'fs/promises';
import path from 'path';
import { config } from '../config';
import { AppError } from '../middleware/error.middleware';

export interface FileInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

function getUserDrivePath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9-]/g, '');
  return path.join(config.driveBasePath, safe);
}

export async function ensureUserDrive(userId: string): Promise<string> {
  const dirPath = getUserDrivePath(userId);
  await fs.mkdir(dirPath, { recursive: true }); // eslint-disable-line security/detect-non-literal-fs-filename -- userId is sanitized in getUserDrivePath
  return dirPath;
}

export async function listFiles(userId: string): Promise<FileInfo[]> {
  const dirPath = getUserDrivePath(userId);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }); // eslint-disable-line security/detect-non-literal-fs-filename -- sanitized path
    const files: FileInfo[] = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        const stat = await fs.stat(path.join(dirPath, entry.name)); // eslint-disable-line security/detect-non-literal-fs-filename -- sanitized path
        files.push({
          name: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function getFilePath(userId: string, fileName: string): Promise<string> {
  const sanitized = path.basename(fileName);
  if (!sanitized || sanitized !== fileName) {
    throw new AppError('Invalid file name', 400);
  }
  const filePath = path.join(getUserDrivePath(userId), sanitized);
  try {
    await fs.access(filePath);
  } catch {
    throw new AppError('File not found', 404);
  }
  return filePath;
}

export async function deleteFile(userId: string, fileName: string): Promise<void> {
  const filePath = await getFilePath(userId, fileName);
  await fs.unlink(filePath); // eslint-disable-line security/detect-non-literal-fs-filename -- path validated by getFilePath
}

export async function checkQuota(userId: string, additionalBytes: number): Promise<void> {
  const files = await listFiles(userId);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize + additionalBytes > config.userDriveQuota) {
    throw new AppError(
      `Drive quota exceeded. Current usage: ${Math.round(totalSize / 1024 / 1024)}MB, limit: ${Math.round(config.userDriveQuota / 1024 / 1024)}MB`,
      413
    );
  }
}
