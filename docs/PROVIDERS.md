# Providers

A provider is an adapter that turns "system text + prompt text" into "answer text" by running an official CLI that the user has logged in to with a subscription. This file gives the exact commands.

Every fact below is marked:

- **Verified**: observed on this machine on 2026-11-14 with Claude Code 2.1.287 (Pro plan login) and codex-cli 0.144.6 (ChatGPT login).
- **Unverified**: taken from documentation or inferred; confirm with a smoke call before relying on it.

CLI behaviour changes between releases. Before changing an adapter, run the CLI's `--help` and `npm run smoke`.

## 1. Interface

`apps/server/src/providers/types.ts`:

```ts
export interface Provider {
  readonly id: ProviderId;
  readonly streams: boolean;                 // true if onDelta fires incrementally
  check(): Promise<ProviderStatus>;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export interface GenerateRequest {
  system: string;
  prompt: string;
  model: string | null;                      // null = provider default
  signal: AbortSignal;
  onDelta?: (text: string) => void;
  onStatus?: (phase: 'starting' | 'generating' | 'retrying') => void;
}

export interface GenerateResult {
  text: string;                              // complete final answer
  model: string | null;
  durationMs: number;
  usage: { inputTokens?: number; outputTokens?: number };
}

export interface ProviderStatus {
  id: ProviderId;
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  auth: 'subscription' | 'api_key' | 'unknown' | null;
  plan: string | null;                       // e.g. "pro"; never the email
  usable: boolean;                           // installed && loggedIn && auth === 'subscription'
  reason: string | null;                     // why not usable, in plain words
  fix: string | null;                        // command to run
  models: string[];                          // choices to offer; [] = default only
  streams: boolean;
}

export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, message: string) { super(message); }
}

export type ProviderErrorCode =
  | 'provider_not_installed'
  | 'provider_not_logged_in'
  | 'provider_api_key_auth'
  | 'rate_limited'
  | 'timeout'
  | 'aborted'
  | 'empty_output'
  | 'provider_failed';
```

The interface asks for plain text only. Structured output is handled by the text format in [PROMPTS.md](PROMPTS.md), so an adapter needs no JSON-schema support and a new provider is a small file.

## 2. Rules for every adapter

1. **Spawn without a shell.** `spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })`.
2. **Working directory** is `<dataDir>/.sandbox`, an empty directory. This stops the CLI from loading project instructions and gives an agent nothing to read.
3. **Prompt goes on stdin**, then stdin is closed.
4. **Environment**: copy `process.env`, then delete the variables listed for that provider. This is what guarantees that a stray API key in the shell cannot switch billing to pay-per-token.
5. **Refuse API-key logins.** `generate` calls `check()` (cached for 60 seconds) and throws `provider_api_key_auth`, `provider_not_logged_in` or `provider_not_installed` before spawning.
6. **Timeout** from `MINDMAPPER_TIMEOUT_MS` (90 s). On timeout throw `timeout`.
7. **Abort**: on `signal` abort, send `SIGINT`, then `SIGKILL` after 2 seconds, and throw `aborted`.
8. **Parse stdout line by line as JSON.** Ignore lines that are not JSON and event types that are not listed here.
9. **Ignore stderr unless the process fails.** Both CLIs write harmless warnings there.
10. **Empty answer** throws `empty_output`.
11. **No automatic re-run.** If the CLI itself retries a request, report `retrying`; the adapter never starts a second process.

`providers/spawn.ts` implements rules 1, 3, 6, 7, 8 and 9 once, as `runCli({ bin, args, env, cwd, stdin, signal, timeoutMs, onLine })`.

## 3. Claude

### Command (verified)

```
claude -p
  --model <model>
  --tools ""
  --disable-slash-commands
  --strict-mcp-config
  --setting-sources ""
  --no-session-persistence
  --system-prompt <system>
  --output-format stream-json
  --verbose
  --include-partial-messages
```

