# Mindmapper

**Learn a topic with AI without losing the thread.**

Mindmapper turns an AI explanation into a map you can walk around. You type a topic, get a board of concept cards, and go as deep as you like on any of them. Every term in an explanation is a link. A concept that comes up in two places is still one card, and the app always shows how you got here and how to get back.

It runs on your own computer and uses the AI subscriptions you already pay for (Claude and/or ChatGPT). **There is no API key and no extra cost.**

## The problem

Learning from an AI chat usually goes like this: you ask what deep learning is, the answer mentions CNNs, you ask about CNNs, that mentions layers, then neurons, then activations, then channels. Five questions later you have lost the original point, the chat has lost it too, and you stop enjoying it. A chat is one long line. Learning a subject is a graph.

## What you get

- **A board, not a transcript.** Each concept is a card. Cards you have not opened yet are dashed outlines, so you can see what is left to explore.
- **Go deeper on demand.** Click a card to open it, press **Explain**, and read. Nothing is written until you ask, so you never spend your plan on a stray click.
- **Every term is a link.** A solid link goes to a concept already on the board. A dotted link is a concept you have not opened yet; click it and it appears.
- **One card per concept.** "Channels" reached from two different branches is the same card, shown under **Mentioned in** and **See also**.
- **Ask questions on any card.** Answers are saved on the card. If an answer names kinds or parts of something ("different types of padding"), they are added as new cards under it.
- **Always a way back.** A breadcrumb, a trail, Back and Forward, search, and an **anchor** you can set as "where I really am".
- **Yours to arrange.** Drag cards anywhere, collapse branches, rename, merge, delete, and export everything as Markdown notes.
- **Private.** The server only listens on your own machine. Maps are plain files in a folder.

## Requirements

- **macOS or Linux** (Windows is untested)
- **Node.js 22 or newer** (`node -v` to check)
- At least one of these, **signed in with your subscription**:
  - **Claude Code** with a Claude plan (Pro or Max). Sign in by running `claude` and typing `/login`.
  - **Codex CLI** with ChatGPT (Plus, Pro or Team). Sign in by running `codex login`.

