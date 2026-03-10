import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import * as connectionService from '../services/connection.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';

const sshTerminalConfigSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().int().min(10).max(24).optional(),
  lineHeight: z.number().min(1.0).max(2.0).optional(),
  letterSpacing: z.number().min(0).max(5).optional(),
  cursorStyle: z.enum(['block', 'underline', 'bar']).optional(),
  cursorBlink: z.boolean().optional(),
  theme: z.string().optional(),
  customColors: z.record(z.string(), z.string()).optional(),
  scrollback: z.number().int().min(100).max(10000).optional(),
  bellStyle: z.enum(['none', 'sound', 'visual']).optional(),
  syncThemeWithWebUI: z.boolean().optional(),
  syncLightTheme: z.string().optional(),
  syncDarkTheme: z.string().optional(),
});

const rdpSettingsSchema = z.object({
  colorDepth: z.union([z.literal(8), z.literal(16), z.literal(24)]).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  dpi: z.number().int().positive().optional(),
  resizeMethod: z.enum(['display-update', 'reconnect']).optional(),
  qualityPreset: z.enum(['performance', 'balanced', 'quality', 'custom']).optional(),
  enableWallpaper: z.boolean().optional(),
  enableTheming: z.boolean().optional(),
  enableFontSmoothing: z.boolean().optional(),
  enableFullWindowDrag: z.boolean().optional(),
  enableDesktopComposition: z.boolean().optional(),
  enableMenuAnimations: z.boolean().optional(),
  forceLossless: z.boolean().optional(),
  disableAudio: z.boolean().optional(),
  enableAudioInput: z.boolean().optional(),
  security: z.enum(['any', 'nla', 'nla-ext', 'tls', 'rdp']).optional(),
  ignoreCert: z.boolean().optional(),
  serverLayout: z.string().optional(),
  console: z.boolean().optional(),
  timezone: z.string().optional(),
});

const vncSettingsSchema = z.object({
  colorDepth: z.union([z.literal(8), z.literal(16), z.literal(24), z.literal(32)]).optional(),
  cursor: z.enum(['local', 'remote']).optional(),
  readOnly: z.boolean().optional(),
  clipboardEncoding: z.enum(['ISO8859-1', 'UTF-8', 'UTF-16', 'CP1252']).optional(),
  swapRedBlue: z.boolean().optional(),
  disableAudio: z.boolean().optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['RDP', 'SSH', 'VNC']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().optional(),
  password: z.string().optional(),
  domain: z.string().optional(),
  credentialSecretId: z.string().uuid().optional(),
  description: z.string().optional(),
  folderId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  enableDrive: z.boolean().optional(),
  gatewayId: z.string().uuid().nullable().optional(),
  sshTerminalConfig: sshTerminalConfigSchema.optional(),
  rdpSettings: rdpSettingsSchema.optional(),
  vncSettings: vncSettingsSchema.optional(),
  defaultCredentialMode: z.enum(['saved', 'domain', 'prompt']).nullable().optional(),
}).refine(
  (data) => data.credentialSecretId || (data.username !== undefined && data.password !== undefined),
  { message: 'Either credentialSecretId or both username and password must be provided' }
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['RDP', 'SSH', 'VNC']).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  domain: z.string().optional(),
  credentialSecretId: z.string().uuid().nullable().optional(),
  description: z.string().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  enableDrive: z.boolean().optional(),
  gatewayId: z.string().uuid().nullable().optional(),
  sshTerminalConfig: sshTerminalConfigSchema.nullable().optional(),
  rdpSettings: rdpSettingsSchema.nullable().optional(),
  vncSettings: vncSettingsSchema.nullable().optional(),
  defaultCredentialMode: z.enum(['saved', 'domain', 'prompt']).nullable().optional(),
});

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = createSchema.parse(req.body);
    const result = await connectionService.createConnection(req.user.userId, data, req.user.tenantId);
    auditService.log({
      userId: req.user.userId, action: 'CREATE_CONNECTION',
      targetType: 'Connection', targetId: result.id,
      details: { name: data.name, type: data.type, host: data.host, teamId: data.teamId ?? null },
      ipAddress: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = updateSchema.parse(req.body);
    const result = await connectionService.updateConnection(
      req.user.userId,
      req.params.id as string,
      data,
      req.user.tenantId
    );
    auditService.log({
      userId: req.user.userId, action: 'UPDATE_CONNECTION',
      targetType: 'Connection', targetId: req.params.id as string,
      details: { fields: Object.keys(data) },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await connectionService.deleteConnection(req.user.userId, req.params.id as string, req.user.tenantId);
    auditService.log({
      userId: req.user.userId, action: 'DELETE_CONNECTION',
      targetType: 'Connection', targetId: req.params.id as string,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await connectionService.getConnection(req.user.userId, req.params.id as string, req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await connectionService.listConnections(req.user.userId, req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function toggleFavorite(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await connectionService.toggleFavorite(req.user.userId, req.params.id as string, req.user.tenantId);

    auditService.log({
      userId: req.user.userId,
      action: 'CONNECTION_FAVORITE',
      targetType: 'Connection',
      targetId: req.params.id as string,
      details: { isFavorite: result.isFavorite },
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}
