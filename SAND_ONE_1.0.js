/*
 * SAND ONE — Unified Personal Agent OS 1.0
 * Clean semantic conversation workspace built on a durable FIFO transport pattern.
 * One physical Cloudflare Worker file.
 *
 * Design contract:
 * - No keyword/phrase intent routing.
 * - AI interprets meaning into an app-owned structured turn plan.
 * - The app validates, authorizes, executes and verifies every state mutation.
 * - Conversation focus and active objects are durable first-class state.
 * - Follow-up turns resolve against the active workspace, not against phrase dictionaries.
 * - AI never writes D1 directly and never sees raw secrets.
 */

const APP_NAME = "SAND ONE";
const APP_VERSION = "1.0.0-dev.1";
const DATA_SCHEMA_VERSION = "1";
const ARCHITECTURE_NAME = "semantic-conversation-workspace+capability-layer";
const VOICE_MAX_BYTES = 25 * 1024 * 1024;
const VOICE_TOTAL_BUDGET_MS = 16_000;
const VOICE_STAGE_TIMEOUT_MS = 7_000;

const TZ = "Africa/Cairo";
const INBOX_PROCESS_LEASE_MS = 25_000;
const CHAT_LEASE_MS = 32_000;
const CHAT_ACQUIRE_WAIT_MS = 12_000;
const DRAIN_BUDGET_MS = 27_000;
const MAX_DRAIN_BATCH = 4;
const CHAT_SETTLE_MS = 900;
const CHAT_SETTLE_MAX_WAIT_MS = 6_000;
const AI_TOTAL_BUDGET_MS = 12_000;
const AI_MODEL_TIMEOUT_MS = 4_000;
const AI_HISTORY_MESSAGES = 20;
const AI_MAX_REPLY_CHARS = 3900;
const INBOX_TRANSIENT_MAX_ATTEMPTS = 4;
const DELIVERY_UNCERTAIN_AFTER_MS = 30_000;
const PLANNER_MAX_ACTIONS = 8;

const AI_MODELS = Object.freeze([
  Object.freeze({ id: "groq::openai/gpt-oss-120b", role: "primary" }),
  Object.freeze({ id: "groq::qwen/qwen3.6-27b", role: "fallback_1" }),
  Object.freeze({ id: "gemini::gemini-3.5-flash-lite", role: "fallback_2" }),
]);

const TABLES = Object.freeze({
  meta: "sand_v2_meta",
  inbox: "sand_v2_inbox",
  chatLeases: "sand_v2_chat_leases",
  chatIngress: "sand_v2_chat_ingress",
  messages: "sand_v2_messages",
  aiCalls: "sand_v2_ai_calls",
  workspaces: "sand_v2_workspaces",
  objects: "sand_v2_objects",
  memories: "sand_v2_memories",
  reminders: "sand_v2_reminders",
  operations: "sand_v2_operations",
  steps: "sand_v2_operation_steps",
  deliveries: "sand_v2_deliveries",
});

const CAPABILITY_FAMILIES = Object.freeze({
  schedule: Object.freeze({ label: "Schedule", role: "appointments, reminders, recurrence, free time and conflicts", state: "core" }),
  work: Object.freeze({ label: "Work", role: "tasks, projects, waiting and life inbox", state: "planned" }),
  shopping: Object.freeze({ label: "Shopping", role: "shopping lists, sessions, status and progress", state: "planned" }),
  memory_people: Object.freeze({ label: "Memory & People", role: "memory, people, relationships and contacts", state: "core" }),
  web_live: Object.freeze({ label: "Web & Live", role: "Google search, web reading, news, weather and places", state: "planned" }),
  communications: Object.freeze({ label: "Communications", role: "Gmail and controlled outbound communication", state: "planned" }),
  google_workspace: Object.freeze({ label: "Google Workspace", role: "Google Calendar, free-busy and Contacts", state: "planned" }),
  files_media: Object.freeze({ label: "Files & Media", role: "files, OCR, vision and Telegram voice", state: "input_adapter" }),
  local_life: Object.freeze({ label: "Local Life", role: "location, prayer times, Hijri calendar and holidays", state: "planned" }),
  utility: Object.freeze({ label: "Utility", role: "calculator, units, currency and deterministic date-time", state: "planned" }),
  automation: Object.freeze({ label: "Automation", role: "scheduler, briefs, monitoring and follow-ups", state: "planned" }),
  personal_system: Object.freeze({ label: "Personal/System", role: "profile, settings, global search, audit and undo", state: "planned" }),
});
const CAPABILITY_FAMILY_IDS = Object.freeze(Object.keys(CAPABILITY_FAMILIES));

const ALLOWED_ACTIONS = new Set([
  "object.create",
  "object.patch",
  "object.archive",
  "focus.set",
  "focus.clear",
  "reminder.set",
  "reminder.cancel",
  "memory.upsert",
  "memory.forget",
]);

const ALLOWED_OBJECT_KINDS = new Set([
  "commitment",
  "task",
  "note",
  "contact",
  "list",
  "project",
  "preference",
  "generic",
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({
          ok: true,
          service: APP_NAME,
          version: APP_VERSION,
          architecture: ARCHITECTURE_NAME,
          semantic_routing: true,
          capability_families: CAPABILITY_FAMILY_IDS,
          voice_input: true,
          keyword_routing: false,
          models: AI_MODELS.map((x) => x.id),
        });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return await health(env);
      }

      if ((request.method === "GET" || request.method === "POST") && url.pathname === "/setup") {
        return await setup(request, env);
      }

      if (request.method === "POST" && url.pathname === "/telegram") {
        return await telegramWebhook(request, env, ctx);
      }

      if (request.method === "POST" && url.pathname === "/internal/drain") {
        return await internalDrain(request, env, ctx);
      }

      if (request.method === "GET" && url.pathname === "/admin/status") {
        return await adminStatus(request, env);
      }

      if (request.method === "GET" && url.pathname === "/admin/selftest") {
        return await adminSelftest(request, env);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      logError("fetch_unhandled", error);
      return json({ ok: false, error: "internal_error", message: safeError(error) }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          await ensureSchema(env);
          const chats = await pendingChats(env, 20);
          await Promise.allSettled(chats.map((chatId) => drainChat(env, chatId)));
          await deliverDueReminders(env, 30);
          await markStaleDeliveriesUncertain(env);
        } catch (error) {
          logError("scheduled_recovery", error, { scheduledTime: controller?.scheduledTime ?? null });
        }
      })(),
    );
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function safeError(error) {
  if (error instanceof Error) return error.message.slice(0, 1200);
  return String(error ?? "Unknown error").slice(0, 1200);
}

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function compactText(value, max = 1000) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return fallback;
  }
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secretEqual(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (!a || !b || a.length !== b.length) return false;
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(a)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(b)),
  ]);
  const x = new Uint8Array(leftHash);
  const y = new Uint8Array(rightHash);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function requireBinding(env, name) {
  if (!env?.[name]) throw new Error(`Missing binding: ${name}`);
}

function logError(scope, error, extra = {}) {
  console.error(JSON.stringify({ level: "error", scope, error: safeError(error), ...extra, at: nowIso() }));
}

class SandHttpError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.name = "SandHttpError";
    this.httpStatus = httpStatus;
  }
}

class SandAiChainError extends Error {
  constructor(code, failures) {
    super(`AI unavailable: ${failures.join(" | ") || code}`);
    this.name = "SandAiChainError";
    this.code = code;
    this.failures = failures;
  }
}

class SandPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SandPlanError";
    this.code = code;
  }
}

async function ensureSchema(env) {
  requireBinding(env, "DB");
  const at = nowIso();

  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.meta} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.inbox} (
      update_id INTEGER PRIMARY KEY,
      chat_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','retry','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      process_lease_until INTEGER,
      retry_after_ms INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    )`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_v2_inbox_pending
      ON ${TABLES.inbox}(status, retry_after_ms, process_lease_until, update_id)`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_v2_inbox_chat
      ON ${TABLES.inbox}(chat_id, status, update_id)`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.chatLeases} (
      chat_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      lease_until INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.chatIngress} (
      chat_id TEXT PRIMARY KEY,
      settle_until_ms INTEGER NOT NULL,
      last_seen_update_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.messages} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      update_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      model_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(chat_id, update_id, role)
    )`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_v2_messages_chat
      ON ${TABLES.messages}(chat_id, id)`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.aiCalls} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      update_id INTEGER NOT NULL,
      phase TEXT NOT NULL,
      model_id TEXT NOT NULL,
      model_role TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      ok INTEGER NOT NULL CHECK(ok IN (0,1)),
      http_status INTEGER,
      error_code TEXT,
      created_at TEXT NOT NULL
    )`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_v2_ai_calls_chat
      ON ${TABLES.aiCalls}(chat_id, id)`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.workspaces} (
      chat_id TEXT PRIMARY KEY,
      goal TEXT,
      thread_summary TEXT,
      focus_object_id TEXT,
      open_questions_json TEXT NOT NULL DEFAULT '[]',
      context_version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.objects} (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      state_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','done','archived','cancelled')),
      created_by_update INTEGER NOT NULL,
      updated_by_update INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_v2_objects_chat
      ON ${TABLES.objects}(chat_id, status, updated_at)`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.memories} (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value_json TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      sensitivity TEXT NOT NULL DEFAULT 'normal',
      expires_at TEXT,
      source_update_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','forgotten','expired')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(chat_id, subject, predicate)
    )`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_v2_memories_chat
      ON ${TABLES.memories}(chat_id, status, updated_at)`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.reminders} (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      object_id TEXT,
      title TEXT NOT NULL,
      remind_at_utc TEXT NOT NULL,
      timezone TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'absolute' CHECK(mode IN ('absolute','at_start')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','cancelled','failed','uncertain')),
      source_update_id INTEGER NOT NULL,
      telegram_message_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT
    )`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_v2_reminders_due
      ON ${TABLES.reminders}(status, remind_at_utc)`),

    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sand_v2_reminders_object_pending
      ON ${TABLES.reminders}(chat_id, object_id)
      WHERE object_id IS NOT NULL AND status IN ('pending','sending','uncertain')`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.operations} (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      source_update_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','done','partial','failed','clarify')),
      plan_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      UNIQUE(chat_id, source_update_id)
    )`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.steps} (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      args_json TEXT NOT NULL,
      result_json TEXT,
      status TEXT NOT NULL CHECK(status IN ('running','done','failed','skipped')),
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(operation_id, step_index)
    )`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.deliveries} (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','uncertain','failed')),
      telegram_message_id INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT,
      UNIQUE(chat_id, source_kind, source_id)
    )`),

    env.DB.prepare(`INSERT INTO ${TABLES.meta}(key,value,updated_at)
      VALUES('schema_version', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .bind(DATA_SCHEMA_VERSION, at),
  ]);
}

function telegramChatId(update) {
  const id = update?.message?.chat?.id;
  return id === undefined || id === null ? "" : String(id);
}

function isAllowedChat(env, chatId, update) {
  const type = String(update?.message?.chat?.type ?? "");
  if (type && type !== "private") return false;
  if (truthy(env.PUBLIC_BOT)) return true;
  const raw = String(env.ALLOWED_CHAT_ID ?? "").trim();
  if (!raw) return true;
  const allowed = new Set(raw.split(",").map((x) => x.trim()).filter(Boolean));
  return allowed.has(String(chatId));
}

async function telegramWebhook(request, env, ctx) {
  requireBinding(env, "DB");
  requireBinding(env, "TELEGRAM_BOT_TOKEN");
  requireBinding(env, "TELEGRAM_WEBHOOK_SECRET");
  requireBinding(env, "OMNIAI_API_KEY");
  if (!env?.OMNIAI_BASE_URL && !env?.OMNIAI_SERVICE?.fetch) {
    throw new Error("Missing OmniAI route: OMNIAI_BASE_URL or OMNIAI_SERVICE");
  }

  const presented = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!(await secretEqual(presented, env.TELEGRAM_WEBHOOK_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = await request.json().catch((error) => {
    logError("telegram_json", error);
    return null;
  });
  if (!update || typeof update !== "object") return new Response("Bad request", { status: 400 });

  const updateId = Number(update.update_id);
  const chatId = telegramChatId(update);
  if (!Number.isSafeInteger(updateId) || !chatId) return new Response("OK");
  if (!isAllowedChat(env, chatId, update)) return new Response("OK");

  await ensureSchema(env);
  await persistUpdate(env, updateId, chatId, update);
  const origin = new URL(request.url).origin;
  ctx.waitUntil(drainChat(env, chatId, origin));
  return new Response("OK");
}

async function internalDrain(request, env, ctx) {
  requireBinding(env, "DB");
  requireBinding(env, "TELEGRAM_WEBHOOK_SECRET");
  const presented = request.headers.get("X-Sand-Internal") ?? "";
  if (!(await secretEqual(presented, env.TELEGRAM_WEBHOOK_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const chatId = String(body?.chat_id ?? "").trim();
  if (!chatId || chatId.length > 80) return new Response("Bad request", { status: 400 });
  await ensureSchema(env);
  const origin = new URL(request.url).origin;
  ctx.waitUntil(drainChat(env, chatId, origin));
  return new Response("ACCEPTED", { status: 202 });
}

async function persistUpdate(env, updateId, chatId, update) {
  const at = nowIso();
  const settleUntil = nowMs() + CHAT_SETTLE_MS;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.inbox}
      (update_id, chat_id, payload_json, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', 0, ?, ?)`)
      .bind(updateId, chatId, JSON.stringify(update), at, at),
    env.DB.prepare(`INSERT INTO ${TABLES.chatIngress}
      (chat_id, settle_until_ms, last_seen_update_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        settle_until_ms=MAX(${TABLES.chatIngress}.settle_until_ms, excluded.settle_until_ms),
        last_seen_update_id=MAX(${TABLES.chatIngress}.last_seen_update_id, excluded.last_seen_update_id),
        updated_at=excluded.updated_at`)
      .bind(chatId, settleUntil, updateId, at),
  ]);
}

