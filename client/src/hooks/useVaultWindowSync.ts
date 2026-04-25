import { useEffect } from 'react';
import { subscribeToVaultWindowSync } from '../utils/vaultWindowSync';
import { useVaultStore } from '../store/vaultStore';

export function useVaultWindowSync() {
  const setVaultUnlocked = useVaultStore((state) => state.setUnlocked);

  useEffect(() => subscribeToVaultWindowSync((signal) => {
    setVaultUnlocked(signal === 'unlock');
  }), [setVaultUnlocked]);
}
