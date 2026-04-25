import { render } from '@testing-library/react';
import { fireEvent, waitFor } from '@testing-library/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVaultStore } from '@/store/vaultStore';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { lockVault } from '@/api/vault.api';
import { broadcastVaultWindowSync } from '@/utils/vaultWindowSync';

vi.mock('@/api/vault.api', () => ({
  lockVault: vi.fn(),
}));

vi.mock('@/utils/vaultWindowSync', () => ({
  broadcastVaultWindowSync: vi.fn(),
}));

function Probe() {
  useGlobalShortcuts();
  return null;
}

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lockVault).mockResolvedValue({ unlocked: false });
    useVaultStore.setState({
      unlocked: true,
      initialized: true,
      mfaUnlockAvailable: false,
      mfaUnlockMethods: [],
    });
  });

  it('locks the vault immediately on Cmd/Ctrl+L and broadcasts the lock signal', async () => {
    render(<Probe />);

    fireEvent.keyDown(document, { key: 'l', ctrlKey: true });

    await waitFor(() => {
      expect(lockVault).toHaveBeenCalledTimes(1);
    });
    expect(useVaultStore.getState()).toMatchObject({ unlocked: false, initialized: true });
    expect(broadcastVaultWindowSync).toHaveBeenCalledWith('lock');
  });
});