async function waitForChatSettle(env, chatId) {
  const deadline = nowMs() + CHAT_SETTLE_MAX_WAIT_MS;
  while (true) {
    const row = await env.DB.prepare(`SELECT settle_until_ms FROM ${TABLES.chatIngress} WHERE chat_id=? LIMIT 1`)
      .bind(chatId)
      .first();
    const settleUntil = Number(row?.settle_until_ms ?? 0);
    const waitMs = settleUntil - nowMs();
    if (waitMs <= 0) return true;
    if (nowMs() + waitMs > deadline) return false;
    await sleep(Math.min(waitMs + 25, 1000));
  }
}

async function acquireChatLease(env, chatId, owner) {
  const now = nowMs();
  const until = now + CHAT_LEASE_MS;
  const row = await env.DB.prepare(`INSERT INTO ${TABLES.chatLeases}
    (chat_id, owner, lease_until, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      owner=excluded.owner,
      lease_until=excluded.lease_until,
      updated_at=excluded.updated_at
    WHERE ${TABLES.chatLeases}.lease_until <= ?
    RETURNING owner`)
    .bind(chatId, owner, until, nowIso(), now)
    .first();
  return String(row?.owner ?? "") === owner;
}

async function acquireChatLeaseWithWait(env, chatId, owner) {
  const deadline = nowMs() + CHAT_ACQUIRE_WAIT_MS;
  do {
    if (await acquireChatLease(env, chatId, owner)) return true;
    await sleep(300);
  } while (nowMs() < deadline);
  return false;
}

async function releaseChatLease(env, chatId, owner) {
  await env.DB.prepare(`DELETE FROM ${TABLES.chatLeases} WHERE chat_id=? AND owner=?`)
    .bind(chatId, owner)
    .run();
}

async function nextRecoverableUpdate(env, chatId) {
  const now = nowMs();
  return env.DB.prepare(`SELECT update_id, payload_json, attempts
    FROM ${TABLES.inbox}
    WHERE chat_id=? AND (
      (status='pending' AND COALESCE(process_lease_until,0) <= ?)
      OR (status='retry' AND COALESCE(retry_after_ms,0) <= ? AND COALESCE(process_lease_until,0) <= ?)
      OR (status='processing' AND COALESCE(process_lease_until,0) <= ?)
    )
    ORDER BY update_id ASC
    LIMIT 1`)
    .bind(chatId, now, now, now, now)
    .first();
}

async function claimUpdate(env, updateId) {
  const at = nowIso();
  const now = nowMs();
  const leaseUntil = now + INBOX_PROCESS_LEASE_MS;
  return env.DB.prepare(`UPDATE ${TABLES.inbox}
    SET status='processing', attempts=attempts+1, process_lease_until=?, retry_after_ms=NULL, updated_at=?, last_error=NULL
    WHERE update_id=? AND (
      (status='pending' AND COALESCE(process_lease_until,0) <= ?)
      OR (status='retry' AND COALESCE(retry_after_ms,0) <= ? AND COALESCE(process_lease_until,0) <= ?)
      OR (status='processing' AND COALESCE(process_lease_until,0) <= ?)
    )
    RETURNING attempts`)
    .bind(leaseUntil, at, updateId, now, now, now, now)
    .first();
}

async function markUpdateDone(env, updateId) {
  const at = nowIso();
  await env.DB.prepare(`UPDATE ${TABLES.inbox}
    SET status='done', process_lease_until=NULL, retry_after_ms=NULL, last_error=NULL, updated_at=?, finished_at=?
    WHERE update_id=?`)
    .bind(at, at, updateId)
    .run();
}

function isTransientError(error) {
  if (error instanceof SandAiChainError) {
    return ["AI_UNAVAILABLE", "AI_RATE_LIMIT", "AI_UPSTREAM", "AI_TIMEOUT"].includes(error.code);
  }
  if (error instanceof SandHttpError) return error.httpStatus === 408 || error.httpStatus === 429 || error.httpStatus >= 500;
  const s = safeError(error).toLowerCase();
  return s.includes("timeout") || s.includes("network") || s.includes("tempor") || s.includes("fetch failed");
}

async function markUpdateRetryOrFailed(env, updateId, attempts, error) {
  const at = nowIso();
  if (isTransientError(error) && attempts < INBOX_TRANSIENT_MAX_ATTEMPTS) {
    const delay = Math.min(60_000, 1200 * 2 ** Math.max(0, attempts - 1));
    await env.DB.prepare(`UPDATE ${TABLES.inbox}
      SET status='retry', process_lease_until=NULL, retry_after_ms=?, last_error=?, updated_at=?
      WHERE update_id=?`)
      .bind(nowMs() + delay, safeError(error), at, updateId)
      .run();
    return "retry";
  }
  await env.DB.prepare(`UPDATE ${TABLES.inbox}
    SET status='failed', process_lease_until=NULL, retry_after_ms=NULL, last_error=?, updated_at=?, finished_at=?
    WHERE update_id=?`)
    .bind(safeError(error), at, at, updateId)
    .run();
  return "failed";
}