- stdin: the prompt.
- Environment additions: `MAX_THINKING_TOKENS=0`.
- Environment removals: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`.
- Default model: `sonnet`. Offered models: `sonnet`, `haiku`, `opus`.

### Why each flag is there

| Flag or variable | Effect | Evidence |
|---|---|---|
| `MAX_THINKING_TOKENS=0` | Turns off hidden reasoning. Without it, one 150-word node took 43.9 s and 6,919 output tokens; with it, 8.1 s and 400 tokens | Verified |
| `--setting-sources ""` | Skips user, project and local settings, so plugins and hooks are not loaded. Start-up dropped from 3.4 s to 2.3 s. Login still works | Verified |
| `--tools ""` | Disables every built-in tool; the model can only write text | Verified |
| `--strict-mcp-config` | With no `--mcp-config`, no MCP servers are connected | Verified to run; effect taken from help text |
| `--disable-slash-commands` | Skills are not loaded | Verified to run; effect taken from help text |
| `--no-session-persistence` | No session file is written; every call is independent | Verified to run |
| `--system-prompt` | Replaces Claude Code's default system prompt. Input fell to about 800 tokens per call | Verified |
| `--output-format stream-json --verbose --include-partial-messages` | One JSON event per line, including text deltas | Verified |

**Do not use `--effort low` as a substitute for `MAX_THINKING_TOKENS=0`.** It was tested and still took 34 s. (Verified)

**Never use `--bare`.** Bare mode does not read the subscription login. Anthropic's documentation says `--bare` "will become the default for `-p` in a future release". When that happens this adapter will fail with an authentication error; the fix is whatever opt-out flag that release provides. Check `claude --help` first if Claude calls start failing after an update.

### Events (verified)

Each stdout line is a JSON object with a `type`.

| `type` | Detail | Action |
|---|---|---|
| `system` | `subtype: "init"`, first event, about 2.3 s after spawn | `onStatus('generating')` |
| `system` | `subtype: "status"`, `"thinking_tokens"` | Ignore |
| `system` | `subtype: "api_retry"` (documented, not observed) | `onStatus('retrying')` |
| `stream_event` | `event.type: "content_block_delta"` and `event.delta.type: "text_delta"` | `onDelta(event.delta.text)` |
| `stream_event` | any other `event.type` or `delta.type` | Ignore |
| `assistant` | Complete message | Ignore |
| `rate_limit_event` | Observed once per call; fields not examined | Log at debug level |
| `result` | Last event | See below |

The `result` event carries, among other fields: `is_error` (boolean), `result` (the complete answer text), `duration_ms`, `usage.input_tokens`, `usage.output_tokens`, `api_error_status`, `stop_reason`, `subtype`.

- Success: `is_error` is false and the exit code is 0. Return `result.result` as `text`. The concatenated deltas equal `result.result` (verified), but always use `result.result` for parsing.
- `total_cost_usd` in the result is the CLI's estimate at API prices. Under a subscription login nothing is charged; do not show it as a cost.

### Errors

Per the documentation, a failure inside the run is printed as the result on stdout and the exit code is non-zero. None of these were triggered during testing, so the mapping is **unverified**:

| Condition | Code |
|---|---|
| `spawn` fails with `ENOENT` | `provider_not_installed` |
| `api_error_status` 401 or 403 | `provider_not_logged_in` |
| `api_error_status` 429, or the message mentions a usage or rate limit | `rate_limited` |
| Anything else with `is_error` true or a non-zero exit | `provider_failed` |

Always pass the CLI's own message text through as the error message. The first real limit error seen in use should be captured as a test fixture and this table corrected.

### Health check (verified)

- `claude --version` prints `2.1.287 (Claude Code)`.
- `claude auth status` prints JSON:

```json
{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "pro" }
```

  (It also includes `email`, `orgId` and `orgName`. Do not return these from the server.)

- `usable` when `loggedIn` is true, `authMethod` is `"claude.ai"` and `apiProvider` is `"firstParty"`. Any other `authMethod` maps to `auth: 'api_key'`.
- `fix` when not logged in: `Run "claude" in a terminal and use /login.`

### Measurements (Haiku, 150-word explanation)

| Configuration | First text | Total | Output tokens |
|---|---|---|---|
| Default thinking | 42.5 s | 43.9 s | 6,919 |
| `--effort low` | 32.5 s | 34.3 s | 4,843 |
| `MAX_THINKING_TOKENS=0` | 4.2 s | 8.1 s | 400 |
| `MAX_THINKING_TOKENS=0` and `--setting-sources ""` | 3.0 s | 7.2 s | 408 |

Measured through `npm run smoke` on 2026-11-14 with the real prompts (including the 800-token system prompt):

| Model | First text | Total | Output tokens | Words |
|---|---|---|---|---|
| `sonnet` (default) | 2.8 s | 8.1 s | 686 | 176 |
| `haiku` | 3.9 s | 8.4 s | 407 | 167 |

Both meet NFR-1 (first words within 5 s, complete within 12 s), so `sonnet` stays the default. Each row is one run. The smoke run also confirmed that `ANTHROPIC_API_KEY=dummy` in the shell has no effect, because the adapter removes it.

## 4. Codex

### Command (verified)

```
codex exec
  --json
  --ephemeral
  --skip-git-repo-check
  --ignore-user-config
  --ignore-rules
  -s read-only
  -C <sandboxDir>
  -c model_reasoning_effort="low"
  [-m <model>]
  -
