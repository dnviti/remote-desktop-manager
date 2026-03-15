import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, Box, IconButton, Tabs, Tab,
  Stack, useMediaQuery,
} from '@mui/material';
import {
  Close as CloseIcon,
  Person as PersonIcon,
  Terminal as TerminalIcon,
  Shield as ShieldIcon,
  Business as BusinessIcon,
  Groups as GroupsIcon,
  Router as RouterIcon,
  Sync as SyncIcon,
  AdminPanelSettings as AdminPanelSettingsIcon,
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { getProfile } from '../../api/user.api';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import ProfileSection from '../Settings/ProfileSection';
import ChangePasswordSection from '../Settings/ChangePasswordSection';
import ConnectionDefaultsSection from '../Settings/ConnectionDefaultsSection';
import TwoFactorSection from '../Settings/TwoFactorSection';
import SmsMfaSection from '../Settings/SmsMfaSection';
import WebAuthnSection from '../Settings/WebAuthnSection';
import LinkedAccountsSection from '../Settings/LinkedAccountsSection';
import VaultAutoLockSection from '../Settings/VaultAutoLockSection';
import DomainProfileSection from '../Settings/DomainProfileSection';
import TenantSection from '../Settings/TenantSection';
import TeamSection from '../Settings/TeamSection';
import GatewaySection from '../Settings/GatewaySection';
import EmailProviderSection from '../Settings/EmailProviderSection';
import SelfSignupSection from '../Settings/SelfSignupSection';
import IpAllowlistSection from '../Settings/IpAllowlistSection';
import TenantAuditLogSection from '../Settings/TenantAuditLogSection';
import LdapConfigSection from '../Settings/LdapConfigSection';
import SyncProfileSection from '../Settings/SyncProfileSection';
import TenantConnectionPolicySection from '../Settings/TenantConnectionPolicySection';
import SamlConfigSection from '../Settings/SamlConfigSection';
import OAuthProvidersAdminSection from '../Settings/OAuthProvidersAdminSection';
import AccessPolicySection from '../Settings/AccessPolicySection';
import { SlideUp } from '../common/SlideUp';
import { isAdminOrAbove } from '../../utils/roles';

interface TabDef {
  id: string;
  label: string;
  icon: React.ReactElement;
}

const BASE_TABS: TabDef[] = [
  { id: 'profile', label: 'Profile', icon: <PersonIcon /> },
  { id: 'connections', label: 'Connections', icon: <TerminalIcon /> },
  { id: 'security', label: 'Security', icon: <ShieldIcon /> },
  { id: 'organization', label: 'Organization', icon: <BusinessIcon /> },
];

const TENANT_TABS: TabDef[] = [
  { id: 'teams', label: 'Teams', icon: <GroupsIcon /> },
  { id: 'gateways', label: 'Gateways', icon: <RouterIcon /> },
  { id: 'integrations', label: 'Integrations', icon: <SyncIcon /> },
];

const ADMIN_TAB: TabDef = {
  id: 'administration', label: 'Administration', icon: <AdminPanelSettingsIcon />,
};

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: string;
  linkedProvider?: string | null;
  onViewUserProfile?: (userId: string) => void;
  onGeoIpClick?: (ip: string) => void;
}

