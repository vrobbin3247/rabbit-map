# Implementation plan

> **Status (2026-11-14): all milestones built.** The notes under "Build notes" at the end record what differs from the plan and what has and has not been verified.

Seven milestones, built in order. Each ends in something that runs and can be checked. Tick tasks as they are completed.

- **MVP** = M0 to M4: create a map, explain nodes, follow links, ask questions.
- **v1** = M0 to M6: everything in [PRD.md](PRD.md).

## Rules for every milestone

- Read the docs named under "Read first" before writing code.
- A milestone is done when its acceptance criteria are met **and** `npm run typecheck`, `npm run lint` and `npm test` pass.
- Automated tests use the fake provider only ([TESTING.md](TESTING.md)).
- If the code has to differ from a doc, update the doc in the same change and add a line to [DECISIONS.md](DECISIONS.md).

## Dependencies between milestones

```
M0 scaffold ─▶ M1 shared core ─▶ M2 providers ─▶ M3 server ─▶ M4 web ─▶ M5 navigation ─▶ M6 management
```

M1 and M2 do not depend on each other's internals and can be built in either order after M0.

---

## M0. Scaffold

**Goal**: an empty but running project.
**Read first**: [ARCHITECTURE.md](ARCHITECTURE.md) sections 2, 3, 8, 9, 11.

- [x] T0.1 Root `package.json`: npm workspaces `packages/*` and `apps/*`; `engines.node >= 22`; scripts `dev`, `build`, `start`, `test`, `typecheck`, `lint`, `smoke`.
- [x] T0.2 `tsconfig.base.json` (strict, ES modules) and one `tsconfig.json` per workspace. `@mindmapper/shared` importable from server and web.
- [x] T0.3 ESLint and Prettier with a minimal configuration.
- [x] T0.4 Vitest in each workspace, with one passing test each.
- [x] T0.5 `.gitignore`: `node_modules`, `dist`, `data`, `*.tmp`, `.env`.
- [x] T0.6 Server skeleton: `config.ts`; Hono app bound to `127.0.0.1`; Host and Origin guards; error handler producing the error shape; `GET /api/health` returning an empty provider list.
- [x] T0.7 Web skeleton: Vite, React, Tailwind; `/api` proxied to the server; a page that fetches and prints `/api/health`.
- [x] T0.8 `npm run dev` starts server and web together.

**Acceptance**

- `npm install && npm run dev` serves a page at `localhost:5173` that shows the health response.
- `curl -H 'Host: evil.example' http://127.0.0.1:8787/api/health` returns `403`.
- A request with `Origin: https://example.com` returns `403`.
- The server is not reachable on the machine's LAN address.

---

## M1. Shared core

**Goal**: every pure function the product depends on, fully tested, with no I/O.
**Read first**: [DATA-MODEL.md](DATA-MODEL.md), [PROMPTS.md](PROMPTS.md) sections 2, 6, 7, 8.

- [x] T1.1 `types.ts`, `schemas.ts`, `limits.ts`.
- [x] T1.2 `slug.ts`: `toSlug`, tested against the table in DATA-MODEL.md section 4.
- [x] T1.3 `wikilink.ts`: `extractWikilinks`, `wikilinksToMarkdownLinks`; tests for labels, length limits, and links inside code and math being ignored.
- [x] T1.4 `protocol.ts`: `parseExpandOutput`, `parseAskOutput`, `StreamFilter`.
- [x] T1.5 `graph.ts`: `buildIndex`, `resolve`, `pathOf`, `depthOf`, `subtreeOf`, `isAncestor`.
- [x] T1.6 Fixture `expand-claude-cnn.txt`, copied verbatim from PROMPTS.md section 2.

**Acceptance**

- The fixture parses to a non-empty body, the summary, aliases `CNN` and `ConvNet`, and 4 children.
- A test removes the metadata from the fixture and checks the fallback: `metaRecovered` is true and children come from unresolved links.
- A test feeds the fixture to `StreamFilter` split at every possible position and checks that the output always equals the body and never contains `===META===`.
- A leading `# Convolutional Neural Network` heading is removed by the parser.

---

## M2. Providers

**Goal**: text in, text out through real CLIs, safely.
**Read first**: [PROVIDERS.md](PROVIDERS.md), all of it.

- [x] T2.1 `providers/types.ts`.
- [x] T2.2 `providers/spawn.ts` (`runCli`), tested against a small Node script standing in for a CLI: line reading, non-JSON lines, timeout, abort, missing binary.
- [x] T2.3 `providers/fake.ts`, as specified in TESTING.md.
- [x] T2.4 `providers/claude.ts`: arguments, environment, event handling, error mapping, `check()`. Unit-tested with recorded event lines and recorded `auth status` output.
- [x] T2.5 `providers/codex.ts`: the same.
- [x] T2.6 `providers/registry.ts`: lookup, default provider, 60-second health cache, `MINDMAPPER_PROVIDER` override.
- [x] T2.7 `scripts/smoke.ts`: `npm run smoke -- <provider> [--model m] [--record file]`. Prints provider status, runs one explanation with the real prompts, prints time to first delta, total time, token usage and the parsed result. `--record` saves the raw event lines with account details removed.
- [x] T2.8 Run the smoke script for Claude (`sonnet` and `haiku`) and Codex. Record fixtures. Put the timings in PROVIDERS.md and set the default Claude model (see "Open items").

