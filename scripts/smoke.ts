/**
 * One real call through a real provider. Spends a little of the user's plan quota, so run it by hand:
 *   npm run smoke -- claude [--model haiku] [--record file.jsonl]
 *   npm run smoke -- codex
 *   npm run smoke -- claude --ask "what are different paddings"   (a question on a Padding node)
 *   npm run smoke -- claude --expand "Sensor Size"   (explain a concept that has a set of kinds)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StreamFilter, buildIndex, parseAskOutput, parseExpandOutput, resolve } from '@mindmapper/shared';
import { ensureDirs, loadConfig } from '../apps/server/src/config';
import { buildExpandPrompt } from '../apps/server/src/generation/context';
import { Registry } from '../apps/server/src/providers/registry';
import { buildAskPrompt } from '../apps/server/src/generation/context';
import { createMap, finishAsk, finishExpand, openConcept, startAsk, startExpand } from '../apps/server/src/store/mutations';

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

const askQuestion = flag('--ask');
if (askQuestion) {
  const m = createMap('Deep learning', { level: 'beginner', goal: null, provider: id, model: flag('--model') ?? null });
  const gen = { provider: id, model: null, at: '', durationMs: 0, metaRecovered: false };
  startExpand(m, m.rootId);
  finishExpand(m, m.rootId, { body: 'Overview.', summary: 'Neural networks with many layers.', aliases: [], children: [{ title: 'Convolutional Neural Network', summary: 'Image models.' }], metaRecovered: false }, gen);
  const cnnId = Object.values(m.nodes).find((n) => n.title === 'Convolutional Neural Network')!.id;
  startExpand(m, cnnId);
  finishExpand(m, cnnId, { body: 'A CNN slides small filters across an image.', summary: 'Image models.', aliases: ['CNN'], children: [{ title: 'Convolution', summary: 'Sliding a filter over an image.' }, { title: 'Stride', summary: 'How far the filter moves each step.' }], metaRecovered: false }, gen);
  const conv = Object.values(m.nodes).find((n) => n.title === 'Convolution')!;
  const padding = openConcept(m, conv.id, 'Padding').node;
  startExpand(m, padding.id);
  finishExpand(m, padding.id, { body: 'Padding adds border zeros around an image before convolution so the output does not shrink.', summary: 'Adding border zeros around images before convolution.', aliases: [], children: [], metaRecovered: false }, gen);

  const started = startAsk(m, padding.id, { question: askQuestion });
  const { system, prompt } = buildAskPrompt(m, padding.id, started.question, null);
  const ac = new AbortController();
  const t = Date.now();
  const result = await provider.generate({ system, prompt, model: m.settings.model, signal: ac.signal });
  const parsed = parseAskOutput(result.text, padding.title, padding.aliases);
  const changed = finishAsk(m, padding.id, started.assistantId, parsed.text, gen, parsed.children);
  console.log('\n--- ANSWER ---\n' + parsed.text);
  console.log(`\n--- RESULT ---\ntotal: ${((Date.now() - t) / 1000).toFixed(1)}s   tokens:`, result.usage);
  console.log('suggested children:', parsed.children);
  console.log('nodes created under Padding:', changed.slice(1).map((i) => m.nodes[i]?.title));
  console.log('cross-links (See also):', m.nodes[padding.id]?.related.map((i) => m.nodes[i]?.title));
  const links = [...parsed.text.matchAll(/\[\[([^\]|]+)/g)].map((x) => x[1]);
  console.log('links in answer:', links, ' all resolve to nodes:', links.every((l) => Object.values(m.nodes).some((n) => n.title.toLowerCase() === (l ?? '').toLowerCase())));
  process.exit(0);
}

// An explanation of a concept that has a well-known set of kinds: do we get the whole set, or only the commonest?
const expandConcept = flag('--expand');
if (expandConcept) {
  const m = createMap('Photography', { level: 'beginner', goal: 'I want to take photography as a hobby', provider: id, model: flag('--model') ?? null });
  const gen = { provider: id, model: null, at: '', durationMs: 0, metaRecovered: false };
  startExpand(m, m.rootId);
  finishExpand(m, m.rootId, { body: 'Overview.', summary: 'Taking photographs.', aliases: [], children: [{ title: 'Image Sensor', summary: 'The chip that records light.' }, { title: 'Lens', summary: 'Focuses light.' }], metaRecovered: false }, gen);
  const sensor = Object.values(m.nodes).find((n) => n.title === 'Image Sensor')!;
  startExpand(m, sensor.id);
  finishExpand(m, sensor.id, { body: 'The image sensor is the chip behind the lens that records light.', summary: 'The chip that records light.', aliases: [], children: [{ title: 'Pixel', summary: 'One light-sensitive spot.' }, { title: 'Dynamic Range', summary: 'Darkest to brightest detail.' }], metaRecovered: false }, gen);
  const target = openConcept(m, sensor.id, expandConcept).node;
  const { system, prompt } = buildExpandPrompt(m, target.id);
  const result = await provider.generate({ system, prompt, model: m.settings.model, signal: new AbortController().signal });
  const index = buildIndex(m);
  const parsed = parseExpandOutput(result.text, target.title, target.aliases, (n) => resolve(index, n));
  console.log('\n--- EXPLANATION ---\n' + parsed.body);
  console.log(`\n--- RESULT ---\ntotal: ${(result.durationMs / 1000).toFixed(1)}s   words: ${parsed.body.split(/\s+/).length}   tokens:`, result.usage);
  console.log('children:', parsed.children.map((c) => c.title));
  process.exit(0);
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