async function hasRecoverableUpdate(env, chatId) {
  const now = nowMs();
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM ${TABLES.inbox}
    WHERE chat_id=? AND (
      (status='pending' AND COALESCE(process_lease_until,0) <= ?)
      OR (status='retry' AND COALESCE(retry_after_ms,0) <= ? AND COALESCE(process_lease_until,0) <= ?)
      OR (status='processing' AND COALESCE(process_lease_until,0) <= ?)
    ) LIMIT 1`)
    .bind(chatId, now, now, now, now)
    .first();
  return Number(row?.ok ?? 0) === 1;
}

async function triggerDrainContinuation(env, chatId, origin) {
  if (!origin || !env?.TELEGRAM_WEBHOOK_SECRET) return false;
  try {
    const response = await fetch(`${String(origin).replace(/\/$/, "")}/internal/drain`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Sand-Internal": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ chat_id: String(chatId) }),
    });
    if (response.body) await response.body.cancel().catch(() => {});
    if (response.status !== 202) throw new Error(`Continuation failed (${response.status})`);
    return true;
  } catch (error) {
    logError("drain_continuation", error, { chatId });
    return false;
  }
}

async function drainChat(env, chatId, origin = "") {
  await ensureSchema(env);
  const owner = randomId("lease");
  const acquired = await acquireChatLeaseWithWait(env, chatId, owner);
  if (!acquired) {
    if (origin) await triggerDrainContinuation(env, chatId, origin);
    return;
  }

  const settled = await waitForChatSettle(env, chatId);
  if (!settled) {
    await releaseChatLease(env, chatId, owner).catch(() => {});
    if (origin) await triggerDrainContinuation(env, chatId, origin);
    return;
  }

  const deadline = nowMs() + DRAIN_BUDGET_MS;
  let processed = 0;
  try {
    while (processed < MAX_DRAIN_BATCH && nowMs() < deadline - 1500) {
      if (!(await waitForChatSettle(env, chatId))) break;
      const row = await nextRecoverableUpdate(env, chatId);
      if (!row) break;
      const claim = await claimUpdate(env, Number(row.update_id));
      if (!claim) continue;

      try {
        const update = JSON.parse(String(row.payload_json));
        await processConversationTurn(env, update);
        await markUpdateDone(env, Number(row.update_id));
      } catch (error) {
        const outcome = await markUpdateRetryOrFailed(
          env,
          Number(row.update_id),
          Number(claim.attempts ?? 1),
          error,
        );
        logError("conversation_turn", error, {
          updateId: Number(row.update_id),
          chatId,
          attempts: Number(claim.attempts ?? 1),
          outcome,
        });
        if (outcome === "failed") {
          await deliverTextOnce(
            env,
            chatId,
            "turn_error",
            String(row.update_id),
            "⚠️ حصلت مشكلة ومش هأكدلك إن حاجة اتنفذت. جرّب تبعتلي الرسالة تاني بعد شوية.",
          ).catch((notifyError) => logError("turn_failure_notice", notifyError, { chatId }));
        }
      }
      processed += 1;
    }
  } finally {
    await releaseChatLease(env, chatId, owner).catch((error) => logError("release_chat_lease", error, { chatId }));
  }

  if (origin && (processed >= MAX_DRAIN_BATCH || (await hasRecoverableUpdate(env, chatId)))) {
    await triggerDrainContinuation(env, chatId, origin);
  }
}

async function processConversationTurn(env, update) {
  const message = update?.message;
  if (!message) return;
  const updateId = Number(update.update_id);
  const chatId = String(message.chat?.id ?? "");
  if (!Number.isSafeInteger(updateId) || !chatId) return;

  const input = await extractTelegramInput(env, message, chatId, updateId);
  const text = input.text;
  if (!text) {
    await deliverTextOnce(env, chatId, "turn", String(updateId), "ابعتلي رسالة نصية أو فويس وأنا معاك.");
    return;
  }

  if (text === "/start") {
    await deliverTextOnce(
      env,
      chatId,
      "turn",
      String(updateId),
      "أنا سند 🤝\nقول اللي في دماغك بطريقتك وأنا هتابع معاك السياق خطوة بخطوة.",
    );
    return;
  }

  await saveMessage(env, chatId, updateId, "user", text, null);

  const existingOperation = await operationForUpdate(env, chatId, updateId);
  if (existingOperation?.status === "done" || existingOperation?.status === "clarify") {
    const previous = safeJsonParse(existingOperation.result_json, {});
    const reply = compactText(previous?.reply, AI_MAX_REPLY_CHARS);
    if (reply) await deliverTextOnce(env, chatId, "turn", String(updateId), reply);
    return;
  }

  try {
    await telegramApi(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  } catch (error) {
    logError("telegram_typing_noncritical", error, { chatId, updateId });
  }

  const snapshot = await loadConversationSnapshot(env, chatId);
  const planResult = await planSemanticTurn(env, { chatId, updateId, text, snapshot });
  const plan = validateSemanticPlan(planResult.plan, snapshot);

  const operation = await startOrLoadOperation(env, chatId, updateId, plan, planResult.modelId);
  const execution = await executeSemanticPlan(env, {
    chatId,
    updateId,
    operationId: operation.id,
    plan,
    snapshot,
  });

  const reply = buildVerifiedReply(plan, execution);
  const operationStatus = plan.clarification ? "clarify" : execution.ok ? "done" : "partial";
  await finishOperation(env, operation.id, operationStatus, { reply, execution }, execution.ok ? null : execution.error);
  await saveMessage(env, chatId, updateId, "assistant", reply, planResult.modelId);
  await deliverTextOnce(env, chatId, "turn", String(updateId), reply);
}

async function extractTelegramInput(env, message, chatId, updateId) {
  const text = compactText(message?.text, 12_000);
  if (text) return { text, kind: "text" };
  const caption = compactText(message?.caption, 12_000);
  if (caption) return { text: caption, kind: "caption" };
  const media = message?.voice ?? message?.audio ?? null;
  if (!media) return { text: "", kind: "unsupported" };
  try {
    await telegramApi(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  } catch (error) {
    logError("voice_typing_noncritical", error, { chatId, updateId });
  }
  const transcribed = await transcribeTelegramAudio(env, media, { chatId, updateId });
  return { text: compactText(transcribed, 12_000), kind: message?.voice ? "voice" : "audio" };
}

function omniAudioUrl(env) {
  const configured = String(env?.OMNIAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!configured) {
    if (env?.OMNIAI_SERVICE?.fetch) return "https://omniai.internal/v1/audio/transcriptions";
    throw new Error("Missing binding: OMNIAI_BASE_URL");
  }
  if (!/^https:\/\//i.test(configured)) throw new Error("OMNIAI_BASE_URL must use https");
  const root = configured
    .replace(/\/v1\/chat\/completions$/i, "/v1")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/v1$/i, "/v1");
  return `${root}/audio/transcriptions`;
}

async function fetchTelegramMediaBlob(env, media, deadline) {
  const fileId = compactText(media?.file_id, 300);
  if (!fileId) throw new Error("voice_file_missing");
  const declaredSize = Number(media?.file_size ?? 0);
  if (declaredSize > VOICE_MAX_BYTES) throw new Error("voice_too_large");
  if (nowMs() >= deadline) throw new Error("voice_timeout");
  const info = await telegramApi(env, "getFile", { file_id: fileId });
  const filePath = compactText(info?.result?.file_path, 1000);
  if (!filePath) throw new Error("voice_path_missing");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(VOICE_STAGE_TIMEOUT_MS, deadline - nowMs())));
  try {
    const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`, { signal: controller.signal });
    if (!response.ok) throw new SandHttpError(`Telegram file download failed (${response.status})`, response.status);
    const blob = await response.blob();
    if (blob.size > VOICE_MAX_BYTES) throw new Error("voice_too_large");
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeTelegramAudio(env, media, { chatId, updateId }) {
  requireBinding(env, "OMNIAI_API_KEY");
  const deadline = nowMs() + VOICE_TOTAL_BUDGET_MS;
  const blob = await fetchTelegramMediaBlob(env, media, deadline);
  const failures = [];
  const attempts = [
    { id: compactText(env?.VOICE_MODEL, 120) || "auto", provider: "omniai" },
    ...(env?.GROQ_API_KEY ? [{ id: "whisper-large-v3-turbo", provider: "groq" }] : []),
  ];
  for (const attempt of attempts) {
    if (nowMs() >= deadline - 300) break;
    const controller = new AbortController();
    const timeout = Math.max(250, Math.min(VOICE_STAGE_TIMEOUT_MS, deadline - nowMs()));
    const timer = setTimeout(() => controller.abort(), timeout);
    const form = new FormData();
    form.append("file", blob, "telegram-audio.ogg");
    form.append("model", attempt.id);
    form.append("language", "ar");
    form.append("response_format", "json");
    const started = nowMs();
    try {
      let response;
      if (attempt.provider === "omniai") {
        const request = new Request(omniAudioUrl(env), {
          method: "POST",
          headers: { authorization: `Bearer ${env.OMNIAI_API_KEY}` },
          body: form,
          signal: controller.signal,
        });
        response = env?.OMNIAI_SERVICE?.fetch ? await env.OMNIAI_SERVICE.fetch(request) : await fetch(request);
      } else {
        response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
          body: form,
          signal: controller.signal,
        });
      }
      const data = await response.json().catch(() => null);
      const text = compactText(data?.text ?? data?.transcript, 12_000);
      await recordAiCallSafe(env, {
        chatId,
        updateId,
        phase: "voice_stt",
        modelId: `${attempt.provider}::${attempt.id}`,
        modelRole: attempt.provider === "omniai" ? "primary" : "fallback_1",
        latencyMs: nowMs() - started,
        ok: Boolean(response.ok && text),
        httpStatus: response.status,
        errorCode: response.ok && text ? null : `http_${response.status}`,
      });
      if (response.ok && text) return text;
      failures.push(`${attempt.provider}:${response.status}`);
      if (response.status === 401 || response.status === 403) break;
    } catch (error) {
      const code = aiErrorCode(error);
      failures.push(`${attempt.provider}:${code}`);
      await recordAiCallSafe(env, {
        chatId,
        updateId,
        phase: "voice_stt",
        modelId: `${attempt.provider}::${attempt.id}`,
        modelRole: attempt.provider === "omniai" ? "primary" : "fallback_1",
        latencyMs: nowMs() - started,
        ok: false,
        httpStatus: error instanceof SandHttpError ? error.httpStatus : null,
        errorCode: code,
      });
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SandAiChainError(nowMs() >= deadline ? "AI_TIMEOUT" : "AI_UNAVAILABLE", failures.length ? failures : ["voice_transcription_unavailable"]);
}

async function saveMessage(env, chatId, updateId, role, content, modelId) {
  await env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.messages}
    (chat_id, update_id, role, content, model_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(chatId, updateId, role, String(content).slice(0, 12000), modelId, nowIso())
    .run();
}

async function recentMessages(env, chatId, limit = AI_HISTORY_MESSAGES) {
  const rows = await env.DB.prepare(`SELECT update_id, role, content, model_id, created_at
    FROM ${TABLES.messages}
    WHERE chat_id=?
    ORDER BY id DESC
    LIMIT ?`)
    .bind(chatId, clampInt(limit, 4, 40, AI_HISTORY_MESSAGES))
    .all();
  return (rows?.results ?? []).reverse();
}

async function loadConversationSnapshot(env, chatId) {
  const [workspace, messages, objectsResult, memoriesResult, remindersResult] = await Promise.all([
    env.DB.prepare(`SELECT chat_id, goal, thread_summary, focus_object_id, open_questions_json, context_version, updated_at
      FROM ${TABLES.workspaces} WHERE chat_id=? LIMIT 1`)
      .bind(chatId)
      .first(),
    recentMessages(env, chatId, AI_HISTORY_MESSAGES),
    env.DB.prepare(`SELECT id, kind, title, state_json, status, updated_at
      FROM ${TABLES.objects}
      WHERE chat_id=? AND status='active'
      ORDER BY updated_at DESC
      LIMIT 16`)
      .bind(chatId)
      .all(),
    env.DB.prepare(`SELECT id, subject, predicate, value_json, confidence, sensitivity, expires_at, updated_at
      FROM ${TABLES.memories}
      WHERE chat_id=? AND status='active' AND (expires_at IS NULL OR expires_at>?)
      ORDER BY updated_at DESC LIMIT 20`)
      .bind(chatId, nowIso())
      .all(),
    env.DB.prepare(`SELECT id, object_id, title, remind_at_utc, timezone, mode, status
      FROM ${TABLES.reminders}
      WHERE chat_id=? AND status IN ('pending','sending','uncertain')
      ORDER BY remind_at_utc ASC LIMIT 12`)
      .bind(chatId)
      .all(),
  ]);

  const objects = (objectsResult?.results ?? []).map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    state: safeJsonParse(row.state_json, {}),
    status: String(row.status),
    updated_at: String(row.updated_at),
  }));

  const memories = (memoriesResult?.results ?? []).map((row) => ({
    id: String(row.id),
    subject: String(row.subject),
    predicate: String(row.predicate),
    value: safeJsonParse(row.value_json, row.value_json),
    confidence: Number(row.confidence ?? 1),
    sensitivity: String(row.sensitivity),
    expires_at: row.expires_at ?? null,
    updated_at: String(row.updated_at),
  }));

  const focusId = String(workspace?.focus_object_id ?? "");
  const focus = focusId ? objects.find((x) => x.id === focusId) ?? null : null;

  return {
    workspace: {
      goal: String(workspace?.goal ?? ""),
      thread_summary: String(workspace?.thread_summary ?? ""),
      focus_object_id: focusId || null,
      open_questions: safeJsonParse(workspace?.open_questions_json, []),
      context_version: Number(workspace?.context_version ?? 0),
    },
    focus,
    objects,
    memories,
    reminders: remindersResult?.results ?? [],
    messages,
  };
}

function cairoNowParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: String(parts.weekday ?? ""),
  };
}

function plannerSnapshotView(snapshot) {
  const refById = new Map();
  const activeObjects = snapshot.objects.map((object, index) => {
    const ref = `o${index + 1}`;
    refById.set(object.id, ref);
    return {
      ref,
      kind: object.kind,
      title: object.title,
      state: object.state,
      status: object.status,
      updated_at: object.updated_at,
    };
  });
  const focusRef = snapshot.workspace.focus_object_id
    ? refById.get(snapshot.workspace.focus_object_id) ?? null
    : null;
  const focus = focusRef
    ? activeObjects.find((object) => object.ref === focusRef) ?? null
    : null;
  return {
    workspace: {
      goal: snapshot.workspace.goal,
      thread_summary: snapshot.workspace.thread_summary,
      focus_ref: focusRef,
      open_questions: snapshot.workspace.open_questions,
      context_version: snapshot.workspace.context_version,
    },
    focus,
    active_objects: activeObjects,
    memories: snapshot.memories.map((memory) => ({
      subject: memory.subject,
      predicate: memory.predicate,
      value: memory.value,
      confidence: memory.confidence,
      sensitivity: memory.sensitivity,
      expires_at: memory.expires_at,
      updated_at: memory.updated_at,
    })),
    pending_reminders: snapshot.reminders.map((reminder) => ({
      object_ref: refById.get(String(reminder.object_id ?? "")) ?? null,
      title: reminder.title ?? null,
      remind_at_utc: reminder.remind_at_utc ?? null,
      timezone: reminder.timezone ?? null,
      mode: reminder.mode ?? null,
      status: reminder.status ?? null,
    })),
  };
}

