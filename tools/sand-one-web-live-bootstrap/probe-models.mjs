const key = String(process.env.OKEY || '');
if (!key) throw new Error('missing OKEY');
const endpoint = 'https://omniai-engine.ahmeddoba91.workers.dev/v1/chat/completions';
const models = ['groq::openai/gpt-oss-120b','groq::qwen/qwen3.6-27b','gemini::gemini-3.5-flash-lite'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const model of models) {
  let last = 'not attempted';
  let ok = false;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'رد OK فقط' }], max_tokens: 32, stream: false }),
        signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) {
        console.log(`${model} OK ${response.status} attempt=${attempt}`);
        ok = true;
        break;
      }
      const body = (await response.text().catch(() => '')).slice(0, 300);
      last = `HTTP ${response.status} ${body}`;
      if (response.status !== 429 && response.status < 500) break;
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const backoff = retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : Math.min(5_000 * attempt, 25_000);
      console.log(`${model} transient ${response.status}; retrying after ${backoff}ms (${attempt}/6)`);
      await sleep(backoff);
    } catch (error) {
      last = String(error?.message || error);
      if (attempt < 6) await sleep(Math.min(5_000 * attempt, 25_000));
    }
  }
  if (!ok) throw new Error(`${model} did not become healthy after bounded retries: ${last}`);
}
console.log('SAND_MODEL_CHAIN_PROBE_OK');
