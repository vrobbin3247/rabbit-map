import type { ProviderStatus } from '@mindmapper/shared';
import { TtlCache, cleanEnv, runCapture, runCli } from './spawn';
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type Provider,
} from './types';

export const CODEX_ENV_REMOVE = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'];

export function buildCodexArgs(sandboxDir: string, model: string | null): string[] {
  return [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '-s',
    'read-only',
    '-C',
    sandboxDir,
    '-c',
    'model_reasoning_effort="low"',
    ...(model ? ['-m', model] : []),
    '-',
  ];
}

export function buildCodexEnv(): NodeJS.ProcessEnv {
  return cleanEnv(CODEX_ENV_REMOVE);
}

function mapMessageError(message: string): ProviderError {
  const m = message.trim().slice(0, 500) || 'Codex failed.';
  if (/rate limit|usage limit|limit reached|quota|too many requests/i.test(m)) return new ProviderError('rate_limited', m);
  if (/not logged in|log in|unauthori[sz]ed|401/i.test(m)) return new ProviderError('provider_not_logged_in', m);
  return new ProviderError('provider_failed', m);
}

export class CodexProvider implements Provider {
  readonly id = 'codex' as const;
  readonly streams = false;
  private cache = new TtlCache<ProviderStatus>(60_000);

  constructor(
    private bin: string,
    private sandboxDir: string,
    private timeoutMs: number,
  ) {}

  check(force = false): Promise<ProviderStatus> {
    return this.cache.get(() => this.doCheck(), force);
  }

  private async doCheck(): Promise<ProviderStatus> {
    const base: ProviderStatus = {
      id: 'codex',
      installed: false,
      version: null,
      loggedIn: false,
      auth: null,
      plan: null,
      usable: false,
      reason: null,
      fix: null,
      models: [],
      streams: false,
    };
    const env = buildCodexEnv();
    try {
      const v = await runCapture(this.bin, ['--version'], { env, cwd: this.sandboxDir });
      base.installed = true;
      base.version = v.stdout.trim().split(/\s+/).pop() || null;
    } catch {
      return { ...base, reason: 'The Codex CLI is not installed.', fix: 'Install the Codex CLI, then run "codex login".' };
    }
    try {
      const s = await runCapture(this.bin, ['login', 'status'], { env, cwd: this.sandboxDir });
      const out = `${s.stdout}\n${s.stderr}`;
      if (/api key/i.test(out)) {
        return {
          ...base,
          loggedIn: true,
          auth: 'api_key',
          reason:
            'Mindmapper only uses subscription logins so that it never bills per token. Log in with ChatGPT.',
          fix: 'Run "codex logout" then "codex login" and choose Sign in with ChatGPT.',
        };
      }
      if (s.code === 0 && /chatgpt/i.test(out)) {
        return { ...base, loggedIn: true, auth: 'subscription', usable: true };
      }
      return { ...base, reason: 'Codex is not logged in.', fix: 'Run "codex login" in a terminal.' };
    } catch {
      return { ...base, auth: 'unknown', reason: 'Could not read the Codex login status.', fix: 'Run "codex login status".' };
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const status = await this.check();
    if (!status.installed) throw new ProviderError('provider_not_installed', status.reason ?? 'Codex is not installed.');
    if (!status.loggedIn) throw new ProviderError('provider_not_logged_in', status.reason ?? 'Codex is not logged in.');
    if (status.auth === 'api_key') throw new ProviderError('provider_api_key_auth', status.reason ?? 'API key login.');

    req.onStatus?.('starting');
    const started = Date.now();
    let message = '';
    let failure: string | null = null;
    let lastError: string | null = null;
    let usage: { input_tokens?: number; output_tokens?: number } | undefined;

    const run = await runCli({
      bin: this.bin,
      args: buildCodexArgs(this.sandboxDir, req.model),
      env: buildCodexEnv(),
      cwd: this.sandboxDir,
      stdin: `${req.system}\n\n${req.prompt}`,
      signal: req.signal,
      timeoutMs: this.timeoutMs,
      onLine: (line) => {
        let e: {
          type?: string;
          item?: { type?: string; text?: string };
          usage?: { input_tokens?: number; output_tokens?: number };
          message?: string;
          error?: { message?: string };
        };
        try {
          e = JSON.parse(line);
        } catch {
          return;
        }
        if (e.type === 'thread.started') req.onStatus?.('generating');
        else if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text) message = e.item.text;
        else if (e.type === 'turn.completed') usage = e.usage;
        else if (e.type === 'turn.failed') failure = e.error?.message ?? e.message ?? 'Codex failed.';
        else if (e.type === 'error') lastError = e.message ?? e.error?.message ?? null;
      },
    });

    if (failure) throw mapMessageError(failure);
    if (!message.trim()) {
      if (lastError) throw mapMessageError(lastError);
      if (run.code !== 0) throw mapMessageError(run.stderr.trim().slice(-500));
      throw new ProviderError('empty_output', 'The model returned no text.');
    }
    req.onDelta?.(message);
    return {
      text: message,
      model: req.model,
      durationMs: Date.now() - started,
      usage: { inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens },
    };
  }
}
