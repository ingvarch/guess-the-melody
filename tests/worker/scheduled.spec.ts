// Scheduled (cron) handler. Drives the real Worker `scheduled` export against
// real D1 so the sweep query and TTL wiring are exercised end-to-end.

import { beforeEach, describe, expect, it } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import type { Env } from '../../src/types';
import worker from '../../src/index';
import { upsertSession, listSessions } from '../../src/catalog/sessions';

const testEnv = env as unknown as Env;
const DAY_MS = 24 * 60 * 60 * 1000;

function scheduledController(): ScheduledController {
  return {
    scheduledTime: Date.now(),
    cron: '0 4 * * *',
    noRetry() {},
  };
}

describe('scheduled session sweep', () => {
  beforeEach(async () => {
    await testEnv.CATALOG.exec('DELETE FROM sessions');
  });

  it('deletes sessions older than 24h and keeps fresh ones', async () => {
    await upsertSession(testEnv.CATALOG, {
      id: 'ancient', now: Date.now() - 2 * DAY_MS, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [],
    });
    await upsertSession(testEnv.CATALOG, {
      id: 'recent', now: Date.now(), phase: 'playing', selectedGenre: 'rock', roundsPlayed: 1, teams: [],
    });

    const ctx = createExecutionContext();
    await worker.scheduled!(scheduledController(), testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const rows = await listSessions(testEnv.CATALOG);
    expect(rows.map((r) => r.id)).toEqual(['recent']);
  });
});
