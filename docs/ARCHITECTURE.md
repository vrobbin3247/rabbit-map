# Architecture

## 1. Overview

```
┌──────────────────────┐   HTTP + SSE    ┌───────────────────────────────────────┐
│ Browser (React)      │ ──────────────▶ │ Local server (Node, 127.0.0.1:8787)   │
│  canvas · panel · nav│ ◀────────────── │                                       │
└──────────────────────┘                 │  routes                               │
                                         │    │                                  │
                                         │    ├─ map store ─▶ data/maps/<id>.json│
                                         │    │                                  │
                                         │    └─ generation                      │
                                         │         context → provider → parser   │
                                         │                     │                 │
                                         └─────────────────────┼─────────────────┘
                                                               │ spawn, stdin/stdout
                                              ┌────────────────┴───────────────┐
                                              │ claude -p        codex exec    │
                                              │ (subscription login on disk)   │
                                              └────────────────────────────────┘
```

The browser never talks to a model. The server never talks to a model API. The only route to a model is a child process running an official CLI that the user has logged in to.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict, ES modules | One language across server, web and shared logic |
| Runtime | Node.js 22+ | Already installed; needed for `child_process` |
| Package layout | npm workspaces | No extra tooling |
| Server | Hono on `@hono/node-server` | Small, typed, has an SSE helper |
| Validation | zod | One schema gives the type and the runtime check |
| Web build | Vite | Fast dev server with an `/api` proxy |
| UI | React | Required by the canvas library |
| Canvas | `@xyflow/react` (React Flow) | Node and edge canvas with pan, zoom and custom nodes |
| Layout | `@dagrejs/dagre` | Left-to-right tree layout in a few lines |
| Client state | zustand | Small store, easy to update from a stream |
| Markdown | `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex` | Markdown, tables, LaTeX; raw HTML off by default |
| Styling | Tailwind CSS | Fast to write, easy to theme light and dark |
| Storage | One JSON file per map | No native dependency; readable; small data |
| IDs | `ulid` | Sortable by creation time |
| Tests | Vitest; Playwright for one end-to-end flow | See [TESTING.md](TESTING.md) |

Use the latest stable version of each at implementation time and pin it in `package.json`.

## 3. Repository layout

```
mindmapper/
├─ package.json              workspaces, root scripts
├─ tsconfig.base.json
├─ CLAUDE.md  README.md
├─ docs/
├─ data/                     runtime data, git-ignored
│  ├─ maps/<mapId>.json
│  └─ .sandbox/              empty working directory for CLI processes
├─ scripts/
│  └─ smoke.ts               one real call through a real provider
├─ packages/
│  └─ shared/src/
│     ├─ types.ts            MapFile, ConceptNode, …
│     ├─ schemas.ts          zod schemas for the same
│     ├─ limits.ts           size limits and constants
│     ├─ slug.ts             toSlug
│     ├─ wikilink.ts         extractWikilinks, wikilinksToMarkdownLinks
│     ├─ protocol.ts         parseExpandOutput, StreamFilter
│     ├─ graph.ts            buildIndex, pathOf, depthOf, subtreeOf
│     └─ index.ts
└─ apps/
   ├─ server/src/
   │  ├─ index.ts            boot, static files, shutdown
   │  ├─ config.ts           environment variables
   │  ├─ http/
   │  │  ├─ app.ts           Hono app, guards, error handler
   │  │  ├─ health.ts
   │  │  ├─ maps.ts
   │  │  ├─ nodes.ts
   │  │  └─ generate.ts      expand and ask (SSE)
   │  ├─ errors.ts  ids.ts   AppError (code + HTTP status); ULID factory
   │  ├─ store/
   │  │  ├─ mapStore.ts      load, save, list, delete, mutate (per-map queue)
   │  │  ├─ mutations.ts     every change to a map, as pure functions
   │  │  ├─ repair.ts        load-time repairs (DATA-MODEL.md section 9)
   │  │  └─ export.ts        Markdown export
   │  ├─ generation/
   │  │  ├─ prompts.ts       system prompt and templates
   │  │  ├─ context.ts       builds the prompt from a map
   │  │  ├─ apply.ts         applies a parsed result to a map
   │  │  ├─ generator.ts     expandNode, askNode
   │  │  └─ jobs.ts          queue, concurrency, cancellation
   │  └─ providers/
   │     ├─ types.ts         Provider, GenerateRequest, ProviderError
   │     ├─ spawn.ts         runCli: spawn, stdin, line reader, timeout, abort
   │     ├─ claude.ts
   │     ├─ codex.ts
   │     ├─ fake.ts
   │     └─ registry.ts      lookup, health cache
   └─ web/src/
      ├─ main.tsx  App.tsx  MapView.tsx   (MapView: layout, resizable panel, keyboard shortcuts)
      ├─ ui/                 Dialog.tsx, Banners.tsx
      ├─ api/                client.ts (JSON), sse.ts (stream reader)
      ├─ state/              store.ts (zustand), selectors.ts
      ├─ home/               Home.tsx, ProviderChips.tsx
      ├─ canvas/             MapCanvas.tsx, ConceptNodeView.tsx, layout.ts
      ├─ panel/              NodePanel.tsx, Markdown.tsx, Thread.tsx,
      │                      AskBox.tsx, SelectionPopover.tsx
      └─ nav/                Breadcrumb.tsx, Trail.tsx, AnchorButton.tsx,
                             SearchPalette.tsx
```

