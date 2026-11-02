import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { FoundNight, MissingNight } from '../src/digest/types.js';

// Route tests for the digest page and JSON (plan.md § 2d). Fixtures live in a temp runs dir;
// the real `runs/` is read-only and never touched.

const NIGHTS = {
  rows: '2026-01-01',
  rowsOwned: '2026-01-02',
  empty: '2026-01-03',
  badLine: '2026-01-04',
  onlyBad: '2026-01-05',
  missing: '2026-01-06',
} as const;

const line = (o: Record<string, unknown>) => JSON.stringify(o);

// Written out of job order on purpose: the digest sorts by job. `alpha-backup`'s last line has the
// given owner (null in the `rows` night), earlier lines are `ben`.
function rowsFile(lastOwner: string | null): string {
  return (
    [
      line({ at: '2026-01-01T23:10:00+01:00', job: 'zeta-sync', status: 'ok', owner: 'ana' }),
      line({ at: '2026-01-01T23:15:00+01:00', job: 'alpha-backup', status: 'retry', owner: 'ben', error: 'timeout' }),
      line({ at: '2026-01-01T23:20:00+01:00', job: 'alpha-backup', status: 'retry', owner: 'ben', error: 'timeout' }),
      line({ at: '2026-01-01T23:25:00+01:00', job: 'alpha-backup', status: 'ok', owner: lastOwner }),
      line({ at: '2026-01-01T23:30:00+01:00', job: 'mail-digest', status: 'fail', owner: 'cy', error: 'smtp down' }),
    ].join('\n') + '\n'
  );
}

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  writeFileSync(join(runsDir, `${NIGHTS.rows}.jsonl`), rowsFile(null));
  writeFileSync(join(runsDir, `${NIGHTS.rowsOwned}.jsonl`), rowsFile('ana'));
  writeFileSync(join(runsDir, `${NIGHTS.empty}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${NIGHTS.badLine}.jsonl`),
    [
      line({ at: '2026-01-04T23:00:00+01:00', job: 'good-two', status: 'ok', owner: 'ana' }),
      '{ this is not json',
      '   ', // blank lines are skipped: neither a row nor a bad line
      line({ at: '2026-01-04T23:05:00+01:00', job: 'good-one', status: 'ok', owner: 'ben' }),
    ].join('\n') + '\n',
  );
  writeFileSync(
    join(runsDir, `${NIGHTS.onlyBad}.jsonl`),
    [
      '{ this is not json',
      line({ at: '2026-01-05T23:00:00+01:00', job: 'x', status: 'exploded', owner: null }), // wrong shape
    ].join('\n') + '\n',
  );
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

const page = async (night: string) => {
  const res = await app.request(`/digest/${night}`);
  return { res, html: await res.text() };
};
const api = async (night: string) => {
  const res = await app.request(`/api/digest/${night}`);
  return { res, body: (await res.json()) as FoundNight | MissingNight };
};
const found = (body: FoundNight | MissingNight): FoundNight => {
  if (body.kind !== 'found') throw new Error(`expected a found night, got ${JSON.stringify(body)}`);
  return body;
};
const countDashes = (html: string) => html.split('—').length - 1;
const positions = (html: string, names: string[]) => names.map((n) => html.indexOf(n));

