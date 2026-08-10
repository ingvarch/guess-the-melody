// serveR2Audio: shared helper behind both the session track route and the
// admin preview route. Runs against the real R2 binding in the workers pool.

import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../src/types';
import { serveR2Audio } from '../../src/audio-serve';

const testEnv = env as unknown as Env;

const KEY = 'tracks/spec-audio.mp3';
const BODY = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

async function put(contentType: string): Promise<void> {
  await testEnv.AUDIO.put(KEY, BODY, { httpMetadata: { contentType } });
}

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/audio', { headers });
}

describe('serveR2Audio', () => {
  beforeEach(async () => {
    await testEnv.AUDIO.delete(KEY);
  });

  it('serves the stored content type with ETag and Accept-Ranges', async () => {
    await put('audio/mp4');
    const res = await serveR2Audio(req(), testEnv.AUDIO, KEY, {
      cacheControl: 'public, max-age=1',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mp4');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('ETag')).toBeTruthy();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=1');
    expect(res.headers.get('Content-Length')).toBe(String(BODY.byteLength));
    const got = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(got)).toEqual(Array.from(BODY));
  });

  it('falls back to audio/mpeg when the object has no stored content type', async () => {
    await testEnv.AUDIO.put(KEY, BODY);
    const res = await serveR2Audio(req(), testEnv.AUDIO, KEY, {
      cacheControl: 'public, max-age=1',
    });
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('returns 404 for a missing key', async () => {
    const res = await serveR2Audio(req(), testEnv.AUDIO, 'tracks/nope.mp3', {
      cacheControl: 'public, max-age=1',
    });
    expect(res.status).toBe(404);
  });
});
