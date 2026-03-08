import { Resend } from 'resend';
import { config } from '../../../config';
import type { SendFn } from '../types';

export function createSendFn(): SendFn {
  const resend = new Resend(config.resendApiKey);

  return async (msg) => {
    await resend.emails.send({
      from: config.smtpFrom,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  };
}
