// Importer CLI.
//
// Posts to /admin/api/import on a running Worker (locally via wrangler dev
// or a deployed instance). Pure helpers (parseArgs, describeResult,
// formatLogLine, runFile, importOne) are unit-tested under bun; main()
// composes them and is intentionally thin so tests need not mock argv/stdio.

import { readFile, writeFile } from 'node:fs/promises';

export interface CliArgs {
  genre: string;
  urls: string[];
  itunesIdOverride?: number;
  file?: string;
  country?: string;
  delayMs?: number;
  verbose?: boolean;
}

export interface ImportTimings {
  itunesMs: number;
  r2Ms: number;
  dbMs: number;
}

export interface ImportSuccess {
  ok: true;
  id: string;
  artist: string;
  title: string;
  year: number;
  // Absent when the worker predates the timings field.
  timings?: ImportTimings;
}

export interface ImportFailure {
  ok: false;
  code: string;
  body: unknown;
}

export type ImportResult = ImportSuccess | ImportFailure;

const KNOWN_FLAGS = new Set([
  '--genre', '--itunes-id', '--file', '--country', '--delay', '--verbose', '-v',
]);
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INT_RE = /^[0-9]+$/;

export function parseArgs(argv: string[]): CliArgs {
  let genre: string | undefined;
  let itunesIdOverride: number | undefined;
  let file: string | undefined;
  let country: string | undefined;
  let delayMs: number | undefined;
  let verbose = false;
  const urls: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--genre') {
      if (genre !== undefined) throw new Error('duplicate --genre');
      genre = argv[++i];
    } else if (a === '--country') {
      if (country !== undefined) throw new Error('duplicate --country');
      country = argv[++i];
    } else if (a === '--verbose' || a === '-v') {
      verbose = true;
    } else if (a === '--delay') {
      if (delayMs !== undefined) throw new Error('duplicate --delay');
      const raw = argv[++i];
      if (raw === undefined || !NON_NEGATIVE_INT_RE.test(raw)) {
        throw new Error(`--delay requires a non-negative integer (ms), got: ${raw}`);
      }
      delayMs = Number.parseInt(raw, 10);
    } else if (a === '--itunes-id') {
      if (itunesIdOverride !== undefined) throw new Error('duplicate --itunes-id');
      const raw = argv[++i];
      if (raw === undefined || !POSITIVE_INT_RE.test(raw)) {
        throw new Error(
          `--itunes-id requires a positive integer, got: ${raw}`,
        );
      }
      itunesIdOverride = Number.parseInt(raw, 10);
    } else if (a === '--file') {
      if (file !== undefined) throw new Error('duplicate --file');
      file = argv[++i];
    } else if (a !== undefined && a.startsWith('-')) {
      if (!KNOWN_FLAGS.has(a)) throw new Error(`unknown flag: ${a}`);
    } else if (a !== undefined) {
      urls.push(a);
    }
  }

  if (!genre) throw new Error('--genre is required');
  if (!file && urls.length === 0) {
    throw new Error('provide at least one URL or --file <path>');
  }

  const out: CliArgs = { genre, urls };
  if (itunesIdOverride !== undefined) out.itunesIdOverride = itunesIdOverride;
  if (file !== undefined) out.file = file;
  if (country !== undefined) out.country = country;
  if (delayMs !== undefined) out.delayMs = delayMs;
  if (verbose) out.verbose = true;
  return out;
}

// A list file mixes blank lines, `#` comments, pending track queries, and
// `#done <text>` markers written back after a track lands in the catalogue.
export type LineStatus = 'blank' | 'comment' | 'done' | 'track';
export interface ClassifiedLine {
  status: LineStatus;
  text: string;
}

const DONE_RE = /^#done\s+(.*)$/i;

export function classifyLine(line: string): ClassifiedLine {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { status: 'blank', text: '' };
  const done = DONE_RE.exec(trimmed);
  if (done) return { status: 'done', text: done[1]!.trim() };
  if (trimmed.startsWith('#')) return { status: 'comment', text: trimmed };
  return { status: 'track', text: trimmed };
}

export function markDoneLine(text: string): string {
  return `#done ${text}`;
}

export type LevelCounts = Record<LogLevel, number>;

