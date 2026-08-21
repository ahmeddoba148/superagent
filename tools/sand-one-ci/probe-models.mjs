import fs from 'node:fs';

const key = String(process.env.OKEY || '');
if (!key) throw new Error('missing OKEY');

const endpoint = 'https://omniai-engine.ahmeddoba91.workers.dev/v1/chat/completions';
const source = fs.readFileSync('sand_one/runtime/part00.js.txt', 'utf8');
const block = source.match(/const AI_MODELS = Object\.freeze\(\[([\s\S]*?)\]\);/);
const models = [...String(block?.[1] ?? '').matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
if (models.length !== 10) throw new Error(`MODEL_CHAIN_EXPECTED_10 got=${models.length}`);

let live = 0;
const liveProviders = new Set();
const transient = [];
const permanent = [];
const MIN_LIVE = 5;
const MIN_PROVIDERS = 3;
const permanentStatuses = new Set([400, 401, 402, 403, 404, 405, 409, 410, 422]);

for (const model of models) {
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'رد OK فقط' }],
        max_tokens: 16,
        stream: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const latency = Date.now() - started;

    if (response.ok) {
      live += 1;
      liveProviders.add(String(model).split('::', 1)[0]);
      console.log(`${model} LIVE ${response.status} ${latency}ms`);
      continue;
    }

    const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 220);
    const item = `${model}:HTTP_${response.status}`;
    if (permanentStatuses.has(response.status)) {
      permanent.push(item);
      console.log(`${model} PERMANENT ${response.status} ${latency}ms ${body}`);
    } else {
      transient.push(item);
      console.log(`${model} TRANSIENT ${response.status} ${latency}ms ${body}`);
    }
  } catch (error) {
    const message = String(error?.message || error);
    transient.push(`${model}:${message}`);
    console.log(`${model} TRANSIENT ${message}`);
  }
}

if (permanent.length) {
  throw new Error(`MODEL_CHAIN_PERMANENT_FAILURE: ${permanent.join(' | ')}`);
}
if (live < MIN_LIVE || liveProviders.size < MIN_PROVIDERS) {
  throw new Error(`MODEL_CHAIN_DIVERSITY_FAILED live=${live} providers=${liveProviders.size}: ${transient.join(' | ')}`);
}

console.log(`SAND_MODEL_CHAIN_FAILOVER_PROBE_OK configured=${models.length} live=${live} providers=${liveProviders.size} transient=${transient.length} permanent=0`);
