import { useVaultStore } from './vaultStore';

describe('useVaultStore', () => {
  beforeEach(() => {
    useVaultStore.setState({
      unlocked: false,
      initialized: false,
      mfaUnlockAvailable: false,
      mfaUnlockMethods: [],
    });
  });

  it('keeps snapshot-derived unlock metadata when applying an immediate lock signal', () => {
    useVaultStore.getState().applyStatus({
      unlocked: true,
      vaultNeedsRecovery: false,
      mfaUnlockAvailable: true,
      mfaUnlockMethods: ['webauthn'],
    });

    useVaultStore.getState().setUnlocked(false);

    expect(useVaultStore.getState()).toMatchObject({
      unlocked: false,
      initialized: true,
      mfaUnlockAvailable: true,
      mfaUnlockMethods: ['webauthn'],
    });
  });
});
