import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, Box, IconButton, Tabs, Tab,
  Stack, useMediaQuery, Card, CardContent, Button,
} from '@mui/material';
import {
  Close as CloseIcon,
  Person as PersonIcon,
  Palette as PaletteIcon,
  Terminal as TerminalIcon,
  Shield as ShieldIcon,
  Business as BusinessIcon,
  Groups as GroupsIcon,
  Router as RouterIcon,
  Sync as SyncIcon,
  AdminPanelSettings as AdminPanelSettingsIcon,
  VpnLock as TunnelIcon,
  CloudUpload as CloudUploadIcon,
  CloudDownload as CloudDownloadIcon,
  Notifications as NotificationsIcon,
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
import SystemSettingsSection from '../Settings/SystemSettingsSection';
import IpAllowlistSection from '../Settings/IpAllowlistSection';
import TenantAuditLogSection from '../Settings/TenantAuditLogSection';
import LdapConfigSection from '../Settings/LdapConfigSection';
import SyncProfileSection from '../Settings/SyncProfileSection';
import TenantConnectionPolicySection from '../Settings/TenantConnectionPolicySection';
import TunnelConfigSection from '../Settings/TunnelConfigSection';
import SamlConfigSection from '../Settings/SamlConfigSection';
import OAuthProvidersAdminSection from '../Settings/OAuthProvidersAdminSection';
import AccessPolicySection from '../Settings/AccessPolicySection';
import NativeSshSection from '../Settings/NativeSshSection';
import RdGatewayConfigSection from '../Settings/RdGatewayConfigSection';
import DbFirewallSection from '../Settings/DbFirewallSection';
import DbMaskingSection from '../Settings/DbMaskingSection';
import AiQueryConfigSection from '../Settings/AiQueryConfigSection';
import DbRateLimitSection from '../Settings/DbRateLimitSection';
import AppearanceSection from '../Settings/AppearanceSection';
import SqlEditorSection from '../Settings/SqlEditorSection';
import NotificationPreferencesSection from '../Settings/NotificationPreferencesSection';
import NotificationsSection from '../Settings/NotificationsSection';
import { SlideUp } from '../common/SlideUp';
import { isAdminOrAbove } from '../../utils/roles';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

interface TabDef {
  id: string;
  label: string;
  icon: React.ReactElement;
}

const BASE_TABS: TabDef[] = [
  { id: 'profile', label: 'Profile', icon: <PersonIcon /> },
  { id: 'appearance', label: 'Appearance', icon: <PaletteIcon /> },
  { id: 'notifications', label: 'Notifications', icon: <NotificationsIcon /> },
  { id: 'connections', label: 'Connections', icon: <TerminalIcon /> },
  { id: 'security', label: 'Security', icon: <ShieldIcon /> },
  { id: 'organization', label: 'Organization', icon: <BusinessIcon /> },
];

const TENANT_TABS: TabDef[] = [
  { id: 'teams', label: 'Teams', icon: <GroupsIcon /> },
  { id: 'gateways', label: 'Gateways', icon: <RouterIcon /> },
  { id: 'integrations', label: 'Integrations', icon: <SyncIcon /> },
];

const TUNNEL_TAB: TabDef = {
  id: 'tunnel', label: 'Zero-Trust Tunnel', icon: <TunnelIcon />,
};

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
  onImport?: () => void;
  onExport?: () => void;
}

