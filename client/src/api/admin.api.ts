import api from './client';

export interface EmailStatus {
  provider: string;
  configured: boolean;
  from: string;
}

export async function getEmailStatus(): Promise<EmailStatus> {
  const { data } = await api.get<EmailStatus>('/admin/email/status');
  return data;
}

export async function sendTestEmail(
  to: string,
): Promise<{ success: boolean; message: string }> {
  const { data } = await api.post<{ success: boolean; message: string }>(
    '/admin/email/test',
    { to },
  );
  return data;
}

export interface AppConfig {
  selfSignupEnabled: boolean;
  selfSignupEnvLocked: boolean;
}

export async function getAppConfig(): Promise<AppConfig> {
  const { data } = await api.get<AppConfig>('/admin/app-config');
  return data;
}

export async function setSelfSignup(enabled: boolean): Promise<AppConfig> {
  const { data } = await api.put<AppConfig>('/admin/app-config/self-signup', { enabled });
  return data;
}
