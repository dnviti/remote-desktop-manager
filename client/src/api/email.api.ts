import api from './client';

export async function resendVerificationEmail(email: string): Promise<void> {
  await api.post('/auth/resend-verification', { email });
}