## 4. Server components

| Component | Responsibility |
|---|---|
| `config` | Reads environment variables once; resolves the data directory; creates `data/maps` and `data/.sandbox` |
| `http/app` | Builds the Hono app; applies the Host and Origin guards; turns thrown errors into the error shape in [API.md](API.md) |
| `mapStore` | Loads and validates map files; keeps open maps in memory; applies mutations through a per-map queue; writes atomically |
| `generation/context` | Turns a map and a target node into the prompt text, within the size budget |
| `generation/generator` | Orchestrates one expand or ask: mark start, call provider, filter the stream, parse, apply, save |
| `generation/apply` | Pure function from (map, node, parsed output) to changed nodes |
| `generation/jobs` | One job per node at a time; at most N jobs running; FIFO queue; abort on client disconnect |
| `providers/*` | One adapter per CLI behind a single interface; health checks |

`packages/shared` holds every pure function that both sides need: slugs, link extraction, output parsing, graph queries. It has no I/O and no dependencies other than zod.

## 5. Web components

| Component | Responsibility |
|---|---|
| `api/client` | Typed JSON calls |
| `api/sse` | `fetch` with a streamed body, parsed into typed events; abortable |
| `state/store` | Current map, selection, streaming buffers, forward stack; applies server events |
| `canvas` | Computes the layout from the map; renders nodes and edges; handles selection and keyboard movement |
| `panel` | Renders the selected node, links, thread and ask box; text-selection popover |
| `nav` | Breadcrumb, trail, anchor, search |

The server is the source of truth. The client applies the nodes carried by `start`, `done` and `error` events and by JSON responses. The only client-only state is the text of a stream in progress, the Forward stack, and UI toggles.

## 6. Flow: explaining a node

1. The learner presses **Explain**. The web app calls `POST /api/maps/:mapId/nodes/:nodeId/expand` and reads the response as a stream.
2. The server checks that the map's provider is usable and that no job is running for this node, then creates a job.
3. If the concurrency limit is reached the job waits and the stream carries `status: queued`.
4. The generator marks the node `generating`, saves, and emits `start` with the node.
5. `context` builds the system prompt and the prompt from the map.
6. The provider spawns the CLI in `data/.sandbox`, writes the prompt to stdin and reads events from stdout.
7. Each text delta passes through `StreamFilter`, which hides the metadata tail, and is emitted as `delta`.
8. When the CLI exits, `parseExpandOutput` splits the final text into body and metadata.
9. `apply` updates the node, registers alternative names, and creates stubs or cross-links for the suggested children.
10. The store saves the map. The stream emits `done` with every node that changed, then closes.
11. The web app replaces those nodes in its store. The canvas lays out the new stubs.

Asking a question follows the same steps with a different prompt, no metadata, and a thread message instead of the node body.

