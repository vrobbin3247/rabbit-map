# Decisions

One entry per decision: what was decided, why, and what was rejected. Add an entry whenever the code departs from a doc or a dependency is added. Newest at the bottom.

Entries D-01 to D-15 were made on 2026-11-14 during research and specification, before any code. The evidence for them is in [RESEARCH.md](RESEARCH.md) and [PROVIDERS.md](PROVIDERS.md).

---

### D-01. Model access goes through official CLIs with subscription logins

**Decision**: the only way to reach a model is to spawn `claude -p` or `codex exec` on the user's machine.

**Why**: the user pays for Claude, ChatGPT and Gemini subscriptions and does not want API costs or the providers' chat interfaces. Both CLIs were tested and work non-interactively with a plan login.

**Rejected**: model APIs (cost money); automating the chat websites or reusing their session tokens (against terms, fragile); running inside the providers' chat apps as a plugin (the chat interface is the problem being solved); local models (weaker explanations; could be added later as another provider).

### D-02. Refuse API-key authentication

**Decision**: adapters delete API-key variables from the child environment and refuse to generate when a CLI reports a non-subscription login.

**Why**: an `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the shell would silently switch the CLI to per-token billing. "No extra cost" has to be enforced, not assumed.

### D-03. Personal, local, single-user only

**Decision**: the server binds to `127.0.0.1`, has no accounts and no hosted mode.

**Why**: Anthropic's terms allow using your own subscription login in the unmodified Claude Code binary, and forbid offering that login to other people through a product. Staying local keeps the tool inside those terms. It also removes authentication, sync and deployment from the build.

### D-04. Plain-text output format instead of the CLIs' JSON-schema options

**Decision**: the model writes Markdown, a `===META===` line, then a small JSON object. Parsing is done by Mindmapper.

**Why**: text can be streamed to the learner as it is written; JSON-schema output cannot be shown until it is complete. One format and one parser serve every provider, so an adapter only has to return text. Both providers produced the format correctly when tested.

**Rejected**: `--json-schema` (Claude) and `--output-schema` (Codex). Both work and were tested, but they differ per provider and block streaming.

**Cost**: the format is not guaranteed. The parser therefore has a fallback that rebuilds children from the links in the text.

### D-05. Every call is stateless

**Decision**: no CLI session is resumed. Each prompt is rebuilt from the map: topic, path, ancestor summaries, existing node names, and the node's own text.

**Why**: this is the fix for "the AI loses the original point". It also keeps prompts small, makes calls independent of each other, and lets a map change provider at any time.

**Rejected**: one long CLI session per map (context grows without limit and drifts, which is the original problem); one session per node (provider-specific, leaves session files behind).

### D-06. One node per concept, matched by slug, with the model told which nodes exist

**Decision**: within a map, a concept is one node. Names are compared by a normalised slug (case, punctuation and simple plurals ignored) and by alternative names. The prompt lists existing node titles and tells the model to reuse them exactly.

**Why**: shared concepts such as "channels" are a core requirement. Sending the titles prevents most duplicates at the source; slugs and aliases catch simple variations; manual merge handles the rest.

**Rejected**: embedding-based matching (needs a model or an API; unnecessary at this size); asking the model to de-duplicate in a second call (doubles quota use).

**Known limit**: near-synonyms such as "Convolution" and "Convolutional Layer" can still become two nodes.

### D-07. Tree plus derived cross-links

**Decision**: each node has one parent, giving a tree for layout, path and depth. Links between nodes are computed from the text, not stored. Only cross-links that come from suggested children are stored, in `related`.

**Why**: a tree is readable and gives every node an unambiguous path back to the root. Deriving links from text means rename, merge and delete cannot leave broken links.

**Rejected**: a free-form graph with stored edges (no clear path, hard to lay out readably, needs link maintenance).

### D-08. Ghost links: nodes are created when clicked, not when mentioned

**Decision**: a linked term with no node is shown as a ghost link in the text and becomes a node only when the learner clicks it. Only the 3 to 7 suggested children appear on the canvas as stubs.

**Why**: an explanation can mention ten or more concepts. Adding all of them would bury the map. This follows the generated-wiki pattern found in research.

### D-09. No background generation; one call per action; no auto-explain on select

**Decision**: nothing is generated until the learner asks. Selecting a stub shows its summary and an **Explain** button.

**Why**: subscription limits are finite, especially on the Pro plan, and Codex adds about 13,000 tokens to every call. Pre-generating children would multiply usage for content that may never be read.

### D-10. `MAX_THINKING_TOKENS=0` for Claude

**Decision**: always set it.

**Why**: measured. A 150-word explanation took 43.9 s with default thinking, 34.3 s with `--effort low`, and 8.1 s with thinking off. The task is short explanatory writing and does not need hidden reasoning.

### D-11. `--setting-sources ""`, no tools, replaced system prompt, empty working directory

**Decision**: run the CLIs as bare text generators: no user settings, plugins, skills, MCP servers or tools; our own system prompt; an empty sandbox directory.

**Why**: faster start (3.4 s to 2.3 s), about 800 input tokens instead of about 3,800, the same behaviour on every machine, and nothing for an agent to act on.

**Not used**: `--bare`, which would do most of this but disables the subscription login.

### D-12. TypeScript monorepo: Hono server, Vite and React web, React Flow canvas, dagre layout

**Decision**: as listed in [ARCHITECTURE.md](ARCHITECTURE.md) section 2.

**Why**: one language end to end; shared parsing and slug code runs on both sides; React Flow is the standard node canvas and was used by most of the open-source prior art; Hono and Vite are small and need little configuration.

**Rejected**: Next.js (more framework than a local tool needs; long-lived child processes and streams are simpler in a plain server); a desktop shell such as Electron or Tauri (packaging work with no benefit for one user); a Python backend (two languages, and the shared logic would be duplicated).

### D-13. One JSON file per map

**Decision**: `data/maps/<id>.json`, written atomically.

**Why**: no native dependency, readable and easy to back up, and a 500-node map is about 1 MB. Storage is behind `mapStore`, so it can change later.

**Rejected**: SQLite (native module, or an experimental flag on Node 22.12; nothing here needs queries); a folder of Markdown files as the primary store (threads, layout and state do not fit cleanly; offered as an export instead).

### D-14. Direct CLI spawning instead of the Agent SDK or Agent Client Protocol

**Decision**: adapters spawn the CLIs and parse their JSON-lines output.

**Why**: the need is "one prompt in, text out". Two small adapters cover it with no extra dependency.

**Rejected**: the Claude Agent SDK package (Claude only; still spawns the same binary); Agent Client Protocol adapters (extra processes and a protocol designed for editor integrations with tools and permissions, none of which are used here).

### D-15. Gemini is deferred

**Decision**: v1 ships with Claude and Codex. Antigravity is in the backlog.

**Why**: Gemini CLI no longer serves individual Google AI Pro accounts. Its replacement is not installed here and its use of subscription quota in headless mode is confirmed only by a forum reply.

---

### D-16. The server runs TypeScript directly with tsx; there is no compiled server

**Decision**: `npm start` and `npm run dev` both run `tsx`. Only the web app has a build step.

**Why**: `@mindmapper/shared` is consumed as TypeScript source by the server, the web app and the tests. Compiling the server would add a second build with path handling for a local tool that starts in well under a second.

**Rejected**: compiling shared and server with `tsc` or a bundler (extra moving parts, nothing gained for a single-user local app).

### D-17. Playwright for browser tests, plus a manual real-provider test

**Decision**: `e2e/walkthrough.spec.ts` runs against the fake provider and fails on any uncaught page exception. `e2e/real.manual.ts` runs the same app against real Claude and is never part of `npm test`.

**Why**: the first browser run found three real bugs that the unit and integration tests did not: a React crash from an effect that returned a value, a node left stuck in "Writing…" after Stop because the client re-read the map before the server had restored it, and arrow-key navigation dying after the first keystroke. The real-provider run found two more: a layout bug (an unlayered `width: 100%` beat Tailwind's `w-auto`) and an answer that landed below the fold. Browser tests are worth keeping for this app.

### D-18. After Stop the client re-reads until the node settles

**Decision**: when the learner stops a generation, the client aborts the request and then re-reads the map up to 15 times at 200 ms intervals until the node and its thread are no longer "generating".

**Why**: the server restores the node asynchronously after the abort, so one immediate re-read can race it.

**Rejected**: restoring the node optimistically on the client (it does not know the previous state without duplicating server logic); making the server finish the restore before the connection closes (the connection is already gone).

### D-19. Search ties are broken by title length

**Decision**: among equally good matches, the shorter title ranks first.

**Why**: typing "part b" should find "Deep learning Part B" before "Deep learning Part A Detail Part B". Alphabetical order did the opposite.

---

## Choices that are cheap to change

These were made to keep the build moving. Changing them touches little code.

| Choice | Where | Alternative |
|---|---|---|
| Default Claude model is `sonnet` | `providers/claude.ts` | `haiku`, if Sonnet is too slow (decided in T2.8) |
| Default learner level is beginner | `POST /maps` default | Any level |
| Selecting a stub does not auto-explain | `NodePanel` | Explain on single click |
| Tailwind for styling | web only | Plain CSS |
| Data directory is `./data` | `config.ts` | A folder in the home directory |
| Layout is left to right | `canvas/layout.ts` | Top to bottom, or radial |
