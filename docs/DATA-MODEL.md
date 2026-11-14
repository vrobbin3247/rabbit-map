# Data model

All types live in `packages/shared/src/types.ts`, with matching zod schemas in `schemas.ts`. Field names here are exact.

## 1. Types

```ts
export type ProviderId = 'claude' | 'codex' | 'fake';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type NodeStatus = 'stub' | 'generating' | 'ready' | 'error';

export interface MapFile {
  schemaVersion: 1;
  id: string;                 // ULID
  title: string;              // the topic as typed
  createdAt: string;          // ISO 8601
  updatedAt: string;
  settings: MapSettings;
  rootId: string;
  nodes: Record<string, ConceptNode>;   // keyed by node id
  view: ViewState;
}

export interface MapSettings {
  level: Level;
  goal: string | null;
  provider: ProviderId;
  model: string | null;       // null = the provider's default
}

export interface ConceptNode {
  id: string;                 // ULID
  title: string;              // canonical name, 1–80 chars
  aliases: string[];          // other names that resolve to this node
  parentId: string | null;    // null only for the root
  summary: string;            // one line, ≤ 200 chars, may be ''
  body: string | null;        // Markdown with [[wikilinks]]; null until explained
  status: NodeStatus;
  error: ErrorInfo | null;    // set only when status is 'error'
  origin: Origin | null;      // where the learner first met this concept
  related: string[];          // node ids recorded as cross-links ("See also")
  thread: ThreadMessage[];    // oldest first
  collapsed: boolean;
  generatedBy: Generation | null;
  createdAt: string;
  updatedAt: string;
}

export interface Origin {
  nodeId: string;             // node whose text introduced this concept
  snippet: string;            // the sentence around the link, ≤ 400 chars
}

export interface ThreadMessage {
  id: string;                 // ULID
  role: 'user' | 'assistant';
  text: string;               // Markdown; assistant text may contain [[wikilinks]]
  quote: string | null;       // user messages only: quoted selection, ≤ 600 chars
  status: 'ready' | 'generating' | 'error';
  error: ErrorInfo | null;
  generatedBy: Generation | null;   // assistant messages only
  createdAt: string;
}

export interface Generation {
  provider: ProviderId;
  model: string | null;
  at: string;
  durationMs: number;
  metaRecovered: boolean;     // true when metadata was rebuilt from links
}

export interface ErrorInfo {
  code: ErrorCode;            // list in API.md
  message: string;
}

export interface ViewState {
  selectedId: string | null;
  anchorId: string;           // defaults to rootId
  trail: string[];            // node ids in visit order, newest last, max 200
  viewport: { x: number; y: number; zoom: number } | null;
}

export interface MapSummary {     // for the map list
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
}
```

## 2. Structure

A map is a **tree with cross-links**.

- **Tree**: every node except the root has one `parentId`, the node from which it was first introduced. The tree gives the canvas layout, the path and the depth.
- **Cross-links**: a node links to another node when its text mentions it, or when it is listed in `related`. Cross-links can point anywhere in the tree.

Cross-links found in text are **derived, not stored**. They are recomputed from `body` and assistant `thread` text whenever the map changes. This means renaming, merging or deleting a node can never leave a stored link pointing at nothing.

## 3. Invariants

1. Exactly one node has `parentId: null`, and its id is `rootId`.
2. Following `parentId` from any node reaches the root without a cycle.
3. No two nodes have the same slug, and no alias slug equals another node's title slug or alias slug.
4. `view.anchorId`, `view.selectedId`, every `view.trail` entry, every `related` entry and every `origin.nodeId` refer to nodes that exist.
5. `body` is `null` exactly when the node has never been explained successfully.
6. `status` is `generating` only while a job for that node is running.
7. `error` is non-null exactly when `status` is `error`.

`mapStore` checks invariants 1 to 5 when it loads a file and repairs what it can (see section 9).

## 4. Slugs

Two names refer to the same concept when their slugs are equal. Slugs are computed, never stored.

`toSlug(name)`:

1. Normalise to Unicode NFKD and remove combining marks.
2. Lower-case.
3. Replace `&` with ` and ` and `+` with ` plus `.
4. Replace every character that is not a letter or digit with a space.
5. Collapse runs of spaces and trim.
6. Singularise the **last word only**:
   - 3 characters or fewer: unchanged
   - ends in `ies`: replace with `y`
   - ends in `sses`, `ches`, `shes`, `xes` or `zes`: remove `es`
   - ends in `s` but not in `ss`, `us`, `is`, `as` or `os`: remove `s`
   - otherwise unchanged