// Walks a list file's lines: imports each pending track, skips lines already
// marked done, and returns the rewritten lines (done markers added for tracks
// now in the catalogue), the count of genuine failures, and per-level counts
// for the summary. A duplicate is not a failure — the track is already in the
// DB, so it gets marked done too.
//
// `log` receives a level (for colouring/tagging at the call site) plus a
// human message. `persist` is called after every line with the progress so
// far, so an interrupted run (Ctrl-C mid-import) keeps the markers earned.
export async function runFile(
  lines: string[],
  importLine: (text: string) => Promise<ImportResult>,
  log: (level: LogLevel, message: string) => void,
  persist?: (lines: string[]) => void | Promise<void>,
): Promise<{ newLines: string[]; failures: number; counts: LevelCounts }> {
  // Seed with the input so a snapshot taken at any point is the full file.
  const newLines = [...lines];
  const counts: LevelCounts = { ok: 0, skip: 0, dup: 0, err: 0 };
  let failures = 0;
  for (let i = 0; i < lines.length; i++) {
    const c = classifyLine(lines[i]!);
    if (c.status === 'blank' || c.status === 'comment') {
      if (persist) await persist(newLines);
      continue;
    }
    if (c.status === 'done') {
      log('skip', `уже в базе, пропускаем: ${c.text}`);
      counts.skip += 1;
      if (persist) await persist(newLines);
      continue;
    }
    const result = await importLine(c.text);
    const d = describeResult(result, c.text);
    const inDb = result.ok || result.code === 'duplicate';
    if (inDb) {
      log(d.level, result.ok ? d.body : `уже в базе: ${c.text}`);
      newLines[i] = markDoneLine(c.text);
    } else {
      log(d.level, d.body);
      failures += 1;
    }
    counts[d.level] += 1;
    if (persist) await persist(newLines);
  }
  return { newLines, failures, counts };
}

// Log levels drive the coloured tag shown to the user.
//   ok   → ✔ green   — imported a new track
//   skip → ↷ orange  — line already #done, no HTTP call
//   dup  → ⊘ orange  — track already in the catalogue
//   err  → ✖ red     — genuine failure
export type LogLevel = 'ok' | 'skip' | 'dup' | 'err';

// Indent of the breakdown line: past the "[HH:MM:SS] ✔ " prefix.
const BREAKDOWN_INDENT = ' '.repeat(13);

function breakdown(t: ImportTimings): string {
  return `\n${BREAKDOWN_INDENT}└─ itunes ${t.itunesMs}ms · r2 ${t.r2Ms}ms · db ${t.dbMs}ms`;
}

// Maps an import result to a level + a human body (no timestamp/tag).
// `text` is the source line. A failure has no artist/title to report, so
// without it the log says what went wrong but not to which track.
export function describeResult(
  r: ImportResult,
  text?: string,
): { level: LogLevel; body: string } {
  if (r.ok) {
    const head = `${r.id} ${r.artist} - ${r.title} (${r.year})`;
    return { level: 'ok', body: r.timings ? head + breakdown(r.timings) : head };
  }
  if (r.code === 'duplicate') return { level: 'dup', body: JSON.stringify(r.body) };
  const where = text === undefined ? '' : `${text} — `;
  return { level: 'err', body: `${where}${r.code} ${JSON.stringify(r.body)}` };
}

const TAG: Record<LogLevel, string> = { ok: '✔', skip: '↷', dup: '⊘', err: '✖' };
// ANSI: green / orange (bright yellow) / red. Tag only — message stays default.
const COLOR: Record<LogLevel, string> = { ok: '32', skip: '33', dup: '33', err: '31' };

