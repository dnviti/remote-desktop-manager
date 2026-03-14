import { ReactNode } from 'react';
import {
  Share as ShareIcon,
  RemoveCircleOutline,
  Edit as EditIcon,
  VpnKey as VpnKeyIcon,
  VpnKeyOff as VpnKeyOffIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  GroupAdd as GroupAddIcon,
  Videocam as VideocamIcon,
  AirplanemodeActive as FlightIcon,
  Notifications as DefaultIcon,
} from '@mui/icons-material';
import type { NotificationType, NotificationEntry } from '../api/notifications.api';
import { useConnectionsStore } from '../store/connectionsStore';
import { useSecretStore } from '../store/secretStore';

// ── Navigation actions provided by MainLayout ────────────────────────
export interface NavigationActions {
  openKeychain: () => void;
  openRecordings: () => void;
  openSettings: (tab?: string) => void;
  openAuditLog: () => void;
  selectConnection: (connectionId: string) => void;
}

// ── Registry entry ───────────────────────────────────────────────────
interface NotificationActionDef {
  icon: ReactNode;
  onReceive?: (notification: NotificationEntry) => void;
  onNavigate?: (notification: NotificationEntry, actions: NavigationActions) => void;
}

// ── Store refresh helpers ────────────────────────────────────────────
function refreshConnections() {
  useConnectionsStore.getState().fetchConnections();
}

function refreshSecrets() {
  useSecretStore.getState().fetchSecrets();
}

// ── Registry ─────────────────────────────────────────────────────────
const NOTIFICATION_ACTIONS: Record<NotificationType, NotificationActionDef> = {
  CONNECTION_SHARED: {
    icon: <ShareIcon fontSize="small" color="primary" />,
    onReceive: refreshConnections,
    onNavigate: (n, actions) => {
      if (n.relatedId) actions.selectConnection(n.relatedId);
    },
  },
  SHARE_PERMISSION_UPDATED: {
    icon: <EditIcon fontSize="small" color="warning" />,
    onReceive: refreshConnections,
    onNavigate: (n, actions) => {
      if (n.relatedId) actions.selectConnection(n.relatedId);
    },
  },
  SHARE_REVOKED: {
    icon: <RemoveCircleOutline fontSize="small" color="error" />,
    onReceive: refreshConnections,
  },
  SECRET_SHARED: {
    icon: <VpnKeyIcon fontSize="small" color="primary" />,
    onReceive: refreshSecrets,
    onNavigate: (_n, actions) => actions.openKeychain(),
  },
  SECRET_SHARE_REVOKED: {
    icon: <VpnKeyOffIcon fontSize="small" color="error" />,
    onReceive: refreshSecrets,
  },
  SECRET_EXPIRING: {
    icon: <WarningIcon fontSize="small" color="warning" />,
    onNavigate: (_n, actions) => actions.openKeychain(),
  },
  SECRET_EXPIRED: {
    icon: <ErrorIcon fontSize="small" color="error" />,
    onNavigate: (_n, actions) => actions.openKeychain(),
  },
  TENANT_INVITATION: {
    icon: <GroupAddIcon fontSize="small" color="primary" />,
    onNavigate: (_n, actions) => actions.openSettings('organization'),
  },
  RECORDING_READY: {
    icon: <VideocamIcon fontSize="small" color="success" />,
    onNavigate: (_n, actions) => actions.openRecordings(),
  },
  IMPOSSIBLE_TRAVEL_DETECTED: {
    icon: <FlightIcon fontSize="small" color="error" />,
    onNavigate: (_n, actions) => actions.openAuditLog(),
  },
};

// ── Public helpers ───────────────────────────────────────────────────
export function getNotificationIcon(type: NotificationType): ReactNode {
  return NOTIFICATION_ACTIONS[type]?.icon ?? <DefaultIcon fontSize="small" />;
}

export function getOnReceive(type: NotificationType) {
  return NOTIFICATION_ACTIONS[type]?.onReceive;
}

export function getOnNavigate(type: NotificationType) {
  return NOTIFICATION_ACTIONS[type]?.onNavigate;
}
