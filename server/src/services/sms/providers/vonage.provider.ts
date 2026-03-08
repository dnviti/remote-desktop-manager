import { Vonage } from '@vonage/server-sdk';
import { config } from '../../../config';
import type { SmsSendFn } from '../types';

export function createSendFn(): SmsSendFn {
  const vonage = new Vonage({
    apiKey: config.vonageApiKey,
    apiSecret: config.vonageApiSecret,
  });

  return async (msg) => {
    await vonage.sms.send({
      from: config.vonageFromNumber,
      to: msg.to,
      text: msg.body,
    });
  };
}
