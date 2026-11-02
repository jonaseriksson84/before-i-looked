import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';
import type { FoundNight, NightDigest } from '../src/digest/types.js';

function found(d: NightDigest): FoundNight {
  if (d.kind !== 'found') throw new Error(`expected a found night, got ${d.kind}`);
  return d;
}

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = found(readNight('runs', '2026-10-28'));
  const row = (job: string) => night.rows.find((r) => r.job === job);

  it('has 5 jobs, sorted by job, and 1 bad line', () => {
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night.badLines).toBe(1);
  });

  it('counts lines per status, bad line in none', () => {
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(night.rows.reduce((n, r) => n + r.runs, 0)).toBe(15);
  });

  it('folds a job with retries', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      fails: 0,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps times as written, offset included', () => {
    expect(row('lane/sync')?.firstAt).toBe('2026-10-28T23:00:06+01:00');
    expect(row('lane/sync')?.lastAt).toBe('2026-10-29T05:00:04+01:00');
  });

  it('keeps a failed job and a job without owner', () => {
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', fails: 1, lastError: 'quota exceeded' });
    expect(row('digest/render')).toMatchObject({ owner: null, lastError: null, runs: 1 });
  });
});

describe('readNight edge cases', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a night with no file is missing', () => {
    expect(readNight(dir, '2026-01-01')).toEqual({ kind: 'missing', night: '2026-01-01' });
  });

  it('a night that is not a date is missing, never a path', () => {
    writeFileSync(join(dir, 'x.jsonl'), '');
    expect(readNight(dir, '../x').kind).toBe('missing');
    expect(readNight(dir, 'x').kind).toBe('missing');
    expect(readNight(dir, '2026-10-28.jsonl').kind).toBe('missing');
  });

  it('an empty file is an empty night', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({
      kind: 'found',
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips blank lines without counting them', () => {
    const line = '{"at":"2026-01-03T01:00:00+02:00","job":"a","status":"ok","owner":"rook"}';
    writeFileSync(join(dir, '2026-01-03.jsonl'), `\n${line}\n   \n\r\n${line}\n\n`);
    const night = found(readNight(dir, '2026-01-03'));
    expect(night.badLines).toBe(0);
    expect(night.rows).toHaveLength(1);
    expect(night.rows[0]?.runs).toBe(2);
  });

  it('counts JSON of the wrong shape as bad lines', () => {
    const lines = [
      '[]',
      'null',
      '{"at":"2026-01-04T01:00:00+02:00","job":"a","status":"done","owner":null}',
      '{"at":"2026-01-04T01:00:00+02:00","status":"ok","owner":null}',
      '{"at":"2026-01-04T01:00:00+02:00","job":"a","status":"ok","owner":7}',
      '{"at":"2026-01-04T01:00:00+02:00","job":"a","status":"ok"}',
    ];
    writeFileSync(join(dir, '2026-01-04.jsonl'), lines.join('\n'));
    const night = found(readNight(dir, '2026-01-04'));
    expect(night.badLines).toBe(5);
    expect(night.rows).toEqual([expect.objectContaining({ job: 'a', owner: null, runs: 1 })]);
  });

  it('a file of only bad lines is an empty night that still reports them', () => {
    writeFileSync(join(dir, '2026-01-05.jsonl'), '{"at":\nnot json\n');
    const night = found(readNight(dir, '2026-01-05'));
    expect(night.rows).toEqual([]);
    expect(night.badLines).toBe(2);
  });
});