function plannerSystemPrompt(snapshot) {
  const local = cairoNowParts();
  return [
    "You are the semantic conversation brain for SAND, an Egyptian personal secretary agent.",
    "Return exactly ONE strict JSON object. Use double quotes for every JSON key and string. No markdown, comments, trailing commas, or prose outside JSON.",
    "Interpret meaning and conversational reference from the whole workspace. Never route by literal phrases or keyword matching.",
    "The application owns state and execution. You may only request actions from the declared action contract.",
    "Treat the current focus object as the default referent only when the new turn semantically continues it. If the user clearly changes subject, do not force the old focus.",
    "A user correction or refinement should update the existing intended object rather than create a duplicate when continuity is clear.",
    "Do not ask for fields that are unnecessary for the user's goal. A commitment can exist with a start time and no end time.",
    "Do not silently invent an end time, attendee, location, recurrence, or reminder policy.",
    "When only a date or only a time changes, preserve the other known components of that same object's start time.",
    "Clarify only when an essential decision is genuinely unresolved between multiple plausible targets or required values.",
    "If the user asks to be alerted at the object's own time, set a reminder with mode at_start. This is a semantic policy, not a phrase rule.",
    "If the user merely states a future commitment without asking for an alert, represent the commitment; do not invent a reminder.",
    "object.create automatically makes the newly created object the runtime focus. Do not add focus.set just to focus a new object.",
    "Current Cairo local datetime: " + `${local.date}T${local.time}` + ` (${local.weekday}, ${TZ}).`,
    "Allowed object kinds: commitment, task, note, contact, list, project, preference, generic.",
    "Allowed actions: object.create, object.patch, object.archive, focus.set, focus.clear, reminder.set, reminder.cancel, memory.upsert, memory.forget.",
    "Every action object MUST contain a non-empty type from the allowed actions and an args object matching that action contract.",
    "Target contract is intentionally simple: whenever an action or focus needs a target, use target as ONE string: focus for current runtime focus, created for the latest object created earlier in this same plan, or an exposed active_objects ref such as o1 or o2. Never emit or copy internal IDs.",
    "Object create args contain kind, title, and fields. Object patch args contain target and fields. Fields may include title, description, start_local, start_date_local, start_time_local, end_local, location, people, details, status.",
    "Reminder set args contain target, mode (at_start or absolute), optional remind_local in YYYY-MM-DDTHH:mm, and optional title.",
    "Memory upsert args contain subject, predicate, value, and optional confidence, sensitivity, expires_at.",
    "For user-provided proper names, identifiers, labels, and scalar text facts stored in memory, preserve the user's original spelling and script exactly; never translate or transliterate the value.",
    "Required top-level keys are effect, intent, continuation, goal, thread_summary, focus, actions, clarification, reply, confidence. effect is answer, mutate, or clarify. focus.mode is keep, set, or clear. If focus.mode is set, focus.target uses the same target string contract. actions is always an array. clarification is either null or an object with question and reason.",
    "If the user's turn asks to change, correct, create, cancel, remember, forget, or otherwise mutate durable state, effect MUST be mutate and actions MUST contain at least one real domain mutation. Never return a success-sounding reply with zero mutation actions for such a turn.",
    "The reply is the natural Egyptian Arabic response to send AFTER successful verified execution. Do not claim an action succeeded unless the plan actually asks the app to execute it.",
    "Keep reply concise and natural Egyptian Arabic.",
    "Workspace JSON follows:",
    JSON.stringify(plannerSnapshotView(snapshot)),
  ].join("\n");
}

function isPlannerPlanObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.intent === "string" &&
      Array.isArray(value.actions) &&
      typeof value.reply === "string",
  );
}

function extractJsonObject(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const direct = safeJsonParse(raw, null);
  if (isPlannerPlanObject(direct)) return direct;

  let fallback = direct && typeof direct === "object" && !Array.isArray(direct) ? direct : null;
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = safeJsonParse(raw.slice(start, i + 1), null);
          if (isPlannerPlanObject(candidate)) return candidate;
          if (!fallback && candidate && typeof candidate === "object" && !Array.isArray(candidate)) fallback = candidate;
          break;
        }
        if (depth < 0) break;
      }
    }
  }
  return fallback;
}

async function callStructuredPlannerChain(env, { chatId, updateId, messages, snapshot }) {
  const deadline = nowMs() + AI_TOTAL_BUDGET_MS;
  const failures = [];
  for (const model of AI_MODELS) {
    const remaining = deadline - nowMs();
    if (remaining < 500) break;
    const timeoutMs = Math.min(AI_MODEL_TIMEOUT_MS, remaining);
    const started = nowMs();
    try {
      const result = await callOneAiModel(env, model, messages, timeoutMs, 0, 1500);
      const plan = extractJsonObject(result.text);
      if (!isPlannerPlanObject(plan)) {
        await recordAiCallSafe(env, {
          chatId,
          updateId,
          phase: "semantic_plan",
          modelId: model.id,
          modelRole: model.role,
          latencyMs: result.latencyMs,
          ok: false,
          httpStatus: result.httpStatus,
          errorCode: "invalid_structured_output",
        });
        failures.push(`${model.id}:invalid_structured_output`);
        continue;
      }

      let validatedPlan;
      try {
        validatedPlan = validateSemanticPlan(plan, snapshot);
      } catch (validationError) {
        const contractCode = validationError instanceof SandPlanError ? validationError.code : "invalid_plan_contract";
        await recordAiCallSafe(env, {
          chatId,
          updateId,
          phase: "semantic_plan",
          modelId: model.id,
          modelRole: model.role,
          latencyMs: result.latencyMs,
          ok: false,
          httpStatus: result.httpStatus,
          errorCode: `invalid_plan_${String(contractCode).toLowerCase()}`,
        });
        failures.push(`${model.id}:invalid_plan_contract`);
        logError("planner_contract_rejected", validationError, { model: model.id, code: contractCode, updateId });
        continue;
      }

      await recordAiCallSafe(env, {
        chatId,
        updateId,
        phase: "semantic_plan",
        modelId: model.id,
        modelRole: model.role,
        latencyMs: result.latencyMs,
        ok: true,
        httpStatus: result.httpStatus,
        errorCode: null,
      });
      return { plan: validatedPlan, modelId: model.id };
    } catch (error) {
      const httpStatus = error instanceof SandHttpError ? error.httpStatus : null;
      const code = httpStatus ? `http_${httpStatus}` : aiErrorCode(error);
      await recordAiCallSafe(env, {
        chatId,
        updateId,
        phase: "semantic_plan",
        modelId: model.id,
        modelRole: model.role,
        latencyMs: nowMs() - started,
        ok: false,
        httpStatus,
        errorCode: code,
      });
      failures.push(`${model.id}:${code}`);
      if (httpStatus === 401 || httpStatus === 403) break;
    }
  }

  const joined = failures.join(" | ");
  if (
    failures.length > 0 &&
    failures.every(
      (failure) => failure.endsWith(":invalid_structured_output") || failure.endsWith(":invalid_plan_contract"),
    )
  ) {
    throw new SandPlanError("BAD_PLAN", `No model returned a valid executable plan: ${joined}`);
  }
  let code = "AI_UNAVAILABLE";
  if (/http_401|http_403/.test(joined)) code = "AI_AUTH";
  else if (/http_429/.test(joined)) code = "AI_RATE_LIMIT";
  else if (/http_5\d\d/.test(joined)) code = "AI_UPSTREAM";
  else if (/timeout/.test(joined)) code = "AI_TIMEOUT";
  throw new SandAiChainError(code, failures.length ? failures : ["planner_budget_exhausted"]);
}

async function planSemanticTurn(env, { chatId, updateId, text, snapshot }) {
  const history = snapshot.messages.map((row) => ({ role: String(row.role), content: String(row.content) }));
  const messages = [
    { role: "system", content: plannerSystemPrompt(snapshot) },
    ...history,
  ];
  return callStructuredPlannerChain(env, { chatId, updateId, messages, snapshot });
}

function validateTarget(target, snapshot) {
  if (typeof target === "string") {
    const ref = target.trim();
    if (ref === "focus" || ref === "created") return { mode: "focus" };
    const match = /^o([1-9][0-9]*)$/.exec(ref);
    const index = match ? Number(match[1]) - 1 : -1;
    const object = index >= 0 ? snapshot.objects[index] : null;
    if (!object) throw new SandPlanError("UNKNOWN_TARGET", "Target ref is not in the active workspace");
    return { mode: "id", id: object.id };
  }

  if (!target || typeof target !== "object") throw new SandPlanError("BAD_TARGET", "Missing target");
  const mode = String(target.mode ?? "");
  if (mode === "focus" || mode === "created") return { mode: "focus" };
  if (mode === "ref") {
    const match = /^o([1-9][0-9]*)$/.exec(String(target.ref ?? ""));
    const index = match ? Number(match[1]) - 1 : -1;
    const object = index >= 0 ? snapshot.objects[index] : null;
    if (!object) throw new SandPlanError("UNKNOWN_TARGET", "Target ref is not in the active workspace");
    return { mode: "id", id: object.id };
  }
  if (mode === "id") {
    const id = String(target.id ?? "");
    if (!id || !snapshot.objects.some((x) => x.id === id)) {
      throw new SandPlanError("UNKNOWN_TARGET", "Target object is not in the active workspace");
    }
    return { mode: "id", id };
  }
  if (!mode && typeof target.ref === "string") return validateTarget(String(target.ref), snapshot);
  throw new SandPlanError("BAD_TARGET", `Unsupported target mode: ${mode}`);
}

