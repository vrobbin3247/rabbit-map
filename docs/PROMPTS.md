# Prompts and output format

This file defines what is sent to the model, what comes back, and how it is parsed. The prompt text lives in `apps/server/src/generation/prompts.ts`; the parser lives in `packages/shared/src/protocol.ts`.

## 1. Principles

- **Every call is self-contained.** No CLI session is resumed. The prompt is rebuilt from the map each time, so the model always sees the path back to the root. This is what stops the AI from losing the original point, and it lets a map switch providers freely.
- **One call per learner action.**
- **Plain text out.** The model writes Markdown, then a delimiter, then a small JSON object. The same format works for every provider and can be streamed.
- **Small prompts.** Titles and one-line summaries stand in for full text wherever possible.

## 2. Output format

### Explanation (expand)

```
<explanation in Markdown, with [[wikilinks]]>

===META===
{"summary": "...", "aliases": ["..."], "children": [{"title": "...", "summary": "..."}]}
```

### Answer (ask)

Markdown with wikilinks and nothing else.

### Verified example

Captured on 2026-11-14 from `claude` (Haiku) with a draft of the prompts below. The existing nodes given were: Deep learning; Convolutional Neural Network; Transformer; Neuron; Activation Function; Backpropagation.

```
A **Convolutional Neural Network (CNN)** is a specialized [[Deep learning]] architecture designed primarily for processing grid-like data, especially images. Unlike traditional fully-connected neural networks, CNNs use [[Convolutional Layers|convolutional layers]] that apply small learnable filters across the input space to extract spatial features such as edges, textures, and shapes.

The core innovation is systematic scanning: these filters slide across the image, creating [[Feature Maps|feature maps]] that preserve spatial relationships while detecting local patterns. After convolution, [[Pooling Layers|pooling]] operations reduce dimensionality and emphasize important features. Each [[Neuron]] applies an [[Activation Function]] for non-linearity.

Finally, flattened features pass through fully connected layers for final classification. During training, [[Backpropagation]] adjusts all weights through the network. CNNs excel at computer vision tasks because their hierarchical architecture naturally mirrors how biological brains process visual information, progressively building complex pattern recognition from simpler features.

===META===
{"summary": "Deep learning model using spatial filters to extract hierarchical features from images for computer vision", "aliases": ["CNN", "ConvNet"], "children": [{"title": "Convolutional Layers", "summary": "Layers applying learnable filters across spatial input to detect local features"}, {"title": "Pooling Layers", "summary": "Downsampling layers reducing spatial dimensions while preserving important information"}, {"title": "Feature Maps", "summary": "Output representations from convolutional layers encoding detected spatial patterns"}, {"title": "Image Classification", "summary": "Task of categorizing images into predefined classes using CNN feature extraction"}]}
```

What this shows: existing nodes were linked by their exact titles; new concepts got clear names; the metadata was valid JSON. Codex produced the same format from the same instructions. One later Claude run began its answer with a `# Convolutional Neural Network` heading, which is why the prompt forbids a title heading and the parser removes one.

## 3. System prompt

Sent as `system`. Built from three parts joined by blank lines: **base**, **level**, **format**.

### Base

```
You write the content of nodes in a personal learning knowledge graph. One learner is exploring one topic. Each node explains exactly one concept.

Rules:
- Explain only the concept or answer only the question you are given. Do not re-explain its ancestors or wander into neighbouring topics; link to them instead.
- Wrap every concept the learner might want to open next in double square brackets, like [[Pooling]]. To show different words from the concept's name, write [[Activation Function|activation]].
- EXISTING NODES lists concepts already in the graph. When you mean one of them, link it using its title exactly as listed. Invent a new name only when no listed node means the same thing.
- Name a new concept by its most common textbook name, singular, in Title Case.
- Link each concept once, at its first mention. Do not link the concept you are explaining.
- Define in a few words any technical term that you do not link.
- Write Markdown. No title heading, no preamble, no closing remarks or offers of more help.
- Use $...$ for inline math and $$...$$ for display math. Use fenced code blocks for code.
- Answer from your own knowledge. Do not run commands, read files or browse.
```

### Level

| Level | Text |
|---|---|
| beginner | `The learner is a beginner. Assume no background beyond school mathematics. Use plain words and one concrete example.` |
| intermediate | `The learner knows the basics of the map topic. Be precise and use standard terminology.` |
| advanced | `The learner has a strong background. Be concise and technical, and include the key mechanism or equation.` |

### Format, for expand

```
Output format, exactly:
1. The explanation, {minWords} to {maxWords} words.
2. A line containing only ===META===
3. One JSON object, with no code fence and nothing after it:
{"summary": "<one sentence, at most 25 words>", "aliases": ["<other common names or abbreviations, at most 6>"], "children": [{"title": "<concept name>", "summary": "<one sentence, at most 25 words>"}]}
children: the {minChildren} to {maxChildren} concepts to open next in order to understand this one more deeply, most important first. Each must be a part, mechanism or direct prerequisite of this concept, not one of its ancestors. Link each child in the explanation where it fits naturally.
```

| Case | Words | Children |
|---|---|---|
| Root node | 150–220 | 4–7 |
| Any other node | 120–200 | 3–5 |

### Format, for ask

```
Output format: the answer in Markdown, at most 250 words, and nothing else. Do not write ===META===.
```

## 4. Prompt templates

Sent as `prompt`. Lines marked optional are left out when empty.

### Root

```
MAP TOPIC: {map.title}
LEARNER GOAL: {goal}                                   (optional)
EXISTING NODES: {map.title}
TASK: Give an overview of "{map.title}" that maps out the territory: what it is, why it matters, and its main parts.
```

### Expand

