import type { Level } from '@mindmapper/shared';

export const BASE = `You write the content of nodes in a personal learning knowledge graph. One learner is exploring one topic. Each node explains exactly one concept.

Rules:
- Explain only the concept or answer only the question you are given. Do not re-explain its ancestors or wander into neighbouring topics; link to them instead.
- Wrap every concept the learner might want to open next in double square brackets, like [[Pooling]]. To show different words from the concept's name, write [[Activation Function|activation]].
- EXISTING NODES lists concepts already in the graph. When you mean one of them, link it using its title exactly as listed. Invent a new name only when no listed node means the same thing.
- Name a new concept by its most common textbook name, singular, in Title Case.
- Link each concept once, at its first mention. Do not link the concept you are explaining.
- Define in a few words any technical term that you do not link.
- Write Markdown. No title heading, no preamble, no closing remarks or offers of more help.
- Use $...$ for inline math and $$...$$ for display math. Use fenced code blocks for code.
- Answer from your own knowledge. Do not run commands, read files or browse.`;

export const LEVEL_TEXT: Record<Level, string> = {
  beginner:
    'The learner is a beginner. Assume no background beyond school mathematics. Use plain words and one concrete example.',
  intermediate: 'The learner knows the basics of the map topic. Be precise and use standard terminology.',
  advanced: 'The learner has a strong background. Be concise and technical, and include the key mechanism or equation.',
};

export type PromptKind = 'root' | 'expand' | 'ask';

function expandFormat(root: boolean): string {
  const [minW, maxW, minC, maxC] = root ? [150, 220, 4, 7] : [120, 200, 3, 5];
  return `Output format, exactly:
1. The explanation, ${minW} to ${maxW} words.
2. A line containing only ===META===
3. One JSON object, with no code fence and nothing after it:
{"summary": "<one sentence, at most 25 words>", "aliases": ["<other common names or abbreviations, at most 6>"], "children": [{"title": "<concept name>", "summary": "<one sentence, at most 25 words>"}]}
children: the ${minC} to ${maxC} concepts to open next in order to understand this one more deeply, most important first. Each must be a part, mechanism or direct prerequisite of this concept, not one of its ancestors. Link each child in the explanation where it fits naturally.`;
}

const ASK_FORMAT = `Output format, exactly:
1. The answer in Markdown, at most 250 words. Wrap in [[double brackets]] every distinct concept, type, kind or step that you name and that a learner could study on its own, even when you also write it in bold. For example: [[Same Padding|same padding]].
2. Only if you named such concepts: a line containing only ===META=== and then one JSON object, with no code fence and nothing after it:
{"children": [{"title": "<concept name>", "summary": "<one sentence, at most 25 words>"}]}
children: up to 5 of those concepts, most important first. A title must make sense on its own, for example "Same Padding" rather than "Same". Leave out anything the node itself or one of its ancestors already covers.
If you named no such concepts, write no ===META=== line at all.`;

export function buildSystem(level: Level, kind: PromptKind): string {
  const format = kind === 'ask' ? ASK_FORMAT : expandFormat(kind === 'root');
  return [BASE, LEVEL_TEXT[level], format].join('\n\n');
}
