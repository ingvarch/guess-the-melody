// R2 preview cache module. Uses the real AUDIO binding from cloudflare:test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../src/types';
import {
  deletePreviewFromR2,
  downloadPreviewToR2,
} from '../../src/importer/r2';

const testEnv = env as unknown as Env;

async function clearAudio(): Promise<void> {
  const list = await testEnv.AUDIO.list();
  for (const obj of list.objects) {
    await testEnv.AUDIO.delete(obj.key);
  }
}

function audioResponse(body: string | Uint8Array, contentType = 'audio/mpeg'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('importer/r2', () => {
  beforeEach(async () => {
    await clearAudio();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads an audio preview and stores it under tracks/<id>.mp3', async () => {
    const payload = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]); // ID3 header bytes
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(audioResponse(payload, 'audio/mpeg')),
    );

    const key = await downloadPreviewToR2(testEnv, {
      trackId: 'abc123',
      previewUrl: 'https://example.com/preview.mp3',
    });
    expect(key).toBe('tracks/abc123.mp3');

    const got = await testEnv.AUDIO.get(key);
    expect(got).not.toBeNull();
    expect(got?.httpMetadata?.contentType).toBe('audio/mpeg');

    const stored = new Uint8Array(await got!.arrayBuffer());
    expect(Array.from(stored)).toEqual(Array.from(payload));
  });

  it('accepts audio/mp4 (iTunes m4a previews)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(audioResponse('x', 'audio/mp4')),
    );

    const key = await downloadPreviewToR2(testEnv, {
      trackId: 'id1',
      previewUrl: 'https://example.com/preview.m4a',
    });
    expect(key).toBe('tracks/id1.mp3');
    const got = await testEnv.AUDIO.get(key);
    expect(got).not.toBeNull();
    // Body 'x' is unsniffable, so the response header is the fallback.
    expect(got?.httpMetadata?.contentType).toBe('audio/mp4');
  });

  it('stores audio/mp4 when the downloaded bytes are an MP4 container', async () => {
    const m4a = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(audioResponse(m4a, 'audio/x-m4a')),
    );

    const key = await downloadPreviewToR2(testEnv, {
      trackId: 'id-m4a',
      previewUrl: 'https://example.com/preview.m4a',
    });
    const got = await testEnv.AUDIO.get(key);
    expect(got?.httpMetadata?.contentType).toBe('audio/mp4');
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 404 })),
    );
    await expect(
      downloadPreviewToR2(testEnv, {
        trackId: 'id1',
        previewUrl: 'https://example.com/preview.mp3',
      }),
    ).rejects.toThrow();
  });

  it('throws when content-type is not audio/*', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html/>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })),
    );
    await expect(
      downloadPreviewToR2(testEnv, {
        trackId: 'id1',
        previewUrl: 'https://example.com/preview.mp3',
      }),
    ).rejects.toThrow();
  });

  it('deletePreviewFromR2 removes the object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(audioResponse('hello', 'audio/mpeg')),
    );

    const key = await downloadPreviewToR2(testEnv, {
      trackId: 'id-del',
      previewUrl: 'https://example.com/p.mp3',
    });
    expect(await testEnv.AUDIO.get(key)).not.toBeNull();

    await deletePreviewFromR2(testEnv, key);
    expect(await testEnv.AUDIO.get(key)).toBeNull();
  });
});
