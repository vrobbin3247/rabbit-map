#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (args[0] === '--version') { console.log('2.1.287 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(process.env.FAKE_AUTH ?? JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro', email: 'someone@example.com', orgId: 'org', orgName: 'Org' }));
  process.exit(0);
}
let stdin = '';
process.stdin.setEncoding('utf8');
for await (const c of process.stdin) stdin += c;
if (process.env.FAKE_DUMP) {
  fs.writeFileSync(process.env.FAKE_DUMP, JSON.stringify({ args, stdin, env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null, MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS ?? null } }));
}
const mode = process.env.FAKE_MODE ?? 'ok';
out({ type: 'system', subtype: 'init' });
out({ type: 'system', subtype: 'thinking_tokens' });
if (mode === 'hang') { out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } } }); setInterval(() => {}, 1000); }
else if (mode === 'limit') {
  out({ type: 'result', subtype: 'error', is_error: true, api_error_status: 429, result: "You've hit your usage limit. Resets at 5pm." });
  process.exit(1);
} else if (mode === 'login') {
  out({ type: 'result', is_error: true, api_error_status: 401, result: 'Invalid API key · Please run /login' });
  process.exit(1);
} else if (mode === 'nolines') { process.exit(1); }
else {
  const text = 'Hello [[World]].\n===META===\n{"summary":"s"}';
  for (const part of [text.slice(0, 8), text.slice(8)]) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } });
    out({ type: 'stream_event', event: { type: 'content_block_stop' } });
  }
  out({ type: 'rate_limit_event' });
  console.log('this line is not json');
  out({ type: 'result', is_error: false, result: process.env.FAKE_EMPTY ? '' : text, usage: { input_tokens: 800, output_tokens: 40 } });
}
