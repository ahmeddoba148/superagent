import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const MAX_ATTEMPTS = 1;
const BACKOFF_MS = [0, 35_000, 70_000];
const TURN_PACE_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runOnce() {
  const nodeOptions = [process.env.NODE_OPTIONS, '--import=./tools/sand-one-ci/paced-gate-fetch.mjs'].filter(Boolean).join(' ');
  const result = spawnSync(process.execPath, ['sand_v2/live_gate_once.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: nodeOptions, SAND_GATE_TURN_PACE_MS: String(TURN_PACE_MS) },
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return { status: result.status ?? 1, output: `${stdout}\n${stderr}` };
}

function isTransientModelFailure(code) {
  return code === 'http_429' || code === 'timeout' || code === 'network' || /^http_5\d\d$/.test(code);
}

function isIsolatedTransientModelChainOutage(output) {
  const text = String(output ?? '');
  const marker = 'AI unavailable:';
  const at = text.lastIndexOf(marker);
  if (at < 0) return false;
  const line = text.slice(at).split(/\r?\n/, 1)[0];
  const source = fs.readFileSync('sand_v2/source_parts/part00.js.txt', 'utf8');
  const block = source.match(/const AI_MODELS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  const models = [...String(block?.[1] ?? '').matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
  if (models.length < 3) return false;
  return models.every((model) => {
    const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = line.match(new RegExp(`${escaped}:([^ |]+)`));
    return Boolean(match && isTransientModelFailure(match[1]));
  });
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const backoff = BACKOFF_MS[attempt - 1];
  if (backoff > 0) {
    console.log(`CORE_TORTURE_TRANSIENT_BACKOFF attempt=${attempt} ms=${backoff}`);
    await sleep(backoff);
  }
  console.log(`CORE_TORTURE_ATTEMPT ${attempt}/${MAX_ATTEMPTS} pace_ms=${TURN_PACE_MS}`);
  const result = runOnce();
  if (result.status === 0) {
    console.log(`CORE_TORTURE_WRAPPER_OK attempt=${attempt}`);
    process.exit(0);
  }
  if (!isIsolatedTransientModelChainOutage(result.output)) {
    console.error('CORE_TORTURE_NON_TRANSIENT_FAILURE');
    process.exit(result.status || 1);
  }
  if (attempt === MAX_ATTEMPTS) {
    console.error('CORE_TORTURE_TRANSIENT_RETRY_EXHAUSTED');
    process.exit(result.status || 1);
  }
  console.warn(`CORE_TORTURE_MODEL_CHAIN_TRANSIENT_RETRY attempt=${attempt}`);
}

process.exit(1);