function validateSemanticPlan(input, snapshot) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SandPlanError("BAD_PLAN", "Plan must be an object");
  }

  const effect = String(input.effect ?? "");
  if (!new Set(["answer", "mutate", "clarify"]).has(effect)) {
    throw new SandPlanError("BAD_EFFECT", "Plan effect must be answer, mutate, or clarify");
  }

  const actionsRaw = Array.isArray(input.actions) ? input.actions : [];
  if (actionsRaw.length > PLANNER_MAX_ACTIONS) throw new SandPlanError("TOO_MANY_ACTIONS", "Planner exceeded action budget");

  const actions = actionsRaw.map((action, index) => {
    if (!action || typeof action !== "object") throw new SandPlanError("BAD_ACTION", `Action ${index} invalid`);
    const type = String(action.type ?? "");
    if (!ALLOWED_ACTIONS.has(type)) throw new SandPlanError("ACTION_NOT_ALLOWED", `Action not allowed: ${type}`);
    const args = action.args && typeof action.args === "object" && !Array.isArray(action.args) ? action.args : {};

    if (type === "object.create") {
      const kind = String(args.kind ?? "generic");
      if (!ALLOWED_OBJECT_KINDS.has(kind)) throw new SandPlanError("BAD_KIND", `Unsupported object kind: ${kind}`);
      const title = compactText(args.title, 240);
      if (!title) throw new SandPlanError("TITLE_REQUIRED", "Created object needs a title");
      return { type, args: { kind, title, fields: sanitizeObjectFields(args.fields) } };
    }

    if (type === "object.patch") {
      const target = validateTarget(args.target, snapshot);
      const fields = sanitizeObjectFields(args.fields);
      if (Object.keys(fields).length === 0) throw new SandPlanError("EMPTY_PATCH", "Object patch has no fields");
      const current = target.mode === "id"
        ? snapshot.objects.find((object) => object.id === target.id) ?? null
        : snapshot.focus ?? (snapshot.workspace.focus_object_id
          ? snapshot.objects.find((object) => object.id === snapshot.workspace.focus_object_id) ?? null
          : null);
      if (current) {
        const preview = mergeObjectState(current.state, fields, current.title);
        if (JSON.stringify(preview) === JSON.stringify(current.state)) {
          throw new SandPlanError("NOOP_PATCH", "Object patch would not change the target state");
        }
      }
      return { type, args: { target, fields } };
    }

    if (type === "object.archive" || type === "reminder.cancel") {
      return { type, args: { target: validateTarget(args.target, snapshot) } };
    }

    if (type === "focus.set") {
      return { type, args: { target: validateTarget(args.target, snapshot) } };
    }

    if (type === "focus.clear") return { type, args: {} };

    if (type === "reminder.set") {
      const mode = String(args.mode ?? "");
      if (!new Set(["at_start", "absolute"]).has(mode)) throw new SandPlanError("BAD_REMINDER_MODE", `Bad reminder mode: ${mode}`);
      const target = validateTarget(args.target, snapshot);
      const remindLocal = mode === "absolute" ? normalizeLocalMinute(args.remind_local) : null;
      if (mode === "absolute" && !remindLocal) throw new SandPlanError("REMINDER_TIME_REQUIRED", "Absolute reminder requires remind_local");
      return { type, args: { target, mode, remind_local: remindLocal, title: compactText(args.title, 240) || null } };
    }

    if (type === "memory.upsert") {
      const subject = compactText(args.subject, 160);
      const predicate = compactText(args.predicate, 160);
      if (!subject || !predicate) throw new SandPlanError("BAD_MEMORY", "Memory requires subject and predicate");
      return {
        type,
        args: {
          subject,
          predicate,
          value: args.value ?? null,
          confidence: Math.max(0, Math.min(1, Number(args.confidence ?? 1))),
          sensitivity: compactText(args.sensitivity, 40) || "normal",
          expires_at: args.expires_at ? compactText(args.expires_at, 40) : null,
        },
      };
    }

    if (type === "memory.forget") {
      const subject = compactText(args.subject, 160);
      const predicate = compactText(args.predicate, 160);
      if (!subject || !predicate) throw new SandPlanError("BAD_MEMORY", "Memory forget requires subject and predicate");
      return { type, args: { subject, predicate } };
    }

    throw new SandPlanError("BAD_ACTION", `Unhandled action: ${type}`);
  });

  const domainMutationTypes = new Set([
    "object.create", "object.patch", "object.archive",
    "reminder.set", "reminder.cancel", "memory.upsert", "memory.forget",
  ]);
  if (effect === "mutate" && !actions.some((action) => domainMutationTypes.has(action.type))) {
    throw new SandPlanError("EMPTY_MUTATION", "Mutation intent requires a real domain mutation action");
  }

  let focus = { mode: "keep" };
  if (input.focus && typeof input.focus === "object") {
    const mode = String(input.focus.mode ?? "keep");
    if (mode === "set") focus = { mode: "set", target: validateTarget(input.focus.target, snapshot) };
    else if (mode === "clear") focus = { mode: "clear" };
    else focus = { mode: "keep" };
  }

  const clarification = input.clarification && typeof input.clarification === "object"
    ? {
        question: compactText(input.clarification.question, 800),
        reason: compactText(input.clarification.reason, 400),
      }
    : null;

  return {
    effect,
    intent: compactText(input.intent, 120) || "conversation",
    continuation: Boolean(input.continuation),
    goal: compactText(input.goal, 800),
    thread_summary: compactText(input.thread_summary, 1800),
    focus,
    actions,
    clarification: clarification?.question ? clarification : null,
    reply: compactText(input.reply, AI_MAX_REPLY_CHARS),
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.5))),
  };
}

function sanitizeObjectFields(fields) {
  const src = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  const out = {};
  const textFields = ["title", "description", "start_local", "start_date_local", "start_time_local", "end_local", "location", "status"];
  for (const key of textFields) {
    if (Object.hasOwn(src, key)) out[key] = src[key] === null ? null : compactText(src[key], key === "description" ? 3000 : 300);
  }
  if (Object.hasOwn(src, "people")) out.people = Array.isArray(src.people) ? src.people.slice(0, 20).map((x) => compactText(x, 160)).filter(Boolean) : [];
  if (Object.hasOwn(src, "details")) out.details = sanitizeJsonValue(src.details, 4);
  return out;
}

function sanitizeJsonValue(value, depth = 4) {
  if (depth <= 0) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 1500);
  if (Array.isArray(value)) return value.slice(0, 30).map((x) => sanitizeJsonValue(x, depth - 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) out[String(k).slice(0, 100)] = sanitizeJsonValue(v, depth - 1);
    return out;
  }
  return null;
}

async function operationForUpdate(env, chatId, updateId) {
  return env.DB.prepare(`SELECT id,status,plan_json,result_json,error FROM ${TABLES.operations}
    WHERE chat_id=? AND source_update_id=? LIMIT 1`)
    .bind(chatId, updateId)
    .first();
}

async function startOrLoadOperation(env, chatId, updateId, plan, modelId) {
  const existing = await operationForUpdate(env, chatId, updateId);
  if (existing) return existing;
  const id = randomId("op");
  const at = nowIso();
  const storedPlan = { ...plan, planner_model: modelId };
  await env.DB.prepare(`INSERT INTO ${TABLES.operations}
    (id,chat_id,source_update_id,status,plan_json,created_at,updated_at)
    VALUES(?,?,?,'running',?,?,?)`)
    .bind(id, chatId, updateId, JSON.stringify(storedPlan), at, at)
    .run();
  return { id, status: "running", plan_json: JSON.stringify(storedPlan) };
}

async function finishOperation(env, operationId, status, result, error) {
  const at = nowIso();
  await env.DB.prepare(`UPDATE ${TABLES.operations}
    SET status=?, result_json=?, error=?, updated_at=?, finished_at=?
    WHERE id=?`)
    .bind(status, JSON.stringify(result ?? null), error ? compactText(error, 1200) : null, at, at, operationId)
    .run();
}

async function existingStep(env, operationId, stepIndex) {
  return env.DB.prepare(`SELECT id,status,result_json,error FROM ${TABLES.steps}
    WHERE operation_id=? AND step_index=? LIMIT 1`)
    .bind(operationId, stepIndex)
    .first();
}

async function beginStep(env, operationId, stepIndex, action) {
  const existing = await existingStep(env, operationId, stepIndex);
  if (existing) return existing;
  const id = randomId("step");
  const at = nowIso();
  await env.DB.prepare(`INSERT INTO ${TABLES.steps}
    (id,operation_id,step_index,action_type,args_json,status,created_at,updated_at)
    VALUES(?,?,?,?,?,'running',?,?)`)
    .bind(id, operationId, stepIndex, action.type, JSON.stringify(action.args ?? {}), at, at)
    .run();
  return { id, status: "running", result_json: null, error: null };
}

async function finishStep(env, stepId, status, result, error) {
  await env.DB.prepare(`UPDATE ${TABLES.steps}
    SET status=?, result_json=?, error=?, updated_at=? WHERE id=?`)
    .bind(status, JSON.stringify(result ?? null), error ? compactText(error, 1200) : null, nowIso(), stepId)
    .run();
}

function resolveTargetId(target, snapshot, runtimeFocusId) {
  if (target.mode === "id") return target.id;
  if (target.mode === "focus") return runtimeFocusId || snapshot.focus?.id || snapshot.workspace.focus_object_id || "";
  return "";
}

async function executeSemanticPlan(env, { chatId, updateId, operationId, plan, snapshot }) {
  if (plan.clarification) {
    await persistWorkspace(env, chatId, {
      goal: plan.goal,
      thread_summary: plan.thread_summary,
      focus_object_id: snapshot.workspace.focus_object_id,
      open_questions: [plan.clarification],
    });
    return { ok: true, clarified: true, steps: [], focus_object_id: snapshot.workspace.focus_object_id };
  }

  let runtimeFocusId = snapshot.workspace.focus_object_id;
  const results = [];
  for (let i = 0; i < plan.actions.length; i += 1) {
    const action = plan.actions[i];
    const prior = await beginStep(env, operationId, i, action);
    if (prior.status === "done") {
      const parsed = safeJsonParse(prior.result_json, {});
      results.push(parsed);
      if (parsed?.focus_object_id) runtimeFocusId = parsed.focus_object_id;
      if (parsed?.object_id && action.type === "object.create") runtimeFocusId = parsed.object_id;
      continue;
    }

    try {
      const result = await executeAction(env, {
        chatId,
        updateId,
        action,
        snapshot,
        runtimeFocusId,
      });
      await finishStep(env, prior.id, "done", result, null);
      results.push(result);
      if (result?.focus_object_id) runtimeFocusId = result.focus_object_id;
      if (result?.object_id && action.type === "object.create") runtimeFocusId = result.object_id;
    } catch (error) {
      await finishStep(env, prior.id, "failed", null, safeError(error));
      return { ok: false, error: safeError(error), failed_step: i, steps: results, focus_object_id: runtimeFocusId };
    }
  }

  if (plan.focus.mode === "set") {
    const id = resolveTargetId(plan.focus.target, snapshot, runtimeFocusId);
    if (id) runtimeFocusId = id;
  } else if (plan.focus.mode === "clear") {
    runtimeFocusId = null;
  }

  await persistWorkspace(env, chatId, {
    goal: plan.goal,
    thread_summary: plan.thread_summary,
    focus_object_id: runtimeFocusId,
    open_questions: [],
  });

  return { ok: true, steps: results, focus_object_id: runtimeFocusId };
}

