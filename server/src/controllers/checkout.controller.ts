import { Response } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as checkoutService from '../services/checkout.service';
import { validatedQuery } from '../middleware/validate.middleware';
import { getClientIp } from '../utils/ip';
import type { CreateCheckoutInput, ListCheckoutInput } from '../schemas/checkout.schemas';
import type { CheckoutStatus } from '../lib/prisma';

export async function requestCheckout(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const body = req.body as CreateCheckoutInput;
  const result = await checkoutService.requestCheckout(
    req.user.userId,
    {
      secretId: body.secretId,
      connectionId: body.connectionId,
      durationMinutes: body.durationMinutes,
      reason: body.reason,
    },
    getClientIp(req),
  );
  res.status(201).json(result);
}

export async function approveCheckout(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await checkoutService.approveCheckout(
    req.user.userId,
    req.params.id as string,
    getClientIp(req),
  );
  res.json(result);
}

export async function rejectCheckout(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await checkoutService.rejectCheckout(
    req.user.userId,
    req.params.id as string,
    getClientIp(req),
  );
  res.json(result);
}

export async function checkinCheckout(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await checkoutService.checkinCheckout(
    req.user.userId,
    req.params.id as string,
    getClientIp(req),
  );
  res.json(result);
}

export async function listCheckouts(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const filters = validatedQuery<ListCheckoutInput>(req);
  const result = await checkoutService.listCheckoutRequests(
    req.user.userId,
    filters.role,
    filters.status as CheckoutStatus | undefined,
    filters.limit,
    filters.offset,
  );
  res.json(result);
}

export async function getCheckout(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await checkoutService.getCheckoutRequest(req.params.id as string, req.user.userId);
  if (!result) {
    res.status(404).json({ error: 'Checkout request not found' });
    return;
  }
  res.json(result);
}