7. Join words with `-`.

| Input | Slug |
|---|---|
| `Channels` | `channel` |
| `channel` | `channel` |
| `Pooling Layers` | `pooling-layer` |
| `Activation Function` | `activation-function` |
| `CNNs` | `cnn` |
| `GPU` | `gpu` |
| `Bias` | `bias` |
| `Loss` | `loss` |
| `Analysis` | `analysis` |
| `Batches` | `batch` |
| `Classes` | `class` |
| `Dependencies` | `dependency` |
| `C++` | `c-plus-plus` |
| `ResNet-50` | `resnet-50` |
| `Naïve Bayes` | `naive-baye` |

The rule is a heuristic. It is wrong for some words (`Bayes` above, `series`, `biases`). That is acceptable because it is applied the same way to both sides of every comparison; it only fails when the singular and plural of an irregular word both appear. Alternative names and manual merge cover those cases. The table above is the unit-test table.

## 5. Wikilinks

Text refers to concepts with wikilinks:

- `[[Target]]` shows "Target".
- `[[Target|label]]` shows "label".

Grammar: `\[\[([^\[\]|\n]{1,80})(?:\|([^\[\]\n]{1,120}))?\]\]`. Wikilinks inside fenced code, inline code and math (`$…$`, `$$…$$`) are not links.

`packages/shared/src/wikilink.ts` exports:

- `extractWikilinks(markdown): { target: string; label: string; index: number }[]`: masks code and math, then applies the grammar.
- `wikilinksToMarkdownLinks(markdown): string`: rewrites each wikilink to `[label](concept:<encoded target>)` so that a standard Markdown renderer can draw it. The web app renders `concept:` links with its own component.

## 6. Resolving a name to a node

`buildIndex(map)` in `graph.ts` returns:

```ts
interface MapIndex {
  slugToId: Map<string, string>;        // title slugs and alias slugs
  outLinks: Map<string, Set<string>>;   // node id → node ids it links to
  backLinks: Map<string, Set<string>>;  // node id → node ids that link to it
  ghostTargets: Map<string, string[]>;  // node id → unresolved link targets
  depth: Map<string, number>;           // root = 0
}
```

Building `slugToId`:

1. Add every node's title slug. On a clash, the older node wins (should not happen; invariant 3).
2. Add every alias slug that is not already present.

`resolve(index, name)` returns `slugToId.get(toSlug(name))` or `undefined`.

`outLinks` for a node is the union of: resolved wikilink targets in its `body`, resolved targets in its assistant thread messages, and its `related` ids, excluding the node itself. A wikilink whose target does not resolve is a **ghost link**.

The index is rebuilt after every mutation, on the server and in the web store.

## 7. Mutations

All mutations go through `mapStore.mutate(mapId, fn)`, which runs them one at a time per map, sets `updatedAt`, and saves.

### 7.1 Create a map

Create the map with one root node: `title` = topic, `status: 'stub'`, `parentId: null`, empty summary. Set `view.anchorId` and `view.selectedId` to the root and `view.trail` to `[rootId]`. The client then calls expand on the root.

### 7.2 Start and finish an explanation

**Start**: remember the previous `status`, `body` and `error`; set `status: 'generating'`, `error: null`.

**Finish** with parsed output `{ body, summary, aliases, children, metaRecovered }` (see [PROMPTS.md](PROMPTS.md)), in this order:

1. Set `body`.
2. If `summary` is non-empty, set it.
3. For each alias: skip it if its slug equals the node's own slug or already resolves to any node; otherwise append it to `aliases`.
4. Rebuild the index.
5. For each child, in order, up to 7:
   - If its slug equals this node's slug: skip.
   - If it resolves to an existing node:
     - if that node is this node's ancestor or already its child: skip;
     - otherwise add its id to `related` (no duplicates).
   - Otherwise create a stub: `title`, `summary`, `parentId` = this node, `status: 'stub'`, `origin` = `{ nodeId: this node, snippet }` where `snippet` is the sentence of `body` that contains a wikilink to it, or `''`.
6. Set `status: 'ready'`, `error: null`, `generatedBy`.

Regenerating never deletes existing children; suggested children that already exist simply resolve to them.