describe('GET /digest/:night', () => {
  it('renders 200 with every job, in job order', async () => {
    const { res, html } = await page(NIGHTS.rows);
    expect(res.status).toBe(200);
    const at = positions(html, ['alpha-backup', 'mail-digest', 'zeta-sync']);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('shows a missing owner as a dash, not an empty cell', async () => {
    // Same night twice; only alpha-backup's last owner differs (null vs "ana").
    const withNull = countDashes((await page(NIGHTS.rows)).html);
    const withOwner = countDashes((await page(NIGHTS.rowsOwned)).html);
    expect(withNull).toBeGreaterThan(withOwner);
  });

  it('does not mention unreadable lines for a clean night', async () => {
    const { html } = await page(NIGHTS.rows);
    expect(html).not.toMatch(/could not be read/i);
  });

  it('404s for a night with no file', async () => {
    const { res } = await page(NIGHTS.missing);
    expect(res.status).toBe(404);
  });

  it('404s for something that is not a date', async () => {
    expect((await page('not-a-night')).res.status).toBe(404);
    expect((await page('2026-1-1')).res.status).toBe(404);
  });

  it('says "nothing ran" for an empty file', async () => {
    const { res, html } = await page(NIGHTS.empty);
    expect(res.status).toBe(200);
    expect(html).toMatch(/nothing ran/i);
  });

  it('renders the good rows of a night with a bad line and says it could not be read', async () => {
    const { res, html } = await page(NIGHTS.badLine);
    expect(res.status).toBe(200);
    const at = positions(html, ['good-one', 'good-two']);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at[0]).toBeLessThan(at[1]!);
    expect(html).toMatch(/could not be read/i);
    expect(html).not.toMatch(/nothing ran/i);
  });

  it('renders a night with only bad lines as empty and still reports them', async () => {
    const { res, html } = await page(NIGHTS.onlyBad);
    expect(res.status).toBe(200);
    expect(html).toMatch(/nothing ran/i);
    expect(html).toMatch(/could not be read/i);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns 200 with the found digest', async () => {
    const { res, body } = await api(NIGHTS.rows);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body).toEqual({
      kind: 'found',
      night: NIGHTS.rows,
      badLines: 0,
      counts: { ok: 2, retry: 2, fail: 1 },
      rows: [
        {
          job: 'alpha-backup',
          owner: null, // owner on the last line, kept as null
          runs: 3, // every parsed line counts
          retries: 2,
          fails: 0,
          lastStatus: 'ok',
          lastError: 'timeout', // survives the later ok line
          firstAt: '2026-01-01T23:15:00+01:00', // offset kept
          lastAt: '2026-01-01T23:25:00+01:00',
        },
        {
          job: 'mail-digest',
          owner: 'cy',
          runs: 1,
          retries: 0,
          fails: 1,
          lastStatus: 'fail',
          lastError: 'smtp down',
          firstAt: '2026-01-01T23:30:00+01:00',
          lastAt: '2026-01-01T23:30:00+01:00',
        },
        {
          job: 'zeta-sync',
          owner: 'ana',
          runs: 1,
          retries: 0,
          fails: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-01-01T23:10:00+01:00',
          lastAt: '2026-01-01T23:10:00+01:00',
        },
      ],
    });
  });

  it('sorts rows by job, not by file order', async () => {
    const { body } = await api(NIGHTS.rows);
    const jobs = found(body).rows.map((r) => r.job);
    expect(jobs).toEqual([...jobs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(jobs).toEqual(['alpha-backup', 'mail-digest', 'zeta-sync']);
  });

  it('404s with kind "missing" for a night with no file', async () => {
    const { res, body } = await api(NIGHTS.missing);
    expect(res.status).toBe(404);
    expect(body).toEqual({ kind: 'missing', night: NIGHTS.missing });
  });

  it('404s for something that is not a date', async () => {
    const { res, body } = await api('not-a-night');
    expect(res.status).toBe(404);
    expect(body.kind).toBe('missing');
  });

  it('returns 200 with no rows for an empty file', async () => {
    const { res, body } = await api(NIGHTS.empty);
    expect(res.status).toBe(200);
    const night = found(body);
    expect(night.rows).toEqual([]);
    expect(night.badLines).toBe(0);
    expect(night.counts).toEqual({ ok: 0, retry: 0, fail: 0 });
  });

  it('counts one bad line, skips the blank line, and keeps the good rows', async () => {
    const { res, body } = await api(NIGHTS.badLine);
    expect(res.status).toBe(200);
    const night = found(body);
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['good-one', 'good-two']);
    expect(night.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
  });

  it('counts a wrong-shape line as bad, and a night of only bad lines has no rows', async () => {
    const { res, body } = await api(NIGHTS.onlyBad);
    expect(res.status).toBe(200);
    const night = found(body);
    expect(night.rows).toEqual([]);
    expect(night.badLines).toBe(2);
    expect(night.counts).toEqual({ ok: 0, retry: 0, fail: 0 });
  });
});

describe('page and JSON agree (ADR 0001)', () => {
  it.each([NIGHTS.rows, NIGHTS.badLine])('list the same jobs in the same order for %s', async (night) => {
    const jobs = found((await api(night)).body).rows.map((r) => r.job);
    const { html } = await page(night);
    const at = positions(html, jobs);
    expect(jobs.length).toBeGreaterThan(0);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('agree that a missing night is a 404', async () => {
    expect((await page(NIGHTS.missing)).res.status).toBe(404);
    expect((await api(NIGHTS.missing)).res.status).toBe(404);
  });
});