```

- The final `-` makes Codex read the prompt from stdin.
- stdin: the system text, a blank line, then the prompt. `codex exec` has no system-prompt flag.
- Environment removals: `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`.
- Default model: none passed; Codex chooses. Offered models: none in v1.
- When spawning with an argument array, the `-c` value is the single string `model_reasoning_effort="low"`.

| Flag | Effect | Evidence |
|---|---|---|
| `--json` | JSON Lines events on stdout | Verified |
| `--ephemeral` | No session files | Verified to run |
| `--skip-git-repo-check` | Allows running outside a git repository | Verified |
| `--ignore-user-config` | Ignores `~/.codex/config.toml`; login is still used | Verified |
| `--ignore-rules` | Ignores exec-policy rule files | Verified to run |
| `-s read-only` | Any command the agent runs cannot write | Verified to run |
| `-C <dir>` | Working root is the empty sandbox directory | Verified |
| `-c model_reasoning_effort="low"` | 10.2 s instead of 16.2 s on the same prompt | Verified, one sample each |

Codex is a coding agent and may try to run commands. The system text tells it not to (see PROMPTS.md), and the read-only sandbox in an empty directory limits what it could do.

### Events (verified)

| `type` | Action |
|---|---|
| `thread.started` | `onStatus('generating')` |
| `turn.started` | Ignore |
| `item.completed` with `item.type: "agent_message"` | Keep `item.text`; the last one is the answer |
| `item.*` of other item types | Ignore |
| `turn.completed` | Read `usage.input_tokens`, `usage.output_tokens` |
| `turn.failed`, `error` (documented, not observed) | Throw `provider_failed` with the event's message; map limit messages to `rate_limited` |

**Codex does not stream text.** `codex exec --json` delivered the whole answer in one `item.completed` event. Set `streams: false` and call `onDelta` once with the full text. The UI shows a skeleton with a timer for such providers.

Harmless stderr lines seen during testing: `failed to load models cache: missing field …` and `failed to refresh available models: timeout …`. Ignore stderr when the exit code is 0.

### Health check (verified)

- `codex --version` prints `codex-cli 0.144.6`.
- `codex login status` prints `Logged in using ChatGPT`.
- `usable` when the output contains `ChatGPT`. Output that mentions an API key maps to `auth: 'api_key'`. Anything else is not logged in. The exact wording for the other cases is **unverified**.
- `fix` when not logged in: `Run "codex login" in a terminal.`

### Measurements

| Configuration | Total | Input tokens | Output tokens |
|---|---|---|---|
| Default effort | 16.2 s | 13,068 (9,984 cached) | 387 |
| `model_reasoning_effort="low"` | 10.2 s | 13,081 (9,984 cached) | 371 |

Through `npm run smoke` with the real prompts: 17.7 s total, 14,230 input tokens, 501 output tokens, 174 words, valid metadata. This meets NFR-2 (within 20 s) with little margin.

Codex adds about 13,000 input tokens of its own instructions to every call. Most are cached after the first call, but each call still counts against the ChatGPT plan's Codex allowance.

## 5. Fake

Used by all automated tests and for UI work. Selected with `MINDMAPPER_PROVIDER=fake`. Always usable, streams, makes no network or process calls. Its behaviour is specified in [TESTING.md](TESTING.md).

## 6. Antigravity (Gemini): not in v1

Gemini CLI stopped serving individual Google AI Pro accounts on 2026-06-18. Its replacement, the Antigravity CLI, documents a headless mode: `agy -p` with `--output-format text|json|stream-json`. Everything about it is **unverified**: it is not installed on this machine, and the only statement that headless use draws on subscription quota is a forum reply. Adding it means installing it, repeating the checks in this file, and writing `providers/antigravity.ts`. It is in the backlog.

## 7. Policy limits

- Anthropic permits signing in to the unmodified Claude Code binary with your own subscription. It does not permit offering Claude login inside a product for other people, or routing other people's requests through your plan. Mindmapper stays inside this by being a local, single-user tool that runs the user's own installed CLI.
- Anthropic's support page states that `claude -p` usage, when signed in with a plan, draws from that plan's limits.
- Do not add any hosted or multi-user mode on top of these adapters. That would need API keys and a different design.
- Never read the CLIs' credential files, and never drive the providers' chat websites.

Sources are in [RESEARCH.md](RESEARCH.md). Re-read them if a provider announces a billing or terms change.

## 8. Checklist for adding a provider

1. Confirm in the provider's own documentation that non-interactive use with a subscription login is allowed.
2. Find the flags for: prompt on stdin, no tools, no session files, machine-readable output, model choice.
3. Find how to tell a subscription login from an API-key login, and which environment variables would override it.
4. Time one call. Check for hidden reasoning that can be turned off.
5. Write the adapter and a recorded-output test. Add it to the registry and to this file with verified/unverified marks.
