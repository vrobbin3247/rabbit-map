import type { ProviderStatus } from '@mindmapper/shared';
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type Provider,
} from './types';

const SHARED = 'Shared Concept';

function field(prompt: string, name: string): string | null {
  const m = prompt.match(new RegExp(`^${name}: (.*)$`, 'm'));
  return m ? (m[1] as string).trim() : null;
}

function taskConcept(prompt: string): string | null {
  const m = prompt.match(/^TASK: (?:Explain|Give an overview of) "(.*?)"/m);
  return m ? (m[1] as string) : null;
}

/** Deterministic provider for tests and UI work. See docs/TESTING.md section 3. */
export class FakeProvider implements Provider {
  readonly id = 'fake' as const;
  readonly streams = true;

  constructor(private delayMs: () => number = () => Number(process.env.MINDMAPPER_FAKE_DELAY_MS ?? 15)) {}

  async check(): Promise<ProviderStatus> {
    return {
      id: 'fake',
      installed: true,
      version: 'test',
      loggedIn: true,
      auth: 'subscription',
      plan: null,
      usable: true,
      reason: null,
      fix: null,
      models: [],
      streams: true,
    };
  }

  private compose(prompt: string): string {
    const concept = taskConcept(prompt);
    const question = field(prompt, 'QUESTION');
    const trigger = `${concept ?? ''} ${question ?? ''}`;
    if (trigger.includes('__ratelimit__')) throw new ProviderError('rate_limited', 'Fake rate limit.');
    if (trigger.includes('__fail__')) throw new ProviderError('provider_failed', 'Fake failure.');
    if (trigger.includes('__empty__')) return '';

    if (concept !== null) {
      const x = concept;
      let text = `**${x}** is explained here for testing. It builds on [[${x} Part A]] and [[${x} Part B]], and it uses [[${x} Part C]].\n\nIt is also related to [[${SHARED}]].`;
      if (trigger.includes('__heading__')) text = `# ${x}\n\n${text}`;
      if (trigger.includes('__nometa__')) return text;
      const kids = [
        { title: `${x} Part A`, summary: `First part of ${x}.` },
        { title: `${x} Part B`, summary: `Second part of ${x}.` },
        { title: `${x} Part C`, summary: `Third part of ${x}.` },
        { title: SHARED, summary: 'A concept every node refers to.' },
      ];
      const meta = trigger.includes('__badjson__')
        ? '{not json'
        : JSON.stringify({ summary: `Summary of ${x}.`, aliases: [], children: kids });
      return `${text}\n\n===META===\n${meta}`;
    }
    if (question !== null) {
      const n = field(prompt, 'NODE') ?? 'this node';
      const text = `Answer about **${n}**: ${question}. See [[${SHARED}]] and [[${n} Detail]].`;
      if (!trigger.includes('__children__')) return text;
      // Like a real answer that names kinds of the concept: link them and suggest them as nodes.
      const kids = [
        { title: `${n} Kind One`, summary: `First kind of ${n}.` },
        { title: `${n} Kind Two`, summary: `Second kind of ${n}.` },
        { title: SHARED, summary: 'A concept every node refers to.' },
      ];
      return `${text} Kinds: [[${n} Kind One]] and [[${n} Kind Two]].\n\n===META===\n${JSON.stringify({ children: kids })}`;
    }
    return 'Fake provider: no task found in prompt.';
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();
    const text = this.compose(req.prompt);
    req.onStatus?.('starting');
    req.onStatus?.('generating');
    const hang = req.prompt.includes('__hang__');
    const delay = this.delayMs();
    const chunks = text.match(/[\s\S]{1,16}/g) ?? [];

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        if (ms <= 0) return resolve();
        const done = () => {
          clearTimeout(t);
          req.signal.removeEventListener('abort', done);
          resolve();
        };
        const t = setTimeout(done, ms);
        req.signal.addEventListener('abort', done, { once: true });
      });

    for (let i = 0; i < chunks.length; i++) {
      if (req.signal.aborted) throw new ProviderError('aborted', 'Cancelled.');
      req.onDelta?.(chunks[i] as string);
      if (hang && i === 0) {
        await new Promise<void>((resolve) => {
          if (req.signal.aborted) return resolve();
          req.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new ProviderError('aborted', 'Cancelled.');
      }
      await wait(delay);
    }
    if (req.signal.aborted) throw new ProviderError('aborted', 'Cancelled.');
    if (!text.trim()) throw new ProviderError('empty_output', 'The model returned no text.');
    return { text, model: req.model, durationMs: Date.now() - started, usage: {} };
  }
}
