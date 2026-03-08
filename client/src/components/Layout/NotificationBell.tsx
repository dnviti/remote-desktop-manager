import { useEffect, useRef, useState } from 'react';
import {
  IconButton, Badge, Popover, Box, Typography, List, ListItemButton,
  ListItemText, ListItemIcon, Button, Divider,
} from '@mui/material';
import {
  NotificationsOutlined,
  Share as ShareIcon,
  RemoveCircleOutline,
  Edit as EditIcon,
  DoneAll,
} from '@mui/icons-material';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../../store/authStore';
import { useNotificationListStore } from '../../store/notificationListStore';
import type { NotificationEntry } from '../../api/notifications.api';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function notificationIcon(type: NotificationEntry['type']) {
  switch (type) {
    case 'CONNECTION_SHARED': return <ShareIcon fontSize="small" color="primary" />;
    case 'SHARE_REVOKED': return <RemoveCircleOutline fontSize="small" color="error" />;
    case 'SHARE_PERMISSION_UPDATED': return <EditIcon fontSize="small" color="warning" />;
  }
}

export default function NotificationBell() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const notifications = useNotificationListStore((s) => s.notifications);
  const unreadCount = useNotificationListStore((s) => s.unreadCount);
  const fetchNotifications = useNotificationListStore((s) => s.fetchNotifications);
  const markAsRead = useNotificationListStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationListStore((s) => s.markAllAsRead);
  const addNotification = useNotificationListStore((s) => s.addNotification);

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Fetch notifications on mount
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Socket.IO connection for real-time notifications
  useEffect(() => {
    if (!accessToken) return;

    const socket = io('/notifications', {
      auth: { token: accessToken },
      transports: ['websocket'],
    });

    socket.on('notification:new', (notification: NotificationEntry) => {
      addNotification(notification);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, addNotification]);

  const handleClick = (notification: NotificationEntry) => {
    if (!notification.read) {
      markAsRead(notification.id);
    }
  };

  return (
    <>
      <IconButton
        color="inherit"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        title="Notifications"
      >
        <Badge badgeContent={unreadCount} color="error" max={99}>
          <NotificationsOutlined />
        </Badge>
      </IconButton>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: { sx: { width: 360, maxHeight: 480 } },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>Notifications</Typography>
          {unreadCount > 0 && (
            <Button
              size="small"
              startIcon={<DoneAll />}
              onClick={() => markAllAsRead()}
            >
              Mark all read
            </Button>
          )}
        </Box>
        <Divider />

        {notifications.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No notifications
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding sx={{ overflow: 'auto', maxHeight: 400 }}>
            {notifications.map((n) => (
              <ListItemButton
                key={n.id}
                onClick={() => handleClick(n)}
                sx={{
                  bgcolor: n.read ? 'transparent' : 'action.hover',
                  borderLeft: n.read ? 'none' : '3px solid',
                  borderColor: 'primary.main',
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {notificationIcon(n.type)}
                </ListItemIcon>
                <ListItemText
                  primary={n.message}
                  secondary={timeAgo(n.createdAt)}
                  primaryTypographyProps={{
                    variant: 'body2',
                    fontWeight: n.read ? 400 : 600,
                  }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}
