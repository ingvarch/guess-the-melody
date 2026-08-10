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

  it('answers a bytes range with 206 and Content-Range', async () => {
    await put('audio/mpeg');
    const res = await serveR2Audio(req({ Range: 'bytes=2-5' }), testEnv.AUDIO, KEY, {
      cacheControl: 'public, max-age=1',
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 2-5/${BODY.byteLength}`);
    expect(res.headers.get('Content-Length')).toBe('4');
    const got = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(got)).toEqual([2, 3, 4, 5]);
  });

  it('answers an open-ended range with 206 to the end', async () => {
    await put('audio/mpeg');
    const res = await serveR2Audio(req({ Range: 'bytes=6-' }), testEnv.AUDIO, KEY, {
      cacheControl: 'public, max-age=1',
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 6-9/${BODY.byteLength}`);
  });

  it('answers a suffix range with 206', async () => {
    await put('audio/mpeg');
    const res = await serveR2Audio(req({ Range: 'bytes=-3' }), testEnv.AUDIO, KEY, {
      cacheControl: 'public, max-age=1',
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 7-9/${BODY.byteLength}`);
  });

  // Runtime contract, verified against workerd's R2: an out-of-bounds or
  // unparseable Range is never an error — R2 ignores it and resolves to the
  // full extent ({offset:0,length:size}). No 416 is reachable without
  // re-parsing the header, so the helper serves what R2 resolved.
  it('serves the full extent when the range is out of bounds', async () => {
    await put('audio/mpeg');
    const res = await serveR2Audio(req({ Range: 'bytes=100-200' }), testEnv.AUDIO, KEY, {
      cacheControl: 'public, max-age=1',
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-9/${BODY.byteLength}`);
    const got = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(got)).toEqual(Array.from(BODY));
  });

  it('serves the full extent when the range header is unparseable', async () => {
    await put('audio/mpeg');
    const res = await serveR2Audio(req({ Range: 'bytes=garbage' }), testEnv.AUDIO, KEY, {
      cacheControl: 'public, max-age=1',
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-9/${BODY.byteLength}`);
  });
});
