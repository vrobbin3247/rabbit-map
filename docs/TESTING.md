# Testing

## 1. The rule

**Automated tests never run a real CLI.** Every real call spends the user's subscription quota and depends on the network. Automated tests use the fake provider and recorded fixtures. Real CLIs are exercised only by `npm run smoke`, by hand.

## 2. Layers

| Layer | Tool | Covers | Runs in |
|---|---|---|---|
| Unit | Vitest | `packages/shared`, provider event handling, context building, `apply`, job queue | `npm test` |
| Integration | Vitest, Hono `app.request` | The HTTP API end to end with the fake provider and a temporary data directory | `npm test` |
| Component | Vitest, Testing Library | Markdown and link rendering, store reducers, stream reader | `npm test` |
| End to end | Playwright (`e2e/walkthrough.spec.ts`) | The PRD walkthrough, dragging, right-click menus, the theme toggle, Stop, provider errors, text selection and keyboard, origin guard, in a real browser against the fake provider. Any uncaught page exception fails the test | `npm run test:e2e` |
| Smoke | `scripts/smoke.ts` | One real call per provider | By hand |
| Real-provider browser test | `e2e/real.manual.ts` | The same app against real Claude: root, child, shared links, a question | `npm run test:real`, by hand (3 model calls) |
| Manual | Checklist below | The product with real providers | Before calling a milestone done |

## 3. Fake provider

`apps/server/src/providers/fake.ts`. Selected with `MINDMAPPER_PROVIDER=fake`. Deterministic: the same prompt always gives the same text.

**Status**: installed, logged in, `auth: 'subscription'`, usable, `streams: true`, `models: []`.

**Explanation**: when the prompt has a line `TASK: Explain "X" …` or `TASK: Give an overview of "X" …`, the output is:

```
**X** is explained here for testing. It builds on [[X Part A]] and [[X Part B]], and it uses [[X Part C]].

It is also related to [[Shared Concept]].

===META===
{"summary": "Summary of X.", "aliases": [], "children": [{"title": "X Part A", "summary": "First part of X."}, {"title": "X Part B", "summary": "Second part of X."}, {"title": "X Part C", "summary": "Third part of X."}, {"title": "Shared Concept", "summary": "A concept every node refers to."}]}
```

Every explanation suggests `Shared Concept`. The first one creates it as a stub; every later one finds it already present. This is how tests exercise shared nodes and cross-links.

**Answer**: when the prompt has a line `QUESTION: Q`, the output is:

```
Answer about **N**: Q. See [[Shared Concept]] and [[N Detail]].
```

where `N` is the value of the `NODE:` line.

**Triggers**: if the concept name or the question contains one of these, behaviour changes.

| Trigger | Behaviour |
|---|---|
| `__nometa__` | Output stops before `===META===` |
| `__badjson__` | The text after `===META===` is `{not json` |
| `__heading__` | Output starts with `# X` and a blank line |
| `__empty__` | Output is an empty string |
| `__ratelimit__` | Throws `rate_limited` with message `Fake rate limit.` |
| `__fail__` | Throws `provider_failed` with message `Fake failure.` |
| `__hang__` | Emits the first chunk, then waits until aborted |

**Streaming**: text is delivered in 16-character chunks. The delay between chunks is `MINDMAPPER_FAKE_DELAY_MS` (default 15; tests set 0). Abort is honoured between chunks and throws `aborted`.

## 4. Fixtures

| File | Source | Used by |
|---|---|---|
| `packages/shared/test/fixtures/expand-claude-cnn.txt` | Copied from PROMPTS.md section 2 | Parser and stream-filter tests |
| `packages/shared/test/fixtures/expand-codex-cnn.txt` | `npm run smoke -- codex --record` | Parser tests |
| `packages/shared/test/fixtures/expand-claude-sonnet-cnn.txt` | `npm run smoke -- claude --record` | Parser tests |
| `apps/server/test/fixtures/fake-claude.mjs`, `fake-codex.mjs` | Hand-written from PROVIDERS.md | Stand-in CLI scripts. They emit the documented event shapes and record their arguments and environment, so adapter tests check the exact command line without a real CLI |

The smoke script's `--record` option saves only the model's final text, which carries no account details. If you ever record raw CLI output, remove `email`, `orgId`, `orgName`, `session_id` and `uuid` first.

## 5. What must be tested

### `packages/shared`