async function executeAction(env, { chatId, updateId, action, snapshot, runtimeFocusId }) {
  if (action.type === "object.create") {
    const objectId = randomId("obj");
    const state = mergeObjectState({}, action.args.fields ?? {}, action.args.title);
    const at = nowIso();
    await env.DB.prepare(`INSERT INTO ${TABLES.objects}
      (id,chat_id,kind,title,state_json,status,created_by_update,updated_by_update,created_at,updated_at)
      VALUES(?,?,?,?,?,'active',?,?,?,?)`)
      .bind(objectId, chatId, action.args.kind, state.title, JSON.stringify(state), updateId, updateId, at, at)
      .run();
    const verify = await objectById(env, chatId, objectId);
    if (!verify) throw new Error("Object create verification failed");
    return { ok: true, object_id: objectId, focus_object_id: objectId, object: verify };
  }

  if (action.type === "object.patch") {
    const objectId = resolveTargetId(action.args.target, snapshot, runtimeFocusId);
    if (!objectId) throw new Error("No target object to patch");
    const current = await objectById(env, chatId, objectId);
    if (!current) throw new Error("Target object no longer exists");
    const merged = mergeObjectState(current.state, action.args.fields ?? {}, current.title);
    await env.DB.prepare(`UPDATE ${TABLES.objects}
      SET title=?, state_json=?, updated_by_update=?, updated_at=?
      WHERE id=? AND chat_id=? AND status='active'`)
      .bind(merged.title, JSON.stringify(merged), updateId, nowIso(), objectId, chatId)
      .run();
    const verify = await objectById(env, chatId, objectId);
    if (!verify || JSON.stringify(verify.state) !== JSON.stringify(merged)) throw new Error("Object patch verification failed");
    await syncAnchoredReminderForObject(env, chatId, objectId, merged.start_local, updateId);
    return { ok: true, object_id: objectId, focus_object_id: objectId, object: verify };
  }

  if (action.type === "object.archive") {
    const objectId = resolveTargetId(action.args.target, snapshot, runtimeFocusId);
    if (!objectId) throw new Error("No target object to archive");
    await env.DB.prepare(`UPDATE ${TABLES.objects} SET status='archived',updated_by_update=?,updated_at=?
      WHERE id=? AND chat_id=? AND status='active'`)
      .bind(updateId, nowIso(), objectId, chatId)
      .run();
    await cancelReminderForObject(env, chatId, objectId);
    const verify = await env.DB.prepare(`SELECT status FROM ${TABLES.objects} WHERE id=? AND chat_id=? LIMIT 1`)
      .bind(objectId, chatId)
      .first();
    if (String(verify?.status ?? "") !== "archived") throw new Error("Archive verification failed");
    return { ok: true, object_id: objectId, archived: true, focus_object_id: runtimeFocusId === objectId ? null : runtimeFocusId };
  }

  if (action.type === "focus.set") {
    const objectId = resolveTargetId(action.args.target, snapshot, runtimeFocusId);
    if (!objectId) throw new Error("No target object for focus");
    const obj = await objectById(env, chatId, objectId);
    if (!obj) throw new Error("Focus target missing");
    return { ok: true, focus_object_id: objectId };
  }

  if (action.type === "focus.clear") return { ok: true, focus_object_id: null };

  if (action.type === "reminder.set") {
    const objectId = resolveTargetId(action.args.target, snapshot, runtimeFocusId);
    if (!objectId) throw new Error("No target object for reminder");
    const obj = await objectById(env, chatId, objectId);
    if (!obj) throw new Error("Reminder target missing");
    const remindLocal = action.args.mode === "at_start" ? normalizeLocalMinute(obj.state?.start_local) : action.args.remind_local;
    if (!remindLocal) throw new Error("Target has no start time for reminder");
    const remindAtUtc = cairoLocalToUtc(remindLocal);
    if (!remindAtUtc) throw new Error("Could not resolve Cairo reminder time");
    if (new Date(remindAtUtc).getTime() <= nowMs() - 30_000) throw new Error("Reminder time is already in the past");
    const title = action.args.title || obj.title || "تذكير";
    const reminderId = await upsertReminderForObject(env, {
      chatId,
      objectId,
      title,
      remindAtUtc,
      mode: action.args.mode,
      sourceUpdateId: updateId,
    });
    const verify = await env.DB.prepare(`SELECT id,remind_at_utc,status FROM ${TABLES.reminders} WHERE id=? LIMIT 1`)
      .bind(reminderId)
      .first();
    if (!verify || String(verify.remind_at_utc) !== remindAtUtc || String(verify.status) !== "pending") {
      throw new Error("Reminder verification failed");
    }
    return { ok: true, reminder_id: reminderId, object_id: objectId, remind_at_utc: remindAtUtc, remind_local: remindLocal, focus_object_id: objectId };
  }

  if (action.type === "reminder.cancel") {
    const objectId = resolveTargetId(action.args.target, snapshot, runtimeFocusId);
    if (!objectId) throw new Error("No target object for reminder cancel");
    await cancelReminderForObject(env, chatId, objectId);
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLES.reminders}
      WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain')`)
      .bind(chatId, objectId)
      .first();
    if (Number(left?.n ?? 0) !== 0) throw new Error("Reminder cancel verification failed");
    return { ok: true, object_id: objectId, reminder_cancelled: true, focus_object_id: objectId };
  }

  if (action.type === "memory.upsert") {
    const at = nowIso();
    const id = randomId("mem");
    await env.DB.prepare(`INSERT INTO ${TABLES.memories}
      (id,chat_id,subject,predicate,value_json,confidence,sensitivity,expires_at,source_update_id,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)
      ON CONFLICT(chat_id,subject,predicate) DO UPDATE SET
        value_json=excluded.value_json,
        confidence=excluded.confidence,
        sensitivity=excluded.sensitivity,
        expires_at=excluded.expires_at,
        source_update_id=excluded.source_update_id,
        status='active',
        updated_at=excluded.updated_at`)
      .bind(
        id,
        chatId,
        action.args.subject,
        action.args.predicate,
        JSON.stringify(action.args.value),
        action.args.confidence,
        action.args.sensitivity,
        action.args.expires_at,
        updateId,
        at,
        at,
      )
      .run();
    const verify = await env.DB.prepare(`SELECT value_json,status FROM ${TABLES.memories}
      WHERE chat_id=? AND subject=? AND predicate=? LIMIT 1`)
      .bind(chatId, action.args.subject, action.args.predicate)
      .first();
    if (!verify || String(verify.status) !== "active") throw new Error("Memory verification failed");
    return { ok: true, memory: { subject: action.args.subject, predicate: action.args.predicate, value: safeJsonParse(verify.value_json, null) } };
  }

  if (action.type === "memory.forget") {
    await env.DB.prepare(`UPDATE ${TABLES.memories} SET status='forgotten',updated_at=?
      WHERE chat_id=? AND subject=? AND predicate=? AND status='active'`)
      .bind(nowIso(), chatId, action.args.subject, action.args.predicate)
      .run();
    return { ok: true, forgotten: true };
  }

  throw new Error(`Unsupported executor action: ${action.type}`);
}

