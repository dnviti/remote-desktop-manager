import sgMail from '@sendgrid/mail';
import { config } from '../../../config';
import type { SendFn } from '../types';

export function createSendFn(): SendFn {
  sgMail.setApiKey(config.sendgridApiKey);

  return async (msg) => {
    await sgMail.send({
      from: config.smtpFrom,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text ?? msg.subject,
    });
  };
}
