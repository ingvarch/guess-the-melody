// Importer CLI.
//
// Posts to /admin/api/import on a running Worker (locally via wrangler dev
// or a deployed instance). Pure helpers (parseArgs, formatResult,
// readUrlsFile, importOne) are unit-tested under bun; main() composes them
// and is intentionally thin so the unit tests do not need to mock argv/stdio.

import { readFile, writeFile } from 'node:fs/promises';

export interface CliArgs {
  genre: string;
  urls: string[];
  itunesIdOverride?: number;
  file?: string;
  country?: string;
  delayMs?: number;
}

export interface ImportSuccess {
  ok: true;
  id: string;
  artist: string;
  title: string;
  year: number;
}

export interface ImportFailure {
  ok: false;
  code: string;
  body: unknown;
}

export type ImportResult = ImportSuccess | ImportFailure;

const KNOWN_FLAGS = new Set(['--genre', '--itunes-id', '--file', '--country', '--delay']);
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INT_RE = /^[0-9]+$/;

export function parseArgs(argv: string[]): CliArgs {
  let genre: string | undefined;
  let itunesIdOverride: number | undefined;
  let file: string | undefined;
  let country: string | undefined;
  let delayMs: number | undefined;
  const urls: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--genre') {
      if (genre !== undefined) throw new Error('duplicate --genre');
      genre = argv[++i];
    } else if (a === '--country') {
      if (country !== undefined) throw new Error('duplicate --country');
      country = argv[++i];
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
    } else if (a !== undefined && a.startsWith('--')) {
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

// Walks a list file's lines: imports each pending track, skips lines already
// marked done, and returns the rewritten lines (done markers added for tracks
// now in the catalogue) plus the count of genuine failures. A duplicate is not
// a failure — the track is already in the DB, so it gets marked done too.
//
// `persist` is called after every line with the progress so far, so an
// interrupted run (Ctrl-C mid-import) keeps the done markers already earned.
export async function runFile(
  lines: string[],
  importLine: (text: string) => Promise<ImportResult>,
  log: (msg: string) => void,
  persist?: (lines: string[]) => void | Promise<void>,
): Promise<{ newLines: string[]; failures: number }> {
  // Seed with the input so a snapshot taken at any point is the full file.
  const newLines = [...lines];
  let failures = 0;
  for (let i = 0; i < lines.length; i++) {
    const c = classifyLine(lines[i]!);
    if (c.status === 'blank' || c.status === 'comment') {
      if (persist) await persist(newLines);
      continue;
    }
    if (c.status === 'done') {
      log(`SKIP уже в базе, пропускаем: ${c.text}`);
      if (persist) await persist(newLines);
      continue;
    }
    const result = await importLine(c.text);
    const inDb = result.ok || result.code === 'duplicate';
    if (inDb) {
      log(result.ok ? formatResult(result) : `DUP уже в базе: ${c.text}`);
      newLines[i] = markDoneLine(c.text);
    } else {
      log(formatResult(result));
      failures += 1;
    }
    if (persist) await persist(newLines);
  }
  return { newLines, failures };
}

export function formatResult(r: ImportResult): string {
  if (r.ok) {
    return `OK ${r.id} ${r.artist} - ${r.title} (${r.year})`;
  }
  return `ERR ${r.code} ${JSON.stringify(r.body)}`;
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
    const p = parsed as { id: string; artist: string; title: string; year: number };
    return { ok: true, id: p.id, artist: p.artist, title: p.title, year: p.year };
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
    return importOne(fetchFn, baseUrl, password, args.genre, text, importOpts);
  };

  let failures = 0;

  if (args.file) {
    const file = args.file;
    const raw = await readFile(file, 'utf-8');
    const { failures: fileFailures } = await runFile(
      raw.split('\n'),
      paced,
      (m) => process.stdout.write(`${m}\n`),
      // Rewrite after every line so an interrupted run keeps its progress.
      (lines) => writeFile(file, lines.join('\n')),
    );
    failures += fileFailures;
  }

  for (const url of args.urls) {
    const result = await paced(url);
    process.stdout.write(`${formatResult(result)}\n`);
    const inDb = result.ok || result.code === 'duplicate';
    if (!inDb) failures += 1;
  }

  return failures === 0 ? 0 : 1;
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
