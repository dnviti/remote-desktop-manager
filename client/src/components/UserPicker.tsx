import { useState, useRef, useEffect } from 'react';
import {
  Autocomplete, TextField, Avatar, Box, Typography, CircularProgress,
} from '@mui/material';
import { searchUsers, UserSearchResult } from '../api/user.api';

interface UserPickerProps {
  onSelect: (user: UserSearchResult | null) => void;
  scope: 'tenant' | 'team';
  teamId?: string;
  placeholder?: string;
  excludeUserIds?: string[];
  size?: 'small' | 'medium';
}

export default function UserPicker({
  onSelect,
  scope,
  teamId,
  placeholder = 'Search users...',
  excludeUserIds = [],
  size = 'small',
}: UserPickerProps) {
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!inputValue || inputValue.length < 1) {
      setOptions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const currentRequestId = ++requestIdRef.current;

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchUsers(inputValue, scope, teamId);
        if (currentRequestId !== requestIdRef.current) return;
        const filtered = excludeUserIds.length > 0
          ? results.filter((u) => !excludeUserIds.includes(u.id))
          : results;
        setOptions(filtered);
      } catch {
        if (currentRequestId !== requestIdRef.current) return;
        setOptions([]);
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, scope, teamId, excludeUserIds]);

  return (
    <Autocomplete<UserSearchResult>
      size={size}
      fullWidth
      options={options}
      loading={loading}
      filterOptions={(x) => x}
      getOptionLabel={(option) => option.username || option.email}
      isOptionEqualToValue={(option, value) => option.id === value.id}
      noOptionsText={inputValue ? 'No users found' : 'Type to search...'}
      onInputChange={(_e, value) => setInputValue(value)}
      onChange={(_e, value) => onSelect(value)}
      renderOption={(props, option) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Avatar
              src={option.avatarData || undefined}
              sx={{ width: 32, height: 32, fontSize: 14 }}
            >
              {(option.username || option.email)[0].toUpperCase()}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              {option.username && (
                <Typography variant="body2" noWrap>
                  {option.username}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" noWrap>
                {option.email}
              </Typography>
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder}
          slotProps={{
            input: {
              ...params.InputProps,
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
    />
  );
}
