import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

const CSP = "img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

export async function serveWeb(root: string, c: Context): Promise<Response> {
  const rel = decodeURIComponent(c.req.path).replace(/^\/+/, '');
  const full = path.resolve(root, rel || 'index.html');
  if (full !== root && !full.startsWith(root + path.sep)) return c.text('Not found', 404);
  for (const candidate of [full, path.join(root, 'index.html')]) {
    try {
      const s = await stat(candidate);
      if (!s.isFile()) continue;
      const body = await readFile(candidate);
      const type = TYPES[path.extname(candidate)] ?? 'application/octet-stream';
      const headers: Record<string, string> = { 'content-type': type };
      // Defence in depth: this page may load nothing from another origin, whatever an answer contains.
      if (type.startsWith('text/html')) headers['content-security-policy'] = CSP;
      return new Response(body, { headers });
    } catch {
      /* try next */
    }
  }
  return c.text('The web app has not been built. Run "npm run build", or use "npm run dev".', 404);
}
