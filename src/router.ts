// User-facing HTTP router. Sits in front of the MelodyRoom DO, R2 audio
// objects, the admin sub-app, and the static assets binding.
//
// Path map (priority order):
//   POST /api/session                    -- mint a new session + owner cookie
//   GET  /api/genres                     -- public catalogue metadata
//   GET  /s/<id>/qr.svg                  -- Phase 13 placeholder (501)
//   GET  /s/<id>/api/state               -- proxy DO GET /state
//   POST /s/<id>/api/state               -- proxy DO POST /state (owner gate)
//   GET  /s/<id>/api/events              -- SSE proxy (streaming)
//   GET  /s/<id>/api/track/<id>.mp3      -- R2 audio fetch
//   GET  /s/<id>/                        -- host shell with session-id meta
//   GET  /s/<id>/display                 -- display shell with session-id meta
//   /admin*                              -- delegate to admin handler
//   anything else                        -- delegate to ASSETS
//
// Owner authentication is a defence-in-depth pair: the router checks the
// HttpOnly `owner` cookie, the DO verifies the `X-Owner-Token` header. A
// caller who bypassed the cookie check (e.g. by hitting the DO directly)
// would still be stopped at the DO boundary.

import { handleAdmin } from './admin/handlers';
import { listGenres } from './catalog/genres';
import { getTrack } from './catalog/tracks';
import { handleQr } from './qr';
import {
  newOwnerToken,
  newSessionId,
  ownerCookieFor,
  parseOwnerCookie,
} from './session';
import type { Env } from './types';

const DO_BASE = 'http://room';

const SESSION_PATH_RE = /^\/s\/([^/]+)(\/.*)?$/;
const TRACK_PATH_RE = /^\/api\/track\/([^/]+)\.mp3$/;

function clientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('X-Forwarded-For') ??
    'unknown'
  );
}

// Centralises the limiter contract so callers don't need to know it's optional.
async function enforceRateLimit(
  env: Env,
  ip: string,
): Promise<{ ok: true } | { ok: false }> {
  if (env.SESSION_RATE_LIMITER === undefined) return { ok: true };
  const { success } = await env.SESSION_RATE_LIMITER.limit({ key: ip });
  return success ? { ok: true } : { ok: false };
}

async function handleGenresPublic(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('method not allowed', {
      status: 405,
      headers: { Allow: 'GET' },
    });
  }
  // listGenres without includeArchived returns only archived=0 rows, ordered
  // by sort_order. Public metadata: no auth, no secrets exposed.
  const rows = await listGenres(env.CATALOG);
  return Response.json(rows);
}

