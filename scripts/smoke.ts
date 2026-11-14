/**
 * One real call through a real provider. Spends a little of the user's plan quota, so run it by hand:
 *   npm run smoke -- claude [--model haiku] [--record file.jsonl]
 *   npm run smoke -- codex
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StreamFilter, buildIndex, parseExpandOutput, resolve } from '@mindmapper/shared';
import { ensureDirs, loadConfig } from '../apps/server/src/config';
import { buildExpandPrompt } from '../apps/server/src/generation/context';
import { Registry } from '../apps/server/src/providers/registry';
import { createMap, finishExpand, startExpand } from '../apps/server/src/store/mutations';

const args = process.argv.slice(2);
const id = args[0] as 'claude' | 'codex' | undefined;
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (id !== 'claude' && id !== 'codex') {
  console.error('Usage: npm run smoke -- <claude|codex> [--model m] [--record file]');
  process.exit(2);
}

const config = loadConfig();
ensureDirs(config);
const registry = new Registry(config);
const provider = registry.get(id);
if (!provider) throw new Error(`provider ${id} not registered`);

const status = await provider.check(true);
console.log('Provider status:', JSON.stringify({ ...status }, null, 2));
if (!status.usable) {
  console.error(`\nNot usable: ${status.reason ?? ''} ${status.fix ?? ''}`);
  process.exit(1);
}

const map = createMap('Deep learning', { level: 'beginner', goal: null, provider: id, model: flag('--model') ?? null });
startExpand(map, map.rootId);
finishExpand(
  map,
  map.rootId,
  {
    body: 'Overview.',
    summary: 'Neural networks with many layers.',
    aliases: [],
    children: ['Convolutional Neural Network', 'Transformer', 'Neuron', 'Activation Function', 'Backpropagation'].map((title) => ({ title, summary: '' })),
    metaRecovered: false,
  },
  { provider: id, model: null, at: '', durationMs: 0, metaRecovered: false },
);
const cnn = Object.values(map.nodes).find((n) => n.title === 'Convolutional Neural Network')!;
const { system, prompt } = buildExpandPrompt(map, cnn.id);
console.log('\n--- PROMPT ---\n' + prompt + '\n');

const ac = new AbortController();
process.on('SIGINT', () => ac.abort());
const filter = new StreamFilter();
const t0 = Date.now();
let firstDelta: number | null = null;
const result = await provider.generate({
  system,
  prompt,
  model: map.settings.model,
  signal: ac.signal,
  onStatus: (p) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] status: ${p}`),
  onDelta: (t) => {
    firstDelta ??= Date.now() - t0;
    process.stdout.write(filter.push(t));
  },
});
process.stdout.write(filter.flush());

const index = buildIndex(map);
const parsed = parseExpandOutput(result.text, cnn.title, cnn.aliases, (n) => resolve(index, n));
const words = parsed.body.split(/\s+/).length;
console.log('\n\n--- RESULT ---');
console.log(`time to first delta: ${firstDelta === null ? 'n/a' : (firstDelta / 1000).toFixed(1) + 's'}   total: ${(result.durationMs / 1000).toFixed(1)}s   streams: ${provider.streams}`);
console.log('tokens:', result.usage);
console.log(`words: ${words} (target 120-200)   metaRecovered: ${parsed.metaRecovered}`);
console.log('summary:', parsed.summary);
console.log('aliases:', parsed.aliases);
console.log('children:', parsed.children.map((c) => c.title));
console.log('starts with heading:', /^#/.test(parsed.body));

const rec = flag('--record');
if (rec) {
  mkdirSync(path.dirname(path.resolve(rec)), { recursive: true });
  writeFileSync(path.resolve(rec), result.text);
  console.log(`recorded final text to ${rec}`);
}
