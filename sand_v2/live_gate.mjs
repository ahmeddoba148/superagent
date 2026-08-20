import { spawnSync } from 'node:child_process';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 35_000, 70_000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runOnce() {
  const result = spawnSync(process.execPath, ['sand_v2/live_gate_once.mjs'], {
    encoding: 'utf8',
    env: process.env,
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
  const models = [
    'groq::openai/gpt-oss-120b',
    'groq::qwen/qwen3.6-27b',
    'gemini::gemini-3.5-flash-lite',
  ];
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
  console.log(`CORE_TORTURE_ATTEMPT ${attempt}/${MAX_ATTEMPTS}`);
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
