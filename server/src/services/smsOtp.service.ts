import crypto from 'crypto';
import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { sendSms } from './sms';

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function validatePhoneNumber(phone: string): boolean {
  return E164_REGEX.test(phone);
}

function generateOtp(): string {
  const max = 1_000_000;
  const limit = 2 ** 32 - (2 ** 32 % max); // reject values above largest even multiple
  let num: number;
  do { num = crypto.randomBytes(4).readUInt32BE(0); } while (num >= limit);
  return (num % max).toString().padStart(OTP_LENGTH, '0');
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return '+' + '*'.repeat(phone.length - 5) + phone.slice(-4);
}

export async function sendOtpToPhone(userId: string, phoneNumber: string): Promise<void> {
  const otp = generateOtp();
  const hash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.user.update({
    where: { id: userId },
    data: { smsOtpHash: hash, smsOtpExpiresAt: expiresAt },
  });

  await sendSms({
    to: phoneNumber,
    body: `Your Arsenale verification code is: ${otp}. It expires in 5 minutes.`,
  });
}

export async function verifyOtp(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { smsOtpHash: true, smsOtpExpiresAt: true },
  });

  if (!user?.smsOtpHash || !user.smsOtpExpiresAt) {
    return false;
  }

  if (user.smsOtpExpiresAt < new Date()) {
    await prisma.user.update({
      where: { id: userId },
      data: { smsOtpHash: null, smsOtpExpiresAt: null },
    });
    return false;
  }

  const inputHash = hashOtp(code);
  if (inputHash !== user.smsOtpHash) {
    return false;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { smsOtpHash: null, smsOtpExpiresAt: null },
  });

  return true;
}

export async function setupPhone(userId: string, phoneNumber: string): Promise<void> {
  if (!validatePhoneNumber(phoneNumber)) {
    throw new AppError('Invalid phone number. Use E.164 format (e.g. +1234567890)', 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { phoneNumber, phoneVerified: false },
  });

  await sendOtpToPhone(userId, phoneNumber);
}

export async function verifyPhone(userId: string, code: string): Promise<void> {
  const valid = await verifyOtp(userId, code);
  if (!valid) {
    throw new AppError('Invalid or expired verification code', 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { phoneVerified: true },
  });
}

export async function enableSmsMfa(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phoneNumber: true, phoneVerified: true, smsMfaEnabled: true },
  });

  if (!user) throw new AppError('User not found', 404);
  if (!user.phoneNumber || !user.phoneVerified) {
    throw new AppError('Phone number must be verified before enabling SMS MFA', 400);
  }
  if (user.smsMfaEnabled) {
    throw new AppError('SMS MFA is already enabled', 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { smsMfaEnabled: true },
  });
}

export async function disableSmsMfa(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { smsMfaEnabled: true },
  });

  if (!user) throw new AppError('User not found', 404);
  if (!user.smsMfaEnabled) throw new AppError('SMS MFA is not enabled', 400);

  const valid = await verifyOtp(userId, code);
  if (!valid) {
    throw new AppError('Invalid or expired verification code', 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { smsMfaEnabled: false, phoneNumber: null, phoneVerified: false },
  });
}

export async function getSmsMfaStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { smsMfaEnabled: true, phoneNumber: true, phoneVerified: true },
  });

  return {
    enabled: user?.smsMfaEnabled ?? false,
    phoneNumber: user?.phoneNumber ? maskPhone(user.phoneNumber) : null,
    phoneVerified: user?.phoneVerified ?? false,
  };
}
