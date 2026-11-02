import type { FoundNight, MissingNight } from '../digest/types.js';

const dash = '—';

function BadLines({ count }: { count: number }) {
  if (count === 0) return null;
  return <p class="mute">{count === 1 ? '1 line could not be read.' : `${count} lines could not be read.`}</p>;
}

// Retries of 3 or more, or any fail, mark the row.
function isWarn(row: FoundNight['rows'][number]): boolean {
  return row.retries >= 3 || row.fails > 0;
}

export function DigestPage({ digest }: { digest: FoundNight }) {
  return (
    <>
      <h1>{digest.night}</h1>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last</th>
              <th>last error</th>
              <th>first</th>
              <th>last at</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr class={isWarn(row) ? 'warn' : undefined}>
                <td>{row.job}</td>
                <td>{row.owner ?? dash}</td>
                <td>{row.runs}</td>
                <td>{row.retries}</td>
                <td>{row.lastStatus}</td>
                <td>{row.lastError ?? dash}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <BadLines count={digest.badLines} />
    </>
  );
}

export function MissingDigest({ digest }: { digest: MissingNight }) {
  return (
    <>
      <h1>{digest.night}</h1>
      <p class="mute">no run log for {digest.night}</p>
    </>
  );
}
