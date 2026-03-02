import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as gatewayService from '../services/gateway.service';
import * as sshKeyService from '../services/sshkey.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['GUACD', 'SSH_BASTION', 'MANAGED_SSH']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  apiPort: z.number().int().min(1).max(65535).optional(),
  monitoringEnabled: z.boolean().optional(),
  monitorIntervalMs: z.number().int().min(1000).max(3600000).optional(),
});

const rotationPolicySchema = z.object({
  autoRotateEnabled: z.boolean().optional(),
  rotationIntervalDays: z.number().int().min(1).max(365).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  description: z.string().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  apiPort: z.number().int().min(1).max(65535).nullable().optional(),
  monitoringEnabled: z.boolean().optional(),
  monitorIntervalMs: z.number().int().min(1000).max(3600000).optional(),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await gatewayService.listGateways(req.user!.tenantId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createSchema.parse(req.body);
    const result = await gatewayService.createGateway(
      req.user!.userId,
      req.user!.tenantId!,
      data,
    );
    auditService.log({
      userId: req.user!.userId,
      action: 'GATEWAY_CREATE',
      targetType: 'Gateway',
      targetId: result.id,
      details: { name: data.name, type: data.type, isDefault: data.isDefault ?? false },
      ipAddress: req.ip,
    });

    // Best-effort auto-push key for MANAGED_SSH gateways
    let keyPushed = false;
    let keyPushError: string | undefined;
    if (data.type === 'MANAGED_SSH' && data.apiPort) {
      try {
        await gatewayService.pushKeyToGateway(req.user!.tenantId!, result.id);
        keyPushed = true;
        auditService.log({
          userId: req.user!.userId,
          action: 'SSH_KEY_PUSH',
          targetType: 'Gateway',
          targetId: result.id,
          details: { auto: true },
          ipAddress: req.ip,
        });
      } catch (err) {
        keyPushError = (err as Error).message;
      }
    }

    res.status(201).json({ ...result, keyPushed, keyPushError });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = updateSchema.parse(req.body);
    const gatewayId = req.params.id as string;
    const result = await gatewayService.updateGateway(
      req.user!.userId,
      req.user!.tenantId!,
      gatewayId,
      data,
    );
    auditService.log({
      userId: req.user!.userId,
      action: 'GATEWAY_UPDATE',
      targetType: 'Gateway',
      targetId: gatewayId,
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
    const gatewayId = req.params.id as string;
    const result = await gatewayService.deleteGateway(req.user!.tenantId!, gatewayId);
    auditService.log({
      userId: req.user!.userId,
      action: 'GATEWAY_DELETE',
      targetType: 'Gateway',
      targetId: gatewayId,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function testConnectivity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const gatewayId = req.params.id as string;
    const result = await gatewayService.testGatewayConnectivity(
      req.user!.tenantId!,
      gatewayId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function generateSshKeyPair(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await sshKeyService.generateKeyPair(req.user!.tenantId!);
    auditService.log({
      userId: req.user!.userId,
      action: 'SSH_KEY_GENERATE',
      targetType: 'SshKeyPair',
      targetId: result.id,
      ipAddress: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getSshPublicKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await sshKeyService.getPublicKey(req.user!.tenantId!);
    if (!result) {
      return next(new AppError('No SSH key pair found for this tenant', 404));
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function rotateSshKeyPair(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await sshKeyService.rotateKeyPair(req.user!.tenantId!);
    auditService.log({
      userId: req.user!.userId,
      action: 'SSH_KEY_ROTATE',
      targetType: 'SshKeyPair',
      targetId: result.id,
      ipAddress: req.ip,
    });

    // Best-effort auto-push rotated key to all managed gateways
    const pushResults = await gatewayService.pushKeyToAllManagedGateways(req.user!.tenantId!);
    for (const pr of pushResults) {
      if (pr.ok) {
        auditService.log({
          userId: req.user!.userId,
          action: 'SSH_KEY_PUSH',
          targetType: 'Gateway',
          targetId: pr.gatewayId,
          details: { auto: true, trigger: 'rotate' },
          ipAddress: req.ip,
        });
      }
    }

    res.json({ ...result, pushResults });
  } catch (err) {
    next(err);
  }
}

export async function pushKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const gatewayId = req.params.id as string;
    const result = await gatewayService.pushKeyToGateway(
      req.user!.tenantId!,
      gatewayId,
    );
    auditService.log({
      userId: req.user!.userId,
      action: 'SSH_KEY_PUSH',
      targetType: 'Gateway',
      targetId: gatewayId,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function downloadSshPrivateKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const privateKeyBuf = await sshKeyService.getPrivateKey(req.user!.tenantId!);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="tenant_ed25519"');
    res.send(privateKeyBuf.toString('utf8'));
  } catch (err) {
    next(err);
  }
}

export async function updateRotationPolicy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = rotationPolicySchema.parse(req.body);

    const input: sshKeyService.RotationPolicyInput = {};
    if (data.autoRotateEnabled !== undefined) {
      input.autoRotateEnabled = data.autoRotateEnabled;
    }
    if (data.rotationIntervalDays !== undefined) {
      input.rotationIntervalDays = data.rotationIntervalDays;
    }
    if (data.expiresAt !== undefined) {
      input.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    }

    const result = await sshKeyService.updateRotationPolicy(req.user!.tenantId!, input);

    auditService.log({
      userId: req.user!.userId,
      action: 'SSH_KEY_ROTATE',
      targetType: 'SshKeyPair',
      targetId: result.id,
      details: { policyUpdate: data },
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function getRotationStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await sshKeyService.getRotationStatus(req.user!.tenantId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
