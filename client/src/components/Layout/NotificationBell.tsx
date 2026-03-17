import { useEffect, useRef, useState } from 'react';
import {
  IconButton, Badge, Popover, Box, Typography, List, ListItem, ListItemButton,
  ListItemText, ListItemIcon, Button, Divider,
} from '@mui/material';
import { NotificationsOutlined, DoneAll, Close as CloseIcon } from '@mui/icons-material';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../../store/authStore';
import { useNotificationListStore } from '../../store/notificationListStore';
import type { NotificationEntry } from '../../api/notifications.api';
import {
  getNotificationIcon,
  getOnNavigate,
  type NavigationActions,
} from '../../utils/notificationActions';
import { useDesktopNotifications } from '../../hooks/useDesktopNotifications';

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

interface NotificationBellProps {
  navigationActions: NavigationActions;
}

export default function NotificationBell({ navigationActions }: NotificationBellProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const notifications = useNotificationListStore((s) => s.notifications);
  const unreadCount = useNotificationListStore((s) => s.unreadCount);
  const fetchNotifications = useNotificationListStore((s) => s.fetchNotifications);
  const markAsRead = useNotificationListStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationListStore((s) => s.markAllAsRead);
  const addNotification = useNotificationListStore((s) => s.addNotification);
  const removeNotification = useNotificationListStore((s) => s.removeNotification);

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const { sendDesktopNotification, setOnClick } = useDesktopNotifications();

  // Open notification popover when user clicks a native desktop notification
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    setOnClick(() => {
      if (anchorRef.current) setAnchorEl(anchorRef.current);
    });
  }, [setOnClick]);

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
      sendDesktopNotification('Arsenale', {
        body: notification.message,
        tag: notification.id,
      });
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, addNotification, sendDesktopNotification]);

  const handleClick = (notification: NotificationEntry) => {
    if (!notification.read) {
      markAsRead(notification.id);
    }

    const navigate = getOnNavigate(notification.type);
    if (navigate) {
      navigate(notification, navigationActions);
      setAnchorEl(null);
    }
  };

  return (
    <>
      <IconButton
        ref={anchorRef}
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
              <ListItem
                key={n.id}
                secondaryAction={
                  <IconButton
                    edge="end"
                    size="small"
                    aria-label="dismiss notification"
                    onClick={() => removeNotification(n.id)}
                    sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                }
                disablePadding
              >
                <ListItemButton
                  onClick={() => handleClick(n)}
                  sx={{
                    bgcolor: n.read ? 'transparent' : 'action.hover',
                    borderLeft: n.read ? 'none' : '3px solid',
                    borderColor: 'primary.main',
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {getNotificationIcon(n.type)}
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
              </ListItem>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}
