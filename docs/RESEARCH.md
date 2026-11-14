# Research

Background research done on 2026-11-14, before any code. It answers two questions: does this already exist, and can it run on existing subscriptions without an API key.

Provider terms and CLI behaviour changed several times during 2026. Treat dates as part of every claim, and re-check the linked pages before relying on them.

## 1. Summary

- Nothing found combines all three things wanted: one shared node per concept, a way back to the starting point, and no API key.
- Claude (Pro plan) and ChatGPT both work through their official CLIs with a subscription login. Both were tested on this machine.
- Gemini is the weak leg: its CLI no longer serves individual subscribers and the replacement is untested.
- The largest practical finding: Claude's hidden reasoning must be turned off, or each node takes about 40 seconds.

## 2. Prior art

| Kind | Examples | What it does | What it lacks for this project |
|---|---|---|---|
| AI mind maps | Heuristica, learn-thing, Brainforest | A topic becomes a tree; click a node to expand it | Tree only, so a shared concept is duplicated per branch; most need an API key |
| Branching chat canvases | Canvas Chat, ContextFlow, BranchMind, Nodea | Fork a side conversation from any reply, some by highlighting text | Nodes are chat messages, not concepts |
| NotebookLM mind map | Google | Click a node to send a question about it to the chat | Built from uploaded sources, inside Google's interface |
| Generated wikis | Endless Wiki, Dynawiki | One page per concept, written on first visit and saved; terms are links | No map, no trail back |
| Research prototypes | Graphologue, Sensecape (UIST 2023) | Turn LLM answers into node-link diagrams; canvas with a hierarchy view | Not products |

What was taken from each:

- **Generated wikis**: write a concept once, save it, and make every term a link. This is the model for shared nodes and ghost links.
- **Branching canvases**: highlight text to branch. This became **Explain this** and **Ask about this**.
- **Graphologue**: long linear answers are hard to take in; showing concepts and relations as a diagram helps people grasp them and control complexity.
- **Sensecape**: in its user study, people explored more topics and organised them hierarchically when given a canvas with levels. This supports a tree with a visible path.
- **React Flow** is the canvas used by most of the open-source projects above.

Only search summaries of these projects were read. Their code, licences and maintenance status were not checked.

## 3. Using subscriptions without an API key

### Claude

- Anthropic's support article on using the Agent SDK with a Claude plan, as updated on 2026-06-15 and 2026-10-07, says that when signed in with a plan, the Agent SDK and `claude -p` draw from the plan's subscription limits. A plan to move this usage to a separate credit was announced and then paused on 2026-06-15 ("for now, nothing has changed").
- Claude Code's legal page says OAuth login is for subscribers' ordinary use of Claude Code. It forbids third-party developers from offering Claude login in their own applications or routing requests through plan credentials on behalf of their users. It explicitly does not prevent a user from signing in to the unmodified Claude Code binary with their own subscription.
- The headless-mode documentation says `--bare` is the recommended mode for scripts and "will become the default for `-p` in a future release", and that bare mode never reads OAuth credentials. This is a risk to this project; see [PROVIDERS.md](PROVIDERS.md).

Reading: a local tool that runs the user's own installed `claude` for the user's own learning is ordinary individual use. A hosted or shared version would not be.

### ChatGPT (Codex CLI)

- OpenAI's non-interactive mode documentation says `codex exec` reuses the saved CLI login by default, prints JSON Lines with `--json`, and is read-only by default.
- ChatGPT login is for Plus, Pro, Team and Enterprise subscribers; an API key is the per-token alternative.

### Gemini

- Google announced on 2026-05-19 that Gemini CLI would stop serving Google AI Pro, Ultra and free individual accounts on 2026-06-18, replaced by the Antigravity CLI. Paid API keys and enterprise licences keep Gemini CLI access.
- The Antigravity CLI documents a headless mode (`-p`, `--output-format text|json|stream-json`, `--json-schema`).
- A reply on Google's developer forum says headless use consumes the same account entitlements as interactive use. That is the only source found, and it is not official documentation.
- The Antigravity CLI is not installed on this machine and nothing about it was tested.

### Approaches ruled out

- Automating the chat websites or reusing their session tokens: against the providers' terms and fragile.
- Agent Client Protocol adapters: they exist for Claude Code and Codex, but they add processes and a protocol meant for editor integrations.

