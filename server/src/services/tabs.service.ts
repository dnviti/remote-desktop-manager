import prisma from '../lib/prisma';
import * as permissionService from './permission.service';

const MAX_TABS = 50;

export interface PersistedTab {
  connectionId: string;
  sortOrder: number;
  isActive: boolean;
}

export async function getUserTabs(userId: string): Promise<PersistedTab[]> {
  const rows = await prisma.openTab.findMany({
    where: { userId },
    select: { connectionId: true, sortOrder: true, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return rows;
}

export async function syncTabs(
  userId: string,
  tabs: PersistedTab[],
  tenantId?: string | null,
): Promise<PersistedTab[]> {
  const capped = tabs.slice(0, MAX_TABS);

  // Validate access: silently drop connections the user cannot view
  const validated: PersistedTab[] = [];
  for (const tab of capped) {
    const access = await permissionService.canViewConnection(userId, tab.connectionId, tenantId);
    if (access.allowed) {
      validated.push(tab);
    }
  }

  // Atomic replace: delete all existing tabs then create new ones
  await prisma.$transaction([
    prisma.openTab.deleteMany({ where: { userId } }),
    ...validated.map((tab, index) =>
      prisma.openTab.create({
        data: {
          userId,
          connectionId: tab.connectionId,
          sortOrder: index,
          isActive: tab.isActive,
        },
      }),
    ),
  ]);

  return validated;
}

export async function clearUserTabs(userId: string): Promise<void> {
  await prisma.openTab.deleteMany({ where: { userId } });
}
