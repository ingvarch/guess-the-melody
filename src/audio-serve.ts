// Shared R2 audio serving. Correct Content-Type comes from the object's
// stored httpMetadata; ETag, Accept-Ranges and 206 responses are required for
// browsers to treat the endpoint as a seekable media source (Safari refuses
// media from servers that ignore ranges).
//
// R2 range semantics, verified against miniflare's R2 simulator: passing the
// request Headers as `range` makes R2 parse it and expose the resolved window
// as `obj.range`. Suffix ranges arrive pre-resolved to offset/length; an
// out-of-bounds or unparseable Range falls back to the full extent. Production
// R2 is a separate implementation and may reject such ranges instead, so the
// get is still guarded: a rejected range degrades to 416, never a 500.

export interface ServeAudioOpts {
  cacheControl: string;
}

export async function serveR2Audio(
  req: Request,
  bucket: R2Bucket,
  key: string,
  opts: ServeAudioOpts,
): Promise<Response> {
  const rangeHeader = req.headers.get('range');
  let obj: R2ObjectBody | null;
  try {
    obj = await bucket.get(
      key,
      rangeHeader === null ? undefined : { range: req.headers },
    );
  } catch {
    return new Response('range not satisfiable', { status: 416 });
  }
  if (obj === null) return new Response('not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'audio/mpeg');
  headers.set('Cache-Control', opts.cacheControl);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('ETag', obj.httpEtag);

  const range = rangeHeader === null ? null : resolveRange(obj.range, obj.size);
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${obj.size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

// R2 resolves the parsed Range header into obj.range; turn it back into
// absolute bounds for the Content-Range header.
function resolveRange(
  r: R2Range | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!r) return null;
  if ('suffix' in r && r.suffix !== undefined) {
    return { start: Math.max(0, size - r.suffix), end: size - 1 };
  }
  const offset = 'offset' in r && r.offset !== undefined ? r.offset : 0;
  const length = 'length' in r && r.length !== undefined ? r.length : size - offset;
  return { start: offset, end: offset + length - 1 };
}
