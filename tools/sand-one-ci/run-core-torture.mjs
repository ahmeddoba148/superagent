import { spawnSync } from 'node:child_process';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 35_000, 70_000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runOnce() {
  const result = spawnSync(process.execPath, ['sand_v2/live_gate.mjs'], {
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

function isIsolatedAllModelRateLimit(output) {
  const text = String(output ?? '');
  const allModels = [
    'groq::openai/gpt-oss-120b:http_429',
    'groq::qwen/qwen3.6-27b:http_429',
    'gemini::gemini-3.5-flash-lite:http_429',
  ].every((needle) => text.includes(needle));
  return allModels && text.includes('AI unavailable:');
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  if (BACKOFF_MS[attempt - 1] > 0) {
    console.log(`CORE_TORTURE_RATE_LIMIT_BACKOFF attempt=${attempt} ms=${BACKOFF_MS[attempt - 1]}`);
    await sleep(BACKOFF_MS[attempt - 1]);
  }
  console.log(`CORE_TORTURE_ATTEMPT ${attempt}/${MAX_ATTEMPTS}`);
  const result = runOnce();
  if (result.status === 0) {
    console.log(`CORE_TORTURE_WRAPPER_OK attempt=${attempt}`);
    process.exit(0);
  }
  if (!isIsolatedAllModelRateLimit(result.output)) {
    console.error('CORE_TORTURE_NON_RATE_LIMIT_FAILURE');
    process.exit(result.status || 1);
  }
  if (attempt === MAX_ATTEMPTS) {
    console.error('CORE_TORTURE_RATE_LIMIT_EXHAUSTED');
    process.exit(result.status || 1);
  }
  console.warn(`CORE_TORTURE_ALL_MODELS_429_RETRYING attempt=${attempt}`);
}

process.exit(1);
