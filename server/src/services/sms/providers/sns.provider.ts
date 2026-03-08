import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { config } from '../../../config';
import type { SmsSendFn } from '../types';

export function createSendFn(): SmsSendFn {
  const clientConfig: ConstructorParameters<typeof SNSClient>[0] = {
    region: config.snsRegion,
  };

  if (config.snsAccessKeyId && config.snsSecretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.snsAccessKeyId,
      secretAccessKey: config.snsSecretAccessKey,
    };
  }

  const client = new SNSClient(clientConfig);

  return async (msg) => {
    await client.send(
      new PublishCommand({
        PhoneNumber: msg.to,
        Message: msg.body,
      }),
    );
  };
}
