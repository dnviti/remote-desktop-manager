import api from './client';

export async function setupSmsPhone(phoneNumber: string) {
  const res = await api.post('/user/2fa/sms/setup-phone', { phoneNumber });
  return res.data as { message: string };
}

export async function verifySmsPhone(code: string) {
  const res = await api.post('/user/2fa/sms/verify-phone', { code });
  return res.data as { verified: boolean };
}

export async function enableSmsMfa() {
  const res = await api.post('/user/2fa/sms/enable');
  return res.data as { enabled: boolean };
}

export async function sendSmsMfaDisableCode() {
  const res = await api.post('/user/2fa/sms/send-disable-code');
  return res.data as { message: string };
}

export async function disableSmsMfa(code: string) {
  const res = await api.post('/user/2fa/sms/disable', { code });
  return res.data as { enabled: boolean };
}

export async function getSmsMfaStatus() {
  const res = await api.get('/user/2fa/sms/status');
  return res.data as {
    enabled: boolean;
    phoneNumber: string | null;
    phoneVerified: boolean;
  };
}
