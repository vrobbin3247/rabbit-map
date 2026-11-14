import { spawn } from 'node:child_process';
import { ProviderError } from './types';

export interface RunCliOptions {
  bin: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  onLine?: (line: string) => void;
}

export interface RunCliResult {
  code: number | null;
  stderr: string;
}

function mapSpawnError(e: NodeJS.ErrnoException, bin: string): ProviderError {
  if (e.code === 'ENOENT') return new ProviderError('provider_not_installed', `Could not find "${bin}".`);
  return new ProviderError('provider_failed', e.message);
}

/**
 * Spawn a CLI without a shell, send stdin, and deliver stdout one line at a time.
 * Rejects with ProviderError on missing binary, timeout and abort.
 */
export function runCli(o: RunCliOptions): Promise<RunCliResult> {
  return new Promise((resolve, reject) => {
    if (o.signal?.aborted) return reject(new ProviderError('aborted', 'Cancelled.'));

    let child;
    try {
      child = spawn(o.bin, o.args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(mapSpawnError(e as NodeJS.ErrnoException, o.bin));
    }

    let settled = false;
    let timedOut = false;
    let aborted = false;
    let callbackError: unknown = null;
    let stderr = '';
    let buf = '';
    let killTimer: NodeJS.Timeout | undefined;

    const kill = () => {
      child.kill('SIGINT');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    const onAbort = () => {
      aborted = true;
      kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, o.timeoutMs);
    o.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      o.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const emitLine = (line: string) => {
      if (!line.trim() || !o.onLine) return;
      try {
        o.onLine(line);
      } catch (e) {
        callbackError ??= e;
        kill();
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        emitLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => {
      if (stderr.length < 20_000) stderr += c;
    });
    child.stdin.on('error', () => {});
    child.on('error', (e) => finish(() => reject(mapSpawnError(e as NodeJS.ErrnoException, o.bin))));
    child.on('close', (code) => {
      if (buf) emitLine(buf);
      finish(() => {
        if (aborted) reject(new ProviderError('aborted', 'Cancelled.'));
        else if (timedOut) reject(new ProviderError('timeout', 'This took too long and was stopped.'));
        else if (callbackError) reject(callbackError);
        else resolve({ code, stderr });
      });
    });

    child.stdin.end(o.stdin ?? '');
  });
}

export interface CaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a short CLI command and collect all output. */
export function runCapture(
  bin: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number },
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(mapSpawnError(e as NodeJS.ErrnoException, bin));
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 15_000);
    child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(mapSpawnError(e as NodeJS.ErrnoException, bin));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Copy of process.env without the named variables, plus extras. */
export function cleanEnv(remove: string[], add: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of remove) delete env[k];
  return { ...env, ...add };
}

/** Tiny time-based cache for health checks. */
export class TtlCache<T> {
  private value: T | undefined;
  private at = 0;
  constructor(private ttlMs: number) {}
  async get(load: () => Promise<T>, force = false): Promise<T> {
    if (!force && this.value !== undefined && Date.now() - this.at < this.ttlMs) return this.value;
    this.value = await load();
    this.at = Date.now();
    return this.value;
  }
}
