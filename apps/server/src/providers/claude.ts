import type { ProviderStatus } from '@mindmapper/shared';
import { TtlCache, cleanEnv, runCapture, runCli } from './spawn';
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type Provider,
} from './types';

export const CLAUDE_ENV_REMOVE = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
];
export const CLAUDE_MODELS = ['sonnet', 'haiku', 'opus'];
export const CLAUDE_DEFAULT_MODEL = 'sonnet';

export function buildClaudeArgs(system: string, model: string | null): string[] {
  return [
    '-p',
    '--model',
    model ?? CLAUDE_DEFAULT_MODEL,
    '--tools',
    '',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--no-session-persistence',
    '--system-prompt',
    system,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];
}

/** Never `--bare` (ignores the subscription login). Thinking off: ~7 s instead of ~40 s per node. */
export function buildClaudeEnv(): NodeJS.ProcessEnv {
  return cleanEnv(CLAUDE_ENV_REMOVE, { MAX_THINKING_TOKENS: '0' });
}

interface ClaudeResultEvent {
  type: 'result';
  is_error?: boolean;
  result?: string;
  api_error_status?: number | null;
  duration_ms?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function mapResultError(r: ClaudeResultEvent, stderr: string): ProviderError {
  const message = (r.result || stderr || 'Claude failed.').toString().trim().slice(0, 500);
  const s = r.api_error_status;
  if (s === 401 || s === 403 || /not logged in|please run \/login|invalid api key/i.test(message))
    return new ProviderError('provider_not_logged_in', message);
  if (s === 429 || /rate limit|usage limit|limit reached|quota/i.test(message))
    return new ProviderError('rate_limited', message);
  return new ProviderError('provider_failed', message);
}

export class ClaudeProvider implements Provider {
  readonly id = 'claude' as const;
  readonly streams = true;
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
      id: 'claude',
      installed: false,
      version: null,
      loggedIn: false,
      auth: null,
      plan: null,
      usable: false,
      reason: null,
      fix: null,
      models: CLAUDE_MODELS,
      streams: true,
    };
    const env = buildClaudeEnv();
    try {
      const v = await runCapture(this.bin, ['--version'], { env, cwd: this.sandboxDir });
      base.installed = true;
      base.version = v.stdout.trim().split(/\s+/)[0] || null;
    } catch {
      return {
        ...base,
        reason: 'The Claude CLI is not installed.',
        fix: 'Install Claude Code, then run "claude" in a terminal and use /login.',
      };
    }
    try {
      const a = await runCapture(this.bin, ['auth', 'status'], { env, cwd: this.sandboxDir });
      const j = JSON.parse(a.stdout) as {
        loggedIn?: boolean;
        authMethod?: string;
        apiProvider?: string;
        subscriptionType?: string;
      };
      base.loggedIn = j.loggedIn === true;
      base.plan = j.subscriptionType ?? null;
      if (!base.loggedIn) {
        return { ...base, reason: 'Claude is not logged in.', fix: 'Run "claude" in a terminal and use /login.' };
      }
      if (j.authMethod === 'claude.ai' && (j.apiProvider ?? 'firstParty') === 'firstParty') {
        return { ...base, auth: 'subscription', usable: true };
      }
      return {
        ...base,
        auth: 'api_key',
        reason:
          'Mindmapper only uses subscription logins so that it never bills per token. Log in with your Claude plan.',
        fix: 'Run "claude" in a terminal, use /logout, then /login with your Claude plan.',
      };
    } catch {
      return {
        ...base,
        auth: 'unknown',
        reason: 'Could not read the Claude login status.',
        fix: 'Run "claude auth status" in a terminal.',
      };
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const status = await this.check();
    if (!status.installed) throw new ProviderError('provider_not_installed', status.reason ?? 'Claude is not installed.');
    if (!status.loggedIn) throw new ProviderError('provider_not_logged_in', status.reason ?? 'Claude is not logged in.');
    if (status.auth === 'api_key') throw new ProviderError('provider_api_key_auth', status.reason ?? 'API key login.');

    req.onStatus?.('starting');
    const started = Date.now();
    let result: ClaudeResultEvent | null = null;

    const run = await runCli({
      bin: this.bin,
      args: buildClaudeArgs(req.system, req.model),
      env: buildClaudeEnv(),
      cwd: this.sandboxDir,
      stdin: req.prompt,
      signal: req.signal,
      timeoutMs: this.timeoutMs,
      onLine: (line) => {
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (e.type === 'system') {
          if (e.subtype === 'init') req.onStatus?.('generating');
          else if (e.subtype === 'api_retry') req.onStatus?.('retrying');
        } else if (e.type === 'stream_event') {
          const ev = e.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            req.onDelta?.(ev.delta.text);
          }
        } else if (e.type === 'result') {
          result = e as unknown as ClaudeResultEvent;
        }
      },
    });

    const r = result as ClaudeResultEvent | null;
    if (!r) {
      throw new ProviderError('provider_failed', run.stderr.trim().slice(-500) || 'Claude produced no result.');
    }
    if (r.is_error || run.code !== 0) throw mapResultError(r, run.stderr);
    const text = (r.result ?? '').toString();
    if (!text.trim()) throw new ProviderError('empty_output', 'The model returned no text.');
    return {
      text,
      model: req.model ?? CLAUDE_DEFAULT_MODEL,
      durationMs: Date.now() - started,
      usage: { inputTokens: r.usage?.input_tokens, outputTokens: r.usage?.output_tokens },
    };
  }
}