- `toSlug`: every row of the table in DATA-MODEL.md section 4.
- `extractWikilinks`: plain, labelled, several per line, over-long targets ignored, links inside fenced code, inline code and math ignored.
- `wikilinksToMarkdownLinks`: output round-trips through a Markdown parser to `concept:` links with correct targets.
- `parseExpandOutput`: the fixtures; missing metadata; invalid JSON; fenced JSON; extra text after the JSON; a leading title heading; a child equal to the node itself; duplicate children; more than 7 children; empty body.
- `StreamFilter`: every split position of a fixture; delimiter at the very start; no delimiter at all; text that contains `===` without being the delimiter.
- `buildIndex`: alias resolution; title beats alias; ghost targets; back-links; depth.

### Providers

- `runCli`: lines split across chunks; non-JSON lines skipped; timeout kills the process; abort kills the process; missing binary maps to `provider_not_installed`.
- Claude and Codex adapters: the exact argument array; the environment has the listed variables removed and `MAX_THINKING_TOKENS=0` set for Claude; fixtures produce the expected deltas and final text; error events map to the expected codes.
- `check()`: usable, logged out, and API-key cases; the result never contains an email.

### Server

- `mapStore`: atomic write leaves no `.tmp` file; a corrupt file is reported and not overwritten; concurrent mutations apply in order; repair rules from DATA-MODEL.md section 9.
- `context`: each template against a fixed map (snapshot); path truncation; existing-node selection above 300 nodes; budget trimming order.
- `apply`: every branch of DATA-MODEL.md section 7.2, plus rename, delete and merge from sections 7.5 to 7.7 with the invariants checked afterwards.
- `jobs`: one per node; limit; order; abort.
- Routes: every endpoint's success case and each documented error; Host and Origin guards; event order for expand and ask (`start`, then `delta`s, then exactly one `done` or `error`).

### Web

- Stream reader: events split across network chunks; abort.
- Store: applying `start`, `delta`, `done`, `error`; Back and Forward; trail de-duplication.
- `Markdown`: an existing-node link and a ghost link render differently and call the right handler; raw HTML in the input is shown as text; math renders.
- Layout: a known tree produces non-overlapping positions; collapsed subtrees are excluded.

A helper `assertInvariants(map)` checks the invariants in DATA-MODEL.md section 3 and is called at the end of every server test that mutates a map.

## 6. Smoke script

```bash
npm run smoke -- claude
npm run smoke -- claude --model haiku
npm run smoke -- codex
npm run smoke -- claude --record apps/server/test/fixtures/claude-stream.jsonl
```

It prints the provider status, sends one explanation request for "Convolutional Neural Network" in a map titled "Deep learning", and reports time to first delta, total time, token usage and the parsed result. Check by eye: no title heading, existing nodes linked by exact title, valid metadata, word count in range.

Run it after any change to an adapter or to the prompts, and after updating either CLI.

## 7. Manual checklist

Run with a real provider before calling M5 and M6 done. Repeat with the second provider for M6.

**Core walkthrough**

- [ ] Create a map "Deep learning". The overview streams and 4 to 7 nodes appear.
- [ ] Explain "Convolutional Neural Network" (or the closest node). The text streams within 5 seconds.
- [ ] Click a ghost link in that explanation. A node appears under the current node and is explained.
- [ ] Go three more levels down using a mix of child nodes and ghost links.
- [ ] Return to the root and open a different branch. Find a link to a concept opened earlier; it selects the existing node and no duplicate is created.
- [ ] Ask a question on a node. The answer refers to that node's content.
- [ ] Select a phrase and use **Explain this**, then **Ask about this**.
- [ ] Set an anchor, go five levels deep, press **Back to anchor**.
- [ ] Use Back and Forward, the breadcrumb, the trail and search to move around.
- [ ] Stop the server, start it, reload. Selection, anchor, trail and viewport are restored.

**Content**

- [ ] An explanation with an equation renders the math.
- [ ] An explanation with code renders a code block.
- [ ] No explanation starts by repeating its own title.

**Providers**

- [ ] Switch the map to the other provider and explain another node.
- [ ] Press **Stop** during a generation. The node returns to its earlier state and no CLI process is left running (`pgrep -fl "claude|codex"`).
- [ ] Rename the CLI binary path with `MINDMAPPER_CLAUDE_BIN=/nonexistent`. The chip shows "not installed" with the fix.
- [ ] Start the server with `ANTHROPIC_API_KEY=dummy`. Generation still works through the subscription login.

**Management** (M6)

- [ ] Regenerate a node that has children and a thread. Both are kept.
- [ ] Rename a node. Links using the old name still open it.
- [ ] Merge two nodes. Links to either name open the merged node; both threads are present.
- [ ] Delete a subtree. Links to deleted concepts become ghost links.
- [ ] Export the map and open the folder in a Markdown editor. Wikilinks resolve between files.
