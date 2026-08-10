// Shared R2 audio serving. Correct Content-Type comes from the object's
// stored httpMetadata; ETag and Accept-Ranges are required for browsers to
// treat the endpoint as a seekable media source (Safari refuses media from
// servers that ignore ranges — Range handling itself lands in Task 2).

export interface ServeAudioOpts {
  cacheControl: string;
}

export async function serveR2Audio(
  _req: Request,
  bucket: R2Bucket,
  key: string,
  opts: ServeAudioOpts,
): Promise<Response> {
  const obj = await bucket.get(key);
  if (obj === null) return new Response('not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'audio/mpeg');
  headers.set('Cache-Control', opts.cacheControl);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('ETag', obj.httpEtag);
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
