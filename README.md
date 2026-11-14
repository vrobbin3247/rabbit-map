# Mindmapper

Learn a topic with AI without losing the thread.

You ask about a topic. Mindmapper draws it as a map of concept nodes. You click any node to go deeper, and every term in an explanation is a link. Each concept exists once, so "channels" reached from CNNs and from image basics is the same node. A breadcrumb, a trail and an anchor always show how you got here and take you back.

> **Status (2026-11-14): implemented (v1).** All seven milestones in [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) are built and checked, with Claude and ChatGPT (Codex) as providers. Gemini is not included.

## The problem it solves

Learning through an AI chat goes like this: you ask what deep learning is, the answer mentions CNNs, you ask about CNNs, that mentions layers, then neurons, then activations, then channels. Five questions later you have lost the original point, the chat has lost it too, and you lose interest. A chat is a single line; learning is a graph.

## How it works

1. Type a topic. You get a root node with an overview and a few starter nodes around it.
2. Click a node and press **Explain**. The explanation is written for that node in the context of the path that led to it.
3. Terms in the explanation are links. A link to a concept already on the map jumps to that node. A link to a new concept creates the node when you click it.
4. Ask follow-up questions on any node. They stay attached to that node.
5. Use the breadcrumb, the trail and **Back to anchor** to return to where you were.

## No API key, no extra cost

Mindmapper does not call any model API. It runs the official command-line tools you are already logged in to and reads their output:

| Subscription | CLI used | State |
|---|---|---|
| Claude Pro / Max | `claude -p` | Tested, streams |
| ChatGPT Plus / Pro | `codex exec` | Tested, no streaming |
| Google AI Pro | `agy -p` (Antigravity CLI) | Planned, untested |

It refuses to run if a CLI is authenticated with an API key, so it can never bill you per token. It is a personal, local tool: it listens on `127.0.0.1` only and stores maps as files on your disk.

## Prerequisites

- macOS or Linux
- Node.js 22 or later
- At least one of:
  - Claude Code CLI, logged in with a Claude plan (`claude`, then `/login`)
  - Codex CLI, logged in with ChatGPT (`codex login`)

## Commands

```bash
npm install
npm run dev          # server on 127.0.0.1:8787, web on http://localhost:5173  (open this one)
npm test             # unit, integration and component tests, fake provider only
npm run typecheck
npm run lint
npm run test:e2e     # builds, then runs the browser walkthrough with the fake provider
npm run build && npm start   # one server on http://127.0.0.1:8787 serving the built app

# These spend a little of your plan quota. Run them by hand.
npm run smoke -- claude [--model haiku]   # one real call, prints timings and the parsed result
npm run smoke -- codex
npm run test:real    # drives the browser against real Claude (3 calls)
```

Maps are stored as JSON files in `./data/maps/` (override with `MINDMAPPER_DATA_DIR`). Settings and environment variables are listed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) section 8.

## Documentation

Read in this order.

| File | What it answers |
|---|---|
| [docs/PRD.md](docs/PRD.md) | What we are building, for whom, and what is out of scope |
| [docs/UX.md](docs/UX.md) | Screens, node states and every interaction |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, components, repository layout, security |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Types, storage, how concepts are matched and shared |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | Exact CLI commands, flags, events and error handling |
| [docs/PROMPTS.md](docs/PROMPTS.md) | Prompts, the output format and how it is parsed |
| [docs/API.md](docs/API.md) | HTTP and streaming contract between web and server |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | Milestones, ordered tasks, acceptance criteria |
| [docs/TESTING.md](docs/TESTING.md) | Test layers, the fake provider, manual checklist |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions made, why, and what was rejected |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Prior art, provider policies, measurements, sources |

[CLAUDE.md](CLAUDE.md) holds the working rules for a coding agent in this repository.
