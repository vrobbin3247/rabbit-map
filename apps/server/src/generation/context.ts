import {
  buildIndex,
  pathOf,
  stripWikilinks,
  type ConceptNode,
  type MapFile,
  type MapIndex,
} from '@mindmapper/shared';
import { buildSystem } from './prompts';

export const PROMPT_BUDGET = 24_000;
const EXISTING_LIMIT = 300;
const BODY_LIMIT = 6000;
const ANSWER_LIMIT = 1200;

export interface BuiltPrompt {
  system: string;
  prompt: string;
}

function pathLine(map: MapFile, ids: string[]): string {
  const titles = ids.map((id) => (map.nodes[id] as ConceptNode).title);
  if (titles.length <= 8) return titles.join(' > ');
  return [titles[0], '…', ...titles.slice(-6)].join(' > ');
}

function pathNotes(map: MapFile, ids: string[], self: string): string[] {
  const ancestors = ids.filter((id) => id !== self).map((id) => map.nodes[id] as ConceptNode);
  return ancestors
    .filter((a) => a.summary.trim())
    .slice(-4)
    .map((a) => `- ${a.title}: ${a.summary.trim()}`);
}

/** Titles of existing nodes to offer the model, at most 300, most relevant first. */
export function existingTitles(map: MapFile, index: MapIndex, nodeId: string, pathIds: string[]): string[] {
  const all = Object.values(map.nodes);
  if (all.length <= EXISTING_LIMIT) return all.sort(byCreated).map((n) => n.title);
  const picked: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.size >= EXISTING_LIMIT || seen.has(id) || !map.nodes[id]) return;
    seen.add(id);
    picked.push(id);
  };
  pathIds.forEach(add);
  for (const p of pathIds) (index.children.get(p) ?? []).forEach(add);
  (index.outLinks.get(nodeId) ?? new Set()).forEach(add);
  [...all].sort(byCreated).reverse().forEach((n) => add(n.id));
  return picked.map((id) => (map.nodes[id] as ConceptNode).title);
}

function byCreated(a: ConceptNode, b: ConceptNode): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
}

function header(map: MapFile): string[] {
  const lines = [`MAP TOPIC: ${map.title}`];
  if (map.settings.goal) lines.push(`LEARNER GOAL: ${map.settings.goal}`);
  return lines;
}

function fit(blocks: { text: string; drop?: number }[], existing: string[], build: (existing: string) => string): string {
  let prompt = build(existing.join('; '));
  if (prompt.length <= PROMPT_BUDGET) return prompt;
  // Drop optional blocks in order, then shorten the existing-node list.
  for (const b of [...blocks].sort((a, b) => (a.drop ?? 0) - (b.drop ?? 0))) {
    if (b.drop === undefined) continue;
    b.text = '';
    prompt = build(existing.join('; '));
    if (prompt.length <= PROMPT_BUDGET) return prompt;
  }
  let list = existing;
  while (prompt.length > PROMPT_BUDGET && list.length > 1) {
    list = list.slice(0, Math.max(1, Math.floor(list.length * 0.8)));
    prompt = build(list.join('; '));
  }
  return prompt.slice(0, PROMPT_BUDGET);
}

export function buildExpandPrompt(map: MapFile, nodeId: string): BuiltPrompt {
  const node = map.nodes[nodeId] as ConceptNode;
  const index = buildIndex(map);
  const ids = pathOf(map, nodeId);
  const isRoot = nodeId === map.rootId;
  const system = buildSystem(map.settings.level, isRoot ? 'root' : 'expand');
  const existing = existingTitles(map, index, nodeId, ids);

  if (isRoot) {
    const prompt = [
      ...header(map),
      `EXISTING NODES: ${existing.join('; ') || map.title}`,
      `TASK: Give an overview of "${node.title}" that maps out the territory: what it is, why it matters, and its main parts.`,
    ].join('\n');
    return { system, prompt };
  }

  const notesBlock = { text: pathNotes(map, ids, nodeId).join('\n'), drop: 1 };
  const snippet = node.origin?.snippet ? stripWikilinks(node.origin.snippet) : '';
  const build = (ex: string) =>
    [
      ...header(map),
      `PATH: ${pathLine(map, ids)}`,
      ...(notesBlock.text ? ['PATH NOTES:', notesBlock.text] : []),
      ...(snippet ? [`INTRODUCED IN: "${snippet}"`] : []),
      `EXISTING NODES: ${ex}`,
      `TASK: Explain "${node.title}" as it applies in this path.`,
    ].join('\n');
  return { system, prompt: fit([notesBlock], existing, build) };
}

interface QA {
  q: string;
  a: string;
}

function earlierPairs(node: ConceptNode): QA[] {
  const pairs: QA[] = [];
  for (let i = 0; i < node.thread.length - 1; i++) {
    const u = node.thread[i];
    const a = node.thread[i + 1];
    if (u?.role === 'user' && a?.role === 'assistant' && a.status === 'ready') {
      pairs.push({ q: u.text, a: a.text.slice(0, ANSWER_LIMIT) });
    }
  }
  return pairs.slice(-3);
}

export function buildAskPrompt(
  map: MapFile,
  nodeId: string,
  question: string,
  quote: string | null,
): BuiltPrompt {
  const node = map.nodes[nodeId] as ConceptNode;
  const index = buildIndex(map);
  const ids = pathOf(map, nodeId);
  const system = buildSystem(map.settings.level, 'ask');
  const existing = existingTitles(map, index, nodeId, ids);
  const body = node.body !== null ? node.body.slice(0, BODY_LIMIT) : `(not written yet) ${node.summary}`.trim();
  const pairs = earlierPairs(node);
  const pairsBlock = { text: pairs.map((p) => `Q: ${p.q}\nA: ${p.a}`).join('\n'), drop: 2 };

  const build = (ex: string) =>
    [
      ...header(map),
      `PATH: ${pathLine(map, ids)}`,
      `EXISTING NODES: ${ex}`,
      `NODE: ${node.title}`,
      'NODE EXPLANATION:',
      body,
      ...(pairsBlock.text ? ['EARLIER QUESTIONS ON THIS NODE:', pairsBlock.text] : []),
      ...(quote ? [`QUOTED TEXT: "${quote}"`] : []),
      `QUESTION: ${question}`,
    ].join('\n');
  return { system, prompt: fit([pairsBlock], existing, build) };
}
