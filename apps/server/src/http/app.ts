import { Hono, type Context } from 'hono';
import { ZodError, type ZodType } from 'zod';
import type { Config } from '../config';
import { AppError } from '../errors';
import type { JobManager } from '../generation/jobs';
import type { Registry } from '../providers/registry';
import type { MapStore } from '../store/mapStore';
import { serveWeb } from './static';
import { registerRoutes } from './routes';

export interface Deps {
  config: Config;
  store: MapStore;
  registry: Registry;
  jobs: JobManager;
}

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    const text = await c.req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new AppError('invalid_request', 'The request body is not valid JSON.');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError('invalid_request', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();
  const { config } = deps;
  const hosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const origins = new Set([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, ...config.devOrigins]);

  // Only the local app may talk to this server: it can spend the user's plan quota.
  app.use('/api/*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    if (!hosts.has(host)) throw new AppError('forbidden', 'Requests must use 127.0.0.1 or localhost.');
    const origin = c.req.header('origin');
    if (origin !== undefined && !origins.has(origin)) throw new AppError('forbidden', 'Requests from other origins are not allowed.');
    const m = c.req.method;
    if (m === 'POST' || m === 'PATCH' || m === 'PUT') {
      if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
        throw new AppError('invalid_request', 'Content-Type must be application/json.');
      }
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    if (err instanceof ZodError) return c.json({ error: { code: 'invalid_request', message: err.message } }, 400);
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'Unexpected server error.' } }, 500);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404);
    return serveWeb(config.webDist, c);
  });

  registerRoutes(app, deps);
  return app;
}
