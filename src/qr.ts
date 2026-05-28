// Server-rendered QR code for the session display URL.
// Uses qrcode-svg (lightweight, no canvas dependency).

import QRCode from 'qrcode-svg';

export function generateQrSvg(displayUrl: string): string {
  const qr = new QRCode({
    content: displayUrl,
    padding: 2,
    width: 256,
    height: 256,
    color: '#000000',
    background: '#ffffff',
    ecl: 'M',
    join: true,
  });
  return qr.svg();
}

export async function handleQr(req: Request, sessionId: string): Promise<Response> {
  const url = new URL(req.url);
  const displayUrl = `${url.origin}/s/${sessionId}/display`;
  const svg = generateQrSvg(displayUrl);
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
