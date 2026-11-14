import type { HealthResponse, ProviderId, ProviderStatus } from '@mindmapper/shared';
import type { Config } from '../config';
import { ClaudeProvider } from './claude';
import { CodexProvider } from './codex';
import { FakeProvider } from './fake';
import type { Provider } from './types';

export class Registry {
  private providers = new Map<ProviderId, Provider>();

  constructor(private config: Config) {
    const forced = config.forcedProvider;
    const all: Provider[] = [
      new ClaudeProvider(config.claudeBin, config.sandboxDir, config.timeoutMs),
      new CodexProvider(config.codexBin, config.sandboxDir, config.timeoutMs),
      new FakeProvider(() => this.config.fakeDelayMs),
    ];
    for (const p of all) {
      if (forced ? p.id === forced : p.id !== 'fake') this.providers.set(p.id, p);
    }
  }

  get(id: ProviderId): Provider | undefined {
    return this.providers.get(id);
  }

  ids(): ProviderId[] {
    return [...this.providers.keys()];
  }

  async health(refresh = false): Promise<HealthResponse> {
    const statuses: ProviderStatus[] = await Promise.all(
      [...this.providers.values()].map((p) => p.check(refresh)),
    );
    const order: ProviderId[] = ['claude', 'codex', 'fake'];
    statuses.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const first = statuses.find((s) => s.usable);
    return { providers: statuses, defaultProvider: first ? first.id : null };
  }
}