async function handleSessionCreate(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('method not allowed', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  }

  const rl = await enforceRateLimit(env, clientIp(req));
  if (!rl.ok) {
    return new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  const sessionId = newSessionId();
  const ownerToken = newOwnerToken();

  const stub = env.MELODY_ROOM.get(env.MELODY_ROOM.idFromName(sessionId));
  const init = await stub.fetch(`${DO_BASE}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerToken, sessionId }),
  });
  if (!init.ok) {
    return new Response('init failed', { status: 500 });
  }

  return new Response(JSON.stringify({ sessionId }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': ownerCookieFor(sessionId, ownerToken),
    },
  });
}

function doStubFor(env: Env, sessionId: string) {
  return env.MELODY_ROOM.get(env.MELODY_ROOM.idFromName(sessionId));
}

async function proxyGetState(env: Env, sessionId: string): Promise<Response> {
  return doStubFor(env, sessionId).fetch(`${DO_BASE}/state`);
}

async function proxyPostState(
  req: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const cookie = parseOwnerCookie(req.headers.get('cookie'));
  if (cookie === null) {
    return new Response('forbidden', { status: 403 });
  }
  // Body is forwarded raw; the DO re-parses with its own validation rules.
  const body = await req.arrayBuffer();
  return doStubFor(env, sessionId).fetch(`${DO_BASE}/state`, {
    method: 'POST',
    headers: {
      'Content-Type': req.headers.get('content-type') ?? 'application/json',
      'X-Owner-Token': cookie,
    },
    body,
  });
}

async function proxyEvents(env: Env, sessionId: string): Promise<Response> {
  // Return the streaming Response as-is so the SSE body isn't buffered.
  return doStubFor(env, sessionId).fetch(`${DO_BASE}/events`);
}

async function serveTrack(
  env: Env,
  trackId: string,
): Promise<Response> {
  const track = await getTrack(env.CATALOG, trackId);
  if (track === null || track.r2_key === null) {
    return new Response('not found', { status: 404 });
  }
  const obj = await env.AUDIO.get(track.r2_key);
  if (obj === null) {
    return new Response('not found', { status: 404 });
  }
  const headers: Record<string, string> = {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  if (typeof obj.size === 'number') {
    headers['Content-Length'] = String(obj.size);
  }
  return new Response(obj.body, { status: 200, headers });
}

// HTMLRewriter handler that appends the per-session meta tag into <head>.
class InjectSessionId {
  constructor(private readonly sessionId: string) {}
  element(el: Element): void {
    el.append(`<meta name="session-id" content="${this.sessionId}">`, {
      html: true,
    });
  }
}

function placeholderShell(sessionId: string): Response {
  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="session-id" content="${sessionId}"></head>` +
    `<body>placeholder</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function servePageShell(
  req: Request,
  env: Env,
  sessionId: string,
  assetName: 'host.html' | 'display.html',
): Promise<Response> {
  const assetUrl = new URL(req.url);
  assetUrl.pathname = `/${assetName}`;
  const assetReq = new Request(assetUrl.toString(), { method: 'GET' });
  const assetRes = await env.ASSETS.fetch(assetReq);
  if (assetRes.status !== 200) {
    return placeholderShell(sessionId);
  }
  return new HTMLRewriter()
    .on('head', new InjectSessionId(sessionId))
    .transform(assetRes);
}

async function handleSessionScoped(
  req: Request,
  env: Env,
  sessionId: string,
  rest: string,
): Promise<Response> {
  if (req.method === 'GET' && rest === '/qr.svg') {
    return handleQr(req, sessionId);
  }
  if (req.method === 'GET' && rest === '/api/state') {
    return proxyGetState(env, sessionId);
  }
  if (req.method === 'POST' && rest === '/api/state') {
    return proxyPostState(req, env, sessionId);
  }
  if (req.method === 'GET' && rest === '/api/events') {
    return proxyEvents(env, sessionId);
  }
  const trackMatch = req.method === 'GET' ? TRACK_PATH_RE.exec(rest) : null;
  if (trackMatch && trackMatch[1]) {
    return serveTrack(env, decodeURIComponent(trackMatch[1]));
  }
  if (req.method === 'GET' && (rest === '' || rest === '/')) {
    return servePageShell(req, env, sessionId, 'host.html');
  }
  if (req.method === 'GET' && (rest === '/display' || rest === '/display.html')) {
    return servePageShell(req, env, sessionId, 'display.html');
  }
  return new Response('not found', { status: 404 });
}

export async function route(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === '/api/session') {
    return handleSessionCreate(req, env);
  }

  if (path === '/api/genres') {
    return handleGenresPublic(req, env);
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    return handleAdmin(req, env, ctx);
  }

  const sessionMatch = SESSION_PATH_RE.exec(path);
  if (sessionMatch) {
    const sessionId = sessionMatch[1]!;
    const rest = sessionMatch[2] ?? '';
    return handleSessionScoped(req, env, sessionId, rest);
  }

  // Any non-session /api/* path is reserved.
  if (path.startsWith('/api/')) {
    return new Response('not found', { status: 404 });
  }

  return env.ASSETS.fetch(req);
}
