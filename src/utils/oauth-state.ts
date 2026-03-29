import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { OAuthProvider } from '../domain/oauth';

interface OAuthStatePayload {
  provider: OAuthProvider;
  nonce: string;
  issuedAt: string;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createSignedOAuthState(provider: OAuthProvider, secret: string): string {
  const payload: OAuthStatePayload = {
    provider,
    nonce: randomBytes(16).toString('hex'),
    issuedAt: new Date().toISOString(),
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifySignedOAuthState(
  state: string,
  provider: OAuthProvider,
  secret: string,
): boolean {
  const [encodedPayload, signature] = state.split('.');

  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = sign(encodedPayload, secret);

  if (
    expectedSignature.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  ) {
    return false;
  }

  const payload = JSON.parse(fromBase64Url(encodedPayload)) as OAuthStatePayload;
  const issuedAtMs = Date.parse(payload.issuedAt);

  if (payload.provider !== provider || Number.isNaN(issuedAtMs)) {
    return false;
  }

  const maxAgeMs = 15 * 60 * 1000;
  return Date.now() - issuedAtMs <= maxAgeMs;
}
