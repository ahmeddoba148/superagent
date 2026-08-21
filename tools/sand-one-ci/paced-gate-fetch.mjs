const originalFetch = globalThis.fetch.bind(globalThis);
const paceMs = Math.max(0, Number(process.env.SAND_GATE_TURN_PACE_MS || 0));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastLogicalUpdateId = null;
let lastLogicalPostAt = 0;
let lastLogicalResponseAt = 0;

globalThis.fetch = async function pacedFetch(input, init = undefined) {
  let updateId = null;
  try {
    const url = typeof input === 'string' ? input : String(input?.url || input || '');
    if (paceMs > 0 && String(init?.method || 'GET').toUpperCase() === 'POST' && url.endsWith('/telegram') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body);
      if (Number.isSafeInteger(Number(body?.update_id))) updateId = Number(body.update_id);
    }
  } catch {
    updateId = null;
  }

  if (updateId !== null && updateId !== lastLogicalUpdateId) {
    const anchor = Math.max(lastLogicalPostAt, lastLogicalResponseAt);
    const remaining = anchor > 0 ? anchor + paceMs - Date.now() : 0;
    if (remaining > 0) {
      console.log(`CORE_TORTURE_TURN_PACE update=${updateId} ms=${remaining}`);
      await sleep(remaining);
    }
    lastLogicalUpdateId = updateId;
    lastLogicalPostAt = Date.now();
  }

  const response = await originalFetch(input, init);
  if (updateId !== null) lastLogicalResponseAt = Date.now();
  return response;
};
