import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  describeResult,
  formatLogLine,
  nowHHMMSS,
  classifyLine,
  markDoneLine,
  runFile,
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

test('parseArgs: --country RU is parsed', () => {
  const out = parseArgs(['--genre', 'russian-rock', '--country', 'RU', '--file', 'l.txt']);
  assert.equal(out.country, 'RU');
});

test('parseArgs: country undefined when not given', () => {
  const out = parseArgs(['--genre', 'rock', '--file', 'l.txt']);
  assert.equal(out.country, undefined);
});

test('parseArgs: duplicate --country throws', () => {
  assert.throws(
    () => parseArgs(['--genre', 'rock', '--country', 'RU', '--country', 'US', '--file', 'l.txt']),
    /duplicate|--country/i,
  );
});

test('parseArgs: --delay parses a non-negative integer', () => {
  const out = parseArgs(['--genre', 'rock', '--delay', '750', '--file', 'l.txt']);
  assert.equal(out.delayMs, 750);
});

test('parseArgs: --delay 0 is allowed', () => {
  const out = parseArgs(['--genre', 'rock', '--delay', '0', '--file', 'l.txt']);
  assert.equal(out.delayMs, 0);
});

test('parseArgs: --delay with non-numeric throws', () => {
  assert.throws(
    () => parseArgs(['--genre', 'rock', '--delay', 'abc', '--file', 'l.txt']),
    /delay/i,
  );
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

test('describeResult: success → ok level with id/artist/title/year body', () => {
  const d = describeResult({ ok: true, id: 'abc', artist: 'Queen', title: 'Radio Ga Ga', year: 1984 });
  assert.equal(d.level, 'ok');
  assert.equal(d.body, 'abc Queen - Radio Ga Ga (1984)');
});

test('describeResult: duplicate → dup level', () => {
  const d = describeResult({ ok: false, code: 'duplicate', body: { existingId: 'xyz' } });
  assert.equal(d.level, 'dup');
});

test('describeResult: other error → err level with code and body', () => {
  const d = describeResult({ ok: false, code: 'no_preview', body: { message: 'nope' } });
  assert.equal(d.level, 'err');
  assert.match(d.body, /no_preview/);
  assert.match(d.body, /nope/);
});

test('nowHHMMSS: zero-pads hours, minutes, seconds', () => {
  assert.equal(nowHHMMSS(new Date(2026, 4, 31, 9, 5, 3)), '09:05:03');
});

test('nowHHMMSS: handles two-digit components', () => {
  assert.equal(nowHHMMSS(new Date(2026, 4, 31, 23, 59, 48)), '23:59:48');
});

test('formatLogLine: plain (no color) has timestamp and bracketed tag', () => {
  assert.equal(formatLogLine('ok', 'hello', { time: '12:00:00', color: false }), '[12:00:00] [OK] hello');
});

test('formatLogLine: color wraps the tag in green for ok', () => {
  const line = formatLogLine('ok', 'hi', { time: '12:00:00', color: true });
  assert.match(line, /\x1b\[32m\[OK\]\x1b\[0m/);
});

test('formatLogLine: skip tag is orange', () => {
  const line = formatLogLine('skip', 'x', { time: '00:00:00', color: true });
  assert.match(line, /\x1b\[33m\[SKIP\]\x1b\[0m/);
});

test('formatLogLine: err tag is red', () => {
  const line = formatLogLine('err', 'x', { time: '00:00:00', color: true });
  assert.match(line, /\x1b\[31m\[ERR\]\x1b\[0m/);
});

test('classifyLine: blank line', () => {
  assert.deepEqual(classifyLine('   '), { status: 'blank', text: '' });
});

test('classifyLine: comment line', () => {
  assert.deepEqual(classifyLine('# a comment'), { status: 'comment', text: '# a comment' });
});

test('classifyLine: track line is trimmed', () => {
  assert.deepEqual(classifyLine('  Кино — Группа крови '), {
    status: 'track',
    text: 'Кино — Группа крови',
  });
});

test('classifyLine: done marker extracts the original text', () => {
  assert.deepEqual(classifyLine('#done Кино — Группа крови'), {
    status: 'done',
    text: 'Кино — Группа крови',
  });
});

test('classifyLine: done marker is case-insensitive', () => {
  assert.deepEqual(classifyLine('#DONE Queen - Bohemian Rhapsody'), {
    status: 'done',
    text: 'Queen - Bohemian Rhapsody',
  });
});

test('markDoneLine: round-trips through classifyLine', () => {
  const line = markDoneLine('Кино — Группа крови');
  assert.equal(classifyLine(line).status, 'done');
  assert.equal(classifyLine(line).text, 'Кино — Группа крови');
});

test('runFile: skips done lines without importing, logs skip message', async () => {
  const calls = [];
  const logs = [];
  const importLine = async (text) => {
    calls.push(text);
    return { ok: true, id: 'i', artist: 'a', title: text, year: 2000 };
  };
  const { newLines, failures } = await runFile(
    ['#done Кино — Группа крови', '# header', ''],
    importLine,
    (_level, m) => logs.push(m),
  );
  assert.deepEqual(calls, []);
  assert.equal(failures, 0);
  assert.deepEqual(newLines, ['#done Кино — Группа крови', '# header', '']);
  assert.match(logs[0], /пропускаем/);
});

test('runFile: marks ok and duplicate as done, leaves errors pending', async () => {
  const logs = [];
  const importLine = async (text) => {
    if (text === 'A — ok') return { ok: true, id: 'i', artist: 'A', title: 'ok', year: 2000 };
    if (text === 'B — dup') return { ok: false, code: 'duplicate', body: { existingId: 'x' } };
    return { ok: false, code: 'no_preview', body: {} };
  };
  const { newLines, failures } = await runFile(
    ['A — ok', 'B — dup', 'C — fail'],
    importLine,
    (m) => logs.push(m),
  );
  assert.deepEqual(newLines, [
    markDoneLine('A — ok'),
    markDoneLine('B — dup'),
    'C — fail',
  ]);
  // only the genuine error counts as a failure; a duplicate is "already in DB".
  assert.equal(failures, 1);
});

test('runFile: persists progress after every line (interrupt-safe)', async () => {
  const snapshots = [];
  const importLine = async (text) => {
    if (text === 'B — dup') return { ok: false, code: 'duplicate', body: {} };
    return { ok: true, id: 'i', artist: 'A', title: text, year: 2000 };
  };
  await runFile(
    ['A — ok', 'B — dup', 'C — ok'],
    importLine,
    () => {},
    (lines) => snapshots.push([...lines]),
  );
  // One snapshot per input line, each reflecting progress so far.
  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots[0], [markDoneLine('A — ok'), 'B — dup', 'C — ok']);
  assert.deepEqual(snapshots[1], [markDoneLine('A — ok'), markDoneLine('B — dup'), 'C — ok']);
  assert.deepEqual(snapshots[2], [
    markDoneLine('A — ok'),
    markDoneLine('B — dup'),
    markDoneLine('C — ok'),
  ]);
});

test('runFile: persists after a skipped done line too', async () => {
  const snapshots = [];
  await runFile(
    ['#done X — y', 'A — ok'],
    async () => ({ ok: true, id: 'i', artist: 'A', title: 'ok', year: 2000 }),
    () => {},
    (lines) => snapshots.push([...lines]),
  );
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[1], ['#done X — y', markDoneLine('A — ok')]);
});

test('runFile: logs a duplicate as already-in-DB with dup level, not err', async () => {
  const events = [];
  await runFile(
    ['B — dup'],
    async () => ({ ok: false, code: 'duplicate', body: { existingId: 'x' } }),
    (level, m) => events.push([level, m]),
  );
  assert.equal(events[0][0], 'dup');
  assert.match(events[0][1], /уже в базе/);
});

test('runFile: emits ok/err/skip levels to the log callback', async () => {
  const events = [];
  const importLine = async (text) => {
    if (text === 'A — ok') return { ok: true, id: 'i', artist: 'A', title: 'ok', year: 2000 };
    return { ok: false, code: 'no_preview', body: {} };
  };
  await runFile(
    ['#done D — done', 'A — ok', 'C — fail'],
    importLine,
    (level) => events.push(level),
  );
  assert.deepEqual(events, ['skip', 'ok', 'err']);
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
  await importOne(fetchFn, 'http://base', 'pw', 'rock', 'https://x', { itunesIdOverride: 999 });
  assert.equal(captured.itunesIdOverride, 999);
});

test('importOne: sends a non-URL line as a query, not a url', async () => {
  let captured;
  const fetchFn = async (_url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'i', artist: 'a', title: 't', year: 2000 }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  await importOne(fetchFn, 'http://base', 'pw', 'russian-rock', 'Кино — Группа крови', {
    country: 'RU',
  });
  assert.equal(captured.query, 'Кино — Группа крови');
  assert.equal(captured.url, undefined);
  assert.equal(captured.country, 'RU');
  assert.equal(captured.genreSlug, 'russian-rock');
});

test('importOne: sends an http line as a url, not a query', async () => {
  let captured;
  const fetchFn = async (_url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'i', artist: 'a', title: 't', year: 2000 }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  await importOne(fetchFn, 'http://base', 'pw', 'rock', 'https://music.apple.com/x?i=1');
  assert.equal(captured.url, 'https://music.apple.com/x?i=1');
  assert.equal(captured.query, undefined);
});