export default function SettingsDialog({ open, onClose, initialTab, linkedProvider, onViewUserProfile, onGeoIpClick }: SettingsDialogProps) {
  const user = useAuthStore((s) => s.user);
  const [hasPassword, setHasPassword] = useState(true);

  const hasTenant = Boolean(user?.tenantId);
  const isAdmin = isAdminOrAbove(user?.tenantRole);

  const tabs = useMemo(() => {
    const t = [...BASE_TABS];
    if (hasTenant) t.push(...TENANT_TABS);
    if (isAdmin) t.push(ADMIN_TAB);
    return t;
  }, [hasTenant, isAdmin]);

  const validTabIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);

  const storedTab = useUiPreferencesStore((s) => s.settingsActiveTab);
  const setStoredTab = useUiPreferencesStore((s) => s.set);

  // Use initialTab when provided, otherwise fall back to stored preference
  const [activeTab, setActiveTabState] = useState(() => {
    const preferred = initialTab || storedTab || 'profile';
    return validTabIds.has(preferred) ? preferred : 'profile';
  });

  // Track prop changes to sync initialTab (React derived-state-from-props pattern)
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);

  if (open !== prevOpen || initialTab !== prevInitialTab) {
    setPrevOpen(open);
    setPrevInitialTab(initialTab);
    if (open && initialTab && validTabIds.has(initialTab)) {
      setActiveTabState(initialTab);
      setStoredTab('settingsActiveTab', initialTab);
    }
  }

  // Ensure active tab is always valid (handles tenant removal, tab changes)
  const resolvedTab = validTabIds.has(activeTab) ? activeTab : 'profile';

  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);
    setStoredTab('settingsActiveTab', tab);
  }, [setStoredTab]);

  // Fetch hasPassword on open
  useEffect(() => {
    if (open) {
      getProfile().then((p) => setHasPassword(p.hasPassword)).catch(() => {});
    }
  }, [open]);

  const isMobile = useMediaQuery('(max-width:767px)');

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      TransitionComponent={SlideUp}
    >
      <AppBar position="static" sx={{ position: 'relative' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" color="inherit" onClick={onClose} sx={{ mr: 1 }}>
            <CloseIcon />
          </IconButton>
          <Typography variant="h6">Settings</Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
        <Tabs
          orientation={isMobile ? 'horizontal' : 'vertical'}
          variant="scrollable"
          scrollButtons="auto"
          value={resolvedTab}
          onChange={(_, v) => setActiveTab(v as string)}
          sx={isMobile ? {
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          } : {
            borderRight: 1,
            borderColor: 'divider',
            width: 220,
            minWidth: 220,
            bgcolor: 'background.paper',
            pt: 1,
          }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              value={tab.id}
              label={tab.label}
              icon={tab.icon}
              iconPosition="start"
              sx={{
                justifyContent: 'flex-start',
                textTransform: 'none',
                minHeight: 48,
                px: 2,
              }}
            />
          ))}
        </Tabs>

        <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
          {resolvedTab === 'profile' && (
            <Stack spacing={3}>
              <ProfileSection onHasPasswordResolved={setHasPassword} linkedProvider={linkedProvider} />
              <ChangePasswordSection hasPassword={hasPassword} />
            </Stack>
          )}
          {resolvedTab === 'connections' && <ConnectionDefaultsSection />}
          {resolvedTab === 'security' && (
            <Stack spacing={3}>
              <TwoFactorSection />
              <SmsMfaSection />
              <WebAuthnSection />
              <VaultAutoLockSection />
              <DomainProfileSection />
              <LinkedAccountsSection hasPassword={hasPassword} />
            </Stack>
          )}
          {resolvedTab === 'organization' && (
            <Stack spacing={3}>
              <TenantSection onNavigateToTab={setActiveTab} onViewUserProfile={onViewUserProfile} />
              {isAdmin && <TenantConnectionPolicySection />}
            </Stack>
          )}
          {resolvedTab === 'teams' && (
            <TeamSection onNavigateToTab={setActiveTab} />
          )}
          {resolvedTab === 'gateways' && (
            <GatewaySection onNavigateToTab={setActiveTab} />
          )}
          {resolvedTab === 'integrations' && <SyncProfileSection />}
          {resolvedTab === 'administration' && (
            <Stack spacing={3}>
              <SelfSignupSection />
              <IpAllowlistSection />
              <AccessPolicySection />
              <OAuthProvidersAdminSection />
              <EmailProviderSection />
              <LdapConfigSection />
              <SamlConfigSection />
              <TenantAuditLogSection onViewUserProfile={onViewUserProfile} onGeoIpClick={onGeoIpClick} />
            </Stack>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
