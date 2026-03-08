import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import { config } from '../../../config';
import type { SendFn } from '../types';

export function createSendFn(): SendFn {
  const mailgun = new Mailgun(FormData);
  const mg = mailgun.client({
    username: 'api',
    key: config.mailgunApiKey,
    url:
      config.mailgunRegion === 'eu'
        ? 'https://api.eu.mailgun.net'
        : undefined,
  });

  return async (msg) => {
    await mg.messages.create(config.mailgunDomain, {
      from: config.smtpFrom,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  };
}
