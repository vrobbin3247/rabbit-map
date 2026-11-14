# Mindmapper: working rules

Mindmapper is a local web app that turns AI explanations into a navigable knowledge graph for learning. It gets model output by running the user's subscription-authenticated CLIs (`claude -p`, `codex exec`), never a model API.

## Current state

v1 is implemented (milestones M0 to M6 in [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)). New work should keep the docs and the code in step; see rule 9.

## Hard rules

1. **No API keys, ever.** Do not add a model SDK or any code path that needs `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or similar. Model calls go through the provider adapters in `apps/server/src/providers/` only.
2. **Strip key variables from the child environment** before spawning a CLI, and refuse to generate when a CLI reports API-key authentication. Details in [docs/PROVIDERS.md](docs/PROVIDERS.md).
3. **Never pass `--bare` to `claude`.** Bare mode ignores the subscription login.
4. **Always set `MAX_THINKING_TOKENS=0` for `claude`.** Without it one node takes about 40 seconds instead of about 7.
5. **Automated tests never call a real CLI.** They use the fake provider. Real calls happen only in `npm run smoke`, run by hand, because each one spends the user's plan quota.
6. **One model call per user action.** No background prefetching, no automatic retries that re-run a generation.
7. **Spawn with an argument array, never a shell string.** Prompts go in on stdin.
8. **The server binds to `127.0.0.1` only** and checks `Host` and `Origin` on every request.
9. **The docs are the spec.** If the code must differ from a doc, change the doc in the same commit and add an entry to [docs/DECISIONS.md](docs/DECISIONS.md).
10. **Verify CLI behaviour before relying on it.** Flags and event shapes change between releases. Run `claude --help` or `codex exec --help` and a smoke call; do not trust memory. Facts in PROVIDERS.md are marked verified or unverified.

## Where things are specified

| Question | File |
|---|---|
| What should this feature do? | [docs/PRD.md](docs/PRD.md), [docs/UX.md](docs/UX.md) |
| Where does this code go? | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| What shape is the data? | [docs/DATA-MODEL.md](docs/DATA-MODEL.md) |
| How do I call the CLI? | [docs/PROVIDERS.md](docs/PROVIDERS.md) |
| What do I send the model and how do I parse the reply? | [docs/PROMPTS.md](docs/PROMPTS.md) |
| What does the endpoint return? | [docs/API.md](docs/API.md) |
| How do I test this? | [docs/TESTING.md](docs/TESTING.md) |
| Why was it done this way? | [docs/DECISIONS.md](docs/DECISIONS.md) |

## Conventions

- TypeScript in strict mode, ES modules, Node 22+. No `any`; use `unknown` and narrow.
- Validate everything that crosses a boundary with zod: HTTP bodies, files read from disk, model output.
- Logic used by both server and web lives in `packages/shared` and is pure (no I/O).
- Names follow DATA-MODEL.md exactly: `ConceptNode`, `MapFile`, `slug`, `stub`, `ghost link`, `trail`, `anchor`.
- Tests live in each workspace's `test/` folder (`*.test.ts`, Vitest). Browser tests are in `e2e/` (Playwright). Test files may use `any` for parsed JSON; source files may not.
- Render model output as Markdown with raw HTML disabled.
- Keep dependencies few. Adding one needs a line in DECISIONS.md.

## Commands

```bash
npm run dev          # server 127.0.0.1:8787 + web localhost:5173
npm test             # unit, integration, component; fake provider only
npm run typecheck
npm run lint
npm run test:e2e     # browser walkthrough, fake provider (rebuilds the web app first)
npm run smoke -- claude   # manual, spends plan quota
npm run test:real         # manual, drives the browser against real Claude (3 calls)
```

`npx playwright test` on its own uses the last built web app. Use `npm run test:e2e` so it rebuilds first.

## Before calling a task done

- `npm run typecheck`, `npm run lint` and `npm test` pass.
- The milestone's acceptance criteria in IMPLEMENTATION-PLAN.md are met, checked by actually running the app for anything visible.
- Docs touched by the change are updated.
