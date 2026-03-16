import { useEffect, useState } from 'react';
import { Box, Chip, Link, Tooltip } from '@mui/material';
import { NewReleases as NewReleasesIcon } from '@mui/icons-material';
import { checkVersion, type VersionInfo } from '../../api/version.api';
import { useAuthStore } from '../../store/authStore';
import { isAdminOrAbove } from '../../utils/roles';

export default function VersionIndicator() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const tenantRole = useAuthStore((s) => s.user?.tenantRole);

  useEffect(() => {
    let cancelled = false;
    checkVersion()
      .then((v) => { if (!cancelled) setInfo(v); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  if (!info) return null;

  const showUpdate = info.updateAvailable && isAdminOrAbove(tenantRole);

  return (
    <Box
      sx={{
        px: 1.5,
        py: 0.75,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        borderTop: 1,
        borderColor: 'rgba(35,35,40,0.6)',
      }}
    >
      <Chip
        label={`v${info.current}`}
        size="small"
        variant="outlined"
        sx={{
          height: 20,
          fontSize: '0.7rem',
          color: '#52525b',
          borderColor: 'rgba(0,229,160,0.15)',
          backgroundColor: 'rgba(0,229,160,0.03)',
          '& .MuiChip-label': { px: 0.75 },
        }}
      />
      {showUpdate && info.latest && info.latestUrl && (
        <Tooltip title={`Update available: v${info.latest}`} arrow>
          <Link
            href={info.latestUrl}
            target="_blank"
            rel="noopener noreferrer"
            underline="none"
            sx={{ display: 'flex', alignItems: 'center' }}
          >
            <Chip
              icon={<NewReleasesIcon sx={{ fontSize: '0.85rem !important' }} />}
              label={`v${info.latest}`}
              size="small"
              variant="outlined"
              clickable
              sx={{
                height: 20,
                fontSize: '0.7rem',
                color: '#00e5a0',
                borderColor: 'rgba(0,229,160,0.4)',
                backgroundColor: 'rgba(0,229,160,0.06)',
                '& .MuiChip-label': { px: 0.75 },
                '& .MuiChip-icon': { color: '#00e5a0' },
              }}
            />
          </Link>
        </Tooltip>
      )}
    </Box>
  );
}