## 4. Tests run on this machine

Environment: macOS, Node 22.12.0, Claude Code 2.1.287 logged in with a Pro plan, codex-cli 0.144.6 logged in with ChatGPT. No API-key variables were set. Eight small calls were made in total: five through Claude and three through Codex.

### Structured output through each CLI's schema option

| Provider | Command | Result |
|---|---|---|
| Claude (Haiku) | `claude -p … --output-format json --json-schema …` | Valid structured output; about 6 s of model time; 3,841 input tokens |
| Codex | `codex exec --json --output-schema … -o …` | Valid structured output; 12 s; 14,514 input tokens |

### Text format with streaming (the design that was chosen)

The prompt asked for a 150-word explanation with wikilinks, then `===META===`, then JSON.

| Provider and configuration | First text | Total | Output tokens | Format correct |
|---|---|---|---|---|
| Claude Haiku, default | 42.5 s | 43.9 s | 6,919 | Yes |
| Claude Haiku, `--effort low` | 32.5 s | 34.3 s | 4,843 | Yes |
| Claude Haiku, `MAX_THINKING_TOKENS=0` | 4.2 s | 8.1 s | 400 | Yes |
| Claude Haiku, `MAX_THINKING_TOKENS=0`, `--setting-sources ""` | 3.0 s | 7.2 s | 408 | Yes |
| Codex, default effort | none (no streaming) | 16.2 s | 387 | Yes |
| Codex, `model_reasoning_effort="low"` | none (no streaming) | 10.2 s | 371 | Yes |

Each row is a single run.

### What the tests established

1. Both CLIs accept the prompt on stdin and work with a subscription login and no API key.
2. Claude streams text deltas; Codex delivers the whole answer in one event.
3. By default Claude spent about 38 seconds on hidden reasoning for a 150-word answer. `MAX_THINKING_TOKENS=0` removes it. `--effort low` does not.
4. Skipping user settings cuts Claude's start-up by about a second and input to about 800 tokens.
5. Codex carries about 13,000 input tokens of its own instructions per call, mostly cached after the first.
6. Both models followed the format: existing nodes were linked by their exact titles and the JSON was valid. One Claude run added a title heading, which the prompt now forbids and the parser removes.

### Not tested

- Claude Sonnet and Opus timings.
- What either CLI prints when a plan or rate limit is reached.
- What `codex login status` prints when logged out or using an API key.
- Maps large enough to stress the existing-nodes list.

## 5. Sources

Provider policy and documentation:

- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- [Anthropic pauses Agent SDK subscription change (The New Stack)](https://thenewstack.io/anthropic-pauses-claude-agent-sdk-subscription-change/)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode.md)
- [Transitioning Gemini CLI to Antigravity CLI (Google Developers Blog)](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)
- [Antigravity CLI headless mode](https://antigravity.google/docs/cli/headless/)
- [Forum: Antigravity headless mode with account-based usage](https://discuss.ai.google.dev/t/is-external-orchestration-of-antigravity-cli-headless-mode-supported-with-account-based-usage/183051)
- [Agent Client Protocol overview](https://www.morphllm.com/agent-client-protocol)

Prior art:

- [Graphologue paper](https://arxiv.org/abs/2305.11473v2)
- [Sensecape paper](https://arxiv.org/abs/2305.11483v2)
- [Heuristica](https://www.heuristi.ca/mind-map-maker)
- [learn-thing](https://github.com/aotakeda/learn-thing)
- [Brainforest](https://github.com/22bruce/Brainforest)
- [Canvas Chat](https://ericmjl.github.io/blog/2025/12/31/canvas-chat-a-visual-interface-for-thinking-with-llms/)
- [ContextFlow](https://github.com/Kartik-Rajpurohit/ContextFlow)
- [BranchMind](https://github.com/codejet9/branchmind)
- [Nodea](https://github.com/Elliott-Crosby/Nodea)
- [NotebookLM interactive mind maps](https://learnprompting.org/blog/notebooklm-interactive-mind-maps)
- [Endless Wiki (Sean Goedecke)](https://www.seangoedecke.com/endless-wiki/)
- [Dynawiki](https://aipure.ai/products/dynawiki)
