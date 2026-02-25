import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error.middleware';

const prisma = new PrismaClient();

export async function createFolder(
  userId: string,
  name: string,
  parentId?: string
) {
  if (parentId) {
    const parent = await prisma.folder.findFirst({
      where: { id: parentId, userId },
    });
    if (!parent) throw new AppError('Parent folder not found', 404);
  }

  return prisma.folder.create({
    data: { name, parentId: parentId || null, userId },
  });
}

export async function updateFolder(
  userId: string,
  folderId: string,
  data: { name?: string; parentId?: string | null }
) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
  });
  if (!folder) throw new AppError('Folder not found', 404);

  // Prevent circular references
  if (data.parentId) {
    if (data.parentId === folderId) {
      throw new AppError('A folder cannot be its own parent', 400);
    }
    const parent = await prisma.folder.findFirst({
      where: { id: data.parentId, userId },
    });
    if (!parent) throw new AppError('Parent folder not found', 404);
  }

  return prisma.folder.update({
    where: { id: folderId },
    data: {
      name: data.name ?? folder.name,
      parentId: data.parentId !== undefined ? data.parentId : folder.parentId,
    },
  });
}

export async function deleteFolder(userId: string, folderId: string) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
  });
  if (!folder) throw new AppError('Folder not found', 404);

  // Move connections to root
  await prisma.connection.updateMany({
    where: { folderId, userId },
    data: { folderId: null },
  });

  // Move child folders to parent
  await prisma.folder.updateMany({
    where: { parentId: folderId, userId },
    data: { parentId: folder.parentId },
  });

  await prisma.folder.delete({ where: { id: folderId } });
  return { deleted: true };
}

export async function getFolderTree(userId: string) {
  const folders = await prisma.folder.findMany({
    where: { userId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return folders;
}
