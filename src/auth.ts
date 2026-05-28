// HTTP Basic auth for the admin surface. Username is ignored; only
// the password is compared (constant-time) against ADMIN_PASSWORD.

export function checkBasicAuth(authHeader: string | null, expectedPassword: string | undefined): boolean {
  if (!expectedPassword) return false;
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = atob(authHeader.slice(6));
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const provided = decoded.slice(idx + 1);
  return constantTimeEquals(provided, expectedPassword);
}

export function basicAuthChallenge(): Response {
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="admin"' },
  });
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
