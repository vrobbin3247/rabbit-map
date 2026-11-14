import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MapFileSchema, type MapFile, type MapSummary } from '@mindmapper/shared';
import { AppError } from '../errors';
import { ULID_RE, now } from '../ids';
import { repairMap } from './repair';

export interface UnreadableMap {
  id: string;
  message: string;
}

export class MapStore {
  private cache = new Map<string, MapFile>();
  private queues = new Map<string, Promise<unknown>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private unreadable = new Map<string, UnreadableMap>();

  constructor(
    private dir: string,
    private viewDebounceMs = 500,
  ) {}

  private file(id: string): string {
    if (!ULID_RE.test(id)) throw new AppError('invalid_request', 'Invalid map id.');
    return path.join(this.dir, `${id}.json`);
  }

  private async write(map: MapFile): Promise<void> {
    const f = this.file(map.id);
    const tmp = `${f}.tmp`;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(tmp, JSON.stringify(map, null, 2), 'utf8');
      await rename(tmp, f);
    } catch (e) {
      throw new AppError('storage_failed', `Could not save to disk: ${(e as Error).message}`);
    }
  }

  private async load(id: string): Promise<MapFile> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const f = this.file(id);
    let raw: string;
    try {
      raw = await readFile(f, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('not_found', 'Map not found.');
      throw new AppError('storage_failed', (e as Error).message);
    }
    let parsed;
    try {
      parsed = MapFileSchema.safeParse(JSON.parse(raw));
    } catch (e) {
      this.unreadable.set(id, { id, message: `Invalid JSON: ${(e as Error).message}` });
      throw new AppError('storage_failed', 'This map file could not be read.');
    }
    if (!parsed.success) {
      this.unreadable.set(id, { id, message: parsed.error.issues[0]?.message ?? 'Invalid map file.' });
      throw new AppError('storage_failed', 'This map file could not be read.');
    }
    const map = parsed.data;
    if (!map.nodes[map.rootId]) {
      this.unreadable.set(id, { id, message: 'The root node is missing.' });
      throw new AppError('storage_failed', 'This map file could not be read.');
    }
    this.unreadable.delete(id);
    if (repairMap(map)) await this.write(map);
    this.cache.set(id, map);
    return map;
  }

  private enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  }

  /** The in-memory map. Do not mutate; use `mutate`. */
  async get(id: string): Promise<MapFile> {
    await (this.queues.get(id) ?? Promise.resolve());
    return this.load(id);
  }

  async list(): Promise<{ maps: MapSummary[]; unreadable: UnreadableMap[] }> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const maps: MapSummary[] = [];
    for (const f of files) {
      const id = f.slice(0, -5);
      if (!ULID_RE.test(id)) continue;
      try {
        const m = await this.load(id);
        maps.push({ id, title: m.title, createdAt: m.createdAt, updatedAt: m.updatedAt, nodeCount: Object.keys(m.nodes).length });
      } catch {
        /* recorded in this.unreadable */
      }
    }
    maps.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return { maps, unreadable: [...this.unreadable.values()] };
  }

  async create(map: MapFile): Promise<MapFile> {
    await this.write(map);
    this.cache.set(map.id, map);
    return map;
  }

  /** Run `fn` on a copy of the map, one at a time per map, then save. */
  mutate<T>(id: string, fn: (draft: MapFile) => T, opts: { deferWrite?: boolean } = {}): Promise<T> {
    return this.enqueue(id, async () => {
      const current = await this.load(id);
      const draft = structuredClone(current);
      const result = fn(draft);
      draft.updatedAt = now();
      if (opts.deferWrite) {
        this.cache.set(id, draft);
        this.scheduleWrite(id);
      } else {
        await this.write(draft);
        this.cache.set(id, draft);
        this.cancelTimer(id);
      }
      return result;
    });
  }

  private cancelTimer(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  private scheduleWrite(id: string) {
    this.cancelTimer(id);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.enqueue(id, async () => {
          const m = this.cache.get(id);
          if (m) await this.write(m);
        }).catch(() => undefined);
      }, this.viewDebounceMs),
    );
  }

  async flush(): Promise<void> {
    for (const id of [...this.timers.keys()]) {
      this.cancelTimer(id);
      const m = this.cache.get(id);
      if (m) await this.enqueue(id, () => this.write(m)).catch(() => undefined);
    }
    await Promise.all([...this.queues.values()]);
  }

  async delete(id: string): Promise<void> {
    await this.load(id);
    await this.enqueue(id, async () => {
      this.cancelTimer(id);
      this.cache.delete(id);
      await rm(this.file(id), { force: true });
    });
  }
}
