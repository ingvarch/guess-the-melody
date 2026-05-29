// Importer CLI.
//
// Posts to /admin/api/import on a running Worker (locally via wrangler dev
// or a deployed instance). Pure helpers (parseArgs, formatResult,
// readUrlsFile, importOne) are unit-tested under bun; main() composes them
// and is intentionally thin so the unit tests do not need to mock argv/stdio.

import { readFile } from 'node:fs/promises';

export interface CliArgs {
  genre: string;
  urls: string[];
  itunesIdOverride?: number;
  file?: string;
  country?: string;
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

const KNOWN_FLAGS = new Set(['--genre', '--itunes-id', '--file', '--country']);
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;

export function parseArgs(argv: string[]): CliArgs {
  let genre: string | undefined;
  let itunesIdOverride: number | undefined;
  let file: string | undefined;
  let country: string | undefined;
  const urls: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--genre') {
      if (genre !== undefined) throw new Error('duplicate --genre');
      genre = argv[++i];
    } else if (a === '--country') {
      if (country !== undefined) throw new Error('duplicate --country');
      country = argv[++i];
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
  return out;
}

export async function readUrlsFile(path: string): Promise<string[]> {
  const content = await readFile(path, 'utf-8');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
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

  const urls = args.file
    ? [...(await readUrlsFile(args.file)), ...args.urls]
    : args.urls;

  const importOpts: { itunesIdOverride?: number; country?: string } = {};
  if (args.itunesIdOverride !== undefined) importOpts.itunesIdOverride = args.itunesIdOverride;
  if (args.country !== undefined) importOpts.country = args.country;

  let failures = 0;
  for (const line of urls) {
    const result = await importOne(fetchFn, baseUrl, password, args.genre, line, importOpts);
    process.stdout.write(`${formatResult(result)}\n`);
    if (!result.ok) failures += 1;
  }

  return failures === 0 ? 0 : 1;
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
