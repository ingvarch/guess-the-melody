import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBasicAuth, basicAuthChallenge } from '../../src/auth.ts';

test('checkBasicAuth: accepts correct password', () => {
  const header = 'Basic ' + btoa('admin:hunter2');
  assert.equal(checkBasicAuth(header, 'hunter2'), true);
});

test('checkBasicAuth: rejects wrong password', () => {
  const header = 'Basic ' + btoa('admin:wrong');
  assert.equal(checkBasicAuth(header, 'hunter2'), false);
});

test('checkBasicAuth: rejects missing header', () => {
  assert.equal(checkBasicAuth(null, 'hunter2'), false);
});

test('checkBasicAuth: rejects malformed header', () => {
  assert.equal(checkBasicAuth('Bearer abc', 'hunter2'), false);
  assert.equal(checkBasicAuth('Basic not-base64!!', 'hunter2'), false);
  assert.equal(checkBasicAuth('Basic ' + btoa('no-colon'), 'hunter2'), false);
});

test('checkBasicAuth: rejects empty password mismatch', () => {
  assert.equal(checkBasicAuth('Basic ' + btoa('admin:'), 'hunter2'), false);
});

test('checkBasicAuth: constant-time on equal-length mismatches (not exposed but doesnt throw)', () => {
  const header = 'Basic ' + btoa('admin:xxxxxxx');
  assert.equal(checkBasicAuth(header, 'yyyyyyy'), false);
});

test('basicAuthChallenge: 401 with WWW-Authenticate', () => {
  const r = basicAuthChallenge();
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('WWW-Authenticate'), 'Basic realm="admin"');
});