**Fail**: if the node had a body before, restore `status: 'ready'` and the old body. Otherwise set `status: 'error'` and `error`.

**Cancel**: restore the previous `status`, `body` and `error`.

### 7.3 Ask a question

**Start**: append a user message (`status: 'ready'`) and an assistant message (`status: 'generating'`, `text: ''`).

**Finish**: set the assistant message's `text`, `status: 'ready'`, `generatedBy`.

**Fail**: set the assistant message's `status: 'error'` and `error`. The user message stays so the learner can retry.

**Cancel**: remove both messages.

Retrying a failed question removes the failed assistant message and reuses the user message.

### 7.4 Open a concept

Used when the learner clicks a ghost link or chooses **Explain this**. Input: `fromNodeId`, `term`, optional `snippet`.

1. If `term` resolves to a node, return it with `created: false`.
2. Otherwise create a stub with `title` = `term` (trimmed, internal whitespace collapsed), `parentId` = `fromNodeId`, `origin` = `{ nodeId: fromNodeId, snippet }`, and return it with `created: true`.

No model call happens here. The client follows with expand when `created` is true.

### 7.5 Rename

Reject with `conflict` if the new title's slug belongs to a different node. Otherwise set `title` and append the old title to `aliases`, so existing links keep resolving.

### 7.6 Delete

The root cannot be deleted. Deleting a node deletes its whole subtree. Then, across the map: remove the deleted ids from every `related` and from `view.trail`; clear any `origin` that points at a deleted node; if `view.anchorId` was deleted set it to the root; if `view.selectedId` was deleted set it to the deleted node's parent.

Wikilinks elsewhere that pointed at a deleted concept become ghost links again, with no further work.

### 7.7 Merge

Merge `source` into `target` (different nodes; `source` is not the root; `target` is not inside `source`'s subtree):

1. Re-parent `source`'s children to `target`.
2. Append `source.thread` to `target.thread`.
3. Add `source.title` and `source.aliases` to `target.aliases` (skipping any whose slug equals `target`'s).
4. Union `source.related` into `target.related`, without `target` itself.
5. Replace `source.id` with `target.id` in every `related`, `origin.nodeId`, `view.trail`, `view.anchorId` and `view.selectedId`; remove duplicates and self-references.
6. Delete `source`.

Because the old title is now an alias of the target, every existing wikilink to the source resolves to the target.

### 7.8 View state

`selectedId`, `anchorId`, `trail` and `viewport` are updated by the client through one endpoint. The server validates ids, drops unknown ones, and trims `trail` to its last 200 entries. Consecutive duplicate trail entries are collapsed.

## 8. Storage

- One file per map: `<dataDir>/maps/<mapId>.json`, containing a `MapFile`, pretty-printed with two-space indentation.
- **Atomic write**: write to `<mapId>.json.tmp`, then rename over the real file.
- **Write queue**: one write at a time per map. View-state writes are debounced by 500 ms; all other mutations are written immediately.
- **Loading**: parse, validate with the zod schema, repair (section 9), keep in memory. A file that fails validation is not loaded and is reported in the map list as unreadable; it is never overwritten.
- **Listing**: read the header fields of every file in `maps/`.
- **Deleting a map**: remove the file.

Expected sizes: a 500-node map is about 1 MB.

## 9. Repair on load

Applied in memory, then saved if anything changed:

1. A node with `status: 'generating'` becomes `ready` if it has a body, otherwise `stub`.
2. A thread message with `status: 'generating'` becomes `error` with code `aborted`.
3. `related`, `trail` and `origin` entries that point at missing nodes are removed.
4. A missing `anchorId` or `selectedId` target is replaced by the root.
5. A node whose `parentId` points at a missing node is attached to the root.

## 10. Versioning

`schemaVersion` is `1`. A future change adds a migration function per version step, run on load before validation. A file with a higher version than the app understands is not loaded.

## 11. Limits

Defined once in `packages/shared/src/limits.ts`.

| Name | Value |
|---|---|
| Topic length | 1–200 |
| Node title length | 1–80 |
| Summary length | ≤ 200 |
| Aliases per node | ≤ 6 |
| Children created per explanation | ≤ 7 |
| Question length | 1–2000 |
| Quote length | ≤ 600 |
| Origin snippet length | ≤ 400 |
| Trail length | ≤ 200 |
