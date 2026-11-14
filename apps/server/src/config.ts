import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Config {
  port: number;
  dataDir: string;
  mapsDir: string;
  sandboxDir: string;
  exportsDir: string;
  forcedProvider: string | null;
  maxConcurrency: number;
  timeoutMs: number;
  claudeBin: string;
  codexBin: string;
  fakeDelayMs: number;
  webDist: string;
  devOrigins: string[];
}

function int(v: string | undefined, d: number): number {
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) && n >= 0 ? n : d;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.MINDMAPPER_DATA_DIR ?? path.join(repoRoot, 'data'));
  return {
    port: int(env.MINDMAPPER_PORT, 8787),
    dataDir,
    mapsDir: path.join(dataDir, 'maps'),
    sandboxDir: path.join(dataDir, '.sandbox'),
    exportsDir: path.join(dataDir, 'exports'),
    forcedProvider: env.MINDMAPPER_PROVIDER || null,
    maxConcurrency: Math.max(1, int(env.MINDMAPPER_MAX_CONCURRENCY, 2)),
    timeoutMs: int(env.MINDMAPPER_TIMEOUT_MS, 90_000),
    claudeBin: env.MINDMAPPER_CLAUDE_BIN || 'claude',
    codexBin: env.MINDMAPPER_CODEX_BIN || 'codex',
    fakeDelayMs: int(env.MINDMAPPER_FAKE_DELAY_MS, 15),
    webDist: path.join(repoRoot, 'apps/web/dist'),
    devOrigins: env.MINDMAPPER_DEV ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [],
  };
}

export function ensureDirs(c: Config): void {
  for (const d of [c.mapsDir, c.sandboxDir]) mkdirSync(d, { recursive: true });
}
