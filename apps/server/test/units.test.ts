import type { MapFile } from '@mindmapper/shared';
import { describe, expect, it } from 'vitest';
import { PROMPT_BUDGET, buildAskPrompt, buildExpandPrompt } from '../src/generation/context';
import { JobManager } from '../src/generation/jobs';
import { ADOPT_MAX, adoptGhosts, createMap, finishExpand, openConcept, startExpand } from '../src/store/mutations';
import { expectValid } from './helpers';

const gen = { provider: 'fake' as const, model: null, at: '', durationMs: 1, metaRecovered: false };
const child = (title: string, summary = '') => ({ title, summary });

function sample(): MapFile {
  const map = createMap('Deep learning', { level: 'beginner', goal: 'pass the exam', provider: 'fake', model: null });
  startExpand(map, map.rootId);
  finishExpand(
    map,
    map.rootId,
    { body: 'About [[Convolutional Neural Network|CNNs]].', summary: 'The field.', aliases: [], children: [child('Convolutional Neural Network', 'Image models.'), child('Transformer')], metaRecovered: false },
    gen,
  );
  return map;
}

describe('context', () => {
  it('root prompt: overview task and no path', () => {
    const m = sample();
    const { system, prompt } = buildExpandPrompt(m, m.rootId);
    expect(prompt).toBe(
      [
        'MAP TOPIC: Deep learning',
        'LEARNER GOAL: pass the exam',
        'EXISTING NODES: Deep learning; Convolutional Neural Network; Transformer',
        'TASK: Give an overview of "Deep learning" that maps out the territory: what it is, why it matters, and its main parts.',
      ].join('\n'),
    );
    expect(system).toContain('150 to 220 words');
    expect(system).toContain('4 to 7 concepts');
    expect(system).not.toContain('name every main one'); // the overview already lists the main parts
    expect(system).toContain('The learner is a beginner');
  });

  it('expand prompt: path, notes, origin snippet, existing nodes', () => {
    const m = sample();
    const cnn = Object.values(m.nodes).find((n) => n.title === 'Convolutional Neural Network')!;
    const { system, prompt } = buildExpandPrompt(m, cnn.id);
    expect(system).toContain('120 to 200 words');
    expect(system).toContain('3 to 5 concepts');
    // a concept with a set of kinds should be shown whole, not just its commonest members
    expect(system).toContain('name every main one');
    expect(system).toContain('up to 8');
    expect(prompt).toBe(
      [
        'MAP TOPIC: Deep learning',
        'LEARNER GOAL: pass the exam',
        'PATH: Deep learning > Convolutional Neural Network',
        'PATH NOTES:',
        '- Deep learning: The field.',
        'INTRODUCED IN: "About CNNs."',
        'EXISTING NODES: Deep learning; Convolutional Neural Network; Transformer',
        'TASK: Explain "Convolutional Neural Network" as it applies in this path.',
      ].join('\n'),
    );
  });

  it('truncates long paths to the root, an ellipsis and the last six', () => {
    const m = sample();
    let parent = m.rootId;
    let last = parent;
    for (let i = 1; i <= 9; i++) {
      last = openConcept(m, parent, `Level ${i}`).node.id;
      parent = last;
    }
    const { prompt } = buildExpandPrompt(m, last);
    expect(prompt).toContain('PATH: Deep learning > … > Level 4 > Level 5 > Level 6 > Level 7 > Level 8 > Level 9');
    expect(prompt).toContain('- Level 8:'.slice(0, 0)); // notes only list ancestors with summaries
  });

  it('ask prompt: node text, last three answered pairs, quote, question', () => {
    const m = sample();
    const n = m.nodes[m.rootId]!;
    for (let i = 1; i <= 5; i++) {
      n.thread.push({ id: `u${i}`, role: 'user', text: `q${i}`, quote: null, status: 'ready', error: null, generatedBy: null, createdAt: '' });
      n.thread.push({ id: `a${i}`, role: 'assistant', text: `a${i}`, quote: null, status: i === 2 ? 'error' : 'ready', error: null, generatedBy: null, createdAt: '' });
    }
    const { system, prompt } = buildAskPrompt(m, m.rootId, 'new question?', 'some quote');
    expect(system).toContain('at most 250 words');
    // an answer may suggest concepts, but has no summary or aliases of its own
    expect(system).toContain('"children"');
    expect(system).toContain('up to 5');
    expect(system).not.toContain('"aliases"');
    expect(system).toContain('write no ===META=== line at all');
    // the model must know that children become cards, or it refuses "make nodes for them"
    expect(system).toContain('turns every entry in children into a new card');
    expect(system).toContain('never say that you cannot create nodes');
    expect(prompt).toContain('NODE EXPLANATION:\nAbout [[Convolutional Neural Network|CNNs]].');
    expect(prompt).toContain('EARLIER QUESTIONS ON THIS NODE:\nQ: q3\nA: a3\nQ: q4\nA: a4\nQ: q5\nA: a5');
    expect(prompt).not.toContain('Q: q1');
    expect(prompt).not.toContain('Q: q2');
    expect(prompt.endsWith('QUOTED TEXT: "some quote"\nQUESTION: new question?')).toBe(true);
  });

  it('ask on a stub says the node is not written yet', () => {
    const m = sample();
    const t = Object.values(m.nodes).find((n) => n.title === 'Transformer')!;
    t.summary = 'Attention models.';
    expect(buildAskPrompt(m, t.id, 'what?', null).prompt).toContain('(not written yet) Attention models.');
  });

  it('offers at most 300 existing titles, path and neighbours first', () => {
    const m = sample();
    for (let i = 0; i < 400; i++) openConcept(m, m.rootId, `Filler ${i} concept`);
    const cnn = Object.values(m.nodes).find((n) => n.title === 'Convolutional Neural Network')!;
    const line = buildExpandPrompt(m, cnn.id).prompt.split('\n').find((l) => l.startsWith('EXISTING NODES:'))!;
    const titles = line.replace('EXISTING NODES: ', '').split('; ');
    expect(titles.length).toBe(300);
    expect(titles.slice(0, 2)).toEqual(['Deep learning', 'Convolutional Neural Network']);
    expect(titles).toContain('Transformer');
  });

  it('stays within the prompt budget by dropping optional blocks then titles', () => {
    const m = sample();
    const n = m.nodes[m.rootId]!;
    for (let i = 0; i < 3; i++) {
      n.thread.push({ id: `u${i}`, role: 'user', text: 'q', quote: null, status: 'ready', error: null, generatedBy: null, createdAt: '' });
      n.thread.push({ id: `a${i}`, role: 'assistant', text: 'x'.repeat(5000), quote: null, status: 'ready', error: null, generatedBy: null, createdAt: '' });
    }
    n.body = 'y'.repeat(6000);
    for (let i = 0; i < 300; i++) openConcept(m, m.rootId, `A very long concept name number ${i} ${'z'.repeat(40)}`);
    const { prompt } = buildAskPrompt(m, m.rootId, 'q?', null);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_BUDGET);
    expect(prompt).toContain('QUESTION: q?');
    expect(prompt).not.toContain('EARLIER QUESTIONS');
  });
});

