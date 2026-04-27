import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteManagedHistoryItem,
  downloadManagedHistoryItem,
  listManagedHistory,
  rdpManagedTransferScope,
  restoreManagedHistoryItem,
  sshManagedTransferScope,
} from './managedTransfer.api';
import {
  deleteRdpHistoryItem,
  deleteSshHistoryItem,
  downloadRdpHistoryItem,
  downloadSshHistoryItem,
  listRdpHistory,
  listSshHistory,
  restoreRdpHistoryItem,
  restoreSshHistoryItem,
} from './managedHistory.api';

vi.mock('./managedHistory.api', () => ({
  listRdpHistory: vi.fn(),
  downloadRdpHistoryItem: vi.fn(),
  restoreRdpHistoryItem: vi.fn(),
  deleteRdpHistoryItem: vi.fn(),
  listSshHistory: vi.fn(),
  downloadSshHistoryItem: vi.fn(),
  restoreSshHistoryItem: vi.fn(),
  deleteSshHistoryItem: vi.fn(),
}));

describe('managedTransfer.api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRdpHistory).mockResolvedValue([]);
    vi.mocked(listSshHistory).mockResolvedValue([]);
    vi.mocked(downloadRdpHistoryItem).mockResolvedValue(new Blob(['rdp']));
    vi.mocked(downloadSshHistoryItem).mockResolvedValue(new Blob(['ssh']));
    vi.mocked(restoreRdpHistoryItem).mockResolvedValue({ restored: true });
    vi.mocked(restoreSshHistoryItem).mockResolvedValue({ restored: true });
    vi.mocked(deleteRdpHistoryItem).mockResolvedValue({ deleted: true });
    vi.mocked(deleteSshHistoryItem).mockResolvedValue({ deleted: true });
  });

  it('routes RDP managed history through connection scoped endpoints', async () => {
    const scope = rdpManagedTransferScope('conn-rdp');

    await listManagedHistory(scope);
    await downloadManagedHistoryItem(scope, 'history-1');
    await restoreManagedHistoryItem(scope, 'history-1', 'restored.txt');
    await deleteManagedHistoryItem(scope, 'history-1');

    expect(listRdpHistory).toHaveBeenCalledWith('conn-rdp');
    expect(downloadRdpHistoryItem).toHaveBeenCalledWith('conn-rdp', 'history-1');
    expect(restoreRdpHistoryItem).toHaveBeenCalledWith('conn-rdp', 'history-1', 'restored.txt');
    expect(deleteRdpHistoryItem).toHaveBeenCalledWith('conn-rdp', 'history-1');
  });

  it('routes SSH managed history through credential scoped endpoints', async () => {
    const credentials = { connectionId: 'conn-ssh', username: 'alice', credentialMode: 'manual' as const };
    const scope = sshManagedTransferScope(credentials);

    await listManagedHistory(scope);
    await downloadManagedHistoryItem(scope, 'history-1');
    await restoreManagedHistoryItem(scope, 'history-1', 'docs/restored.txt');
    await deleteManagedHistoryItem(scope, 'history-1');

    expect(listSshHistory).toHaveBeenCalledWith(credentials);
    expect(downloadSshHistoryItem).toHaveBeenCalledWith({ ...credentials, id: 'history-1' });
    expect(restoreSshHistoryItem).toHaveBeenCalledWith({ ...credentials, id: 'history-1', path: 'docs/restored.txt' });
    expect(deleteSshHistoryItem).toHaveBeenCalledWith({ ...credentials, id: 'history-1' });
  });
});
