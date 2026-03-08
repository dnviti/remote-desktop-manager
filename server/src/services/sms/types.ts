export interface SmsMessage {
  to: string; // E.164 format, e.g. "+1234567890"
  body: string;
}

export type SmsSendFn = (msg: SmsMessage) => Promise<void>;
