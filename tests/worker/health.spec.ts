import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('Worker root', () => {
  it('serves the landing page on /', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/html/);
    const body = await res.text();
    expect(body).toContain('Guess The Melody');
  });

  it('returns 404 for /api/* unknown path', async () => {
    const res = await SELF.fetch('http://localhost/api/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for /s/* unknown path', async () => {
    const res = await SELF.fetch('http://localhost/s/abc/foo');
    expect(res.status).toBe(404);
  });

  it('returns 404 for /admin', async () => {
    const res = await SELF.fetch('http://localhost/admin');
    expect(res.status).toBe(404);
  });
});
