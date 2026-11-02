import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/read-night.js';
import type { StatusCounts } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightEntry[];
};

// `counts` is null when the night's digest can't be read as a found night; the view shows `—`.
export type NightEntry = { night: string; counts: StatusCounts | null };

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function nightEntry(runsDir: string, night: string): NightEntry {
  const digest = readNight(runsDir, night);
  return { night, counts: digest.kind === 'found' ? digest.counts : null };
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((n) => nightEntry(config.runsDir, n)),
  };
}