**Acceptance**

- `npm run smoke -- claude` shows text arriving incrementally and a parsed result with children.
- `npm run smoke -- codex` shows a parsed result with children.
- `ANTHROPIC_API_KEY=dummy npm run smoke -- claude` still succeeds through the subscription login, proving the variable is stripped.
- A unit test with an `auth status` fixture whose `authMethod` is not `claude.ai` makes `generate` throw `provider_api_key_auth` without spawning.
- Aborting a smoke call with Ctrl+C leaves no `claude` or `codex` process running.

---

## M3. Server

**Goal**: the whole product behind an HTTP API, testable without a browser.
**Read first**: [API.md](API.md), DATA-MODEL.md sections 7 to 9, PROMPTS.md sections 3 to 5, ARCHITECTURE.md sections 6 and 7.

- [x] T3.1 `store/mapStore.ts`: load, validate, repair, list, create, delete, `mutate` with a per-map queue, atomic writes, debounced view writes.
- [x] T3.2 `generation/prompts.ts` and `context.ts`; tests on a fixed map for each template and for budget trimming.
- [x] T3.3 `generation/apply.ts`; tests for: stubs created; a child that already exists becomes a cross-link; ancestor and existing-child cases skipped; alias rules; regeneration keeps children; failure and cancel restore state.
- [x] T3.4 `generation/jobs.ts`; tests for one job per node, the concurrency limit, queue order and abort.
- [x] T3.5 `generation/generator.ts`: `expandNode`, `askNode`.
- [x] T3.6 Routes: health, maps, view, nodes (open concept, rename, collapse, delete, merge, delete message), expand and ask as event streams.
- [x] T3.7 Client-disconnect handling: abort the job and restore the node.
- [x] T3.8 Static file serving for the web build; graceful shutdown.

**Acceptance**

- An integration test drives the API with the fake provider through: create map, expand root, open a ghost concept, expand it, ask a question, expand a second branch whose suggested child already exists (it becomes a cross-link, not a new node), reload the store from disk, and finds everything intact.
- A test aborts a stream mid-generation and finds the node back in its previous state.
- A map file edited to contain a `generating` node loads with that node repaired.
- With the server running: `curl -N -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8787/api/maps/<id>/nodes/<id>/expand` prints `start`, `delta` and `done` events.

---

## M4. Web: map, panel, generation

**Goal**: the MVP. A learner can build and read a map.
**Read first**: [UX.md](UX.md) sections 1 to 4 and 7.

- [x] T4.1 `api/client.ts` and `api/sse.ts` (stream reader with abort); unit test for the event parser.
- [x] T4.2 `state/store.ts`: maps, current map, index, selection, streaming buffers; applies `start`, `delta`, `done`, `error`.
- [x] T4.3 Home: topic input, level, goal, map list, provider chips, disabled state when no provider is usable.
- [x] T4.4 Canvas: `layout.ts` (dagre, left to right, fixed node size), `ConceptNodeView` for all four states, tree edges, selection, fit and centre controls.
- [x] T4.5 Panel: header, body by state, **Next concepts** chips.
- [x] T4.6 `Markdown.tsx`: Markdown, tables, code, math, raw HTML off; links to existing nodes and ghost links styled and clickable; hover summaries.
- [x] T4.7 Explain flow: **Explain** button and double-click; streaming text; **Stop**; non-streaming skeleton with timer.
- [x] T4.8 Ghost link flow: open concept, then expand, then navigate.
- [x] T4.9 Thread and ask box with streaming answers; retry on a failed answer.
- [x] T4.10 Error and waiting states for the panel (UX.md section 7).

**Acceptance**

- User stories US-1 to US-5 work in the browser with the fake provider and with real Claude.
- Clicking a link to an existing node selects it and never creates a duplicate.
- Pressing **Stop** returns the node to a stub.
- With Codex selected, the panel shows the skeleton and timer, then the full text.
- Reloading the page shows the same map and content.

---

## M5. Navigation

**Goal**: the learner can always get back. This is the point of the product.
**Read first**: UX.md sections 2, 5, 6 and 8.

- [x] T5.1 Trail recording on every navigation; view state saved through `PATCH /view` and restored on open.
- [x] T5.2 Breadcrumb with middle truncation.
- [x] T5.3 Back and Forward.
- [x] T5.4 Trail rail, indented by depth, collapsible.
- [x] T5.5 Anchor: set, badge on the node, **Back to anchor** button.
- [x] T5.6 Depth indicator; current-path highlighting on nodes and edges; visited styling.
- [x] T5.7 Search palette over titles and aliases.
- [x] T5.8 **Mentioned in** and **See also** lists; cross-link edges for the selected node; show-all toggle.
- [x] T5.9 Selection popover: **Explain this** and **Ask about this**.
- [x] T5.10 Keyboard shortcuts.

