import type { ErrorCode } from '@mindmapper/shared';

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  provider_not_installed: 503,
  provider_not_logged_in: 503,
  provider_api_key_auth: 503,
  rate_limited: 429,
  timeout: 504,
  aborted: 499,
  empty_output: 502,
  provider_failed: 502,
  storage_failed: 500,
  internal: 500,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
  get status(): number {
    return STATUS[this.code];
  }
}
