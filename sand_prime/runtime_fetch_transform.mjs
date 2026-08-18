import fs from 'node:fs';

const path = process.argv[2] || 'SAND.js';
let src = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  const first = src.indexOf(oldText);
  if (first < 0) throw new Error(`Missing runtime transform anchor: ${label}`);
  if (src.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`Non-unique runtime transform anchor: ${label}`);
  src = src.slice(0, first) + newText + src.slice(first + oldText.length);
}

replaceOnce(
  'const DRAIN_BUDGET_MS = 50_000;\nconst MAX_DRAIN_BATCH = 2;\nconst CHAT_SETTLE_MS = 900;',
  'const DRAIN_BUDGET_MS = 50_000;\nconst MAX_DRAIN_BATCH = 2;\nconst INBOX_TRANSIENT_MAX_ATTEMPTS = 4;\nconst INBOX_TRANSIENT_RETRY_BASE_MS = 1_500;\nconst CHAT_SETTLE_MS = 900;',
  'transient inbox recovery constants',
);

replaceOnce(
  'async function markUpdateFailed(env, updateId, error) { const at = nowIso(); await env.DB.prepare(`UPDATE ${TABLES.inbox} SET status=\'failed\',process_lease_until=NULL,last_error=?,updated_at=?,finished_at=? WHERE update_id=?`).bind(safeError(error), at, at, updateId).run(); }\nasync function hasRecoverableUpdate(env, chatId) {',
  'async function markUpdateFailed(env, updateId, error) { const at = nowIso(); await env.DB.prepare(`UPDATE ${TABLES.inbox} SET status=\'failed\',process_lease_until=NULL,last_error=?,updated_at=?,finished_at=? WHERE update_id=?`).bind(safeError(error), at, at, updateId).run(); }\nasync function releaseUpdateForRetry(env, updateId, error) { await env.DB.prepare(`UPDATE ${TABLES.inbox} SET status=\'pending\',process_lease_until=NULL,last_error=?,updated_at=?,finished_at=NULL WHERE update_id=?`).bind(safeError(error), nowIso(), updateId).run(); }\nfunction isTransientUpdateError(error) { return error instanceof SandAiChainError && [\'AI_RATE_LIMIT\',\'AI_TIMEOUT\',\'AI_UPSTREAM\',\'AI_UNAVAILABLE\'].includes(String(error.code || \'\')); }\nfunction transientRetryDelayMs(attempt) { return Math.min(6_000, INBOX_TRANSIENT_RETRY_BASE_MS * (2 ** Math.max(0, Number(attempt || 1) - 1))); }\nasync function hasRecoverableUpdate(env, chatId) {',
  'transient inbox recovery helpers',
);

replaceOnce(
  '      try { const update = JSON.parse(String(row.payload_json)); await processPrimeUpdate(env, update); await markUpdateDone(env, Number(row.update_id)); }\n      catch (error) { await markUpdateFailed(env, Number(row.update_id), error); logError("prime_update", error, { updateId: Number(row.update_id), chatId, attempts: Number(claim.attempts ?? 1) }); try { await sendTelegramOnce(env, `failure:${Number(row.update_id)}`, chatId, `⚠️ حصلت مشكلة ومش هسيب طلبك معلق. كود: ${aiFailurePublicCode(error)}`); } catch (notifyError) { logError("failure_notice", notifyError, { chatId }); } }\n      processed += 1;',
  '      try { const update = JSON.parse(String(row.payload_json)); await processPrimeUpdate(env, update); await markUpdateDone(env, Number(row.update_id)); }\n      catch (error) {\n        const attempts = Number(claim.attempts ?? 1), updateId = Number(row.update_id);\n        if (isTransientUpdateError(error) && attempts < INBOX_TRANSIENT_MAX_ATTEMPTS) {\n          await releaseUpdateForRetry(env, updateId, error);\n          const retryDelay = transientRetryDelayMs(attempts);\n          logError("prime_update_retryable", error, { updateId, chatId, attempts, retryDelay });\n          if (nowMs() + retryDelay + AI_TOTAL_BUDGET_MS + 1_500 < deadline) { await sleep(retryDelay); continue; }\n          break;\n        }\n        await markUpdateFailed(env, updateId, error);\n        logError("prime_update", error, { updateId, chatId, attempts });\n        try { await sendTelegramOnce(env, `failure:${updateId}`, chatId, `⚠️ حصلت مشكلة ومش هسيب طلبك معلق. كود: ${aiFailurePublicCode(error)}`); } catch (notifyError) { logError("failure_notice", notifyError, { chatId }); }\n      }\n      processed += 1;',
  'bounded transient inbox retry',
);

