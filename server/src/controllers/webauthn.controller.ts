import { Response } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as auditService from '../services/audit.service';
import * as webauthnService from '../services/webauthn.service';
import { getClientIp } from '../utils/ip';
import type { WebauthnRegisterInput, WebauthnRenameInput } from '../schemas/mfa.schemas';

export async function registrationOptions(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const options = await webauthnService.generateRegistrationOpts(req.user.userId);
  res.json(options);
}

export async function register(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { credential, friendlyName, expectedChallenge } = req.body as WebauthnRegisterInput & { expectedChallenge?: string };
  const result = await webauthnService.verifyRegistration(
    req.user.userId,
    credential as unknown as Parameters<typeof webauthnService.verifyRegistration>[1],
    friendlyName,
    expectedChallenge,
  );
  auditService.log({
    userId: req.user.userId,
    action: 'WEBAUTHN_REGISTER',
    targetType: 'WebAuthnCredential',
    targetId: result.id,
    details: { friendlyName: result.friendlyName, deviceType: result.deviceType },
    ipAddress: getClientIp(req),
  });
  res.json(result);
}

export async function getCredentials(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const credentials = await webauthnService.getCredentials(req.user.userId);
  res.json(credentials);
}

export async function removeCredential(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const credentialId = req.params.id as string;
  await webauthnService.removeCredential(req.user.userId, credentialId);
  auditService.log({
    userId: req.user.userId,
    action: 'WEBAUTHN_REMOVE',
    targetType: 'WebAuthnCredential',
    targetId: credentialId,
    ipAddress: getClientIp(req),
  });
  res.json({ removed: true });
}

export async function renameCredential(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const credentialId = req.params.id as string;
  const { friendlyName } = req.body as WebauthnRenameInput;
  await webauthnService.renameCredential(req.user.userId, credentialId, friendlyName);
  res.json({ renamed: true });
}

export async function status(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await webauthnService.getWebAuthnStatus(req.user.userId);
  res.json(result);
}