export default function SettingsDialog({ open, onClose, initialTab, linkedProvider, onViewUserProfile, onGeoIpClick, onImport, onExport }: SettingsDialogProps) {
  const user = useAuthStore((s) => s.user);
  const databaseProxyEnabled = useFeatureFlagsStore((s) => s.databaseProxyEnabled);
  const [hasPassword, setHasPassword] = useState(true);
  const [deleteOrgTrigger, setDeleteOrgTrigger] = useState<(() => void) | null>(null);

  const hasTenant = Boolean(user?.tenantId);
  const isAdmin = isAdminOrAbove(user?.tenantRole);
  const isOwner = user?.tenantRole === 'OWNER';

  const tabs = useMemo(() => {
    const t = [...BASE_TABS];
    if (hasTenant) t.push(...TENANT_TABS);
    if (isAdmin) t.push(TUNNEL_TAB, ADMIN_TAB);
    return t;
  }, [hasTenant, isAdmin]);

  const validTabIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);

  const storedTab = useUiPreferencesStore((s) => s.settingsActiveTab);
  const setStoredTab = useUiPreferencesStore((s) => s.set);

  // --- Active tab state (React 19 render-time adjustment, no useEffect) ---
  const [activeTab, setActiveTabRaw] = useState('profile');
  const [prevOpen, setPrevOpen] = useState(false);
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);

  // Reset tab when dialog opens or initialTab changes while open
  if (open && (!prevOpen || initialTab !== prevInitialTab)) {
    const target = initialTab || storedTab || 'profile';
    setActiveTabRaw(validTabIds.has(target) ? target : 'profile');
  }
  if (open !== prevOpen) setPrevOpen(open);
  if (initialTab !== prevInitialTab) setPrevInitialTab(initialTab);

  // Ensure active tab is always valid (handles tenant removal, role changes)
  const resolvedTab = validTabIds.has(activeTab) ? activeTab : 'profile';

  const setActiveTab = useCallback((tab: string) => {
    setActiveTabRaw(tab);
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
          {resolvedTab === 'appearance' && (
            <Stack spacing={3}>
              <AppearanceSection />
              {databaseProxyEnabled && <SqlEditorSection />}
            </Stack>
          )}
          {resolvedTab === 'notifications' && (
            <Stack spacing={3}>
              <NotificationsSection />
              <NotificationPreferencesSection />
            </Stack>
          )}
          {resolvedTab === 'connections' && (
            <Stack spacing={3}>
              {/* Import & Export */}
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    Import & Export
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Import connections from a file or export your current connections.
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<CloudUploadIcon />}
                      onClick={onImport}
                    >
                      Import
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<CloudDownloadIcon />}
                      onClick={onExport}
                    >
                      Export
                    </Button>
                  </Box>
                </CardContent>
              </Card>
              <ConnectionDefaultsSection />
            </Stack>
          )}
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
              <TenantSection
                onViewUserProfile={onViewUserProfile}
                onDeleteRequest={(trigger) => setDeleteOrgTrigger(() => trigger)}
              />
              {isAdmin && <TenantConnectionPolicySection />}
              {isOwner && deleteOrgTrigger && (
                <Card
                  variant="outlined"
                  sx={{
                    borderColor: 'rgba(239,68,68,0.3)',
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(239,68,68,0.04)' : 'rgba(239,68,68,0.02)',
                  }}
                >
                  <CardContent>
                    <Typography variant="h6" sx={{ color: 'error.main', mb: 1 }}>Danger Zone</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Permanently delete this organization, all teams, and remove all members. This action cannot be undone.
                    </Typography>
                    <Button
                      color="error"
                      variant="outlined"
                      size="small"
                      onClick={deleteOrgTrigger}
                    >
                      Delete Organization
                    </Button>
                  </CardContent>
                </Card>
              )}
            </Stack>
          )}
          {resolvedTab === 'teams' && (
            <TeamSection onNavigateToTab={setActiveTab} />
          )}
          {resolvedTab === 'gateways' && (
            <GatewaySection onNavigateToTab={setActiveTab} />
          )}
          {resolvedTab === 'integrations' && (
            <Stack spacing={3}>
              <SyncProfileSection />
              {isOwner && databaseProxyEnabled && <AiQueryConfigSection />}
            </Stack>
          )}
          {resolvedTab === 'tunnel' && <TunnelConfigSection />}
          {resolvedTab === 'administration' && (
            <Stack spacing={3}>
              <SelfSignupSection />
              <SystemSettingsSection />
              <NativeSshSection />
              <IpAllowlistSection />
              <AccessPolicySection />
              <RdGatewayConfigSection />
              <OAuthProvidersAdminSection />
              <EmailProviderSection />
              <LdapConfigSection />
              <SamlConfigSection />
              {databaseProxyEnabled && <DbFirewallSection />}
              {databaseProxyEnabled && <DbMaskingSection />}
              {databaseProxyEnabled && <DbRateLimitSection />}
              <TenantAuditLogSection onViewUserProfile={onViewUserProfile} onGeoIpClick={onGeoIpClick} />
            </Stack>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
