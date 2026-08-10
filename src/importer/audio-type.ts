// Container sniffing for imported previews. iTunes serves m4a (MP4/AAC),
// Spotify serves mp3; CDN Content-Type headers are not always truthful, so
// the bytes are the source of truth. Firefox picks its demuxer by MIME —
// serving AAC as audio/mpeg breaks decoding there.

const FTYP = [0x66, 0x74, 0x79, 0x70]; // 'ftyp' at offset 4 = MP4 family

export function detectAudioContentType(buf: ArrayBuffer, fallback: string): string {
  const b = new Uint8Array(buf);
  if (b.length >= 8 && FTYP.every((v, i) => b[4 + i] === v)) return 'audio/mp4';
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg'; // 'ID3'
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return 'audio/mpeg'; // frame sync
  return fallback;
}
