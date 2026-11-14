import { ProviderError } from '../providers/types';
import { AppError } from '../errors';

export class Job {
  readonly ac = new AbortController();
  queued: boolean;
  ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (e: unknown) => void;
  private finished = false;

  constructor(
    readonly key: string,
    queued: boolean,
    private onDone: (job: Job) => void,
  ) {
    this.queued = queued;
    this.ready = new Promise<void>((res, rej) => {
      this.resolveReady = res;
      this.rejectReady = rej;
    });
    this.ready.catch(() => undefined);
    if (!queued) this.resolveReady();
    this.ac.signal.addEventListener('abort', () => {
      if (this.queued) this.rejectReady(new ProviderError('aborted', 'Cancelled.'));
    });
  }

  get signal(): AbortSignal {
    return this.ac.signal;
  }

  /** Called by the manager when a slot frees up. */
  start(): void {
    this.queued = false;
    this.resolveReady();
  }

  abort(): void {
    this.ac.abort();
  }

  done(): void {
    if (this.finished) return;
    this.finished = true;
    this.onDone(this);
  }
}

/** One job per key, at most `max` running at once, FIFO queue. */
export class JobManager {
  private all = new Map<string, Job>();
  private running = new Set<Job>();
  private queue: Job[] = [];

  constructor(private max: number) {}

  has(key: string): boolean {
    return this.all.has(key);
  }

  hasAny(keys: Iterable<string>): boolean {
    for (const k of keys) if (this.all.has(k)) return true;
    return false;
  }

  begin(key: string): Job {
    if (this.all.has(key)) throw new AppError('conflict', 'Something is already being written for this node.');
    const queued = this.running.size >= this.max;
    const job = new Job(key, queued, (j) => this.release(j));
    this.all.set(key, job);
    if (queued) this.queue.push(job);
    else this.running.add(job);
    return job;
  }

  private release(job: Job): void {
    this.all.delete(job.key);
    this.running.delete(job);
    const qi = this.queue.indexOf(job);
    if (qi >= 0) this.queue.splice(qi, 1);
    while (this.running.size < this.max && this.queue.length) {
      const next = this.queue.shift() as Job;
      this.running.add(next);
      next.start();
    }
  }

  abortAll(): void {
    for (const j of this.all.values()) j.abort();
  }

  get activeCount(): number {
    return this.all.size;
  }
}
