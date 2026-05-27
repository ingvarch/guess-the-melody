import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  formatResult,
  readUrlsFile,
  importOne,
} from '../../src/cli/import.ts';

test('parseArgs: --genre rock URL', () => {
  const out = parseArgs(['--genre', 'rock', 'https://music.apple.com/x?i=1']);
  assert.equal(out.genre, 'rock');
  assert.deepEqual(out.urls, ['https://music.apple.com/x?i=1']);
  assert.equal(out.itunesIdOverride, undefined);
  assert.equal(out.file, undefined);
});

test('parseArgs: --genre rock --itunes-id 123 URL', () => {
  const out = parseArgs(['--genre', 'rock', '--itunes-id', '123', 'https://music.apple.com/x?i=1']);
  assert.equal(out.itunesIdOverride, 123);
});

test('parseArgs: --genre rock --file path', () => {
  const out = parseArgs(['--genre', 'rock', '--file', 'urls.txt']);
  assert.equal(out.file, 'urls.txt');
  assert.deepEqual(out.urls, []);
});

test('parseArgs: missing --genre throws', () => {
  assert.throws(() => parseArgs(['https://music.apple.com/x?i=1']), /genre/i);
});

test('parseArgs: no URL and no --file throws', () => {
  assert.throws(() => parseArgs(['--genre', 'rock']), /url|file/i);
});

test('parseArgs: --itunes-id with non-numeric throws', () => {
  assert.throws(
    () => parseArgs(['--genre', 'rock', '--itunes-id', 'abc', 'https://music.apple.com/x?i=1']),
    /itunes-id/i,
  );
});

test('parseArgs: unknown flag throws', () => {
  assert.throws(
    () => parseArgs(['--gnere', 'rock', 'https://music.apple.com/x?i=1']),
    /unknown flag/i,
  );
});

test('parseArgs: duplicate --genre throws', () => {
  assert.throws(
    () => parseArgs(['--genre', 'rock', '--genre', 'pop', 'https://music.apple.com/x?i=1']),
    /duplicate|--genre/i,
  );
});

test('parseArgs: duplicate --file throws', () => {
  assert.throws(
    () => parseArgs(['--genre', 'rock', '--file', 'a.txt', '--file', 'b.txt']),
    /duplicate|--file/i,
  );
});

test('parseArgs: duplicate --itunes-id throws', () => {
  assert.throws(
    () =>
      parseArgs([
        '--genre',
        'rock',
        '--itunes-id',
        '1',
        '--itunes-id',
        '2',
        'https://music.apple.com/x?i=1',
      ]),
    /duplicate|--itunes-id/i,
  );
});

test('parseArgs: --itunes-id with 0 throws', () => {
  assert.throws(
    () => parseArgs(['--genre', 'rock', '--itunes-id', '0', 'https://music.apple.com/x?i=1']),
    /itunes-id/i,
  );
});

test('parseArgs: --itunes-id with negative throws', () => {
  assert.throws(
    () => parseArgs(['--genre', 'rock', '--itunes-id', '-5', 'https://music.apple.com/x?i=1']),
    /itunes-id/i,
  );
});

test('parseArgs: --itunes-id with mixed alphanumeric throws', () => {
  assert.throws(
    () => parseArgs(['--genre', 'rock', '--itunes-id', '12abc', 'https://music.apple.com/x?i=1']),
    /itunes-id/i,
  );
});

test('formatResult: success', () => {
  const line = formatResult({
    ok: true,
    id: 'abc',
    artist: 'Queen',
    title: 'Radio Ga Ga',
    year: 1984,
  });
  assert.match(line, /^OK abc Queen - Radio Ga Ga \(1984\)$/);
});

test('formatResult: error', () => {
  const line = formatResult({ ok: false, code: 'duplicate', body: { existingId: 'xyz' } });
  assert.match(line, /^ERR duplicate/);
  assert.match(line, /existingId/);
});

test('readUrlsFile: skips blanks and # comments, dedupes, trims', async () => {
  const path = new URL('../fixtures/urls.txt', import.meta.url).pathname;
  const urls = await readUrlsFile(path);
  assert.deepEqual(urls, [
    'https://music.apple.com/us/album/foo/1?i=111',
    'https://music.apple.com/us/album/bar/2?i=222',
  ]);
});

test('importOne: success path', async () => {
  const fetchFn = async (url, init) => {
    assert.equal(url, 'http://base/admin/api/import');
    assert.equal(init.method, 'POST');
    assert.match(init.headers.authorization, /^Basic /);
    const body = JSON.parse(init.body);
    assert.equal(body.url, 'https://music.apple.com/x?i=1');
    assert.equal(body.genreSlug, 'rock');
    return new Response(
      JSON.stringify({ id: 'idx', artist: 'A', title: 'T', year: 2020 }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    );
  };
  const out = await importOne(fetchFn, 'http://base', 'pw', 'rock', 'https://music.apple.com/x?i=1');
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.id, 'idx');
    assert.equal(out.artist, 'A');
    assert.equal(out.title, 'T');
    assert.equal(out.year, 2020);
  }
});

test('importOne: 409 ambiguous returns error with body', async () => {
  const fetchFn = async () =>
    new Response(JSON.stringify({ code: 'ambiguous', candidates: [{ x: 1 }] }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
  const out = await importOne(fetchFn, 'http://base', 'pw', 'rock', 'https://x');
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, 'ambiguous');
    assert.deepEqual(out.body, { code: 'ambiguous', candidates: [{ x: 1 }] });
  }
});

test('importOne: 400 returns error', async () => {
  const fetchFn = async () =>
    new Response(JSON.stringify({ code: 'bad_url', message: 'nope' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  const out = await importOne(fetchFn, 'http://base', 'pw', 'rock', 'https://x');
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, 'bad_url');
  }
});

test('importOne: network error returns ok=false with code=network', async () => {
  const fetchFn = async () => {
    throw new Error('connection refused');
  };
  const out = await importOne(fetchFn, 'http://base', 'pw', 'rock', 'https://x');
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, 'network');
    assert.match(JSON.stringify(out.body), /connection refused/);
  }
});

test('importOne: includes itunesIdOverride when provided', async () => {
  let captured;
  const fetchFn = async (_url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'i', artist: 'a', title: 't', year: 2000 }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  await importOne(fetchFn, 'http://base', 'pw', 'rock', 'https://x', 999);
  assert.equal(captured.itunesIdOverride, 999);
});
