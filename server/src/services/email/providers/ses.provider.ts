import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { config } from '../../../config';
import type { SendFn } from '../types';

export function createSendFn(): SendFn {
  const clientConfig: ConstructorParameters<typeof SESClient>[0] = {
    region: config.sesRegion,
  };

  // Use explicit credentials if provided, otherwise fall back to AWS default credential chain
  if (config.sesAccessKeyId && config.sesSecretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.sesAccessKeyId,
      secretAccessKey: config.sesSecretAccessKey,
    };
  }

  const client = new SESClient(clientConfig);

  return async (msg) => {
    await client.send(
      new SendEmailCommand({
        Source: config.smtpFrom,
        Destination: { ToAddresses: [msg.to] },
        Message: {
          Subject: { Data: msg.subject },
          Body: {
            Html: { Data: msg.html },
            ...(msg.text ? { Text: { Data: msg.text } } : {}),
          },
        },
      }),
    );
  };
}