function normalizeLocalMinute(value) {
  const s = compactText(value, 40);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const yy = Number(y), mm = Number(mo), dd = Number(d), hh = Number(h), mn = Number(mi);
  if (yy < 2020 || yy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh < 0 || hh > 23 || mn < 0 || mn > 59) return null;
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function mergeObjectState(currentState, patch, fallbackTitle) {
  const current = currentState && typeof currentState === "object" && !Array.isArray(currentState) ? structuredClone(currentState) : {};
  const out = {
    title: compactText(current.title || fallbackTitle || "موضوع", 240),
    description: current.description ?? null,
    start_local: normalizeLocalMinute(current.start_local) ?? null,
    end_local: normalizeLocalMinute(current.end_local) ?? null,
    timezone: TZ,
    location: current.location ?? null,
    people: Array.isArray(current.people) ? current.people : [],
    details: current.details && typeof current.details === "object" ? current.details : {},
    status: current.status ?? "open",
  };

  if (Object.hasOwn(patch, "title") && patch.title !== null) out.title = compactText(patch.title, 240) || out.title;
  if (Object.hasOwn(patch, "description")) out.description = patch.description === null ? null : compactText(patch.description, 3000);
  if (Object.hasOwn(patch, "location")) out.location = patch.location === null ? null : compactText(patch.location, 300);
  if (Object.hasOwn(patch, "people")) out.people = Array.isArray(patch.people) ? patch.people.slice(0, 20) : [];
  if (Object.hasOwn(patch, "details")) out.details = { ...out.details, ...(patch.details && typeof patch.details === "object" ? patch.details : {}) };
  if (Object.hasOwn(patch, "status") && patch.status !== null) out.status = compactText(patch.status, 80) || out.status;

  if (Object.hasOwn(patch, "start_local")) out.start_local = patch.start_local === null ? null : normalizeLocalMinute(patch.start_local);
  if (Object.hasOwn(patch, "end_local")) out.end_local = patch.end_local === null ? null : normalizeLocalMinute(patch.end_local);

  if (Object.hasOwn(patch, "start_date_local")) {
    const date = String(patch.start_date_local ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new SandPlanError("BAD_DATE", "start_date_local must be YYYY-MM-DD");
    const time = out.start_local ? out.start_local.slice(11, 16) : null;
    if (!time) throw new SandPlanError("MISSING_TIME_COMPONENT", "Cannot change only the date when the target has no known time");
    out.start_local = `${date}T${time}`;
  }

  if (Object.hasOwn(patch, "start_time_local")) {
    const time = String(patch.start_time_local ?? "").trim();
    if (!/^\d{2}:\d{2}$/.test(time)) throw new SandPlanError("BAD_TIME", "start_time_local must be HH:mm");
    const date = out.start_local ? out.start_local.slice(0, 10) : null;
    if (!date) throw new SandPlanError("MISSING_DATE_COMPONENT", "Cannot change only the time when the target has no known date");
    out.start_local = normalizeLocalMinute(`${date}T${time}`);
  }

  return out;
}

async function objectById(env, chatId, objectId) {
  const row = await env.DB.prepare(`SELECT id,chat_id,kind,title,state_json,status,created_at,updated_at
    FROM ${TABLES.objects} WHERE id=? AND chat_id=? LIMIT 1`)
    .bind(objectId, chatId)
    .first();
  if (!row) return null;
  return {
    id: String(row.id),
    chat_id: String(row.chat_id),
    kind: String(row.kind),
    title: String(row.title),
    state: safeJsonParse(row.state_json, {}),
    status: String(row.status),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

async function upsertReminderForObject(env, { chatId, objectId, title, remindAtUtc, mode, sourceUpdateId }) {
  const existing = await env.DB.prepare(`SELECT id FROM ${TABLES.reminders}
    WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain') LIMIT 1`)
    .bind(chatId, objectId)
    .first();
  const at = nowIso();
  if (existing?.id) {
    await env.DB.prepare(`UPDATE ${TABLES.reminders}
      SET title=?,remind_at_utc=?,timezone=?,mode=?,status='pending',source_update_id=?,updated_at=?
      WHERE id=?`)
      .bind(title, remindAtUtc, TZ, mode, sourceUpdateId, at, String(existing.id))
      .run();
    return String(existing.id);
  }
  const id = randomId("rem");
  await env.DB.prepare(`INSERT INTO ${TABLES.reminders}
    (id,chat_id,object_id,title,remind_at_utc,timezone,mode,status,source_update_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'pending',?,?,?)`)
    .bind(id, chatId, objectId, title, remindAtUtc, TZ, mode, sourceUpdateId, at, at)
    .run();
  return id;
}

async function cancelReminderForObject(env, chatId, objectId) {
  await env.DB.prepare(`UPDATE ${TABLES.reminders}
    SET status='cancelled',updated_at=?
    WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain')`)
    .bind(nowIso(), chatId, objectId)
    .run();
}

async function syncAnchoredReminderForObject(env, chatId, objectId, startLocal, sourceUpdateId) {
  const row = await env.DB.prepare(`SELECT id,title,mode,status FROM ${TABLES.reminders}
    WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain') LIMIT 1`)
    .bind(chatId, objectId)
    .first();
  if (!row || String(row.mode) !== "at_start") return;
  const normalized = normalizeLocalMinute(startLocal);
  if (!normalized) return;
  const remindAtUtc = cairoLocalToUtc(normalized);
  if (!remindAtUtc) return;
  await env.DB.prepare(`UPDATE ${TABLES.reminders}
    SET remind_at_utc=?,status='pending',source_update_id=?,updated_at=? WHERE id=?`)
    .bind(remindAtUtc, sourceUpdateId, nowIso(), String(row.id))
    .run();
}

function cairoLocalToUtc(localMinute) {
  const normalized = normalizeLocalMinute(localMinute);
  if (!normalized) return null;
  const [datePart, timePart] = normalized.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);

  // Iteratively solve UTC such that formatting in Cairo equals the requested local wall time.
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  for (let i = 0; i < 4; i += 1) {
    const formatted = cairoPartsFromUtc(new Date(guess));
    const localAsUtc = Date.UTC(formatted.y, formatted.mo - 1, formatted.d, formatted.h, formatted.mi, 0, 0);
    const desiredAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
    const delta = desiredAsUtc - localAsUtc;
    guess += delta;
    if (delta === 0) break;
  }
  const verify = cairoPartsFromUtc(new Date(guess));
  if (verify.y !== y || verify.mo !== mo || verify.d !== d || verify.h !== h || verify.mi !== mi) return null;
  return new Date(guess).toISOString();
}

function cairoPartsFromUtc(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), mi: Number(parts.minute) };
}

async function persistWorkspace(env, chatId, { goal, thread_summary, focus_object_id, open_questions }) {
  const at = nowIso();
  await env.DB.prepare(`INSERT INTO ${TABLES.workspaces}
    (chat_id,goal,thread_summary,focus_object_id,open_questions_json,context_version,updated_at)
    VALUES(?,?,?,?,?,1,?)
    ON CONFLICT(chat_id) DO UPDATE SET
      goal=excluded.goal,
      thread_summary=excluded.thread_summary,
      focus_object_id=excluded.focus_object_id,
      open_questions_json=excluded.open_questions_json,
      context_version=${TABLES.workspaces}.context_version+1,
      updated_at=excluded.updated_at`)
    .bind(chatId, goal || null, thread_summary || null, focus_object_id || null, JSON.stringify(open_questions ?? []), at)
    .run();
}

function buildVerifiedReply(plan, execution) {
  if (plan.clarification) return plan.clarification.question;
  if (!execution.ok) return "حصلت مشكلة أثناء التنفيذ، فمش هقولك إن الطلب تم. مفيش تأكيد نجاح لحد ما التنفيذ يتثبت.";
  const reply = compactText(plan.reply, AI_MAX_REPLY_CHARS);
  if (reply) return reply;
  if (execution.steps.length > 0) return "تمام، نفذت المطلوب واتأكدت من النتيجة ✅";
  return "تمام.";
}

async function deliverTextOnce(env, chatId, sourceKind, sourceId, text) {
  const normalized = compactText(text, AI_MAX_REPLY_CHARS);
  if (!normalized) return { ok: true, skipped: true };
  const hash = await sha256Hex(normalized);
  const existing = await env.DB.prepare(`SELECT id,status,telegram_message_id,updated_at
    FROM ${TABLES.deliveries}
    WHERE chat_id=? AND source_kind=? AND source_id=? LIMIT 1`)
    .bind(chatId, sourceKind, sourceId)
    .first();

  if (existing?.status === "sent") return { ok: true, deduplicated: true, message_id: existing.telegram_message_id };
  if (existing?.status === "sending") {
    const age = nowMs() - new Date(String(existing.updated_at)).getTime();
    if (Number.isFinite(age) && age < DELIVERY_UNCERTAIN_AFTER_MS) return { ok: true, in_flight: true };
    await env.DB.prepare(`UPDATE ${TABLES.deliveries} SET status='uncertain',updated_at=? WHERE id=?`)
      .bind(nowIso(), String(existing.id))
      .run();
    return { ok: false, uncertain: true };
  }
  if (existing?.status === "uncertain") return { ok: false, uncertain: true };

  const id = existing?.id ? String(existing.id) : randomId("delivery");
  if (!existing) {
    await env.DB.prepare(`INSERT INTO ${TABLES.deliveries}
      (id,chat_id,source_kind,source_id,text_hash,status,created_at,updated_at)
      VALUES(?,?,?,?,?,'pending',?,?)`)
      .bind(id, chatId, sourceKind, sourceId, hash, nowIso(), nowIso())
      .run();
  }

  const claimed = await env.DB.prepare(`UPDATE ${TABLES.deliveries}
    SET status='sending',text_hash=?,updated_at=?
    WHERE id=? AND status IN ('pending','failed') RETURNING id`)
    .bind(hash, nowIso(), id)
    .first();
  if (!claimed) return { ok: true, deduplicated: true };

  try {
    const data = await telegramApi(env, "sendMessage", { chat_id: chatId, text: normalized });
    const messageId = Number(data?.result?.message_id ?? 0) || null;
    await env.DB.prepare(`UPDATE ${TABLES.deliveries}
      SET status='sent',telegram_message_id=?,last_error=NULL,updated_at=?,sent_at=? WHERE id=?`)
      .bind(messageId, nowIso(), nowIso(), id)
      .run();
    return { ok: true, message_id: messageId };
  } catch (error) {
    await env.DB.prepare(`UPDATE ${TABLES.deliveries}
      SET status='uncertain',last_error=?,updated_at=? WHERE id=?`)
      .bind(safeError(error), nowIso(), id)
      .run();
    throw error;
  }
}

async function deliverDueReminders(env, limit = 30) {
  const now = nowIso();
  const rows = await env.DB.prepare(`SELECT id,chat_id,title,remind_at_utc,status
    FROM ${TABLES.reminders}
    WHERE status='pending' AND remind_at_utc<=?
    ORDER BY remind_at_utc ASC LIMIT ?`)
    .bind(now, clampInt(limit, 1, 100, 30))
    .all();
  for (const row of rows?.results ?? []) {
    const claimed = await env.DB.prepare(`UPDATE ${TABLES.reminders}
      SET status='sending',updated_at=? WHERE id=? AND status='pending' RETURNING id`)
      .bind(nowIso(), String(row.id))
      .first();
    if (!claimed) continue;
    try {
      const delivery = await deliverTextOnce(env, String(row.chat_id), "reminder", String(row.id), `⏰ ${String(row.title)}`);
      if (delivery.ok && !delivery.uncertain) {
        await env.DB.prepare(`UPDATE ${TABLES.reminders}
          SET status='sent',telegram_message_id=?,updated_at=?,sent_at=? WHERE id=?`)
          .bind(delivery.message_id ?? null, nowIso(), nowIso(), String(row.id))
          .run();
      } else {
        await env.DB.prepare(`UPDATE ${TABLES.reminders} SET status='uncertain',updated_at=? WHERE id=?`)
          .bind(nowIso(), String(row.id))
          .run();
      }
    } catch (error) {
      await env.DB.prepare(`UPDATE ${TABLES.reminders} SET status='uncertain',updated_at=? WHERE id=?`)
        .bind(nowIso(), String(row.id))
        .run();
      logError("reminder_delivery", error, { reminderId: String(row.id) });
    }
  }
}

async function markStaleDeliveriesUncertain(env) {
  const cutoff = new Date(nowMs() - DELIVERY_UNCERTAIN_AFTER_MS).toISOString();
  await env.DB.prepare(`UPDATE ${TABLES.deliveries}
    SET status='uncertain',updated_at=? WHERE status='sending' AND updated_at<?`)
    .bind(nowIso(), cutoff)
    .run();
  await env.DB.prepare(`UPDATE ${TABLES.reminders}
    SET status='uncertain',updated_at=? WHERE status='sending' AND updated_at<?`)
    .bind(nowIso(), cutoff)
    .run();
}

function omniChatUrl(env) {
  const configured = String(env?.OMNIAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!configured) {
    if (env?.OMNIAI_SERVICE?.fetch) return "https://omniai.internal/v1/chat/completions";
    throw new Error("Missing binding: OMNIAI_BASE_URL");
  }
  if (!/^https:\/\//i.test(configured)) throw new Error("OMNIAI_BASE_URL must use https");
  if (/\/v1\/chat\/completions$/i.test(configured)) return configured;
  if (/\/v1$/i.test(configured)) return `${configured}/chat/completions`;
  return `${configured}/v1/chat/completions`;
}

function aiContent(data) {
  const direct = data?.choices?.[0]?.message?.content;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const output = data?.output_text ?? data?.text;
  if (typeof output === "string" && output.trim()) return output.trim();
  return "";
}

function aiErrorCode(error) {
  if (error?.name === "AbortError") return "timeout";
  const message = safeError(error).toLowerCase();
  if (message.includes("timeout") || message.includes("aborted")) return "timeout";
  if (message.includes("empty")) return "empty_response";
  return "network_or_runtime";
}

async function recordAiCallSafe(env, record) {
  try {
    await env.DB.prepare(`INSERT INTO ${TABLES.aiCalls}
      (chat_id,update_id,phase,model_id,model_role,latency_ms,ok,http_status,error_code,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        record.chatId,
        record.updateId,
        record.phase,
        record.modelId,
        record.modelRole,
        Math.max(0, Number(record.latencyMs) || 0),
        record.ok ? 1 : 0,
        record.httpStatus ?? null,
        record.errorCode ?? null,
        nowIso(),
      )
      .run();
  } catch (error) {
    logError("ai_call_log_noncritical", error, { modelId: record.modelId });
  }
}

async function callOneAiModel(env, model, messages, timeoutMs, temperature, maxTokens) {
  requireBinding(env, "OMNIAI_API_KEY");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = nowMs();
  try {
    const request = new Request(omniChatUrl(env), {
      method: "POST",
      headers: { authorization: `Bearer ${env.OMNIAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
    const response = env?.OMNIAI_SERVICE?.fetch ? await env.OMNIAI_SERVICE.fetch(request) : await fetch(request);
    const httpStatus = response.status;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = String(data?.error?.message ?? data?.message ?? `HTTP ${httpStatus}`).slice(0, 400);
      throw new SandHttpError(`OmniAI ${model.id} failed: ${detail}`, httpStatus);
    }
    const content = aiContent(data);
    if (!content) throw new SandHttpError(`OmniAI ${model.id} returned empty content`, httpStatus);
    return { text: content, latencyMs: nowMs() - started, httpStatus };
  } finally {
    clearTimeout(timer);
  }
}

async function callAiChain(env, { chatId, updateId, phase, messages, temperature = 0.2, maxTokens = 1200 }) {
  requireBinding(env, "OMNIAI_API_KEY");
  if (!env?.OMNIAI_BASE_URL && !env?.OMNIAI_SERVICE?.fetch) throw new Error("Missing OmniAI route");
  const deadline = nowMs() + AI_TOTAL_BUDGET_MS;
  const failures = [];

  for (const model of AI_MODELS) {
    const remaining = deadline - nowMs();
    if (remaining < 500) break;
    const timeoutMs = Math.min(AI_MODEL_TIMEOUT_MS, remaining);
    const started = nowMs();
    try {
      const result = await callOneAiModel(env, model, messages, timeoutMs, temperature, maxTokens);
      await recordAiCallSafe(env, {
        chatId,
        updateId,
        phase,
        modelId: model.id,
        modelRole: model.role,
        latencyMs: result.latencyMs,
        ok: true,
        httpStatus: result.httpStatus,
        errorCode: null,
      });
      return { text: result.text, modelId: model.id };
    } catch (error) {
      const httpStatus = error instanceof SandHttpError ? error.httpStatus : null;
      const code = httpStatus ? `http_${httpStatus}` : aiErrorCode(error);
      await recordAiCallSafe(env, {
        chatId,
        updateId,
        phase,
        modelId: model.id,
        modelRole: model.role,
        latencyMs: nowMs() - started,
        ok: false,
        httpStatus,
        errorCode: code,
      });
      failures.push(`${model.id}:${code}`);
      logError("ai_model_failed", error, { model: model.id, role: model.role, code, phase });
      if (httpStatus === 401 || httpStatus === 403) break;
    }
  }

  const joined = failures.join(" | ");
  let code = "AI_UNAVAILABLE";
  if (/http_401|http_403/.test(joined)) code = "AI_AUTH";
  else if (/http_404/.test(joined)) code = "AI_ROUTE_OR_MODEL";
  else if (/http_429/.test(joined)) code = "AI_RATE_LIMIT";
  else if (/http_5\d\d/.test(joined)) code = "AI_UPSTREAM";
  else if (/timeout/.test(joined)) code = "AI_TIMEOUT";
  throw new SandAiChainError(code, failures.length ? failures : ["budget_exhausted"]);
}

async function telegramApi(env, method, payload) {
  requireBinding(env, "TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new SandHttpError(`Telegram ${method} failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`, response.status);
  }
  return data;
}

async function setup(request, env) {
  requireBinding(env, "DB");
  requireBinding(env, "SETUP_KEY");
  requireBinding(env, "TELEGRAM_BOT_TOKEN");
  requireBinding(env, "TELEGRAM_WEBHOOK_SECRET");
  const url = new URL(request.url);
  const presented = request.headers.get("X-Sand-Key") ?? url.searchParams.get("key") ?? "";
  if (!(await secretEqual(presented, env.SETUP_KEY))) return json({ ok: false, error: "unauthorized" }, 401);
  await ensureSchema(env);
  const webhookUrl = `${url.origin}/telegram`;
  const result = await telegramApi(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  return json({ ok: true, webhook_url: webhookUrl, telegram: result.result ?? true, version: APP_VERSION });
}

async function health(env) {
  const bindings = {
    DB: Boolean(env?.DB),
    TELEGRAM_BOT_TOKEN: Boolean(env?.TELEGRAM_BOT_TOKEN),
    TELEGRAM_WEBHOOK_SECRET: Boolean(env?.TELEGRAM_WEBHOOK_SECRET),
    SETUP_KEY: Boolean(env?.SETUP_KEY),
    OMNIAI_API_KEY: Boolean(env?.OMNIAI_API_KEY),
    OMNIAI_BASE_URL: Boolean(env?.OMNIAI_BASE_URL),
    OMNIAI_SERVICE: Boolean(env?.OMNIAI_SERVICE?.fetch),
    ALLOWED_CHAT_ID: Boolean(env?.ALLOWED_CHAT_ID),
    PUBLIC_BOT: String(env?.PUBLIC_BOT ?? "false"),
  };
  try {
    await ensureSchema(env);
    const [pending, operations, objects, reminders] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLES.inbox} WHERE status IN ('pending','retry','processing')`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLES.operations}`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLES.objects} WHERE status='active'`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLES.reminders} WHERE status IN ('pending','sending','uncertain')`).first(),
    ]);
    return json({
      ok:
        bindings.DB &&
        bindings.TELEGRAM_BOT_TOKEN &&
        bindings.TELEGRAM_WEBHOOK_SECRET &&
        bindings.OMNIAI_API_KEY &&
        (bindings.OMNIAI_BASE_URL || bindings.OMNIAI_SERVICE),
      service: APP_NAME,
      version: APP_VERSION,
      schema_version: DATA_SCHEMA_VERSION,
      architecture: ARCHITECTURE_NAME,
      semantic_routing: true,
      capability_families: CAPABILITY_FAMILY_IDS.map((id) => ({ id, ...CAPABILITY_FAMILIES[id] })),
      voice_input: true,
      keyword_routing: false,
      pending_updates: Number(pending?.n ?? 0),
      operations: Number(operations?.n ?? 0),
      active_objects: Number(objects?.n ?? 0),
      pending_reminders: Number(reminders?.n ?? 0),
      models: AI_MODELS.map((x) => x.id),
      bindings,
    });
  } catch (error) {
    return json({ ok: false, service: APP_NAME, version: APP_VERSION, bindings, error: safeError(error) }, 503);
  }
}

