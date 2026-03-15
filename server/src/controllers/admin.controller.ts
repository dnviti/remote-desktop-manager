import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import { sendEmail, getEmailStatus } from '../services/email';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import * as appConfigService from '../services/appConfig.service';
import { config } from '../config';
import { getClientIp } from '../utils/ip';
import type { TestEmailInput, SelfSignupInput } from '../schemas/admin.schemas';

export async function emailStatus(
  _req: AuthRequest,
  res: Response,
) {
  res.json(getEmailStatus());
}

export async function sendTestEmail(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    assertAuthenticated(req);
    const { to } = req.body as TestEmailInput;
    const status = getEmailStatus();

    await sendEmail({
      to,
      subject: 'Test Email — Arsenale',
      html: `
        <h2>Test Email</h2>
        <p>This is a test email sent from your Arsenale instance.</p>
        <p>Provider: <strong>${status.provider}</strong></p>
        <p>If you received this email, your email configuration is working correctly.</p>
      `,
      text: `Test email from Arsenale.\nProvider: ${status.provider}.\nYour email configuration is working correctly.`,
    });

    auditService.log({
      userId: req.user.userId,
      action: 'EMAIL_TEST_SEND',
      details: { to, provider: status.provider },
      ipAddress: getClientIp(req),
    });

    res.json({ success: true, message: 'Test email sent successfully' });
  } catch {
    next(
      new AppError(
        'Failed to send test email. Check your email provider configuration.',
        500,
      ),
    );
  }
}

export async function getAppConfig(
  _req: AuthRequest,
  res: Response,
) {
  const selfSignupEnabled = await appConfigService.getSelfSignupEnabled();
  const selfSignupEnvLocked = appConfigService.isSelfSignupEnvLocked();
  res.json({ selfSignupEnabled, selfSignupEnvLocked });
}

export async function setSelfSignup(
  req: AuthRequest,
  res: Response,
) {
  assertAuthenticated(req);
  const { enabled } = req.body as SelfSignupInput;
  await appConfigService.setSelfSignupEnabled(enabled);

  auditService.log({
    userId: req.user.userId,
    action: 'APP_CONFIG_UPDATE',
    details: { key: 'selfSignupEnabled', value: enabled },
    ipAddress: getClientIp(req),
  });

  res.json({ selfSignupEnabled: enabled });
}

export async function getProviderDetails(
  _req: AuthRequest,
  res: Response,
) {
  const providers: Array<{
    key: string;
    label: string;
    enabled: boolean;
    providerName?: string;
  }> = [
    { key: 'google', label: 'Google', enabled: config.oauth.google.enabled },
    { key: 'microsoft', label: 'Microsoft', enabled: config.oauth.microsoft.enabled },
    { key: 'github', label: 'GitHub', enabled: config.oauth.github.enabled },
    { key: 'oidc', label: 'OIDC', enabled: config.oauth.oidc.enabled, providerName: config.oauth.oidc.providerName },
    { key: 'saml', label: 'SAML', enabled: config.oauth.saml.enabled, providerName: config.oauth.saml.providerName },
    { key: 'ldap', label: 'LDAP', enabled: config.ldap.enabled && !!config.ldap.serverUrl, providerName: config.ldap.providerName },
  ];
  res.json(providers);
}
