import { config } from '../../config';
import { logger } from '../../utils/logger';
import type { EmailMessage, SendFn } from './types';
import { createSendFn as createSmtpSendFn } from './providers/smtp.provider';
import { createSendFn as createSendgridSendFn } from './providers/sendgrid.provider';
import { createSendFn as createSesSendFn } from './providers/ses.provider';
import { createSendFn as createResendSendFn } from './providers/resend.provider';
import { createSendFn as createMailgunSendFn } from './providers/mailgun.provider';

export type { EmailMessage } from './types';

let cachedSendFn: SendFn | null | undefined;

function getSendFn(): SendFn | null {
  if (cachedSendFn !== undefined) return cachedSendFn;

  switch (config.emailProvider) {
    case 'sendgrid':
      cachedSendFn = createSendgridSendFn();
      break;
    case 'ses':
      cachedSendFn = createSesSendFn();
      break;
    case 'resend':
      cachedSendFn = createResendSendFn();
      break;
    case 'mailgun':
      cachedSendFn = createMailgunSendFn();
      break;
    case 'smtp':
    default:
      cachedSendFn = createSmtpSendFn();
      break;
  }

  return cachedSendFn;
}

/** Reset cached provider so the next sendEmail() re-creates it from current config. */
export function resetEmailProvider(): void { cachedSendFn = undefined; }

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const send = getSendFn();
  if (!send) {
    logger.info('========================================');
    logger.info('EMAIL (dev mode — no provider configured):');
    logger.info(`  To: ${msg.to}`);
    logger.info(`  Subject: ${msg.subject}`);
    logger.info('========================================');
    return;
  }
  await send(msg);
}

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<void> {
  const verifyUrl = `${config.clientUrl}/api/auth/verify-email?token=${token}`;

  const send = getSendFn();
  if (!send) {
    logger.info('========================================');
    logger.info('EMAIL VERIFICATION LINK (dev mode):');
    logger.info(verifyUrl);
    logger.info('========================================');
    return;
  }

  await send({
    to,
    subject: 'Verify your email — Arsenale',
    html: `
      <h2>Email Verification</h2>
      <p>Click the link below to verify your email address:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 24 hours.</p>
      <p>If you did not create an account, you can ignore this email.</p>
    `,
    text: `Verify your email: ${verifyUrl}\n\nThis link expires in 24 hours. If you did not create an account, ignore this email.`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const resetUrl = `${config.clientUrl}/reset-password?token=${token}`;

  const send = getSendFn();
  if (!send) {
    logger.info('========================================');
    logger.info('PASSWORD RESET LINK (dev mode):');
    logger.info(resetUrl);
    logger.info('========================================');
    return;
  }

  await send({
    to,
    subject: 'Password Reset — Arsenale',
    html: `
      <h2>Password Reset Request</h2>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour.</p>
      <p>If you did not request this, you can safely ignore this email. Your password will not be changed.</p>
    `,
    text: `Password Reset: ${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
  });
}

export async function sendWelcomeEmail(
  to: string,
  temporaryPassword: string,
): Promise<void> {
  const loginUrl = `${config.clientUrl}/login`;

  const send = getSendFn();
  if (!send) {
    logger.info('========================================');
    logger.info('WELCOME EMAIL (dev mode):');
    logger.info(`  To: ${to}`);
    logger.info(`  Temporary password: ${temporaryPassword}`);
    logger.info(`  Login URL: ${loginUrl}`);
    logger.info('========================================');
    return;
  }

  await send({
    to,
    subject: 'Your account has been created — Arsenale',
    html: `
      <h2>Welcome to Arsenale</h2>
      <p>An administrator has created an account for you.</p>
      <p><strong>Email:</strong> ${to}</p>
      <p><strong>Temporary password:</strong> ${temporaryPassword}</p>
      <p><a href="${loginUrl}">Sign in to your account</a></p>
      <p>We recommend changing your password after your first login.</p>
    `,
    text: `Welcome to Arsenale\n\nAn administrator has created an account for you.\nEmail: ${to}\nTemporary password: ${temporaryPassword}\nLogin: ${loginUrl}\n\nPlease change your password after your first login.`,
  });
}

export async function sendIdentityVerificationCode(
  to: string,
  code: string,
  purpose: string,
): Promise<void> {
  const send = getSendFn();
  if (!send) {
    logger.info('========================================');
    logger.info('IDENTITY VERIFICATION CODE (dev mode):');
    logger.info(`  To: ${to}`);
    logger.info(`  Code: ${code}`);
    logger.info(`  Purpose: ${purpose}`);
    logger.info('========================================');
    return;
  }

  await send({
    to,
    subject: 'Identity Verification Code — Arsenale',
    html: `
      <h2>Identity Verification</h2>
      <p>Your verification code is: <strong>${code}</strong></p>
      <p>This code is needed for: <strong>${purpose}</strong></p>
      <p>The code expires in 15 minutes.</p>
      <p>If you did not request this, please secure your account immediately.</p>
    `,
    text: `Your identity verification code is: ${code}\n\nPurpose: ${purpose}\nThis code expires in 15 minutes.\nIf you did not request this, please secure your account immediately.`,
  });
}

export async function sendEmailChangeCode(
  to: string,
  code: string,
  isOldEmail: boolean,
): Promise<void> {
  const label = isOldEmail
    ? 'Confirm that you want to change your email address'
    : 'Confirm your new email address';

  const send = getSendFn();
  if (!send) {
    logger.info('========================================');
    logger.info(`EMAIL CHANGE CODE (dev mode — ${isOldEmail ? 'old' : 'new'} email):`);
    logger.info(`  To: ${to}`);
    logger.info(`  Code: ${code}`);
    logger.info('========================================');
    return;
  }

  await send({
    to,
    subject: 'Email Change Verification — Arsenale',
    html: `
      <h2>Email Change Verification</h2>
      <p>${label}</p>
      <p>Your verification code is: <strong>${code}</strong></p>
      <p>The code expires in 15 minutes.</p>
      <p>If you did not request this, please secure your account immediately.</p>
    `,
    text: `${label}\n\nYour verification code is: ${code}\nThis code expires in 15 minutes.\nIf you did not request this, please secure your account immediately.`,
  });
}

export function getEmailStatus(): {
  provider: string;
  configured: boolean;
  from: string;
} {
  const send = getSendFn();
  return {
    provider: config.emailProvider,
    configured: send !== null,
    from: config.smtpFrom,
  };
}
