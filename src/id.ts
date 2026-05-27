// URL-safe random ids. Shared by session ids (10 chars) and track ids (12 chars).
// Alphabet matches RFC 7515 base64url so ids drop into URLs and filenames
// without escaping.

export const URL_SAFE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export function randomUrlSafe(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => URL_SAFE_ALPHABET.charAt(b % URL_SAFE_ALPHABET.length)).join(
    '',
  );
}