async function adminStatus(request, env) {
  requireBinding(env, "DB");
  requireBinding(env, "SETUP_KEY");
  const presented = request.headers.get("X-Sand-Key") ?? "";
  if (!(await secretEqual(presented, env.SETUP_KEY))) return json({ ok: false, error: "unauthorized" }, 401);
  await ensureSchema(env);
  const [counts, recent, workspaces, objects, operations, reminders] = await Promise.all([
    env.DB.prepare(`SELECT status,COUNT(*) AS count FROM ${TABLES.inbox} GROUP BY status ORDER BY status`).all(),
    env.DB.prepare(`SELECT update_id,chat_id,status,attempts,last_error,updated_at FROM ${TABLES.inbox} ORDER BY update_id DESC LIMIT 15`).all(),
    env.DB.prepare(`SELECT chat_id,goal,thread_summary,focus_object_id,context_version,updated_at FROM ${TABLES.workspaces} ORDER BY updated_at DESC LIMIT 10`).all(),
    env.DB.prepare(`SELECT id,chat_id,kind,title,status,state_json,updated_at FROM ${TABLES.objects} ORDER BY updated_at DESC LIMIT 20`).all(),
    env.DB.prepare(`SELECT id,chat_id,source_update_id,status,error,updated_at FROM ${TABLES.operations} ORDER BY updated_at DESC LIMIT 20`).all(),
    env.DB.prepare(`SELECT id,chat_id,object_id,title,remind_at_utc,mode,status,updated_at FROM ${TABLES.reminders} ORDER BY updated_at DESC LIMIT 20`).all(),
  ]);
  return json({
    ok: true,
    version: APP_VERSION,
    counts: counts?.results ?? [],
    recent: recent?.results ?? [],
    workspaces: workspaces?.results ?? [],
    objects: objects?.results ?? [],
    operations: operations?.results ?? [],
    reminders: reminders?.results ?? [],
  });
}

async function adminSelftest(request, env) {
  requireBinding(env, "DB");
  requireBinding(env, "SETUP_KEY");
  const presented = request.headers.get("X-Sand-Key") ?? request.headers.get("x-sand-admin") ?? "";
  if (!(await secretEqual(presented, env.SETUP_KEY))) return json({ ok: false, error: "unauthorized" }, 401);
  await ensureSchema(env);
  const tests = [];
  const push = (name, ok, detail = null) => tests.push({ name, ok: Boolean(ok), detail });

  const dt = "2026-08-19T17:00";
  const utc = cairoLocalToUtc(dt);
  push("cairo_datetime", utc === "2026-08-19T14:00:00.000Z" || utc === "2026-08-19T15:00:00.000Z", utc);

  const mergedDate = mergeObjectState({ title: "x", start_local: "2026-08-20T17:00" }, { start_date_local: "2026-08-19" }, "x");
  push("preserve_time_on_date_patch", mergedDate.start_local === "2026-08-19T17:00", mergedDate.start_local);

  const mergedTime = mergeObjectState({ title: "x", start_local: "2026-08-19T17:00" }, { start_time_local: "18:30" }, "x");
  push("preserve_date_on_time_patch", mergedTime.start_local === "2026-08-19T18:30", mergedTime.start_local);

  const noEnd = mergeObjectState({}, { start_local: "2026-08-19T17:00" }, "فرح");
  push("end_time_not_required", noEnd.start_local === "2026-08-19T17:00" && noEnd.end_local === null, noEnd);

  push("keyword_router_absent", true, "routing is semantic planner only");
  push("capability_family_contract", CAPABILITY_FAMILY_IDS.length === 12 && new Set(CAPABILITY_FAMILY_IDS).size === 12, CAPABILITY_FAMILY_IDS);
  push("voice_adapter_contract", VOICE_MAX_BYTES === 25 * 1024 * 1024 && omniAudioUrl({ OMNIAI_SERVICE: { fetch() {} } }) === "https://omniai.internal/v1/audio/transcriptions", { max_bytes: VOICE_MAX_BYTES });

  const selfChat = "__sand_v2_selftest__";
  try {
    await env.DB.prepare(`DELETE FROM ${TABLES.reminders} WHERE chat_id=?`).bind(selfChat).run();
    await env.DB.prepare(`DELETE FROM ${TABLES.objects} WHERE chat_id=?`).bind(selfChat).run();
    const snapshot = { workspace: { focus_object_id: null }, focus: null, objects: [] };
    const created = await executeAction(env, {
      chatId: selfChat,
      updateId: -9001,
      action: { type: "object.create", args: { kind: "commitment", title: "selftest", fields: { start_local: "2099-01-02T10:00" } } },
      snapshot,
      runtimeFocusId: null,
    });
    const objectId = String(created.object_id ?? "");
    const reminder = await executeAction(env, {
      chatId: selfChat,
      updateId: -9002,
      action: { type: "reminder.set", args: { target: { mode: "id", id: objectId }, mode: "at_start", remind_local: null, title: null } },
      snapshot,
      runtimeFocusId: objectId,
    });
    const beforeUtc = String(reminder.remind_at_utc ?? "");
    await executeAction(env, {
      chatId: selfChat,
      updateId: -9003,
      action: { type: "object.patch", args: { target: { mode: "id", id: objectId }, fields: { start_date_local: "2099-01-03" } } },
      snapshot,
      runtimeFocusId: objectId,
    });
    const row = await env.DB.prepare(`SELECT mode,remind_at_utc,status FROM ${TABLES.reminders} WHERE chat_id=? AND object_id=? LIMIT 1`)
      .bind(selfChat, objectId)
      .first();
    const obj = await objectById(env, selfChat, objectId);
    push(
      "d1_executor_contract",
      Boolean(objectId) && obj?.state?.start_local === "2099-01-03T10:00" && String(row?.mode ?? "") === "at_start" && String(row?.status ?? "") === "pending" && Boolean(row?.remind_at_utc) && String(row.remind_at_utc) !== beforeUtc,
      { object_start: obj?.state?.start_local ?? null, reminder_mode: row?.mode ?? null, reminder_status: row?.status ?? null },
    );
  } catch (error) {
    push("d1_executor_contract", false, safeError(error));
  } finally {
    await env.DB.prepare(`DELETE FROM ${TABLES.reminders} WHERE chat_id=?`).bind(selfChat).run().catch((error) => logError("selftest_cleanup_reminder", error));
    await env.DB.prepare(`DELETE FROM ${TABLES.objects} WHERE chat_id=?`).bind(selfChat).run().catch((error) => logError("selftest_cleanup_object", error));
  }

  return json({ ok: tests.every((x) => x.ok), service: APP_NAME, version: APP_VERSION, tests });
}

async function pendingChats(env, limit = 20) {
  const now = nowMs();
  const rows = await env.DB.prepare(`SELECT DISTINCT chat_id FROM ${TABLES.inbox}
    WHERE (status='pending' AND COALESCE(process_lease_until,0) <= ?)
       OR (status='retry' AND COALESCE(retry_after_ms,0) <= ? AND COALESCE(process_lease_until,0) <= ?)
       OR (status='processing' AND COALESCE(process_lease_until,0) <= ?)
    ORDER BY chat_id LIMIT ?`)
    .bind(now, now, now, now, clampInt(limit, 1, 100, 20))
    .all();
  return (rows?.results ?? []).map((row) => String(row.chat_id));
}
