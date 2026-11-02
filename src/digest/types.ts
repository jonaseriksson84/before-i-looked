// The digest contract (plan.md § 1). Section 2 (page, JSON, board link, route tests) builds
// against this file only. Everything here is plain JSON-serializable data.

/** Status of one run log line. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/**
 * One parsed line of `runs/<night>.jsonl`. Parsed at the edge: a line becomes a `RunLine` only
 * if it is valid JSON with `at` (string), `job` (non-empty string) and `status` (a `RunStatus`).
 * `owner` is a string or `null`; an absent `owner` reads as `null`. `error` is a string if
 * present; an absent `error` reads as `null`. Any other line is a bad line (see
 * `NightDigest.badLines`).
 */
export type RunLine = {
  /** Time as written in the log, offset included. Never converted to UTC. */
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

/**
 * One row per job: all parsed lines of that job in a night, folded in file order (the log is
 * append-only; lines are never reordered by `at`).
 */
export type DigestRow = {
  job: string;
  /** Owner on the job's last line. `null` stays `null` here; the views show it as `—`. */
  owner: string | null;
  /** Number of parsed lines for this job, every status counted (each line is one attempt). */
  runs: number;
  /** Number of lines with `status: 'retry'`. */
  retries: number;
  /** Number of lines with `status: 'fail'`. */
  fails: number;
  /** Status of the job's last line. */
  lastStatus: RunStatus;
  /**
   * The most recent `error` on any of the job's lines, even if a later line is `ok`.
   * `null` if no line had one (the views show it as `—`).
   */
  lastError: string | null;
  /** `at` of the job's first line, verbatim (offset kept). */
  firstAt: string;
  /** `at` of the job's last line, verbatim (offset kept). */
  lastAt: string;
};

/** Lines per status for a night. Bad lines count in none of them. */
export type StatusCounts = Record<RunStatus, number>;

/** `runs/<night>.jsonl` does not exist, or `night` is not a `YYYY-MM-DD` date. Routes: 404. */
export type MissingNight = {
  kind: 'missing';
  night: string;
};

/**
 * The night's file exists and was read.
 *
 * - Empty night: `rows.length === 0` ("nothing ran"). That includes an empty file and a file
 *   with only bad lines; `badLines` is still reported then.
 * - Blank (whitespace-only) lines are skipped: neither a row nor a bad line.
 */
export type FoundNight = {
  kind: 'found';
  night: string;
  /** One row per job, sorted by `job` ascending (plain string comparison, `a < b`). */
  rows: DigestRow[];
  /** Lines that are not valid JSON or do not have the `RunLine` shape. Counted, never thrown. */
  badLines: number;
  /** Parsed lines per status. `ok + retry + fail` equals the sum of `rows[].runs`. */
  counts: StatusCounts;
};

export type NightDigest = MissingNight | FoundNight;

/**
 * Reads `<runsDir>/<night>.jsonl` into a `NightDigest`. Synchronous, like the other readers in
 * rig. `night` must match `YYYY-MM-DD`, otherwise the result is `missing` (it comes from a URL;
 * the reader never builds a path from anything else). Only a missing file is `missing`; any
 * other read error (permissions, a directory) throws.
 *
 * Implemented as `readNight` in `src/digest/read-night.ts`.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest;
