import Twilio from 'twilio';
import { config } from '../../../config';
import type { SmsSendFn } from '../types';

export function createSendFn(): SmsSendFn {
  const client = Twilio(config.twilioAccountSid, config.twilioAuthToken);

  return async (msg) => {
    await client.messages.create({
      from: config.twilioFromNumber,
      to: msg.to,
      body: msg.body,
    });
  };
}
