export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type SendFn = (msg: EmailMessage) => Promise<void>;
