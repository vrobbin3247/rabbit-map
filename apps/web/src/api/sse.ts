import type { StreamEvent } from '@mindmapper/shared';
import { ApiError } from './client';

/** Incremental parser for text/event-stream. Comment lines (": ping") are ignored. */
export class SseParser {
  private buf = '';
  push(chunk: string): StreamEvent[] {
    // A chunk may end between "\r" and "\n": hold a trailing "\r" back until the next chunk.
    this.buf += chunk;
    const hold = this.buf.endsWith('\r');
    this.buf = (hold ? this.buf.slice(0, -1) : this.buf).replace(/\r\n?/g, '\n') + (hold ? '\r' : '');
    const out: StreamEvent[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      let event = '';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!event || !data.length) continue;
      try {
        out.push({ event, data: JSON.parse(data.join('\n')) } as StreamEvent);
      } catch {
        /* skip malformed event */
      }
    }
    return out;
  }
}

/** POST and read a server-sent event stream. Rejects with ApiError for errors before the stream opens. */
export async function postStream(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('network', 'Could not reach the Mindmapper server. Is it running?');
  }
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    let e: { error?: { code: never; message: string } } | null = null;
    try {
      e = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(e?.error?.code ?? 'internal', e?.error?.message ?? `Request failed (${res.status}).`, res.status);
  }
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of parser.push(decoder.decode(value, { stream: true }))) onEvent(ev);
  }
}