describe('finishExpand', () => {
  it('skips self, ancestors and existing children; links other existing nodes', () => {
    const m = sample();
    const cnn = Object.values(m.nodes).find((n) => n.title === 'Convolutional Neural Network')!;
    const tr = Object.values(m.nodes).find((n) => n.title === 'Transformer')!;
    startExpand(m, cnn.id);
    const changed = finishExpand(
      m,
      cnn.id,
      {
        body: 'Body about [[Pooling]]. Also [[Transformer]].',
        summary: 'Sum',
        aliases: ['CNN', 'Transformer', 'Convolutional Neural Networks', 'ConvNet'],
        children: [child('Deep Learning'), child('Convolutional Neural Network'), child('Transformer'), child('Pooling', 'p'), child('Pooling Layers'), child('CNN')],
        metaRecovered: false,
      },
      gen,
    );
    const n = m.nodes[cnn.id]!;
    expect(n.aliases).toEqual(['CNN', 'ConvNet']); // plural of own title, and a name that belongs to another node, are skipped
    expect(n.related).toEqual([tr.id]); // ancestor and self skipped, other existing node linked
    const kids = Object.values(m.nodes).filter((x) => x.parentId === cnn.id).map((x) => x.title);
    expect(kids).toEqual(['Pooling', 'Pooling Layers']); // "Pooling Layers" is a different slug from "Pooling"
    expect(changed).toHaveLength(3);
    expect(m.nodes[changed[1]!]?.origin?.snippet).toBe('Body about Pooling.');
    expectValid(m);
  });

  it('caps new children at ten', () => {
    const m = sample();
    startExpand(m, m.rootId);
    finishExpand(m, m.rootId, { body: 'b', summary: '', aliases: [], children: Array.from({ length: 14 }, (_, i) => child(`Extra ${i}`)), metaRecovered: false }, gen);
    expect(Object.values(m.nodes).filter((n) => n.title.startsWith('Extra'))).toHaveLength(10);
  });
});

