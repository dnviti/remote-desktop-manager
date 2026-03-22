import { config } from '../../config';
import { logger } from '../../utils/logger';
import type { SmsMessage, SmsSendFn } from './types';
import { createSendFn as createTwilioSendFn } from './providers/twilio.provider';
import { createSendFn as createSnsSendFn } from './providers/sns.provider';
import { createSendFn as createVonageSendFn } from './providers/vonage.provider';

export type { SmsMessage } from './types';

let cachedSendFn: SmsSendFn | null | undefined;

function getSendFn(): SmsSendFn | null {
  if (cachedSendFn !== undefined) return cachedSendFn;

  switch (config.smsProvider) {
    case 'twilio':
      cachedSendFn = createTwilioSendFn();
      break;
    case 'sns':
      cachedSendFn = createSnsSendFn();
      break;
    case 'vonage':
      cachedSendFn = createVonageSendFn();
      break;
    default:
      cachedSendFn = null;
      break;
  }

  return cachedSendFn;
}

/** Reset cached provider so the next sendSms() re-creates it from current config. */
export function resetSmsProvider(): void { cachedSendFn = undefined; }

export async function sendSms(msg: SmsMessage): Promise<void> {
  const send = getSendFn();
  if (!send) {
    logger.info('========================================');
    logger.info('SMS (dev mode — no provider configured):');
    logger.info(`  To: ${msg.to}`);
    logger.info(`  Body: ${msg.body}`);
    logger.info('========================================');
    return;
  }
  await send(msg);
}

export function getSmsStatus(): {
  provider: string;
  configured: boolean;
} {
  const send = getSendFn();
  return {
    provider: config.smsProvider || 'none',
    configured: send !== null,
  };
}
