import { NotificationType } from '../../../lib/prisma';

interface NotificationEmailContent {
  subject: string;
  html: string;
  text: string;
}

const SUBJECT_MAP: Record<NotificationType, string> = {
  [NotificationType.CONNECTION_SHARED]: 'A connection has been shared with you — Arsenale',
  [NotificationType.SHARE_PERMISSION_UPDATED]: 'Shared connection permissions updated — Arsenale',
  [NotificationType.SHARE_REVOKED]: 'Connection share revoked — Arsenale',
  [NotificationType.SECRET_SHARED]: 'A secret has been shared with you — Arsenale',
  [NotificationType.SECRET_SHARE_REVOKED]: 'Secret share revoked — Arsenale',
  [NotificationType.SECRET_EXPIRING]: 'Secret expiring soon — Arsenale',
  [NotificationType.SECRET_EXPIRED]: 'Secret has expired — Arsenale',
  [NotificationType.TENANT_INVITATION]: 'You have been invited to an organization — Arsenale',
  [NotificationType.RECORDING_READY]: 'Session recording is ready — Arsenale',
  [NotificationType.IMPOSSIBLE_TRAVEL_DETECTED]: 'Security Alert: Impossible Travel Detected — Arsenale',
  [NotificationType.LATERAL_MOVEMENT_ALERT]: 'Security Alert: Lateral Movement Anomaly Detected — Arsenale',
};

function buildHtml(subject: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #1976d2; padding: 24px 32px; }
    .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 600; letter-spacing: 0.5px; }
    .body { padding: 32px; color: #374151; font-size: 15px; line-height: 1.6; }
    .message { background: #f9fafb; border-left: 4px solid #1976d2; padding: 16px; border-radius: 4px; margin: 20px 0; }
    .footer { padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; font-size: 12px; }
    .footer a { color: #6b7280; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Arsenale</h1>
    </div>
    <div class="body">
      <p>You have a new notification:</p>
      <div class="message">${message.replace(/\n/g, '<br />')}</div>
      <p>Log in to Arsenale to view more details.</p>
    </div>
    <div class="footer">
      <p>You received this email because you have email notifications enabled for this event type.<br />
      You can manage your notification preferences in <strong>Settings → Notifications</strong>.</p>
    </div>
  </div>
</body>
</html>`;
}

export function buildNotificationEmail(
  type: NotificationType,
  message: string
): NotificationEmailContent {
  const subject = SUBJECT_MAP[type] ?? 'New notification — Arsenale';
  return {
    subject,
    html: buildHtml(subject, message),
    text: `${subject}\n\n${message}\n\nLog in to Arsenale to view more details.\n\n---\nYou can manage your notification preferences in Settings → Notifications.`,
  };
}