Failure at any step emits `error` with the nodes in their restored state. Closing the stream from the browser aborts the job, which kills the CLI and restores the node.

## 7. Concurrency and cancellation

- One job per node. A second request for the same node while one is running gets `409 conflict`.
- At most `MINDMAPPER_MAX_CONCURRENCY` jobs run at once (default 2). Others wait in order.
- Each job has an `AbortController`. It is aborted by client disconnect, by the 90-second timeout, or by server shutdown.
- Aborting sends `SIGINT` to the CLI, then `SIGKILL` after 2 seconds.
- Map mutations go through a per-map promise queue, so two jobs finishing together cannot interleave their writes.

## 8. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MINDMAPPER_PORT` | `8787` | Server port |
| `MINDMAPPER_DATA_DIR` | `./data` | Where maps and the sandbox directory live |
| `MINDMAPPER_PROVIDER` | none | Forces the provider for every map; `fake` is used by tests and UI work |
| `MINDMAPPER_MAX_CONCURRENCY` | `2` | Jobs running at once |
| `MINDMAPPER_TIMEOUT_MS` | `90000` | Per-generation timeout |
| `MINDMAPPER_CLAUDE_BIN` | `claude` | Path to the Claude CLI |
| `MINDMAPPER_CODEX_BIN` | `codex` | Path to the Codex CLI |
| `MINDMAPPER_FAKE_DELAY_MS` | `15` | Delay between chunks of the fake provider; tests set `0` |
| `MINDMAPPER_DEV` | unset | Set by `npm run dev`. Also allows the Vite origins `http://localhost:5173` and `http://127.0.0.1:5173` |

There is no settings file in v1. Per-map choices (provider, model, level, goal) live in the map.

## 9. Security

The server can spend the user's plan quota, so it must not be reachable by anything except the local app.

- **Bind address**: `127.0.0.1` only. Never `0.0.0.0`.
- **Host guard**: reject any request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding).
- **Origin guard**: reject any request that carries an `Origin` header other than the app's own origin (and the Vite dev origin in development). No CORS headers are ever sent.
- **JSON only**: mutating routes require `Content-Type: application/json`, which a cross-site form cannot send.
- **Process spawning**: argument arrays only, no shell. User text reaches the CLI on stdin or as a single argument, never interpolated into a command line.
- **Tools off**: Claude runs with all tools disabled; Codex runs in a read-only sandbox in an empty directory. See [PROVIDERS.md](PROVIDERS.md).
- **Credentials**: the server never reads, stores or forwards CLI credentials. It strips API-key variables from the child environment. Health responses never include the account email.
- **Rendering**: model output is Markdown with raw HTML disabled; link URLs are limited to `http`, `https` and the internal `concept:` scheme.
- **Paths**: map IDs are validated as ULIDs before being used in a file path.

## 10. Errors

Every failure has a code from one list, shared by JSON responses and stream `error` events. The list is in [API.md](API.md). Provider adapters throw `ProviderError` with one of the provider codes; the generator passes the code and the provider's own message through to the learner.

## 11. Build and run

- **Development**: `npm run dev` starts the server with file watching and the Vite dev server. Vite proxies `/api` to `127.0.0.1:8787`.
- **Production**: `npm run build` builds the web app. `npm start` runs the TypeScript server directly with `tsx` (there is no compiled server; see D-16) and it serves the built web files, so the whole app is at `http://127.0.0.1:8787`.
- **Dev proxy**: Vite proxies `/api` with `changeOrigin: true`. Without it the browser's `Host: localhost:5173` would fail the server's Host guard.
- **Shutdown**: on `SIGINT` or `SIGTERM` the server aborts running jobs, flushes pending writes and exits.

## 12. Performance notes

- Starting the Claude CLI costs about 2.3 seconds before the request is sent. Pre-starting a process is a possible later optimisation (see backlog in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)); it is not in v1.
- Layout runs on every structural change. Dagre handles a few hundred nodes in a few milliseconds; collapsed subtrees are excluded.
- Cross-link edges are rendered only for the selected node by default, which keeps the edge count low.
- The link index is rebuilt in memory whenever a map changes. It is a linear pass over the text and is not stored.
