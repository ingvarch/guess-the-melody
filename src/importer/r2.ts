// R2 preview cache.
//
// We never proxy iTunes preview URLs at play time — those expire and add a
// hop. Instead the importer downloads the preview once, stores it in R2 under
// `tracks/<id>.mp3`, and the runtime serves the R2 object directly.

import type { Env } from '../types';

export async function downloadPreviewToR2(
  env: Env,
  opts: { trackId: string; previewUrl: string },
): Promise<string> {
  const res = await fetch(opts.previewUrl);
  if (!res.ok) {
    throw new Error(`preview download failed: ${res.status}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('audio/')) {
    throw new Error(`preview download: unexpected content-type ${contentType}`);
  }

  const body = await res.arrayBuffer();
  const key = `tracks/${opts.trackId}.mp3`;
  await env.AUDIO.put(key, body, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });
  return key;
}

export async function deletePreviewFromR2(env: Env, r2Key: string): Promise<void> {
  await env.AUDIO.delete(r2Key);
}
