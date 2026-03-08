import nodemailer from 'nodemailer';
import { config } from '../../../config';
import type { SendFn } from '../types';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  if (!config.smtpHost) return null;

  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });
  return transporter;
}

export function createSendFn(): SendFn | null {
  const transport = getTransporter();
  if (!transport) return null;

  return async (msg) => {
    await transport.sendMail({
      from: config.smtpFrom,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  };
}
