import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeProvider, buildClaudeArgs } from '../src/providers/claude';
import { CodexProvider, buildCodexArgs } from '../src/providers/codex';
import { FakeProvider } from '../src/providers/fake';
import { runCli } from '../src/providers/spawn';
import { ProviderError } from '../src/providers/types';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const claudeBin = path.join(fixtures, 'fake-claude.mjs');
const codexBin = path.join(fixtures, 'fake-codex.mjs');
let tmp: string;
let dump: string;
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v?: string) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

beforeAll(() => {
  chmodSync(claudeBin, 0o755);
  chmodSync(codexBin, 0o755);
  tmp = mkdtempSync(path.join(tmpdir(), 'mm-prov-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
});
beforeEach(() => {
  dump = path.join(tmp, `dump-${Math.random().toString(36).slice(2)}.json`);
  setEnv('FAKE_DUMP', dump);
  for (const k of ['FAKE_MODE', 'FAKE_AUTH', 'FAKE_LOGIN', 'FAKE_EMPTY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) setEnv(k);
});

const nodeBin = process.execPath;
const sig = () => new AbortController().signal;

describe('runCli', () => {
  it('delivers lines split across chunks and skips blanks', async () => {
    const lines: string[] = [];
    const script = `process.stdout.write('{"a":'); setTimeout(()=>{process.stdout.write('1}\\n\\nsecond\\nthird')},30)`;
    await runCli({ bin: nodeBin, args: ['-e', script], env: process.env, cwd: tmp, timeoutMs: 5000, onLine: (l) => lines.push(l) });
    expect(lines).toEqual(['{"a":1}', 'second', 'third']);
  });

  it('writes stdin', async () => {
    const lines: string[] = [];
    const script = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(s.toUpperCase()))`;
    await runCli({ bin: nodeBin, args: ['-e', script], env: process.env, cwd: tmp, stdin: 'abc', timeoutMs: 5000, onLine: (l) => lines.push(l) });
    expect(lines).toEqual(['ABC']);
  });

  it('times out and kills the process', async () => {
    const t0 = Date.now();
    await expect(
      runCli({ bin: nodeBin, args: ['-e', 'setInterval(()=>{},1000)'], env: process.env, cwd: tmp, timeoutMs: 150 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it('aborts and kills the process', async () => {
    const ac = new AbortController();
    const p = runCli({ bin: nodeBin, args: ['-e', 'setInterval(()=>{},1000)'], env: process.env, cwd: tmp, timeoutMs: 20000, signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });

  it('rejects immediately when already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runCli({ bin: nodeBin, args: ['-e', ''], env: process.env, cwd: tmp, timeoutMs: 1000, signal: ac.signal })).rejects.toMatchObject({ code: 'aborted' });
  });

  it('maps a missing binary to provider_not_installed', async () => {
    await expect(runCli({ bin: '/nonexistent/bin', args: [], env: process.env, cwd: tmp, timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'provider_not_installed',
    });
  });
});

describe('ClaudeProvider', () => {
  const make = (bin = claudeBin) => new ClaudeProvider(bin, tmp, 10_000);
  const req = (extra: object = {}) => ({ system: 'SYS', prompt: 'PROMPT', model: null, signal: sig(), ...extra });

  it('check: usable subscription login, never exposes the email', async () => {
    const s = await make().check(true);
    expect(s).toMatchObject({ installed: true, version: '2.1.287', loggedIn: true, auth: 'subscription', plan: 'pro', usable: true });
    expect(JSON.stringify(s)).not.toContain('someone@example.com');
  });

  it('check: not installed', async () => {
    const s = await make('/nonexistent/claude').check(true);
    expect(s.installed).toBe(false);
    expect(s.usable).toBe(false);
    expect(s.fix).toMatch(/login/);
  });

  it('check: logged out and API-key logins are not usable', async () => {
    setEnv('FAKE_AUTH', JSON.stringify({ loggedIn: false }));
    expect((await make().check(true)).usable).toBe(false);
    setEnv('FAKE_AUTH', JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }));
    const s = await make().check(true);
    expect(s.auth).toBe('api_key');
    expect(s.usable).toBe(false);
  });

  it('generate: exact args, stripped env, thinking off, prompt on stdin, streamed deltas', async () => {
    setEnv('ANTHROPIC_API_KEY', 'dummy');
    const deltas: string[] = [];
    const r = await make().generate(req({ onDelta: (t: string) => deltas.push(t) }));
    expect(deltas.join('')).toBe(r.text);
    expect(deltas.length).toBeGreaterThan(1);
    expect(r.text).toContain('Hello [[World]]');
    expect(r.usage).toEqual({ inputTokens: 800, outputTokens: 40 });
    const d = JSON.parse(readFileSync(dump, 'utf8'));
    expect(d.args).toEqual(buildClaudeArgs('SYS', null));
    expect(d.args).not.toContain('--bare');
    expect(d.stdin).toBe('PROMPT');
    expect(d.env).toEqual({ ANTHROPIC_API_KEY: null, MAX_THINKING_TOKENS: '0' });
  });

  it('generate: refuses an API-key login without spawning a generation', async () => {
    setEnv('FAKE_AUTH', JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }));
    await expect(make().generate(req())).rejects.toMatchObject({ code: 'provider_api_key_auth' });
    expect(existsSync(dump)).toBe(false);
  });

  it('generate: maps limit and login errors, passing the CLI message through', async () => {
    setEnv('FAKE_MODE', 'limit');
    await expect(make().generate(req())).rejects.toMatchObject({ code: 'rate_limited', message: expect.stringContaining('usage limit') });
    setEnv('FAKE_MODE', 'login');
    await expect(make().generate(req())).rejects.toMatchObject({ code: 'provider_not_logged_in' });
    setEnv('FAKE_MODE', 'nolines');
    await expect(make().generate(req())).rejects.toBeInstanceOf(ProviderError);
  });

  it('generate: empty result is empty_output', async () => {
    setEnv('FAKE_EMPTY', '1');
    await expect(make().generate(req())).rejects.toMatchObject({ code: 'empty_output' });
  });

  it('generate: abort stops a hanging run', async () => {
    setEnv('FAKE_MODE', 'hang');
    const ac = new AbortController();
    const p = make().generate({ system: 's', prompt: 'p', model: null, signal: ac.signal, onDelta: () => ac.abort() });
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('CodexProvider', () => {
  const make = (bin = codexBin) => new CodexProvider(bin, tmp, 10_000);
  const req = (extra: object = {}) => ({ system: 'SYS', prompt: 'PROMPT', model: null, signal: sig(), ...extra });

  it('check variants', async () => {
    expect(await make().check(true)).toMatchObject({ installed: true, version: '0.144.6', auth: 'subscription', usable: true, streams: false });
    setEnv('FAKE_LOGIN', 'Logged in using an API key - sk-***');
    expect((await make().check(true)).auth).toBe('api_key');
    setEnv('FAKE_LOGIN', 'Not logged in');
    expect((await make().check(true)).usable).toBe(false);
    expect((await make('/nonexistent/codex').check(true)).installed).toBe(false);
  });

  it('generate: exact args, system text then prompt on stdin, final message, one delta', async () => {
    setEnv('OPENAI_API_KEY', 'dummy');
    const deltas: string[] = [];
    const r = await make().generate(req({ onDelta: (t: string) => deltas.push(t) }));
    expect(r.text).toContain('Codex says [[World]]');
    expect(deltas).toEqual([r.text]);
    expect(r.usage).toEqual({ inputTokens: 13000, outputTokens: 300 });
    const d = JSON.parse(readFileSync(dump, 'utf8'));
    expect(d.args).toEqual(buildCodexArgs(tmp, null));
    expect(d.args.at(-1)).toBe('-');
    expect(d.stdin).toBe('SYS\n\nPROMPT');
    expect(d.env.OPENAI_API_KEY).toBeNull();
  });

  it('generate: turn.failed maps a limit message', async () => {
    setEnv('FAKE_MODE', 'failed');
    await expect(make().generate(req())).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('generate: refuses an API-key login', async () => {
    setEnv('FAKE_LOGIN', 'Logged in using an API key');
    await expect(make().generate(req())).rejects.toMatchObject({ code: 'provider_api_key_auth' });
    expect(existsSync(dump)).toBe(false);
  });
});

describe('FakeProvider', () => {
  const fake = new FakeProvider(() => 0);
  const run = (prompt: string, signal = sig()) => fake.generate({ system: '', prompt, model: null, signal });

  it('explains and answers deterministically', async () => {
    const a = await run('TASK: Explain "CNN" as it applies.');
    expect(a.text).toContain('[[CNN Part A]]');
    expect(a.text).toContain('===META===');
    expect((await run('TASK: Explain "CNN" as it applies.')).text).toBe(a.text);
    const q = await run('NODE: CNN\nQUESTION: why?');
    expect(q.text).toBe('Answer about **CNN**: why?. See [[Shared Concept]] and [[CNN Detail]].');
  });

  it('honours triggers', async () => {
    expect((await run('TASK: Explain "X __nometa__"')).text).not.toContain('===META===');
    expect((await run('TASK: Explain "X __badjson__"')).text).toContain('{not json');
    expect((await run('TASK: Explain "X __heading__"')).text.startsWith('# X __heading__')).toBe(true);
    await expect(run('TASK: Explain "X __ratelimit__"')).rejects.toMatchObject({ code: 'rate_limited', message: 'Fake rate limit.' });
    await expect(run('TASK: Explain "X __fail__"')).rejects.toMatchObject({ code: 'provider_failed' });
    await expect(run('TASK: Explain "X __empty__"')).rejects.toMatchObject({ code: 'empty_output' });
  });

  it('__hang__ waits until aborted', async () => {
    const ac = new AbortController();
    const p = run('TASK: Explain "X __hang__"', ac.signal);
    setTimeout(() => ac.abort(), 50);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});
