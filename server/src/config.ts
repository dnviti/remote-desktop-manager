import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  guacamoleWsPort: parseInt(process.env.GUACAMOLE_WS_PORT || '3002', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  guacdHost: process.env.GUACD_HOST || 'localhost',
  guacdPort: parseInt(process.env.GUACD_PORT || '4822', 10),
  guacamoleSecret: process.env.GUACAMOLE_SECRET || 'dev-guac-secret',
  vaultTtlMinutes: parseInt(process.env.VAULT_TTL_MINUTES || '30', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: (process.env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug',
  driveBasePath: process.env.DRIVE_BASE_PATH || path.resolve(__dirname, '../../data/drive'),
  fileUploadMaxSize: parseInt(process.env.FILE_UPLOAD_MAX_SIZE || String(10 * 1024 * 1024), 10),
  userDriveQuota: parseInt(process.env.USER_DRIVE_QUOTA || String(100 * 1024 * 1024), 10),
  sftpMaxFileSize: parseInt(process.env.SFTP_MAX_FILE_SIZE || String(100 * 1024 * 1024), 10),
  sftpChunkSize: parseInt(process.env.SFTP_CHUNK_SIZE || String(64 * 1024), 10),
  emailProvider: (process.env.EMAIL_PROVIDER || 'smtp') as
    | 'smtp'
    | 'sendgrid'
    | 'ses'
    | 'resend'
    | 'mailgun',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || 'noreply@localhost',
  sendgridApiKey: process.env.SENDGRID_API_KEY || '',
  sesRegion: process.env.AWS_SES_REGION || 'us-east-1',
  sesAccessKeyId: process.env.AWS_SES_ACCESS_KEY_ID || '',
  sesSecretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  mailgunApiKey: process.env.MAILGUN_API_KEY || '',
  mailgunDomain: process.env.MAILGUN_DOMAIN || '',
  mailgunRegion: (process.env.MAILGUN_REGION || 'us') as 'us' | 'eu',
  smsProvider: (process.env.SMS_PROVIDER || '') as '' | 'twilio' | 'sns' | 'vonage',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
  snsRegion: process.env.AWS_SNS_REGION || 'us-east-1',
  snsAccessKeyId: process.env.AWS_SNS_ACCESS_KEY_ID || '',
  snsSecretAccessKey: process.env.AWS_SNS_SECRET_ACCESS_KEY || '',
  vonageApiKey: process.env.VONAGE_API_KEY || '',
  vonageApiSecret: process.env.VONAGE_API_SECRET || '',
  vonageFromNumber: process.env.VONAGE_FROM_NUMBER || '',
  emailVerifyRequired: process.env.EMAIL_VERIFY_REQUIRED !== 'false',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  oauth: {
    google: {
      enabled: !!process.env.GOOGLE_CLIENT_ID,
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/google/callback',
    },
    microsoft: {
      enabled: !!process.env.MICROSOFT_CLIENT_ID,
      clientId: process.env.MICROSOFT_CLIENT_ID || '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
      callbackUrl: process.env.MICROSOFT_CALLBACK_URL || 'http://localhost:3001/api/auth/microsoft/callback',
    },
    github: {
      enabled: !!process.env.GITHUB_CLIENT_ID,
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      callbackUrl: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/api/auth/github/callback',
    },
    oidc: {
      enabled: !!process.env.OIDC_CLIENT_ID,
      providerName: process.env.OIDC_PROVIDER_NAME || 'SSO',
      issuerUrl: process.env.OIDC_ISSUER_URL || '',
      clientId: process.env.OIDC_CLIENT_ID || '',
      clientSecret: process.env.OIDC_CLIENT_SECRET || '',
      callbackUrl: process.env.OIDC_CALLBACK_URL || 'http://localhost:3001/api/auth/oidc/callback',
      scopes: process.env.OIDC_SCOPES || 'openid profile email',
    },
  },
};
