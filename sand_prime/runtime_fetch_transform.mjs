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
