import type { ErrorCode, ProviderId, ProviderStatus } from '@mindmapper/shared';

export type { ProviderStatus };

export type ProviderErrorCode = Extract<
  ErrorCode,
  | 'provider_not_installed'
  | 'provider_not_logged_in'
  | 'provider_api_key_auth'
  | 'rate_limited'
  | 'timeout'
  | 'aborted'
  | 'empty_output'
  | 'provider_failed'
>;

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface GenerateRequest {
  system: string;
  prompt: string;
  model: string | null;
  signal: AbortSignal;
  onDelta?: (text: string) => void;
  onStatus?: (phase: 'starting' | 'generating' | 'retrying') => void;
}

export interface GenerateResult {
  text: string;
  model: string | null;
  durationMs: number;
  usage: { inputTokens?: number; outputTokens?: number };
}

export interface Provider {
  readonly id: ProviderId;
  readonly streams: boolean;
  check(force?: boolean): Promise<ProviderStatus>;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
