const key = String(process.env.OKEY || '');
if (!key) throw new Error('missing OKEY');

const endpoint = 'https://omniai-engine.ahmeddoba91.workers.dev/v1/chat/completions';
const models = [
  'groq::openai/gpt-oss-120b',
  'groq::qwen/qwen3.6-27b',
  'gemini::gemini-3.5-flash-lite',
];

let live = 0;
const transient = [];

for (const model of models) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'رد OK فقط' }],
        max_tokens: 32,
        stream: false,
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(`SHARED_AUTH_${response.status} ${model}`);
    }

    if (response.ok) {
      live += 1;
      console.log(`${model} LIVE ${response.status}`);
      continue;
    }

    const body = (await response.text().catch(() => '')).slice(0, 200);
    transient.push(`${model}:HTTP_${response.status}`);
    console.log(`${model} TRANSIENT ${response.status} ${body}`);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.startsWith('SHARED_AUTH_')) throw error;
    transient.push(`${model}:${message}`);
    console.log(`${model} TRANSIENT ${message}`);
  }
}

if (live < 1) {
  throw new Error(`MODEL_CHAIN_NO_LIVE_MODEL: ${transient.join(' | ')}`);
}

console.log(`SAND_MODEL_CHAIN_FAILOVER_PROBE_OK live=${live} transient=${transient.length}`);
