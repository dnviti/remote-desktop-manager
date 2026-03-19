import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Autocomplete, TextField, Box, Chip, Typography,
  CircularProgress,
} from '@mui/material';
import { VpnKey, Key, Lock as LockIcon } from '@mui/icons-material';
import { listSecrets, type SecretListItem, type SecretType } from '../../api/secrets.api';
import { useVaultStore } from '../../store/vaultStore';

const TYPE_ICONS: Partial<Record<SecretType, React.ReactNode>> = {
  LOGIN: <VpnKey fontSize="small" />,
  SSH_KEY: <Key fontSize="small" />,
};

const TYPE_LABELS: Partial<Record<SecretType, string>> = {
  LOGIN: 'Login',
  SSH_KEY: 'SSH Key',
};

const SCOPE_LABELS: Record<string, string> = {
  PERSONAL: 'Me',
  TEAM: 'Team',
  TENANT: 'Org',
};

const SCOPE_COLORS: Record<string, 'default' | 'primary' | 'secondary'> = {
  PERSONAL: 'default',
  TEAM: 'primary',
  TENANT: 'secondary',
};

interface SecretPickerProps {
  value: string | null;
  onChange: (secretId: string | null, secret: SecretListItem | null) => void;
  connectionType: 'SSH' | 'RDP' | 'VNC' | 'DATABASE';
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  /** Pre-populated name/type from connection data so the picker shows
   *  the secret immediately without waiting for an API fetch. */
  initialName?: string | null;
  initialType?: SecretType | null;
}

export default function SecretPicker({
  value,
  onChange,
  connectionType,
  disabled,
  error,
  helperText,
  initialName,
  initialType,
}: SecretPickerProps) {
  const vaultUnlocked = useVaultStore((s) => s.unlocked);
  const [options, setOptions] = useState<SecretListItem[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SecretListItem | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compatibleTypes: SecretType[] =
    connectionType === 'SSH' ? ['LOGIN', 'SSH_KEY'] : ['LOGIN'];

  // Synchronously set stub from initialName, then upgrade with full API data
  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }

    // Synchronously show stub from initialName (no async wait needed)
    if (initialName && selected?.id !== value) {
      const stub: SecretListItem = {
        id: value,
        name: initialName,
        description: null,
        type: initialType ?? 'LOGIN',
        scope: 'PERSONAL',
        teamId: null,
        tenantId: null,
        folderId: null,
        metadata: null,
        tags: [],
        isFavorite: false,
        expiresAt: null,
        currentVersion: 1,
        createdAt: '',
        updatedAt: '',
      };
      setSelected(stub);
      setOptions((prev) =>
        prev.some((o) => o.id === value) ? prev : [stub, ...prev],
      );
    }

    // Upgrade stub with full metadata from API (async)
    if (!vaultUnlocked) return;

    let cancelled = false;
    (async () => {
      try {
        const results = await listSecrets({});
        if (cancelled) return;
        const match = results.find((s) => s.id === value);
        if (match) {
          setSelected(match);
          setOptions((prev) =>
            prev.some((o) => o.id === match.id) ? prev : [match, ...prev],
          );
        }
      } catch {
        // silent — secret may not be accessible
      }
    })();
    return () => { cancelled = true; };
  }, [value, vaultUnlocked, initialName, initialType]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchOptions = useCallback(
    async (search: string) => {
      if (!vaultUnlocked) return;
      setLoading(true);
      try {
        // Fetch for each compatible type and merge
        const promises = compatibleTypes.map((t) =>
          listSecrets({ search: search || undefined, type: t }),
        );
        const results = (await Promise.all(promises)).flat();
        // Deduplicate by id
        const seen = new Set<string>();
        const unique = results.filter((s) => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        setOptions(unique);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    },
    [vaultUnlocked, connectionType], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Debounced search
  useEffect(() => {
    if (!vaultUnlocked) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchOptions(inputValue);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, fetchOptions, vaultUnlocked]);

  // Re-fetch when connection type changes (compatible types change)
  useEffect(() => {
    if (vaultUnlocked) fetchOptions(inputValue);
  }, [connectionType]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDisabled = disabled || !vaultUnlocked;

  return (
    <Autocomplete
      value={selected}
      onChange={(_e, newValue) => {
        setSelected(newValue);
        onChange(newValue?.id ?? null, newValue);
      }}
      inputValue={inputValue}
      onInputChange={(_e, newInput, reason) => {
        if (reason !== 'reset') setInputValue(newInput);
      }}
      options={options}
      loading={loading}
      disabled={isDisabled}
      getOptionLabel={(opt) => opt.name}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      filterOptions={(x) => x} // server-side filtering
      noOptionsText={loading ? 'Searching...' : 'No secrets found'}
      renderOption={(props, option) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {TYPE_ICONS[option.type]}
            <Typography variant="body2" sx={{ flex: 1 }}>
              {option.name}
            </Typography>
            <Chip
              label={SCOPE_LABELS[option.scope] ?? option.scope}
              color={SCOPE_COLORS[option.scope] ?? 'default'}
              size="small"
              variant="outlined"
            />
            <Typography variant="caption" color="text.secondary">
              {TYPE_LABELS[option.type] ?? option.type}
            </Typography>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Select Secret"
          placeholder={vaultUnlocked ? 'Search keychain...' : undefined}
          error={error}
          helperText={
            !vaultUnlocked
              ? 'Unlock vault to use keychain'
              : helperText
          }
          slotProps={{
            input: {
              ...params.InputProps,
              startAdornment: !vaultUnlocked ? (
                <LockIcon fontSize="small" color="disabled" sx={{ mr: 0.5 }} />
              ) : (
                params.InputProps.startAdornment
              ),
              endAdornment: (
                <>
                  {loading && <CircularProgress color="inherit" size={18} />}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              key={key}
              {...tagProps}
              icon={TYPE_ICONS[option.type] as React.ReactElement}
              label={option.name}
              size="small"
            />
          );
        })
      }
    />
  );
}
