import { useState, useEffect } from 'react';
import {
  Button, Menu, MenuItem, ListItemIcon, ListItemText, Chip, Divider, Typography,
} from '@mui/material';
import { SwapHoriz, Business, Add } from '@mui/icons-material';
import { useTenantStore } from '../../store/tenantStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';

interface TenantSwitcherProps {
  onCreateOrg?: () => void;
}

export default function TenantSwitcher({ onCreateOrg }: TenantSwitcherProps) {
  const memberships = useTenantStore((s) => s.memberships);
  const fetchMemberships = useTenantStore((s) => s.fetchMemberships);
  const switchTenant = useTenantStore((s) => s.switchTenant);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetchMemberships();
  }, [fetchMemberships]);

  if (memberships.length <= 1) return null;

  const active = memberships.find((m) => m.isActive);

  const handleSwitch = async (tenantId: string) => {
    setAnchorEl(null);
    if (tenantId === active?.tenantId) return;
    setSwitching(true);
    try {
      await switchTenant(tenantId);
      useUiPreferencesStore.getState().set('lastActiveTenantId', tenantId);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <>
      <Button
        size="small"
        startIcon={<SwapHoriz />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        disabled={switching}
        sx={{ textTransform: 'none', color: 'inherit', mr: 1 }}
      >
        {active?.name ?? 'Select org'}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        <Typography variant="caption" sx={{ px: 2, py: 0.5, display: 'block', color: 'text.secondary' }}>
          Switch organization
        </Typography>
        <Divider sx={{ my: 0.5 }} />
        {memberships.map((m) => (
          <MenuItem
            key={m.tenantId}
            selected={m.isActive}
            onClick={() => handleSwitch(m.tenantId)}
          >
            <ListItemIcon><Business fontSize="small" /></ListItemIcon>
            <ListItemText primary={m.name} secondary={m.role} />
            {m.isActive && <Chip label="Active" size="small" color="primary" sx={{ ml: 1 }} />}
          </MenuItem>
        ))}
        {onCreateOrg && (
          <>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem onClick={() => { setAnchorEl(null); onCreateOrg(); }}>
              <ListItemIcon><Add fontSize="small" /></ListItemIcon>
              <ListItemText primary="Create organization" />
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  );
}