```
MAP TOPIC: {map.title}
LEARNER GOAL: {goal}                                   (optional)
PATH: {root.title} > … > {node.title}
PATH NOTES:                                            (optional)
- {ancestor.title}: {ancestor.summary}
INTRODUCED IN: "{origin.snippet}"                      (optional)
EXISTING NODES: {title}; {title}; …
TASK: Explain "{node.title}" as it applies in this path.
```

### Ask

```
MAP TOPIC: {map.title}
LEARNER GOAL: {goal}                                   (optional)
PATH: {root.title} > … > {node.title}
EXISTING NODES: {title}; {title}; …
NODE: {node.title}
NODE EXPLANATION:
{node.body, or "(not written yet) " + node.summary}
EARLIER QUESTIONS ON THIS NODE:                        (optional)
Q: {question}
A: {answer}
QUOTED TEXT: "{quote}"                                 (optional)
QUESTION: {question}
```

## 5. Building the context

`generation/context.ts` exports `buildExpandPrompt(map, nodeId)` and `buildAskPrompt(map, nodeId, question, quote)`, each returning `{ system, prompt }`.

| Block | Rule |
|---|---|
| `PATH` | Titles from the root to the node. If longer than 8, keep the root, `…`, and the last 6 |
| `PATH NOTES` | The nearest 4 ancestors that have a non-empty summary, root-most first. Titles and summaries only, never bodies |
| `INTRODUCED IN` | `origin.snippet`, with wikilink markup reduced to the label |
| `EXISTING NODES` | Titles only, separated by `; `. If the map has 300 nodes or fewer, all of them. Otherwise, in this order until 300: the path, the children of every path node, nodes linked from the target node, then the most recently created |
| `NODE EXPLANATION` | The body, cut at 6,000 characters |
| `EARLIER QUESTIONS` | The last 3 completed question and answer pairs; each answer cut at 1,200 characters |

**Budget**: the prompt must not exceed 24,000 characters. If it does, remove in this order until it fits: `PATH NOTES`, `EARLIER QUESTIONS`, then shorten `EXISTING NODES` from the end.

For Codex, which has no system-prompt flag, the adapter joins `system`, a blank line and `prompt` into one stdin text. The context builder does not know which provider is in use.

## 6. Parsing an explanation

`parseExpandOutput(text, nodeTitle, nodeAliases, resolve)` returns `{ body, summary, aliases, children, metaRecovered }`. `resolve` is the name-to-node lookup from the map index.

1. Normalise line endings to `\n`.
2. Find the **last** line that equals `===META===` after trimming. `body` is everything before it; `tail` is everything after it. If there is no such line, `body` is the whole text and there is no tail.
3. Clean `body`: trim. If its first line is a Markdown heading whose slug equals the slug of the node title or of an alias, remove that line. If `body` is now empty, throw `empty_output`.
4. Parse `tail`: trim; drop a surrounding code fence if present; take the text from the first `{` to the last `}`; `JSON.parse`; validate with the metadata schema:

   ```ts
   const metaSchema = z.object({
     summary: z.string().default(''),
     aliases: z.array(z.string()).default([]),
     children: z.array(z.object({
       title: z.string(),
       summary: z.string().default(''),
     })).default([]),
   });
   ```

   Any failure here means "no metadata". It is not an error.
5. Clean metadata:
   - trim every string; remove `[[` and `]]` from titles and aliases;
   - cut `summary` and child summaries at 200 characters;
   - drop children with an empty title or a title over 80 characters;
   - drop children whose slug equals the node's slug, and children that repeat an earlier child's slug;
   - keep at most 7 children and 6 aliases.
6. **Fallback when there is no metadata**: set `metaRecovered: true`;
   - `summary` is the first sentence of `body` with wikilinks reduced to their labels and Markdown emphasis removed, cut at 200 characters;
   - `aliases` is empty;
   - `children` is the first 5 distinct wikilink targets in `body`, in order, that do not resolve to an existing node, each with an empty summary.

The fallback means a badly formatted answer still gives the learner an explanation and somewhere to go next, with no second model call.

How the parsed result changes the map is defined in [DATA-MODEL.md](DATA-MODEL.md), section 7.2.

## 7. Parsing an answer

1. Normalise line endings and trim.
2. If a line equal to `===META===` is present, discard it and everything after it.
3. If the result is empty, throw `empty_output`.

## 8. Streaming filter

Deltas are forwarded to the browser as they arrive, but the metadata tail must not appear in the panel. `StreamFilter` in `protocol.ts`:

```
DELIM = "\n===META==="          // 11 characters
buffer = ""                     // everything received so far
sent = 0                        // number of characters already forwarded
done = false

push(text):
  if done: return ""
  buffer += text
  i = buffer.indexOf(DELIM)
  if i == -1 and buffer starts with "===META===": i = 0
  if i >= 0:
    end = i; done = true
  else:
    end = max(sent, buffer.length - DELIM.length)   // hold back a possible partial delimiter
  out = buffer.slice(sent, end); sent = end
  return out

flush():                        // call when the stream ends
  if done: return ""
  out = buffer.slice(sent); sent = buffer.length
  return out
```

The streamed text is for display only. Parsing always uses the provider's final `text`. The same filter is used for answers, so a stray delimiter there is hidden as well.

A stream can end inside an unfinished wikilink such as `[[Pool`. The renderer shows unmatched brackets as plain text; they become a link when the rest arrives.

## 9. Changing the prompts

- Keep the delimiter and the JSON keys stable. If they must change, change `protocol.ts`, its tests and section 2 together.
- After any change to the base rules, run `npm run smoke` against each real provider and check: no title heading, existing nodes linked by exact title, valid metadata, word count in range.
- Record a new fixture from the smoke output (see [TESTING.md](TESTING.md)).
