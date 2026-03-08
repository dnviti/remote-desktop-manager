import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { sendEmail, getEmailStatus } from '../services/email';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import * as appConfigService from '../services/appConfig.service';

const testEmailSchema = z.object({
  to: z.string().email(),
});

const selfSignupSchema = z.object({
  enabled: z.boolean(),
});

export async function emailStatus(
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(getEmailStatus());
  } catch (err) {
    next(err);
  }
}

export async function sendTestEmail(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const { to } = testEmailSchema.parse(req.body);
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
      userId: req.user!.userId,
      action: 'EMAIL_TEST_SEND',
      details: { to, provider: status.provider },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Test email sent successfully' });
  } catch (err) {
    if (err instanceof z.ZodError)
      return next(new AppError(err.issues[0].message, 400));
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
  next: NextFunction,
) {
  try {
    const selfSignupEnabled = await appConfigService.getSelfSignupEnabled();
    const selfSignupEnvLocked = appConfigService.isSelfSignupEnvLocked();
    res.json({ selfSignupEnabled, selfSignupEnvLocked });
  } catch (err) {
    next(err);
  }
}

export async function setSelfSignup(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const { enabled } = selfSignupSchema.parse(req.body);
    await appConfigService.setSelfSignupEnabled(enabled);

    auditService.log({
      userId: req.user!.userId,
      action: 'APP_CONFIG_UPDATE',
      details: { key: 'selfSignupEnabled', value: enabled },
      ipAddress: req.ip,
    });

    res.json({ selfSignupEnabled: enabled });
  } catch (err) {
    if (err instanceof z.ZodError)
      return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}
