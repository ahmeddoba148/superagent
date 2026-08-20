const originalFetch = globalThis.fetch.bind(globalThis);
const paceMs = Math.max(0, Number(process.env.SAND_GATE_TURN_PACE_MS || 0));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastLogicalUpdateId = null;
let lastLogicalPostAt = Date.now();

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
    const remaining = lastLogicalPostAt + paceMs - Date.now();
    if (remaining > 0) {
      console.log(`CORE_TORTURE_TURN_PACE update=${updateId} ms=${remaining}`);
      await sleep(remaining);
    }
    lastLogicalUpdateId = updateId;
    lastLogicalPostAt = Date.now();
  }

  return originalFetch(input, init);
};
