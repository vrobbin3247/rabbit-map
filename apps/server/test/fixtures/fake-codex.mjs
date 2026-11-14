#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (args[0] === '--version') { console.log('codex-cli 0.144.6'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') { console.log(process.env.FAKE_LOGIN ?? 'Logged in using ChatGPT'); process.exit(0); }
let stdin = '';
process.stdin.setEncoding('utf8');
for await (const c of process.stdin) stdin += c;
if (process.env.FAKE_DUMP) {
  fs.writeFileSync(process.env.FAKE_DUMP, JSON.stringify({ args, stdin, env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null } }));
}
console.error('ERROR codex_models_manager::cache: failed to load models cache');
out({ type: 'thread.started', thread_id: 't' });
out({ type: 'turn.started' });
if (process.env.FAKE_MODE === 'failed') { out({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }); process.exit(1); }
out({ type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: 'thinking' } });
out({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Codex says [[World]].\n===META===\n{"summary":"s"}' } });
out({ type: 'turn.completed', usage: { input_tokens: 13000, output_tokens: 300 } });
