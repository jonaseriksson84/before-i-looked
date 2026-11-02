import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { readNight } from './digest/read-night.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { DigestPage, MissingDigest } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = readNight(config.runsDir, night);
    const page = (
      <Layout title={`digest · ${night}`} lane={lane()}>
        {digest.kind === 'found' ? <DigestPage digest={digest} /> : <MissingDigest digest={digest} />}
      </Layout>
    );
    return c.html(page, digest.kind === 'found' ? 200 : 404);
  });

  app.get('/api/digest/:night', (c) => {
    const digest = readNight(config.runsDir, c.req.param('night'));
    return digest.kind === 'found' ? c.json(digest) : c.json(digest, 404);
  });

  return app;
}