export function nowHHMMSS(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Braille spinner: same cell width in every frame, so the line never jitters.
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spinnerFrame(tick: number): string {
  return SPINNER_FRAMES[((tick % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) %
    SPINNER_FRAMES.length]!;
}

// The transient in-flight line, rewritten in place while the worker works.
export function formatProgressLine(
  text: string,
  elapsedMs: number,
  tick: number,
  opts: { time: string; color: boolean },
): string {
  const frame = spinnerFrame(tick);
  const painted = opts.color ? `\x1b[36m${frame}\x1b[0m` : frame;
  const secs = (elapsedMs / 1000).toFixed(1);
  return `[${opts.time}] ${painted} ${text}  ${secs}s`;
}

export function formatLogLine(
  level: LogLevel,
  message: string,
  opts: { time: string; color: boolean },
): string {
  const tag = TAG[level];
  const painted = opts.color ? `\x1b[${COLOR[level]}m${tag}\x1b[0m` : tag;
  return `[${opts.time}] ${painted} ${message}`;
}

// ok/err always print; skip/dup ("уже в базе") are noise on a re-run and only
// show with --verbose.
export function shouldShow(level: LogLevel, verbose: boolean): boolean {
  if (level === 'ok' || level === 'err') return true;
  return verbose;
}

export function formatStats(counts: LevelCounts): string {
  return `Итого: загружено ${counts.ok}, пропущено ${counts.skip}, дубликатов ${counts.dup}, ошибок ${counts.err}`;
}

const HTTP_RE = /^https?:\/\//i;

export async function importOne(
  fetchFn: typeof fetch,
  baseUrl: string,
  password: string,
  genre: string,
  line: string,
  opts?: { itunesIdOverride?: number; country?: string },
): Promise<ImportResult> {
  // A URL resolves directly; anything else is a free-text "Artist — Title" query.
  const body: Record<string, unknown> = HTTP_RE.test(line)
    ? { url: line, genreSlug: genre }
    : { query: line, genreSlug: genre };
  if (opts?.itunesIdOverride !== undefined) body.itunesIdOverride = opts.itunesIdOverride;
  if (opts?.country !== undefined) body.country = opts.country;

  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/admin/api/import`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + btoa(`admin:${password}`),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, code: 'network', body: { message } };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, code: 'bad_response', body: { status: res.status } };
  }

  if (res.status === 201 && parsed && typeof parsed === 'object' && 'id' in parsed) {
    const p = parsed as {
      id: string;
      artist: string;
      title: string;
      year: number;
      timings?: ImportTimings;
    };
    const out: ImportSuccess = {
      ok: true,
      id: p.id,
      artist: p.artist,
      title: p.title,
      year: p.year,
    };
    if (p.timings) out.timings = p.timings;
    return out;
  }
  const code =
    parsed && typeof parsed === 'object' && 'code' in parsed
      ? String((parsed as { code: unknown }).code)
      : `http_${res.status}`;
  return { ok: false, code, body: parsed };
}

export async function main(deps?: { fetchFn?: typeof fetch }): Promise<number> {
  const fetchFn = deps?.fetchFn ?? fetch;
  const baseUrl = process.env.ADMIN_BASE_URL ?? 'http://localhost:8787';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    process.stderr.write('ADMIN_PASSWORD env var is required\n');
    return 1;
  }

  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return 1;
  }

  const importOpts: { itunesIdOverride?: number; country?: string } = {};
  if (args.itunesIdOverride !== undefined) importOpts.itunesIdOverride = args.itunesIdOverride;
  if (args.country !== undefined) importOpts.country = args.country;

  // Pace requests to stay under iTunes' ~20 req/min throttle. The server also
  // backs off on 429, but pacing avoids most retries in the first place. Lines
  // already marked done skip the HTTP call entirely, so they cost no delay.
  const delayMs = args.delayMs ?? 500;
  let pendingCalls = 0;
  const paced = async (text: string): Promise<ImportResult> => {
    if (pendingCalls > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    pendingCalls += 1;
    return spin(text, () =>
      importOne(fetchFn, baseUrl, password, args.genre, text, importOpts),
    );
  };

  // Colour only when stdout is a TTY; piped/redirected output stays plain.
  const color = process.stdout.isTTY === true;
  const verbose = args.verbose === true;

  // Live progress goes to stderr so `… | tee log` keeps a clean result log and
  // still shows the spinner. Skipped unless stderr is a TTY: the line is
  // rewritten in place, which turns into thousands of junk lines in a file.
  const spinner = process.stderr.isTTY === true;
  const spin = async (text: string, run: () => Promise<ImportResult>): Promise<ImportResult> => {
    if (!spinner) return run();
    const started = Date.now();
    let tick = 0;
    const draw = () => {
      const line = formatProgressLine(text, Date.now() - started, tick++, {
        time: nowHHMMSS(new Date()),
        color: true,
      });
      process.stderr.write(`\r\x1b[2K${line}`);
    };
    draw();
    const timer = setInterval(draw, 100);
    try {
      return await run();
    } finally {
      clearInterval(timer);
      process.stderr.write('\r\x1b[2K');
    }
  };
  const emit = (level: LogLevel, message: string) => {
    if (!shouldShow(level, verbose)) return;
    process.stdout.write(
      `${formatLogLine(level, message, { time: nowHHMMSS(new Date()), color })}\n`,
    );
  };

  const totals: LevelCounts = { ok: 0, skip: 0, dup: 0, err: 0 };
  let failures = 0;

  if (args.file) {
    const file = args.file;
    const raw = await readFile(file, 'utf-8');
    const { failures: fileFailures, counts } = await runFile(
      raw.split('\n'),
      paced,
      emit,
      // Rewrite after every line so an interrupted run keeps its progress.
      (lines) => writeFile(file, lines.join('\n')),
    );
    failures += fileFailures;
    for (const k of Object.keys(totals) as LogLevel[]) totals[k] += counts[k];
  }

  for (const url of args.urls) {
    const result = await paced(url);
    const d = describeResult(result, url);
    emit(d.level, d.body);
    totals[d.level] += 1;
    const inDb = result.ok || result.code === 'duplicate';
    if (!inDb) failures += 1;
  }

  process.stdout.write(`${formatStats(totals)}\n`);
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