Mindmapper never asks for an API key. If a CLI is logged in with an API key instead of a plan, Mindmapper refuses to use it, so you cannot be billed per token by accident (see [Troubleshooting](#troubleshooting)).

Each time you press **Explain** or send a question, one request goes through your own CLI and counts against your plan's normal usage limits.

## Setup

```bash
git clone <this repository>
cd mindmapper
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser.

The home screen shows a status chip for each provider. Claude and/or ChatGPT should say **ready**. If one says *not installed* or *not logged in*, click it to see what to run.

To run it as a single server instead (no hot reloading):

```bash
npm run build
npm start        # then open http://127.0.0.1:8787
```

### Where your data lives

Maps are saved as JSON files in `./data/maps/`. Back that folder up if your maps matter. To keep them elsewhere:

```bash
MINDMAPPER_DATA_DIR=~/Documents/mindmapper-data npm run dev
```

### Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `MINDMAPPER_DATA_DIR` | `./data` | Where maps and exports are stored |
| `MINDMAPPER_PORT` | `8787` | Server port |
| `MINDMAPPER_TIMEOUT_MS` | `90000` | Stop a single generation after this long |
| `MINDMAPPER_MAX_CONCURRENCY` | `2` | Generations running at the same time |
| `MINDMAPPER_CLAUDE_BIN` / `MINDMAPPER_CODEX_BIN` | `claude` / `codex` | Path to a CLI that is not on your `PATH` |

## Using Mindmapper

### Start a map

1. On the home screen, type a topic (for example *Deep learning*).
2. Pick your **level**: beginner, intermediate or advanced. This changes how explanations are written.
3. Optionally add a **goal** ("prepare for an exam"). It is passed along with every request.
4. Press **Start mapping**. The overview streams in on the right, and a few starter cards appear on the board.

### The screen

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ‹ Maps  Deep learning               provider  model  level  ☀ ▭ ☾  Search │  top bar
│ ← →   Deep learning › CNN › Pooling      depth 2   [Set anchor] [⚓ Root]   │  where you are
├──────────────────────────────────────────────────────┬───────────────────┤
│ ▢ tools   ┌ Trail ┐                                   │ Pooling      ⋯   │
│ ▢ ▢ ▢     │ ...   │      the board                    │ explanation with  │
│ ▢ ▢       └───────┘      (cards and connectors)       │ links, next       │
│                                                       │ concepts, See     │
│                      − 100% +                         │ also, questions   │
└──────────────────────────────────────────────────────┴───────────────────┤
                                                          Ask about Pooling…
```

- **Board (left):** the map. Pan by dragging the background, zoom with the wheel or the `−` `+` buttons.
- **Panel (right):** the selected card. Drag its left edge to resize it.
- **Tools (far left):** fit the whole map, centre on the selected card, tidy up the layout, show all cross-links, show a minimap.
- **Trail:** the cards you visited, in order.

### Reading a card

| What you see | What it means |
|---|---|
| Dashed outline | Not explained yet. Press **Explain** (or double-click the card). |
| Filled colour card | Explained. The colour changes with depth, so each level reads at a glance. |
| Pulsing card, "Writing…" | Being written now. **Stop** (or `Esc`) cancels it. |
| Orange card with ⚠ | The last attempt failed. The panel shows the reason and **Try again**. |
| ⚓ badge | The anchor card. |
| `2?` badge | The card has 2 questions saved on it. |
| `+4` badge | A collapsed card hiding 4 cards. |
| Bright ring | The selected card. Connectors along your path to it are highlighted. |

### Going deeper

- **Click a solid link** in an explanation to jump to that card.
- **Click a dotted link** to create that concept under the current card and have it explained.
- **Select any words** in an explanation or answer. A small bar offers **Explain this** (makes the selection a card) and **Ask about this** (quotes it in your question).
- **Open a suggested concept** from **Next concepts** at the bottom of a card.
- **Ask a question** in the box at the bottom of the panel (`Enter` sends, `Shift+Enter` adds a line). The answer is saved on the card. If it names distinct kinds, parts or steps, they appear as new cards under it.

If the same concept is already on the board, Mindmapper links to the existing card instead of making a copy.

### Never lose your place

Learning gets deep fast, so four tools are always on screen:

- **Breadcrumb**: where this card sits in the subject, from the root down. Click any part to jump there.
- **Trail**: the cards you visited, in order. Click one to return to it.
- **Back and Forward** (or `Alt+←` and `Alt+→`): step through the trail like a browser.
- **Anchor**: the card you consider "home". It starts as the root. Press **Set anchor here** on any card, and the **⚓** button in the top bar (or the `A` key) brings you straight back. The **depth** counter turns amber at depth 5, a hint that you are well down a rabbit hole.

**Search** (`Cmd/Ctrl+K`) finds a card by name or alternative name.

### Arranging the board

- **Drag a card** anywhere. Its position is saved. Cards you have not moved follow their parent when it moves.
- **Tidy up** returns every card to the automatic layout.
- **Collapse a branch** to hide it (its card shows how many are hidden).
- **Rename** a card; the old name keeps working as a link.
- **Merge** two cards that mean the same thing; their questions and children are combined.
- **Delete** a card and everything below it (you are asked first).
- **Export** (top bar) writes one Markdown file per card to `./data/exports/<map name>/`, with `[[wikilinks]]` intact, so the folder opens as an Obsidian vault. Exporting again replaces that folder. A folder you made yourself with the same name is never touched; a numbered one (`<map name> (2)`) is used instead.

### Right-click menu

Right-click a card (or press `Shift+F10`) for everything you can do to it: Explain or Regenerate, Ask a question, **Add child concept** (creates a card by name with no AI request), go to parent or first child, set as anchor, release position, collapse, copy its link or explanation, rename, merge and delete. Right-click empty board space for fit, go to anchor, tidy up and cross-links.

### Switching AI or level

Use the dropdowns in the top bar to change **provider** (Claude or ChatGPT), **model** (Claude only) and **level** at any time, even partway through a map. Each request is rebuilt from the map, so switching never loses context.

| | Claude | ChatGPT (Codex) |
|---|---|---|
| Text appears as it is written | Yes | No, the whole answer arrives at once |
| Typical time for one card | about 8 to 10 seconds | about 15 seconds |

### Themes

The three buttons in the top bar choose **Light**, **System** (follows your computer) or **Dark**. Your choice is remembered in this browser.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `Cmd/Ctrl+K` | Search |
| `Alt+←` / `Alt+→` | Back / Forward |
| `Enter` | Explain the selected card (when the board has focus) |
| `/` | Jump to the question box |
| `A` | Go to the anchor |
| Arrow keys | Move selection: `←` parent, `→` first child, `↑` `↓` siblings |
| `Shift+F10` or menu key | Open the selected card's menu |
| `Esc` | Close a menu or dialog; otherwise stop a running generation |

### Tips

- Start broad, then open only the cards you care about. Unopened cards cost nothing.
- Set the anchor before you dive in. It is the cheapest way to find your way back.
- Phrase questions as "what are the kinds of…" or "what are the steps of…" to grow a branch.
- Use **Add child concept** when you already know what you want a card to be called.

## Troubleshooting

| Problem | What to do |
|---|---|
| A provider chip says **not installed** | Install that CLI, then click **Check again**. |
| **not logged in** | Run `claude` and type `/login`, or run `codex login`, then click **Check again**. |
| **API-key login (refused)** | Mindmapper only uses subscription logins so it never bills per token. Log out of the CLI and sign in with your plan. |
| A card shows a usage or rate-limit message | That is your provider's own message. Wait for your limit to reset, or switch provider in the top bar. |
| "This took too long and was stopped" | Press **Try again**. Raise `MINDMAPPER_TIMEOUT_MS` if it keeps happening. |
| "Could not reach the Mindmapper server" | The server is not running. Start `npm run dev` again. |
| `EADDRINUSE` on start | Another program uses port 8787. Set `MINDMAPPER_PORT` to something else. |
| "Could not copy" appears | Your browser blocked clipboard access. Allow it for this page. |
| A map shows as **Unreadable** | Its file in `data/maps/` is damaged. Mindmapper leaves it untouched so you can repair or recover it. |

## Privacy and safety

- The server listens on `127.0.0.1` only and rejects requests from other sites or hosts.
- Nothing is sent anywhere except the prompt that goes through your own Claude or Codex CLI. Images in an AI answer are never loaded, and the page the server serves carries a policy that blocks requests to other sites.
- Mindmapper never reads your CLI credentials and never uses an API key.
- It is built for one person on one computer. It is not designed to be put on a network or shared with other people.

## For developers

```bash
npm test             # unit, integration and component tests (no real AI calls)
npm run typecheck
npm run lint
npx playwright install chromium   # once, for the browser tests
npm run test:e2e     # rebuilds, then drives the app in a real browser with a fake AI

# These spend a little of your plan quota. Run them by hand.
npm run smoke -- claude [--model haiku]            # one real call, prints timings
npm run smoke -- codex
npm run smoke -- claude --ask "what are the kinds of padding"
npm run test:real    # drives the browser against real Claude (3 calls)
```

Layout:

```
packages/shared   types, schemas, parsing and graph logic used by both sides
apps/server       local API, map storage, Claude and Codex adapters
apps/web          the React app (board, panel, navigation)
e2e/              browser tests
scripts/          manual smoke tests
docs/             design notes: requirements, UX, architecture, data model, providers, prompts
```

Rules for contributors, including the "no API keys" rule, are in [CLAUDE.md](CLAUDE.md). Design notes start at [docs/PRD.md](docs/PRD.md).

## Limits

- Claude and ChatGPT (Codex) are supported. Gemini is not, because its command-line tool no longer serves individual subscriptions.
- An answer adds at most 5 new cards; further concepts it names stay as dotted links you can click.
- Explanations come from the AI's own knowledge. They can be wrong, and nothing is checked against sources.
- One person, one computer. No accounts, sync or sharing.
