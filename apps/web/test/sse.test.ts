import { describe, expect, it } from 'vitest';
import { SseParser } from '../src/api/sse';

const wire = 'event: start\ndata: {"a":1}\n\n: ping\n\nevent: delta\ndata: {"text":"héllo\\nworld"}\n\nevent: done\ndata: {"nodes":[]}\n\n';

describe('SseParser', () => {
  it('parses events, ignoring comments', () => {
    expect(new SseParser().push(wire).map((e) => e.event)).toEqual(['start', 'delta', 'done']);
  });
  it('handles every split position and CRLF', () => {
    for (const text of [wire, wire.replace(/\n/g, '\r\n')]) {
      for (let i = 0; i <= text.length; i++) {
        const p = new SseParser();
        const evs = [...p.push(text.slice(0, i)), ...p.push(text.slice(i))];
        expect(evs.map((e) => e.event)).toEqual(['start', 'delta', 'done']);
        expect((evs[1] as { data: { text: string } }).data.text).toBe('héllo\nworld');
      }
    }
  });
  it('skips malformed data', () => {
    expect(new SseParser().push('event: x\ndata: {nope\n\nevent: ok\ndata: {}\n\n').map((e) => e.event)).toEqual(['ok']);
  });
});
