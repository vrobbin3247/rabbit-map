import { serve } from '@hono/node-server';
import { ensureDirs, loadConfig } from './config';
import { JobManager } from './generation/jobs';
import { createApp } from './http/app';
import { Registry } from './providers/registry';
import { MapStore } from './store/mapStore';

const config = loadConfig();
ensureDirs(config);
const store = new MapStore(config.mapsDir);
const registry = new Registry(config);
const jobs = new JobManager(config.maxConcurrency);
const app = createApp({ config, store, registry, jobs });

const server = serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`Mindmapper server listening on http://127.0.0.1:${info.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  jobs.abortAll();
  await new Promise((r) => setTimeout(r, 300));
  await store.flush();
  server.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
