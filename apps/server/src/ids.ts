import { monotonicFactory } from 'ulid';

export const newId = monotonicFactory();
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const now = () => new Date().toISOString();
