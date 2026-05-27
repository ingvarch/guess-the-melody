import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSessionId,
  newOwnerToken,
  ownerCookieFor,
  parseOwnerCookie,
} from '../../src/session.ts';

test('newSessionId: 10 chars, URL-safe alphabet', () => {
  const id = newSessionId();
  assert.match(id, /^[A-Za-z0-9_-]{10}$/);
});

test('newSessionId: produces different ids on each call', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(newSessionId());
  assert.equal(seen.size, 100);
});

test('newOwnerToken: 64 hex chars (32 bytes)', () => {
  const tok = newOwnerToken();
  assert.match(tok, /^[0-9a-f]{64}$/);
});

test('ownerCookieFor: HttpOnly, Secure, Path-scoped, SameSite=Strict', () => {
  const c = ownerCookieFor('ABCDEFGH12', 'token-xyz');
  assert.ok(c.startsWith('owner=token-xyz;'));
  assert.ok(c.includes('Path=/s/ABCDEFGH12/'));
  assert.ok(c.includes('HttpOnly'));
  assert.ok(c.includes('Secure'));
  assert.ok(c.includes('SameSite=Strict'));
});

test('parseOwnerCookie: extracts owner=<token>', () => {
  assert.equal(parseOwnerCookie('owner=abc123; foo=bar'), 'abc123');
  assert.equal(parseOwnerCookie('foo=bar; owner=xyz'), 'xyz');
  assert.equal(parseOwnerCookie('foo=bar'), null);
  assert.equal(parseOwnerCookie(null), null);
  assert.equal(parseOwnerCookie(''), null);
});

test('parseOwnerCookie: preserves "=" inside the value (e.g. base64 padding)', () => {
  assert.equal(parseOwnerCookie('owner=YWJjZA==; foo=bar'), 'YWJjZA==');
});

test('parseOwnerCookie: empty value yields empty string', () => {
  assert.equal(parseOwnerCookie('owner=; foo=bar'), '');
});

test('parseOwnerCookie: case-sensitive name match', () => {
  assert.equal(parseOwnerCookie('OWNER=abc'), null);
});