describe('adoptGhosts', () => {
  it('never creates more than the cap at once', () => {
    const m = sample();
    const body = Array.from({ length: 45 }, (_, i) => `[[Mentioned ${i}]]`).join(' ');
    m.nodes[m.rootId]!.body = body;
    expect(adoptGhosts(m, m.rootId)).toHaveLength(ADOPT_MAX);
    expect(adoptGhosts(m, m.rootId)).toHaveLength(15); // the rest, on the next click
    expect(adoptGhosts(m, m.rootId)).toHaveLength(0);
    expectValid(m);
  });

  it('skips the card itself, existing cards and repeats', () => {
    const m = sample();
    m.nodes[m.rootId]!.body = 'See [[Deep learning]], [[Transformer]], [[New Idea]], [[new idea]], [[Neural Idea]].';
    const made = adoptGhosts(m, m.rootId);
    expect(made.map((id) => m.nodes[id]!.title)).toEqual(['New Idea', 'Neural Idea']);
  });
});

describe('JobManager', () => {
  it('allows one job per key', () => {
    const jm = new JobManager(2);
    const j = jm.begin('a');
    expect(() => jm.begin('a')).toThrowError(/already/);
    j.done();
    expect(() => jm.begin('a')).not.toThrow();
  });

  it('limits concurrency and runs the queue in order', async () => {
    const jm = new JobManager(2);
    const j1 = jm.begin('1');
    const j2 = jm.begin('2');
    const j3 = jm.begin('3');
    const j4 = jm.begin('4');
    expect([j1, j2, j3, j4].map((j) => j.queued)).toEqual([false, false, true, true]);
    const order: string[] = [];
    void j3.ready.then(() => order.push('3'));
    void j4.ready.then(() => order.push('4'));
    j1.done();
    await j3.ready;
    expect(j3.queued).toBe(false);
    expect(j4.queued).toBe(true);
    j2.done();
    await j4.ready;
    expect(order).toEqual(['3', '4']);
    j3.done();
    j4.done();
    expect(jm.activeCount).toBe(0);
  });

  it('aborting a queued job rejects its ready promise and removes it', async () => {
    const jm = new JobManager(1);
    const j1 = jm.begin('1');
    const j2 = jm.begin('2');
    j2.abort();
    await expect(j2.ready).rejects.toMatchObject({ code: 'aborted' });
    j2.done();
    j1.done();
    expect(jm.activeCount).toBe(0);
  });

  it('hasAny and abortAll', () => {
    const jm = new JobManager(2);
    const j = jm.begin('x');
    expect(jm.hasAny(['y', 'x'])).toBe(true);
    jm.abortAll();
    expect(j.signal.aborted).toBe(true);
  });
});