replaceOnce(
  'async function fetchJsonPublic(url, timeoutMs = 8000) { const u = new URL(url); if (u.protocol !== "https:" || isPrivateHost(u.hostname)) throw new SandValidationError("Unsafe public API URL", "UNSAFE_URL"); const c = new AbortController(), timer = setTimeout(() => c.abort(), timeoutMs); try { const r = await fetch(u.toString(), { headers: { accept: "application/json" }, redirect: "error", signal: c.signal }); const data = await r.json().catch(() => null); if (!r.ok) throw new SandHttpError(`Public API HTTP ${r.status}: ${cleanText(data?.reason ?? data?.error ?? "", 400)}`, r.status); return data; } finally { clearTimeout(timer); } }',
  'async function fetchJsonPublic(url, timeoutMs = 8000) { const u = new URL(url); if (u.protocol !== "https:" || isPrivateHost(u.hostname)) throw new SandValidationError("Unsafe public API URL", "UNSAFE_URL"); const c = new AbortController(), timer = setTimeout(() => c.abort(), timeoutMs); try { const r = await fetch(u.toString(), { headers: { accept: "application/json" }, redirect: "manual", signal: c.signal }); if (r.status >= 300 && r.status < 400) throw new SandValidationError("Public API redirects are blocked", "PUBLIC_REDIRECT_BLOCKED"); const data = await r.json().catch(() => null); if (!r.ok) throw new SandHttpError(`Public API HTTP ${r.status}: ${cleanText(data?.reason ?? data?.error ?? "", 400)}`, r.status); return data; } finally { clearTimeout(timer); } }',
  'fetchJsonPublic redirect policy',
);

replaceOnce(
  '  try { const r = await fetch(u.toString(), { method: "GET", headers: { accept: "text/html,application/json,text/plain;q=0.9" }, redirect: "error", signal: controller.signal }); const raw = (await r.text()).slice(0, 100000); if (!r.ok) throw new SandHttpError(`Web fetch HTTP ${r.status}`, r.status); const type = r.headers.get("content-type") || ""; const text = type.includes("html") ? htmlToText(raw) : raw; return { ok: true, url: u.toString(), status: r.status, content_type: type, text: text.slice(0, maxChars), truncated: text.length > maxChars, message: "قرأت الصفحة بنجاح." }; } finally { clearTimeout(timer); }',
  '  try { const r = await fetch(u.toString(), { method: "GET", headers: { accept: "text/html,application/json,text/plain;q=0.9" }, redirect: "manual", signal: controller.signal }); if (r.status >= 300 && r.status < 400) throw new SandValidationError("Web redirects are blocked", "PUBLIC_REDIRECT_BLOCKED"); const raw = (await r.text()).slice(0, 100000); if (!r.ok) throw new SandHttpError(`Web fetch HTTP ${r.status}`, r.status); const type = r.headers.get("content-type") || ""; const text = type.includes("html") ? htmlToText(raw) : raw; return { ok: true, url: u.toString(), status: r.status, content_type: type, text: text.slice(0, maxChars), truncated: text.length > maxChars, message: "قرأت الصفحة بنجاح." }; } finally { clearTimeout(timer); }',
  'web.fetch redirect policy',
);

replaceOnce(
  '  /** @type {RequestInit} */ const init = { method, headers, redirect: "error" }; if (method === "POST") { headers["content-type"] = "application/json"; init.body = JSON.stringify(substituteTemplate(recipe.body_template ?? {}, args ?? {})); }',
  '  /** @type {RequestInit} */ const init = { method, headers, redirect: "manual" }; if (method === "POST") { headers["content-type"] = "application/json"; init.body = JSON.stringify(substituteTemplate(recipe.body_template ?? {}, args ?? {})); }',
  'forged tool RequestInit redirect mode',
);

replaceOnce(
  '  try { const response = await fetch(url, init); const contentType = response.headers.get("content-type") || ""; const raw = (await response.text()).slice(0, 100000); if (!response.ok) throw new SandHttpError(`Forged tool HTTP ${response.status}: ${cleanText(raw, 500)}`, response.status); const parsed = contentType.includes("json") ? parseJsonSafe(raw, raw) : parseJsonSafe(raw, raw); const value = extractPathValue(parsed, recipe.extract_path); return { ok: true, status: response.status, data: value, source_host: u.hostname, message: testMode ? "Tool recipe test passed." : "تم جلب النتيجة." }; } finally { clearTimeout(timer); }',
  '  try { const response = await fetch(url, init); if (response.status >= 300 && response.status < 400) throw new SandValidationError("Forged tool redirects are blocked", "FORGE_REDIRECT_BLOCKED"); const contentType = response.headers.get("content-type") || ""; const raw = (await response.text()).slice(0, 100000); if (!response.ok) throw new SandHttpError(`Forged tool HTTP ${response.status}: ${cleanText(raw, 500)}`, response.status); const parsed = contentType.includes("json") ? parseJsonSafe(raw, raw) : parseJsonSafe(raw, raw); const value = extractPathValue(parsed, recipe.extract_path); return { ok: true, status: response.status, data: value, source_host: u.hostname, message: testMode ? "Tool recipe test passed." : "تم جلب النتيجة." }; } finally { clearTimeout(timer); }',
  'forged tool redirect rejection',
);

if (src.includes('redirect: "error"')) throw new Error('Unsupported redirect:error remains after runtime compatibility transform');
fs.writeFileSync(path, src);
console.log('SAND_PRIME_RUNTIME_FETCH_TRANSFORM_OK');