**Acceptance**

- User stories US-6 to US-9 work.
- The walkthrough in PRD.md section 9 passes with a real provider.
- After restarting the server and reloading, the selected node, anchor, trail and viewport are restored.

---

## M6. Management and finish

**Goal**: v1 complete.
**Read first**: PRD.md FR-8, DATA-MODEL.md sections 7.5 to 7.7, UX.md sections 9 and 10.

- [x] T6.1 Regenerate a node.
- [x] T6.2 Rename, delete (with confirmation showing the subtree size) and merge (with a node picker).
- [x] T6.3 Collapse and expand subtrees, with the hidden-count badge.
- [x] T6.4 Provider, model and level switching inside a map (US-10).
- [x] T6.5 Home: rename and delete maps; unreadable map files shown as such.
- [x] T6.6 Export: `POST /maps/:mapId/export` writes one Markdown file per node into `<dataDir>/exports/<map title>/`: front matter (id, aliases, parent), the body with wikilinks intact, and a Questions section. The folder opens as an Obsidian vault.
- [x] T6.7 Light and dark themes, reduced motion, keyboard and screen-reader pass.
- [x] T6.8 Playwright test of the walkthrough against the fake provider.
- [x] T6.9 Update README.md to the real commands; reconcile every doc with the code.

**Acceptance**

- Every FR in PRD.md is met.
- The manual checklist in TESTING.md passes with Claude and with Codex.
- Merging "Convolution" into "Convolutional Layer" makes old links to "Convolution" open the merged node.

---

## Requirement coverage

| Requirements | Milestone |
|---|---|
| FR-1 Maps | M3 (API), M4 (create, open), M6 (rename, delete, settings) |
| FR-2 Nodes and explanations | M1 to M4; FR-2.6 in M6 |
| FR-3 Links and shared concepts | M1 (resolution), M3 (apply), M4 (links), M5 (lists, cross-link edges) |
| FR-4 Questions | M3, M4; FR-4.4 in M5 |
| FR-5 Finding the way back | M5 |
| FR-6 Providers | M2; messages in M4 |
| FR-7 Persistence | M3; view state in M5 |
| FR-8 Management | M6 |

## Open items to settle during the build

| Item | When | How |
|---|---|---|
| Default Claude model: `sonnet` or `haiku` | T2.8 | Time both with the real prompts. Keep `sonnet` if it meets NFR-1; otherwise default to `haiku` |
| Real error output for plan and rate limits | First time one occurs | Record it as a fixture and correct the error tables in PROVIDERS.md |
| Wording of `codex login status` when logged out or on an API key | T2.5 | Check the Codex source or documentation; do not log out the user's CLI to find out |
| Node size and layout spacing | T4.4 | Adjust by eye on a 40-node map |

## Backlog (after v1)

- Antigravity provider for Google AI Pro (PROVIDERS.md section 6).
- Pre-started CLI processes to remove the 2.3-second start-up from each call.
- Token streaming for Codex through its app-server protocol.
- Manual node positions that survive re-layout.
- Concepts shared across maps.
- Explanations grounded in the learner's own documents.
- Quiz mode over visited nodes.
- A usage indicator built from the provider's rate-limit events.

## Build notes (2026-11-14)

What differs from the plan above:

- **T0.1 / start-up:** there is no compiled server build. `npm start` runs the TypeScript directly with `tsx`, because `@mindmapper/shared` is consumed as source. See D-16.
- **T2.7:** `--record <file>` saves the model's final text, not raw CLI event lines, and it does not need to strip account fields because the text carries none.
- **T6.6:** the export route is `POST /api/maps/:mapId/export`, which writes into `<dataDir>/exports/<map title>/` (API.md has the shape).
- **T6.8:** Playwright tests are in `e2e/walkthrough.spec.ts`. `e2e/real.manual.ts` is a manual test against a real provider.

What was verified, and how:

| Check | How |
|---|---|
| Parser, slugs, wikilinks, stream filter, graph | 43 unit tests in `packages/shared`, including every split position of the stream filter and the real Claude and Codex outputs |
| Provider adapters | Stand-in CLI scripts check the exact arguments, the stripped environment, error mapping, abort and API-key refusal; real calls through `npm run smoke` |
| Whole API and store | 46 integration and unit tests with the fake provider, including abort, failure restore, merge, delete, export, corrupt files |
| UI logic | Component and store tests (Markdown links, trail, back/forward, stream handling, Stop) |
| The product in a browser | 5 Playwright tests (full PRD walkthrough, Stop, provider error, text selection and arrow keys, origin guard) |
| Real providers | `npm run smoke` for Claude (sonnet, haiku) and Codex; `npm run test:real` drove the browser against real Claude |

**Not verified:** a screen-reader pass (T6.7 added labels, roles and live regions, but nobody listened to them); `viewport` restore after reload (saved and passed as `defaultViewport`, not asserted); the merge picker and delete confirmation dialogs in a browser (the API behind them is tested); the real Codex provider through the browser (only through `npm run smoke`); behaviour when a plan or rate limit is actually reached; Windows.
