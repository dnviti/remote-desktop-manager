import { startAuthentication } from '@simplewebauthn/browser';

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export function getExpectedChallenge(options: Record<string, unknown>): string | undefined {
  return typeof options.challenge === 'string' ? options.challenge : undefined;
}

export async function startWebAuthnAuthentication(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not available in this browser context.');
  }

  const credential = await startAuthentication({
    optionsJSON: options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
  });

  return credential as unknown as Record<string, unknown>;
}

export function formatWebAuthnError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError') {
      return 'Authentication was cancelled or timed out.';
    }

    if (error.message) {
      return error.message;
    }
  }

  return 'WebAuthn authentication failed.';
}
