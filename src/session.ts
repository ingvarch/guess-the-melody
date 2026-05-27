// Session id + owner-cookie helpers.
//
// Session ids are 10 chars of a URL-safe alphabet (~60 bits of entropy):
// short enough to share, long enough that guessing is infeasible.
// Owner tokens are 32 bytes (64 hex chars). They live in an HttpOnly
// cookie scoped to /s/<sessionId>/.

import { randomUrlSafe } from './id';

export function newSessionId(): string {
  return randomUrlSafe(10);
}

export function newOwnerToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function ownerCookieFor(sessionId: string, token: string): string {
  return `owner=${token}; Path=/s/${sessionId}/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
}

export function parseOwnerCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    if (trimmed.slice(0, idx) === 'owner') return trimmed.slice(idx + 1);
  }
  return null;
}
