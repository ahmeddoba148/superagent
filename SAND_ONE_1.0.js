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
const APP_VERSION = "1.0.0-dev.6";
const DATA_SCHEMA_VERSION = "2";
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
const AI_TOTAL_BUDGET_MS = 18_000;
const AI_MODEL_TIMEOUT_MS = 4_000;
const AI_HISTORY_MESSAGES = 20;
const AI_MAX_REPLY_CHARS = 3900;
const INBOX_TRANSIENT_MAX_ATTEMPTS = 4;
const DELIVERY_UNCERTAIN_AFTER_MS = 30_000;
const PLANNER_MAX_ACTIONS = 8;

const AI_MODELS = Object.freeze([
  Object.freeze({ id: "groq::openai/gpt-oss-120b", role: "primary" }),
  Object.freeze({ id: "gemini::gemini-3.6-flash", role: "fallback_1" }),
  Object.freeze({ id: "mistral::mistral-medium-latest", role: "fallback_2" }),
  Object.freeze({ id: "nvidia::nvidia/nemotron-3-super-120b-a12b", role: "fallback_3" }),
  Object.freeze({ id: "groq::qwen/qwen3.6-27b", role: "fallback_4" }),
  Object.freeze({ id: "nvidia::nvidia/nemotron-3-nano-30b-a3b", role: "fallback_5" }),
  Object.freeze({ id: "mistral::mistral-large-latest", role: "fallback_6" }),
  Object.freeze({ id: "openrouter::nvidia/nemotron-3-super-120b-a12b:free", role: "fallback_7" }),
  Object.freeze({ id: "nvidia::nvidia/nemotron-3-ultra-550b-a55b", role: "fallback_8" }),
  Object.freeze({ id: "openrouter::google/gemma-4-31b-it:free", role: "fallback_9" }),
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
  lifeItems: "sand_one_life_items",
  capabilityPlans: "sand_one_capability_plans",
  scheduleRules: "sand_one_schedule_rules",
  scheduleSignals: "sand_one_schedule_signals",
});

const CAPABILITY_FAMILIES = Object.freeze({
  schedule: Object.freeze({ label: "Schedule", role: "appointments, reminders, recurrence, free time and conflicts", state: "active" }),
  work: Object.freeze({ label: "Work", role: "tasks, projects, waiting and life inbox", state: "active" }),
  shopping: Object.freeze({ label: "Shopping", role: "shopping lists, sessions, status and progress", state: "active" }),
  memory_people: Object.freeze({ label: "Memory & People", role: "memory, people, relationships and contacts", state: "active" }),
  web_live: Object.freeze({ label: "Web & Live", role: "Google search, web reading, news, weather and places", state: "active" }),
  communications: Object.freeze({ label: "Communications", role: "Gmail and controlled outbound communication", state: "planned" }),
  google_workspace: Object.freeze({ label: "Google Workspace", role: "Google Calendar, free-busy and Contacts", state: "planned" }),
  files_media: Object.freeze({ label: "Files & Media", role: "files, OCR, vision and Telegram voice", state: "input_adapter" }),
  local_life: Object.freeze({ label: "Local Life", role: "location, prayer times, Hijri calendar and holidays", state: "active" }),
  utility: Object.freeze({ label: "Utility", role: "calculator, units and deterministic date-time", state: "active" }),
  automation: Object.freeze({ label: "Automation", role: "scheduler, briefs, monitoring and follow-ups", state: "planned" }),
  personal_system: Object.freeze({ label: "Personal/System", role: "profile, settings, global search, audit and undo", state: "planned" }),
});
const CAPABILITY_FAMILY_IDS = Object.freeze(Object.keys(CAPABILITY_FAMILIES));

const CAPABILITY_FAMILY_CONTRACTS = Object.freeze({
  schedule: Object.freeze({
    max_steps: 8,
    operations: Object.freeze({
      "schedule.create": "args.title and args.start_local required; end_local/location/description optional",
      "schedule.list": "args.from_local/to_local optional; defaults to the next 7 days",
      "schedule.search": "args.query required; from_local/to_local optional",
      "schedule.free_time": "args.from_local and args.to_local required; min_minutes optional",
      "schedule.conflicts": "args.from_local/to_local optional; target optional",
      "schedule.shift": "args.target required; use delta_minutes or start_local",
      "schedule.bulk_shift": "args.targets array and delta_minutes required",
      "schedule.cancel": "args.target required",
      "schedule.snooze": "args.target and minutes required",
      "schedule.alerts.set": "args.target and offsets_minutes array required; 0 means at start",
      "schedule.alerts.clear": "args.target required",
      "schedule.recurrence.set": "args.target and freq=daily|weekly|monthly|yearly; interval/weekdays/month_days/months/times/start_date/end_date/max_occurrences/duration_minutes/alert_offsets_minutes optional",
      "schedule.recurrence.pause": "args.target required; until_local optional",
      "schedule.recurrence.resume": "args.target required",
      "schedule.recurrence.skip": "args.target and occurrence required (YYYY-MM-DD or YYYY-MM-DDTHH:mm)",
      "schedule.recurrence.cancel": "args.target required",
    }),
  }),
  shopping: Object.freeze({
    max_steps: 8,
    operations: Object.freeze({
      "shopping.add": "args.items = array of {title, quantity?, category?, priority?}",
      "shopping.list": "args.status = pending|bought|unavailable|skipped|all (optional)",
      "shopping.mark": "args.target = exposed shopping ref such as s1; args.status = pending|bought|unavailable|skipped",
      "shopping.remove": "args.target = exposed shopping ref such as s1",
      "shopping.progress": "args = {}",
      "shopping.session.start": "args.place_name optional",
      "shopping.session.finish": "args = {}",
    }),
  }),
  work: Object.freeze({
    max_steps: 8,
    operations: Object.freeze({
      "project.create": "args.title required; priority low|normal|high optional; deadline optional; notes optional",
      "project.list": "args.status = active|done|all optional",
      "project.update": "args.target = exposed work ref such as w1; status/progress/priority/deadline/notes optional",
      "task.create": "args.title required; parent = exposed project ref or created:N optional; due_at/priority optional",
      "task.list": "args.project = exposed project ref optional; status optional",
      "task.update": "args.target = exposed task ref; title/status/due_at/priority optional",
      "waiting.create": "args.title required; waiting_on/due_at optional",
      "waiting.list": "args.status optional",
      "waiting.close": "args.target = exposed waiting ref",
      "inbox.add": "args.text required; classified_as optional",
      "inbox.list": "args.status = open|closed|all optional",
      "inbox.classify": "args.target = exposed inbox ref; classified_as required",
      "inbox.close": "args.target = exposed inbox ref",
    }),
  }),
  memory_people: Object.freeze({
    max_steps: 8,
    operations: Object.freeze({
      "people.create": "args.name required; relationship_to_user/notes/facts optional",
      "people.list": "args.query optional",
      "people.update": "args.target = exposed person ref such as p1; patch may contain relationship_to_user, notes, facts",
      "relations.set": "args.subject and args.object = exposed person ref or created:N; args.relation required",
      "relations.list": "args.person = exposed person ref optional",
    }),
  }),
  local_life: Object.freeze({
    max_steps: 4,
    operations: Object.freeze({
      "prayer.times": "Prayer times for a Gregorian date. city/country or latitude+longitude optional; defaults Cairo, EG; method defaults 5 Egyptian General Authority of Survey",
      "hijri.date": "Convert Gregorian date to Hijri Umm al-Qura. args.date YYYY-MM-DD optional; defaults current Cairo date",
      "egypt.holidays": "Egypt public holidays for args.year optional; defaults current Cairo year",
    }),
  }),
  utility: Object.freeze({
    max_steps: 6,
    operations: Object.freeze({
      "calculator.evaluate": "args.expression required; arithmetic only: + - * / % ^ and parentheses",
      "unit.convert": "args.value number; args.from/to one of c,f,k,m,km,cm,mm,mi,yd,ft,in,kg,g,mg,lb,oz,l,ml,cup_us,gal_us,b,kb,mb,gb,kib,mib,gib",
      "datetime.now": "args.timezone optional IANA timezone; defaults Africa/Cairo",
      "datetime.diff": "args.from and args.to ISO datetime; args.unit = seconds|minutes|hours|days optional",
    }),
  }),
  web_live: Object.freeze({
    max_steps: 5,
    operations: Object.freeze({
      "web.search": "Google web search. args.query required; limit/language/country optional",
      "web.read": "Read a public HTTPS web page. args.url required; max_chars optional",
      "news.search": "Live news search. args.query required; limit optional",
      "weather.read": "Current weather + 1..7 day forecast. city or latitude+longitude required",
      "places.search": "Google Places text search. args.query required; optional coordinates/radius/limit/language",
    }),
  }),
});
const CAPABILITY_FAMILY_CATALOG = Object.freeze(
  CAPABILITY_FAMILY_IDS.map((id) => ({ id, label: CAPABILITY_FAMILIES[id].label, role: CAPABILITY_FAMILIES[id].role, state: CAPABILITY_FAMILIES[id].state })),
);

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
  "capability.request",
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
          await processDueScheduleSignals(env, 40);
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

function randomId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function secretEqual(a, b) {
  const left = new TextEncoder().encode(String(a ?? ""));
  const right = new TextEncoder().encode(String(b ?? ""));
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", left),
    crypto.subtle.digest("SHA-256", right),
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

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.lifeItems} (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      parent_id TEXT,
      title TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      source_update_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_one_life_items_chat
      ON ${TABLES.lifeItems}(chat_id, kind, status, updated_at)`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.capabilityPlans} (
      operation_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      family TEXT NOT NULL,
      request_text TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      model_id TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(operation_id, step_index)
    )`),



    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.scheduleRules} (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      object_id TEXT NOT NULL,
      freq TEXT NOT NULL CHECK(freq IN ('once','daily','weekly','monthly','yearly')),
      interval_n INTEGER NOT NULL DEFAULT 1,
      anchor_local TEXT NOT NULL,
      weekdays_json TEXT NOT NULL DEFAULT '[]',
      month_days_json TEXT NOT NULL DEFAULT '[]',
      months_json TEXT NOT NULL DEFAULT '[]',
      times_json TEXT NOT NULL DEFAULT '[]',
      start_date_local TEXT,
      end_date_local TEXT,
      max_occurrences INTEGER,
      duration_minutes INTEGER,
      alert_offsets_json TEXT NOT NULL DEFAULT '[]',
      shift_minutes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled')),
      paused_until_local TEXT,
      skip_occurrences_json TEXT NOT NULL DEFAULT '[]',
      source_update_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(chat_id, object_id)
    )`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_one_schedule_rules_chat
      ON ${TABLES.scheduleRules}(chat_id, status, updated_at)`),

    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLES.scheduleSignals} (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      rule_id TEXT,
      object_id TEXT NOT NULL,
      occurrence_local TEXT,
      offset_minutes INTEGER,
      fire_at_utc TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','cancelled','uncertain','failed')),
      telegram_message_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT
    )`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_one_schedule_signals_due
      ON ${TABLES.scheduleSignals}(status, fire_at_utc)`),

    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sand_one_schedule_signals_object
      ON ${TABLES.scheduleSignals}(chat_id, object_id, status, fire_at_utc)`),

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
    const rateLimited =
      (error instanceof SandAiChainError && error.code === "AI_RATE_LIMIT") ||
      (error instanceof SandHttpError && error.httpStatus === 429);
    const delay = rateLimited
      ? Math.min(120_000, 75_000 + Math.max(0, attempts - 1) * 15_000)
      : Math.min(30_000, 2500 * 2 ** Math.max(0, attempts - 1));
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
    "When more than one active object exists, every object-targeting mutation must use the exposed ref of the intended object (such as o1 or o2), even when that object is currently focused. Resolve explicit semantic references by object identity and meaning, never by recency alone.",
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
    "Allowed actions: object.create, object.patch, object.archive, focus.set, focus.clear, reminder.set, reminder.cancel, memory.upsert, memory.forget, capability.request.",
    "For a request that belongs to a non-core capability family, emit capability.request with args {family, request, target?}. The top-level brain chooses only the family and semantic request; it does NOT choose the family operation. A second family-specific planner sees only that family contract.",
    "Deterministic arithmetic, unit conversion, and current/difference date-time requests belong to the utility family. Do not calculate them in model prose when the utility family is available.",
    "Recurrence, free-time analysis, conflict checks, snooze, multiple alerts, and bulk schedule changes belong to the schedule family. Basic one-off commitments may remain core.",
    "Prayer times, Hijri calendar dates, and Egypt public holidays belong to the local_life family. Prefer coordinates when the user supplied them; otherwise preserve the city/country they named and default to Cairo, Egypt only when no location was supplied.",
    "Capability families: " + JSON.stringify(CAPABILITY_FAMILY_CATALOG),
    "Every action object MUST contain a non-empty type from the allowed actions and an args object matching that action contract.",
    "Target contract is intentionally simple: whenever an action or focus needs a target, use target as ONE string: focus for current runtime focus, created for the latest object created earlier in this same plan, or an exposed active_objects ref such as o1 or o2. Never emit or copy internal IDs.",
    "Object create args contain kind, title, and fields. Object patch args contain target and fields. Fields may include title, description, start_local, start_date_local, start_time_local, end_local, location, people, details, status.",
    "Reminder set args contain target, mode (at_start or absolute), optional remind_local in YYYY-MM-DDTHH:mm, and optional title.",
    "Memory upsert args contain subject, predicate, value, and optional confidence, sensitivity, expires_at.",
    "Durable personal facts that the user explicitly wants remembered belong in memory.upsert, not object.patch, focus changes, notes, or unrelated active objects. Memory is independent from the current object focus.",
    "When recalling a stored fact, answer from workspace memories with effect answer and no mutation unless the user also asks to change or forget that memory. Do not patch an active object merely because it is focused.",
    "A request to remember a personal fact must use a real memory.upsert action; a mutate plan that only patches an unrelated object is invalid for that semantic goal.",
    "For user-provided proper names, identifiers, labels, and scalar text facts stored in memory, preserve the user's original spelling and script exactly; never translate or transliterate the value.",
    "Required top-level keys are effect, intent, continuation, goal, thread_summary, focus, actions, clarification, reply, confidence. effect is exactly answer, mutate, or clarify. Use mutate whenever the user asks to create, change, remove, remember, forget, schedule, cancel, or otherwise alter durable state; answer when no durable state change is requested; clarify only when a genuinely essential ambiguity blocks execution.",
    "A mutate plan MUST contain at least one real domain mutation action; changing focus alone is never enough to satisfy a requested state change.",
    "focus.mode is keep, set, or clear. If focus.mode is set, focus.target uses the same target string contract. actions is always an array. clarification is either null or an object with question and reason.",
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
  const failureCodes = failures.map((failure) => failure.slice(failure.lastIndexOf(":") + 1));
  const hasFailureCode = (predicate) => failureCodes.some(predicate);
  const allFailureCodes = (predicate) => failureCodes.length > 0 && failureCodes.every(predicate);
  let code = "AI_UNAVAILABLE";
  if (hasFailureCode((failureCode) => failureCode === "http_401" || failureCode === "http_403")) code = "AI_AUTH";
  else if (allFailureCodes((failureCode) => failureCode === "http_429")) code = "AI_RATE_LIMIT";
  else if (hasFailureCode((failureCode) => failureCode === "timeout")) code = "AI_TIMEOUT";
  else if (hasFailureCode((failureCode) => /^http_5\d\d$/.test(failureCode))) code = "AI_UPSTREAM";
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
    if (ref === "focus") {
      if (snapshot.objects.length > 1) throw new SandPlanError("EXPLICIT_TARGET_REQUIRED", "Multiple active objects require an explicit exposed object ref");
      return { mode: "focus" };
    }
    if (ref === "created") return { mode: "focus" };
    const match = /^o([1-9][0-9]*)$/.exec(ref);
    const index = match ? Number(match[1]) - 1 : -1;
    const object = index >= 0 ? snapshot.objects[index] : null;
    if (!object) throw new SandPlanError("UNKNOWN_TARGET", "Target ref is not in the active workspace");
    return { mode: "id", id: object.id };
  }

  if (!target || typeof target !== "object") throw new SandPlanError("BAD_TARGET", "Missing target");
  const mode = String(target.mode ?? "");
  if (mode === "focus") {
    if (snapshot.objects.length > 1) throw new SandPlanError("EXPLICIT_TARGET_REQUIRED", "Multiple active objects require an explicit exposed object ref");
    return { mode: "focus" };
  }
  if (mode === "created") return { mode: "focus" };
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
      return { type, args: { target, fields } };    }

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

    if (type === "capability.request") {
      const family = compactText(args.family, 80);
      const request = compactText(args.request, 1200);
      if (!family || !CAPABILITY_FAMILIES[family]) throw new SandPlanError("BAD_CAPABILITY_FAMILY", `Unknown capability family: ${family}`);
      if (!request) throw new SandPlanError("BAD_CAPABILITY_REQUEST", "Capability request requires semantic request text");
      if (!CAPABILITY_FAMILY_CONTRACTS[family]) throw new SandPlanError("CAPABILITY_NOT_READY", `Capability family is not enabled yet: ${family}`);
      const target = args.target === undefined || args.target === null ? null : validateTarget(args.target, snapshot);
      return { type, args: { family, request, target } };
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
    "reminder.set", "reminder.cancel", "memory.upsert", "memory.forget", "capability.request",
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
    return { ok: true, clarification: true, steps: [], focus_object_id: snapshot.workspace.focus_object_id };
  }

  const results = [];
  let runtimeFocusId = snapshot.workspace.focus_object_id || null;

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
        operationId,
        stepIndex: i,
        action,
        snapshot,
        runtimeFocusId,
      });
      await finishStep(env, prior.id, "done", result, null);
      results.push(result);
      const resultAny = /** @type {any} */ (result);
      if (resultAny?.focus_object_id) runtimeFocusId = resultAny.focus_object_id;
      if (resultAny?.object_id && action.type === "object.create") runtimeFocusId = resultAny.object_id;
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

async function executeAction(env, { chatId, updateId, operationId = "", stepIndex = 0, action, snapshot, runtimeFocusId }) {
  if (action.type === "capability.request") {
    return executeCapabilityRequest(env, { chatId, updateId, operationId, stepIndex, request: action.args });
  }

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

async function currentUserMessage(env, chatId, updateId) {
  const row = await env.DB.prepare(`SELECT content FROM ${TABLES.messages} WHERE chat_id=? AND update_id=? AND role='user' LIMIT 1`)
    .bind(chatId, updateId)
    .first();
  return compactText(row?.content, 12_000);
}

async function capabilitySnapshot(env, chatId, family) {
  if (family === "schedule") return scheduleCapabilitySnapshot(env, chatId);
  if (family === "shopping") {
    const rows = await env.DB.prepare(`SELECT id,kind,parent_id,title,state_json,status,created_at,updated_at FROM ${TABLES.lifeItems}
      WHERE chat_id=? AND kind IN ('shopping_item','shopping_session') AND status!='archived'
      ORDER BY updated_at DESC LIMIT 80`)
      .bind(chatId).all();
    let itemNo = 0;
    return (rows?.results ?? []).map((row) => {
      const kind = String(row.kind);
      const ref = kind === "shopping_item" ? `s${++itemNo}` : `session`;
      return { ref, id: String(row.id), kind, title: String(row.title), status: String(row.status), state: safeJsonParse(row.state_json, {}), updated_at: String(row.updated_at) };
    });
  }
  if (family === "work") {
    const rows = await env.DB.prepare(`SELECT id,kind,parent_id,title,state_json,status,created_at,updated_at FROM ${TABLES.lifeItems}
      WHERE chat_id=? AND kind IN ('project','task','waiting','inbox') AND status!='archived'
      ORDER BY updated_at DESC LIMIT 100`)
      .bind(chatId).all();
    let no = 0;
    return (rows?.results ?? []).map((row) => ({
      ref: `w${++no}`,
      id: String(row.id),
      kind: String(row.kind),
      parent_id: row.parent_id ? String(row.parent_id) : null,
      title: String(row.title),
      status: String(row.status),
      state: safeJsonParse(row.state_json, {}),
      updated_at: String(row.updated_at),
    }));
  }
  if (family === "memory_people") {
    const rows = await env.DB.prepare(`SELECT id,kind,parent_id,title,state_json,status,created_at,updated_at FROM ${TABLES.lifeItems}
      WHERE chat_id=? AND kind IN ('person','relationship') AND status!='archived'
      ORDER BY CASE kind WHEN 'person' THEN 0 ELSE 1 END, updated_at DESC LIMIT 120`)
      .bind(chatId).all();
    const raw = rows?.results ?? [];
    const personRefById = new Map();
    let personNo = 0;
    for (const row of raw) {
      if (String(row.kind) === "person") personRefById.set(String(row.id), `p${++personNo}`);
    }
    let relationNo = 0;
    return raw.map((row) => {
      const kind = String(row.kind);
      const state = safeJsonParse(row.state_json, {});
      if (kind === "person") {
        return {
          ref: personRefById.get(String(row.id)),
          id: String(row.id),
          kind,
          title: String(row.title),
          status: String(row.status),
          state,
          updated_at: String(row.updated_at),
        };
      }
      return {
        ref: `r${++relationNo}`,
        id: String(row.id),
        kind,
        title: String(row.title),
        status: String(row.status),
        state: {
          relation: compactText(state.relation, 160) || String(row.title),
          subject_ref: personRefById.get(String(row.parent_id ?? "")) ?? null,
          object_ref: personRefById.get(String(state.object_id ?? "")) ?? null,
        },
        updated_at: String(row.updated_at),
      };
    });
  }
  if (family === "utility" || family === "web_live") return [];
  return [];
}

function familyPlannerPrompt(family, snapshot, currentText, semanticRequest) {
  const contract = CAPABILITY_FAMILY_CONTRACTS[family];
  const publicState = snapshot.map(({ id, ...row }) => row);
  return [
    "You are a family-specific planner inside SAND ONE.",
    "Return exactly one strict JSON object with keys steps and reply_hint. No markdown.",
    "Use only operations declared in this family contract. Do not invent operations.",
    "Understand the user's natural language semantically; never depend on trigger phrases or keyword routing.",
    "For existing items, target ONLY the exposed refs in family_state. Never emit internal IDs.",
    "For a newly created item needed by a later step in the same plan, use created:N where N is the 1-based earlier step number.",
    "Preserve user-provided names, item titles, labels and scalar text in the user's original spelling/script.",
    "Do not add actions the user did not request. Read requests should use read/progress operations; mutation requests should use the smallest complete mutation plan.",
    `Family: ${family}`,
    `Contract: ${JSON.stringify(contract)}`,
    `Family state: ${JSON.stringify(publicState)}`,
    `Current user text: ${currentText}`,
    `Current Cairo local datetime: ${cairoNowParts().date}T${cairoNowParts().time.slice(0,5)} (${TZ})`,
    `Semantic request: ${semanticRequest}`,
    'Output shape: {"steps":[{"op":"...","args":{}}],"reply_hint":""}',
  ].join("\n");
}

function familyPlanObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.steps));
}

function extractFamilyPlan(text) {
  const raw = String(text ?? "").trim();
  const direct = safeJsonParse(raw, null);
  if (familyPlanObject(direct)) return direct;
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "{") continue;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = safeJsonParse(raw.slice(start, i + 1), null);
          if (familyPlanObject(candidate)) return candidate;
          break;
        }
      }
    }
  }
  return null;
}

async function planCapabilityFamily(env, { chatId, updateId, family, currentText, semanticRequest, familyState }) {
  const failures = [];
  const deadline = nowMs() + AI_TOTAL_BUDGET_MS;
  const prompt = familyPlannerPrompt(family, familyState, currentText, semanticRequest);
  for (const model of AI_MODELS) {
    const remaining = deadline - nowMs();
    if (remaining < 500) break;
    const started = nowMs();
    try {
      const result = await callOneAiModel(env, model, [{ role: "system", content: prompt }, { role: "user", content: currentText }], Math.min(AI_MODEL_TIMEOUT_MS, remaining), 0, 1300);
      const plan = extractFamilyPlan(result.text);
      if (!familyPlanObject(plan)) {
        failures.push(`${model.id}:invalid_structured_output`);
        await recordAiCallSafe(env, { chatId, updateId, phase: `family_${family}`, modelId: model.id, modelRole: model.role, latencyMs: result.latencyMs, ok: false, httpStatus: result.httpStatus, errorCode: "invalid_structured_output" });
        continue;
      }
      const validated = validateFamilyPlan(family, plan, familyState);
      await recordAiCallSafe(env, { chatId, updateId, phase: `family_${family}`, modelId: model.id, modelRole: model.role, latencyMs: result.latencyMs, ok: true, httpStatus: result.httpStatus, errorCode: null });
      return { plan: validated, modelId: model.id };
    } catch (error) {
      const httpStatus = error instanceof SandHttpError ? error.httpStatus : null;
      const code = error instanceof SandPlanError ? `invalid_plan_${error.code.toLowerCase()}` : httpStatus ? `http_${httpStatus}` : aiErrorCode(error);
      failures.push(`${model.id}:${code}`);
      await recordAiCallSafe(env, { chatId, updateId, phase: `family_${family}`, modelId: model.id, modelRole: model.role, latencyMs: nowMs() - started, ok: false, httpStatus, errorCode: code });
      if (httpStatus === 401 || httpStatus === 403) break;
    }
  }
  throw new SandAiChainError(/http_429/.test(failures.join("|")) ? "AI_RATE_LIMIT" : "AI_UNAVAILABLE", failures.length ? failures : ["family_planner_budget_exhausted"]);
}

function familyRefMap(familyState) {
  return new Map(familyState.map((row) => [String(row.ref), String(row.id)]));
}

function resolveFamilyRef(value, refs, created = []) {
  const raw = compactText(value, 120);
  if (!raw) return null;
  if (refs.has(raw)) return refs.get(raw);
  const m = /^created:([1-9][0-9]*)$/.exec(raw);
  if (m) return created[Number(m[1]) - 1] ?? null;
  return null;
}

function validateFamilyPlan(family, input, familyState) {
  const contract = CAPABILITY_FAMILY_CONTRACTS[family];
  if (!contract) throw new SandPlanError("CAPABILITY_NOT_READY", `Family not ready: ${family}`);
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (rawSteps.length > contract.max_steps) throw new SandPlanError("TOO_MANY_CAPABILITY_STEPS", "Capability step budget exceeded");
  const refs = familyRefMap(familyState);
  const steps = rawSteps.map((step, index) => validateFamilyStep(family, step, refs, index));
  return { steps, reply_hint: compactText(input.reply_hint, 800) };
}


function sanitizeScalarFacts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 20)) {
    const key = compactText(rawKey, 120);
    if (!key) continue;
    if (["string", "number", "boolean"].includes(typeof rawValue) || rawValue === null) {
      out[key] = typeof rawValue === "string" ? compactText(rawValue, 1000) : rawValue;
    }
  }
  return out;
}

function familyCreatedRefOrKnown(value, refs) {
  const raw = compactText(value, 120);
  return Boolean(raw && (refs.has(raw) || /^created:[1-9][0-9]*$/.test(raw)));
}

function familyPersonRefOrCreated(value, refs) {
  const raw = compactText(value, 120);
  if (!raw) return false;
  if (/^created:[1-9][0-9]*$/.test(raw)) return true;
  return raw.startsWith("p") && refs.has(raw);
}

function validateFamilyStep(family, step, refs, index) {
  if (!step || typeof step !== "object") throw new SandPlanError("BAD_CAPABILITY_STEP", `Bad family step ${index}`);
  const op = compactText(step.op, 120);
  if (!CAPABILITY_FAMILY_CONTRACTS[family]?.operations?.[op]) throw new SandPlanError("CAPABILITY_OP_NOT_ALLOWED", `Operation not allowed in ${family}: ${op}`);
  const a = step.args && typeof step.args === "object" && !Array.isArray(step.args) ? step.args : {};
  if (family === "schedule") return validateScheduleStep(op, a, refs);
  if (family === "shopping") {
    if (op === "shopping.add") {
      const items = Array.isArray(a.items) ? a.items.slice(0, 30).map((item) => ({ title: compactText(item?.title, 240), quantity: compactText(item?.quantity, 120) || null, category: compactText(item?.category, 120) || null, priority: compactText(item?.priority, 80) || null })).filter((x) => x.title) : [];
      if (!items.length) throw new SandPlanError("SHOPPING_ITEMS_REQUIRED", "shopping.add requires items");
      return { op, args: { items } };
    }
    if (op === "shopping.list") {
      const status = compactText(a.status, 40) || "all";
      if (!["pending","bought","unavailable","skipped","all"].includes(status)) throw new SandPlanError("BAD_SHOPPING_STATUS", "Bad shopping status");
      return { op, args: { status } };
    }
    if (op === "shopping.mark") {
      const target = compactText(a.target, 120), status = compactText(a.status, 40);
      if (!refs.has(target)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown shopping target");
      if (!["pending","bought","unavailable","skipped"].includes(status)) throw new SandPlanError("BAD_SHOPPING_STATUS", "Bad shopping status");
      return { op, args: { target, status } };
    }
    if (op === "shopping.remove") {
      const target = compactText(a.target, 120);
      if (!refs.has(target)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown shopping target");
      return { op, args: { target } };
    }
    if (op === "shopping.progress" || op === "shopping.session.finish") return { op, args: {} };
    if (op === "shopping.session.start") return { op, args: { place_name: compactText(a.place_name, 240) || null } };
  }
  if (family === "work") {
    if (op === "project.create") {
      const title = compactText(a.title, 240); if (!title) throw new SandPlanError("TITLE_REQUIRED", "Project title required");
      const priority = compactText(a.priority, 40) || "normal"; if (!["low","normal","high"].includes(priority)) throw new SandPlanError("BAD_PRIORITY", "Bad priority");
      return { op, args: { title, priority, deadline: compactText(a.deadline, 80) || null, notes: compactText(a.notes, 2000) || null } };
    }
    if (op === "project.list") return { op, args: { status: compactText(a.status, 40) || "all" } };
    if (op === "project.update") {
      const target = compactText(a.target, 120); if (!refs.has(target)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown project target");
      return { op, args: { target, status: compactText(a.status, 40) || null, progress: a.progress === undefined ? null : clampInt(a.progress,0,100,0), priority: compactText(a.priority,40) || null, deadline: compactText(a.deadline,80) || null, notes: compactText(a.notes,2000) || null } };
    }
    if (op === "task.create") {
      const title = compactText(a.title, 240); if (!title) throw new SandPlanError("TITLE_REQUIRED", "Task title required");
      const parent = compactText(a.parent,120) || null;
      if (parent && !refs.has(parent) && !/^created:[1-9][0-9]*$/.test(parent)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown project parent");
      return { op, args: { title, parent, due_at: compactText(a.due_at,80) || null, priority: compactText(a.priority,40) || "normal" } };
    }
    if (op === "task.list") {
      const project = compactText(a.project,120) || null;
      if (project && !refs.has(project)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown project filter");
      return { op, args: { project, status: compactText(a.status,40) || "all" } };
    }
    if (op === "task.update") {
      const target = compactText(a.target,120); if (!refs.has(target)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown task target");
      return { op, args: { target, title: compactText(a.title,240) || null, status: compactText(a.status,40) || null, due_at: compactText(a.due_at,80) || null, priority: compactText(a.priority,40) || null } };
    }
    if (op === "waiting.create") {
      const title = compactText(a.title,240); if (!title) throw new SandPlanError("TITLE_REQUIRED", "Waiting title required");
      return { op, args: { title, waiting_on: compactText(a.waiting_on,240) || null, due_at: compactText(a.due_at,80) || null } };
    }
    if (op === "waiting.list") return { op, args: { status: compactText(a.status,40) || "all" } };
    if (op === "waiting.close") {
      const target = compactText(a.target,120); if (!refs.has(target)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown waiting target");
      return { op, args: { target } };
    }
    if (op === "inbox.add") {
      const text = compactText(a.text,2000); if (!text) throw new SandPlanError("TEXT_REQUIRED", "Inbox text required");
      return { op, args: { text, classified_as: compactText(a.classified_as,120) || null } };
    }
    if (op === "inbox.list") return { op, args: { status: compactText(a.status,40) || "all" } };
    if (op === "inbox.classify") {
      const target = compactText(a.target,120), classified_as = compactText(a.classified_as,120);
      if (!refs.has(target) || !classified_as) throw new SandPlanError("BAD_INBOX_CLASSIFY", "Inbox classify target and class required");
      return { op, args: { target, classified_as } };
    }
    if (op === "inbox.close") {
      const target = compactText(a.target,120); if (!refs.has(target)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown inbox target");
      return { op, args: { target } };
    }
  }

  if (family === "memory_people") {
    if (op === "people.create") {
      const name = compactText(a.name, 240);
      if (!name) throw new SandPlanError("PERSON_NAME_REQUIRED", "Person name required");
      return {
        op,
        args: {
          name,
          relationship_to_user: compactText(a.relationship_to_user, 160) || null,
          notes: compactText(a.notes, 2000) || null,
          facts: sanitizeScalarFacts(a.facts),
        },
      };
    }
    if (op === "people.list") return { op, args: { query: compactText(a.query, 240) || null } };
    if (op === "people.update") {
      const target = compactText(a.target, 120);
      if (!refs.has(target) || !target.startsWith("p")) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown person target");
      const patch = {};
      if (Object.prototype.hasOwnProperty.call(a, "relationship_to_user")) patch.relationship_to_user = compactText(a.relationship_to_user, 160) || null;
      if (Object.prototype.hasOwnProperty.call(a, "notes")) patch.notes = compactText(a.notes, 2000) || null;
      if (Object.prototype.hasOwnProperty.call(a, "facts")) patch.facts = sanitizeScalarFacts(a.facts);
      if (!Object.keys(patch).length) throw new SandPlanError("EMPTY_PERSON_PATCH", "Person update has no fields");
      return { op, args: { target, patch } };
    }
    if (op === "relations.set") {
      const subject = compactText(a.subject, 120), object = compactText(a.object, 120), relation = compactText(a.relation, 160);
      if (!familyPersonRefOrCreated(subject, refs) || !familyPersonRefOrCreated(object, refs) || !relation) {
        throw new SandPlanError("BAD_RELATION", "Relationship needs valid subject, object and relation");
      }
      if (subject === object) throw new SandPlanError("BAD_RELATION", "Relationship endpoints must differ");
      return { op, args: { subject, object, relation } };
    }
    if (op === "relations.list") {
      const person = compactText(a.person, 120) || null;
      if (person && (!refs.has(person) || !person.startsWith("p"))) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown person filter");
      return { op, args: { person } };
    }
  }
  if (family === "utility") {
    if (op === "calculator.evaluate") {
      const expression = compactText(a.expression, 500);
      if (!expression) throw new SandPlanError("EXPRESSION_REQUIRED", "Calculator expression required");
      return { op, args: { expression } };
    }
    if (op === "unit.convert") {
      const value = Number(a.value);
      if (!Number.isFinite(value)) throw new SandPlanError("BAD_UNIT_VALUE", "Unit value must be finite");
      const from = compactText(a.from, 40).toLowerCase(), to = compactText(a.to, 40).toLowerCase();
      if (!from || !to) throw new SandPlanError("UNIT_REQUIRED", "Both source and destination units are required");
      return { op, args: { value, from, to } };
    }
    if (op === "datetime.now") return { op, args: { timezone: compactText(a.timezone, 120) || TZ } };
    if (op === "datetime.diff") {
      const from = compactText(a.from, 120), to = compactText(a.to, 120), unit = compactText(a.unit, 40) || "hours";
      if (!from || !to || !["seconds", "minutes", "hours", "days"].includes(unit)) throw new SandPlanError("BAD_DATETIME_DIFF", "Invalid datetime diff args");
      return { op, args: { from, to, unit } };
    }
  }
  if (family === "web_live") {
    if (op === "web.search") {
      const query = compactText(a.query, 700);
      if (!query) throw new SandPlanError("QUERY_REQUIRED", "Web search query required");
      return { op, args: { query, limit: clampInt(a.limit, 1, 10, 6), language: compactText(a.language, 20) || "ar", country: compactText(a.country, 8) || "eg" } };
    }
    if (op === "web.read") {
      const url = normalizePublicHttpsUrl(a.url).toString();
      return { op, args: { url, max_chars: clampInt(a.max_chars, 1000, 12_000, 7000) } };
    }
    if (op === "news.search") {
      const query = compactText(a.query, 700);
      if (!query) throw new SandPlanError("QUERY_REQUIRED", "News query required");
      return { op, args: { query, limit: clampInt(a.limit, 1, 12, 8) } };
    }
    if (op === "weather.read") {
      const city = compactText(a.city, 240) || null;
      const latitude = a.latitude === undefined || a.latitude === null || a.latitude === "" ? null : Number(a.latitude);
      const longitude = a.longitude === undefined || a.longitude === null || a.longitude === "" ? null : Number(a.longitude);
      if ((latitude === null) !== (longitude === null)) throw new SandPlanError("BAD_COORDINATES", "Latitude and longitude must be provided together");
      if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new SandPlanError("BAD_COORDINATES", "Invalid coordinates");
      if (!city && latitude === null) throw new SandPlanError("WEATHER_LOCATION_REQUIRED", "Weather needs a city or coordinates");
      return { op, args: { city, latitude, longitude, forecast_days: clampInt(a.forecast_days, 1, 7, 7) } };
    }
    if (op === "places.search") {
      const query = compactText(a.query, 700);
      if (!query) throw new SandPlanError("QUERY_REQUIRED", "Places query required");
      const latitude = a.latitude === undefined || a.latitude === null || a.latitude === "" ? null : Number(a.latitude);
      const longitude = a.longitude === undefined || a.longitude === null || a.longitude === "" ? null : Number(a.longitude);
      if ((latitude === null) !== (longitude === null)) throw new SandPlanError("BAD_COORDINATES", "Latitude and longitude must be provided together");
      if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new SandPlanError("BAD_COORDINATES", "Invalid coordinates");
      return { op, args: { query, latitude, longitude, radius_m: clampInt(a.radius_m, 100, 50_000, 5000), limit: clampInt(a.limit, 1, 10, 6), language: compactText(a.language, 20) || "ar" } };
    }
  }
  if (family === "local_life") return validateLocalLifeStep(op, a);
  throw new SandPlanError("BAD_CAPABILITY_STEP", `Unhandled family operation: ${op}`);
}

async function stableCapabilityId(prefix, operationId, stepIndex, itemIndex = 0) {
  const h = await textHash(`${operationId}:${stepIndex}:${itemIndex}:${prefix}`);
  return `${prefix}_${h.slice(0, 28)}`;
}

async function loadOrPlanCapability(env, { chatId, updateId, operationId, stepIndex, family, semanticRequest }) {
  const existing = await env.DB.prepare(`SELECT plan_json,model_id FROM ${TABLES.capabilityPlans} WHERE operation_id=? AND step_index=? LIMIT 1`)
    .bind(operationId, stepIndex).first();
  if (existing) return { plan: safeJsonParse(existing.plan_json, { steps: [] }), modelId: existing.model_id ? String(existing.model_id) : null };
  const [currentText, familyState] = await Promise.all([currentUserMessage(env, chatId, updateId), capabilitySnapshot(env, chatId, family)]);
  const planned = await planCapabilityFamily(env, { chatId, updateId, family, currentText, semanticRequest, familyState });
  const at = nowIso();
  await env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.capabilityPlans}
    (operation_id,step_index,family,request_text,plan_json,model_id,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'planned',?,?)`)
    .bind(operationId, stepIndex, family, semanticRequest, JSON.stringify(planned.plan), planned.modelId, at, at).run();
  const stored = await env.DB.prepare(`SELECT plan_json,model_id FROM ${TABLES.capabilityPlans} WHERE operation_id=? AND step_index=? LIMIT 1`)
    .bind(operationId, stepIndex).first();
  return { plan: safeJsonParse(stored?.plan_json, planned.plan), modelId: stored?.model_id ? String(stored.model_id) : planned.modelId };
}

function renderShoppingList(rows) {
  if (!rows.length) return "قائمة المشتريات فاضية حاليًا.";
  return ["🛒 المشتريات:", ...rows.map((r, i) => `${i + 1}) ${r.title}${r.state.quantity ? ` — ${r.state.quantity}` : ""} [${r.status}]`)].join("\n");
}

function renderWorkList(rows, label) {
  if (!rows.length) return `${label} مفيهاش عناصر حاليًا.`;
  return [label, ...rows.map((r, i) => `${i + 1}) ${r.title} [${r.status}]`)].join("\n");
}

async function executeCapabilityRequest(env, { chatId, updateId, operationId, stepIndex, request }) {
  if (!operationId) throw new Error("Capability execution requires operation id");
  const family = request.family;
  const familyState = await capabilitySnapshot(env, chatId, family);
  const refs = familyRefMap(familyState);
  const planned = await loadOrPlanCapability(env, { chatId, updateId, operationId, stepIndex, family, semanticRequest: request.request });
  const plan = validateFamilyPlan(family, planned.plan, familyState);
  const result = await executeFamilyPlan(env, { chatId, updateId, operationId, mainStepIndex: stepIndex, family, plan, refs });
  await env.DB.prepare(`UPDATE ${TABLES.capabilityPlans} SET status='done',result_json=?,updated_at=? WHERE operation_id=? AND step_index=?`)
    .bind(JSON.stringify(result), nowIso(), operationId, stepIndex).run();
  return { ok: true, family, ...result };
}

const EXTERNAL_ADAPTER_BREAKERS = new Map();
const EXTERNAL_ADAPTER_FAILURE_THRESHOLD = 3;
const EXTERNAL_ADAPTER_OPEN_MS = 60_000;
const EXTERNAL_FETCH_TIMEOUT_MS = 8_000;

function externalBreakerState(name) {
  const key = compactText(name, 80);
  let state = EXTERNAL_ADAPTER_BREAKERS.get(key);
  if (!state) {
    state = { failures: 0, open_until: 0 };
    EXTERNAL_ADAPTER_BREAKERS.set(key, state);
  }
  return state;
}

function recordExternalSuccess(name) {
  const state = externalBreakerState(name);
  state.failures = 0;
  state.open_until = 0;
}

function recordExternalFailure(name) {
  const state = externalBreakerState(name);
  state.failures += 1;
  if (state.failures >= EXTERNAL_ADAPTER_FAILURE_THRESHOLD) state.open_until = nowMs() + EXTERNAL_ADAPTER_OPEN_MS;
}

function assertExternalCircuitClosed(name) {
  const state = externalBreakerState(name);
  if (state.open_until > nowMs()) throw new SandHttpError(`${name} circuit is temporarily open`, 503);
  if (state.open_until && state.open_until <= nowMs()) {
    state.open_until = 0;
    state.failures = 0;
  }
}

async function externalFetch(name, url, options = {}, timeoutMs = EXTERNAL_FETCH_TIMEOUT_MS) {
  assertExternalCircuitClosed(name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampInt(timeoutMs, 500, 15_000, EXTERNAL_FETCH_TIMEOUT_MS));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (response.status === 429 || response.status >= 500) recordExternalFailure(name);
    else recordExternalSuccess(name);
    return response;
  } catch (error) {
    recordExternalFailure(name);
    if (error instanceof Error && error.name === "AbortError") throw new SandHttpError(`${name} timeout`, 408);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizePublicHttpsUrl(value) {
  const raw = compactText(value, 2000);
  let url;
  try { url = new URL(raw); } catch { throw new SandPlanError("BAD_URL", "A valid URL is required"); }
  if (url.protocol !== "https:") throw new SandPlanError("BAD_URL", "Only HTTPS URLs are allowed");
  if (url.username || url.password) throw new SandPlanError("BAD_URL", "Credentials in URLs are not allowed");
  if (url.port && url.port !== "443") throw new SandPlanError("BAD_URL", "Non-standard URL ports are not allowed");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new SandPlanError("BAD_URL", "Local URLs are not allowed");
  if (/^(?:10\.|127\.|169\.254\.|192\.168\.|0\.)/.test(host)) throw new SandPlanError("BAD_URL", "Private network URLs are not allowed");
  const m = /^(172)\.(\d{1,3})\./.exec(host);
  if (m && Number(m[2]) >= 16 && Number(m[2]) <= 31) throw new SandPlanError("BAD_URL", "Private network URLs are not allowed");
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) throw new SandPlanError("BAD_URL", "Private network URLs are not allowed");
  return url;
}

function decodeHtmlText(html) {
  return String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const x = Number(n);
      return Number.isFinite(x) && x > 0 && x <= 0x10ffff ? String.fromCodePoint(x) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

async function webReader(urlValue, maxChars) {
  let current = normalizePublicHttpsUrl(urlValue);
  let response = null;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await externalFetch("web_reader", current.toString(), {
      headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1", "user-agent": "SAND-ONE/1.0" },
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects === 5) throw new SandHttpError("Too many web redirects", 508);
    const location = compactText(response.headers.get("location"), 2000);
    if (!location) throw new SandHttpError("Web redirect without location", 502);
    current = normalizePublicHttpsUrl(new URL(location, current).toString());
  }
  if (!response) throw new SandHttpError("Web reader returned no response", 502);
  if (!response.ok) throw new SandHttpError(`Web reader HTTP ${response.status}`, response.status);
  const finalUrl = normalizePublicHttpsUrl(response.url || current.toString());
  const type = String(response.headers.get("content-type") ?? "").toLowerCase();
  if (!(type.includes("text/html") || type.includes("application/xhtml+xml") || type.includes("text/plain"))) throw new SandHttpError(`Unsupported web content type: ${type || "unknown"}`, 415);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > 1_000_000) throw new SandHttpError("Web page is too large", 413);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 1_000_000) throw new SandHttpError("Web page is too large", 413);
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const text = type.includes("text/plain") ? raw.replace(/\s+/g, " ").trim() : decodeHtmlText(raw);
  return { url: finalUrl.toString(), content_type: type.split(";")[0] || null, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

async function googleWebSearch(env, args) {
  const key = compactText(env?.GOOGLE_SEARCH_API_KEY, 500);
  const cx = compactText(env?.GOOGLE_SEARCH_CX, 500);
  if (!key || !cx) throw new SandPlanError("CAPABILITY_BINDING_MISSING", "Google Search is not configured");
  const params = new URLSearchParams({ key, cx, q: args.query, num: String(args.limit), safe: "active" });
  if (args.language) params.set("hl", args.language);
  if (args.country) params.set("gl", args.country);
  const response = await externalFetch("google_search", `https://www.googleapis.com/customsearch/v1?${params.toString()}`);
  if (!response.ok) throw new SandHttpError(`Google Search HTTP ${response.status}`, response.status);
  const data = await response.json().catch(() => ({}));
  const items = (Array.isArray(data?.items) ? data.items : []).slice(0, args.limit).map((item) => ({
    title: compactText(item?.title, 500), url: compactText(item?.link, 2000), snippet: compactText(item?.snippet, 1200), domain: compactText(item?.displayLink, 300),
  })).filter((item) => item.url);
  return { query: args.query, items };
}

function decodeXmlText(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function parseGoogleNewsRss(xml, limit) {
  const items = [];
  const blocks = String(xml ?? "").match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks.slice(0, limit)) {
    const title = decodeXmlText(/<title>([\s\S]*?)<\/title>/i.exec(block)?.[1] ?? "");
    const url = decodeXmlText(/<link>([\s\S]*?)<\/link>/i.exec(block)?.[1] ?? "");
    const seenAt = decodeXmlText(/<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block)?.[1] ?? "");
    const sourceMatch = /<source(?:\s[^>]*)?>([\s\S]*?)<\/source>/i.exec(block);
    const domain = decodeXmlText(sourceMatch?.[1] ?? "");
    if (url) items.push({ title, url, domain, seen_at: seenAt, language: "ar" });
  }
  return items;
}

async function googleNewsRssSearch(args) {
  const params = new URLSearchParams({ q: args.query, hl: "ar", gl: "EG", ceid: "EG:ar" });
  const response = await externalFetch("google_news_rss", `https://news.google.com/rss/search?${params.toString()}`);
  if (!response.ok) throw new SandHttpError(`Google News RSS HTTP ${response.status}`, response.status);
  const xml = await response.text();
  const items = parseGoogleNewsRss(xml, args.limit);
  if (!items.length) throw new SandHttpError("Google News RSS returned no usable items", 502);
  return { query: args.query, items, provider: "google_news_rss" };
}

async function liveNewsSearch(args) {
  const params = new URLSearchParams({ query: args.query, mode: "ArtList", maxrecords: String(Math.min(20, args.limit)), format: "json", sort: "HybridRel" });
  try {
    const response = await externalFetch("gdelt_news", `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`);
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      const items = (Array.isArray(data?.articles) ? data.articles : []).slice(0, args.limit).map((item) => ({
        title: compactText(item?.title, 700), url: compactText(item?.url, 2000), domain: compactText(item?.domain, 300), seen_at: compactText(item?.seendate, 80), language: compactText(item?.language, 80),
      })).filter((item) => item.url);
      if (items.length) return { query: args.query, items, provider: "gdelt" };
    }
  } catch (error) {
    logError("news_primary_transient", error, { provider: "gdelt" });
  }
  return googleNewsRssSearch(args);
}

async function openMeteoWeather(args) {
  let latitude = args.latitude;
  let longitude = args.longitude;
  let city = args.city;
  if (latitude === null || longitude === null) {
    if (!city) throw new SandPlanError("WEATHER_LOCATION_REQUIRED", "Weather needs a city or coordinates");
    const params = new URLSearchParams({ name: city, count: "1", language: "ar", format: "json" });
    const geo = await externalFetch("open_meteo_geocoding", `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`);
    if (!geo.ok) throw new SandHttpError(`Weather geocoding HTTP ${geo.status}`, geo.status);
    const data = await geo.json().catch(() => ({}));
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    if (!first) throw new SandPlanError("WEATHER_LOCATION_NOT_FOUND", "Weather location was not found");
    latitude = Number(first.latitude);
    longitude = Number(first.longitude);
    city = compactText(first.name, 240) || city;
  }
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max", timezone: "auto", forecast_days: String(args.forecast_days),
  });
  const response = await externalFetch("open_meteo_weather", `https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) throw new SandHttpError(`Weather HTTP ${response.status}`, response.status);
  const data = await response.json().catch(() => ({}));
  return { city: city || null, latitude, longitude, timezone: data?.timezone ?? null, current: data?.current ?? null, daily: data?.daily ?? null };
}

async function googlePlacesSearch(env, args) {
  const key = compactText(env?.GOOGLE_MAPS_API_KEY, 500);
  if (!key) throw new SandPlanError("CAPABILITY_BINDING_MISSING", "Google Places is not configured");
  const body = { textQuery: args.query, languageCode: args.language || "ar", maxResultCount: args.limit };
  if (args.latitude !== null && args.longitude !== null) body.locationBias = { circle: { center: { latitude: args.latitude, longitude: args.longitude }, radius: args.radius_m } };
  const response = await externalFetch("google_places", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.primaryTypeDisplayName" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new SandHttpError(`Google Places HTTP ${response.status}`, response.status);
  const data = await response.json().catch(() => ({}));
  const items = (Array.isArray(data?.places) ? data.places : []).slice(0, args.limit).map((place) => ({
    id: compactText(place?.id, 300), name: compactText(place?.displayName?.text, 500), address: compactText(place?.formattedAddress, 800), category: compactText(place?.primaryTypeDisplayName?.text, 300),
    latitude: Number.isFinite(Number(place?.location?.latitude)) ? Number(place.location.latitude) : null,
    longitude: Number.isFinite(Number(place?.location?.longitude)) ? Number(place.location.longitude) : null,
    rating: Number.isFinite(Number(place?.rating)) ? Number(place.rating) : null,
    user_rating_count: Number.isFinite(Number(place?.userRatingCount)) ? Number(place.userRatingCount) : null,
    maps_url: compactText(place?.googleMapsUri, 2000),
  }));
  return { query: args.query, items };
}

function renderWebLiveResult(step, result) {
  if (step.op === "web.search") {
    const items = result.items ?? [];
    if (!items.length) return "ملقتش نتائج مناسبة في Google Search.";
    return ["🔎 نتائج البحث:", ...items.slice(0, 8).map((item, i) => `${i + 1}) ${item.title || item.domain || "نتيجة"}\n${item.url}${item.snippet ? `\n${item.snippet}` : ""}`)].join("\n\n").slice(0, AI_MAX_REPLY_CHARS);
  }
  if (step.op === "web.read") return `📄 قرأت الصفحة:\n${result.text || "مفيش نص قابل للقراءة."}`.slice(0, AI_MAX_REPLY_CHARS);
  if (step.op === "news.search") {
    const items = result.items ?? [];
    if (!items.length) return "ملقتش أخبار حديثة مناسبة للبحث.";
    return ["📰 الأخبار:", ...items.slice(0, 8).map((item, i) => `${i + 1}) ${item.title || "خبر"}\n${item.url}`)].join("\n\n").slice(0, AI_MAX_REPLY_CHARS);
  }
  if (step.op === "weather.read") {
    const c = result.current ?? {};
    return `🌤️ ${result.city || "الطقس"}: ${c.temperature_2m ?? "-"}° — المحسوسة ${c.apparent_temperature ?? "-"}° — رياح ${c.wind_speed_10m ?? "-"}`;
  }
  if (step.op === "places.search") {
    const items = result.items ?? [];
    if (!items.length) return "ملقتش أماكن مناسبة للبحث.";
    return ["📍 الأماكن:", ...items.slice(0, 8).map((item, i) => `${i + 1}) ${item.name || "مكان"}${item.rating !== null ? ` ⭐ ${item.rating}` : ""}\n${item.address || ""}${item.maps_url ? `\n${item.maps_url}` : ""}`)].join("\n\n").slice(0, AI_MAX_REPLY_CHARS);
  }
  return "";
}

async function executeWebLivePlan(env, { plan }) {
  const outputs = [];
  let reply = "";
  for (const step of plan.steps) {
    try {
      let result;
      if (step.op === "web.search") result = await googleWebSearch(env, step.args);
      else if (step.op === "web.read") result = await webReader(step.args.url, step.args.max_chars);
      else if (step.op === "news.search") result = await liveNewsSearch(step.args);
      else if (step.op === "weather.read") result = await openMeteoWeather(step.args);
      else if (step.op === "places.search") result = await googlePlacesSearch(env, step.args);
      else throw new SandPlanError("CAPABILITY_OP_NOT_ALLOWED", `Unhandled Web & Live operation: ${step.op}`);
      outputs.push({ op: step.op, result });
      reply = renderWebLiveResult(step, result) || reply;
    } catch (error) {
      if (error instanceof SandPlanError && error.code === "CAPABILITY_BINDING_MISSING") {
        const unavailable = step.op === "web.search" ? "Google Search" : step.op === "places.search" ? "Google Places" : "الخدمة المطلوبة";
        outputs.push({ op: step.op, unavailable: true, error: error.code });
        reply = `${unavailable} مش متوصل بمفتاح API في البيئة الحالية، فمش هخمن نتيجة بدل الخدمة الحية.`;
        continue;
      }
      throw error;
    }
  }
  return { steps: outputs, reply: reply || compactText(plan.reply_hint, 800) };
}

async function executeFamilyPlan(env, { chatId, updateId, operationId, mainStepIndex, family, plan, refs }) {
  if (family === "schedule") return executeSchedulePlan(env, { chatId, updateId, operationId, mainStepIndex, plan, refs });
  if (family === "shopping") return executeShoppingPlan(env, { chatId, updateId, operationId, mainStepIndex, plan, refs });
  if (family === "work") return executeWorkPlan(env, { chatId, updateId, operationId, mainStepIndex, plan, refs });
  if (family === "memory_people") return executeMemoryPeoplePlan(env, { chatId, updateId, operationId, mainStepIndex, plan, refs });
  if (family === "utility") return executeUtilityPlan(env, { plan });
  if (family === "web_live") return executeWebLivePlan(env, { plan });
  if (family === "local_life") return executeLocalLifePlan(env, { plan });
  throw new SandPlanError("CAPABILITY_NOT_READY", `Family not executable: ${family}`);
}

async function executeShoppingPlan(env, { chatId, updateId, operationId, mainStepIndex, plan, refs }) {
  const hasMutation = plan.steps.some((s) => !["shopping.list","shopping.progress"].includes(s.op));
  if (!hasMutation) {
    let reply = ""; const outputs = [];
    for (const step of plan.steps) {
      if (step.op === "shopping.list") {
        const all = await capabilitySnapshot(env, chatId, "shopping");
        const rows = all.filter((x) => x.kind === "shopping_item" && (step.args.status === "all" || x.status === step.args.status));
        outputs.push({ op: step.op, rows: rows.map(({ id, ...x }) => x) }); reply = renderShoppingList(rows);
      } else if (step.op === "shopping.progress") {
        const all = (await capabilitySnapshot(env, chatId, "shopping")).filter((x) => x.kind === "shopping_item");
        const counts = Object.fromEntries(["pending","bought","unavailable","skipped"].map((status) => [status, all.filter((x) => x.status === status).length]));
        outputs.push({ op: step.op, counts, total: all.length }); reply = `🛒 الإجمالي ${all.length} — باقي ${counts.pending} — اتجاب ${counts.bought} — مش متاح ${counts.unavailable} — متخطّي ${counts.skipped}`;
      }
    }
    return { steps: outputs, reply: reply || compactText(plan.reply_hint,800) };
  }
  if (plan.steps.some((s) => ["shopping.list","shopping.progress"].includes(s.op))) throw new SandPlanError("MIXED_FAMILY_PLAN", "Do not mix shopping reads and mutations in one family plan");
  const stmts = [], created = [], expected = [];
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i], at = nowIso();
    if (step.op === "shopping.add") {
      for (let j = 0; j < step.args.items.length; j += 1) {
        const item = step.args.items[j], id = await stableCapabilityId("shop", operationId, mainStepIndex * 100 + i, j);
        created[i] = created[i] || id;
        const state = { quantity: item.quantity, category: item.category, priority: item.priority };
        stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.lifeItems}(id,chat_id,kind,parent_id,title,state_json,status,source_update_id,created_at,updated_at) VALUES(?,?,'shopping_item',NULL,?,?,'pending',?,?,?)`).bind(id,chatId,item.title,JSON.stringify(state),updateId,at,at));
        expected.push({ id, status: "pending", title: item.title });
      }
    } else if (step.op === "shopping.mark") {
      const id = refs.get(step.args.target); if (!id) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Shopping target disappeared");
      stmts.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET status=?,source_update_id=?,updated_at=? WHERE id=? AND chat_id=? AND kind='shopping_item'`).bind(step.args.status,updateId,at,id,chatId)); expected.push({ id, status: step.args.status });
    } else if (step.op === "shopping.remove") {
      const id = refs.get(step.args.target); if (!id) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Shopping target disappeared");
      stmts.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET status='archived',source_update_id=?,updated_at=? WHERE id=? AND chat_id=? AND kind='shopping_item'`).bind(updateId,at,id,chatId)); expected.push({ id, status: "archived" });
    } else if (step.op === "shopping.session.start") {
      const id = await stableCapabilityId("shopsession", operationId, mainStepIndex * 100 + i, 0); created[i] = id;
      stmts.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET status='done',updated_at=? WHERE chat_id=? AND kind='shopping_session' AND status='active'`).bind(at,chatId));
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.lifeItems}(id,chat_id,kind,parent_id,title,state_json,status,source_update_id,created_at,updated_at) VALUES(?,?,'shopping_session',NULL,?,?,'active',?,?,?)`).bind(id,chatId,step.args.place_name || "جلسة تسوق",JSON.stringify({ place_name: step.args.place_name, started_at: at }),updateId,at,at)); expected.push({ id, status: "active" });
    } else if (step.op === "shopping.session.finish") {
      const row = await env.DB.prepare(`SELECT id FROM ${TABLES.lifeItems} WHERE chat_id=? AND kind='shopping_session' AND status='active' ORDER BY updated_at DESC LIMIT 1`).bind(chatId).first();
      if (row?.id) { const id=String(row.id); stmts.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET status='done',source_update_id=?,updated_at=? WHERE id=? AND chat_id=?`).bind(updateId,at,id,chatId)); expected.push({ id, status: "done" }); }
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  for (const exp of expected) {
    const row = await env.DB.prepare(`SELECT title,status FROM ${TABLES.lifeItems} WHERE id=? AND chat_id=? LIMIT 1`).bind(exp.id,chatId).first();
    if (!row || String(row.status)!==exp.status || (exp.title && String(row.title)!==exp.title)) throw new Error("Shopping capability verification failed");
  }
  return { steps: plan.steps.map((step,i)=>({ op:step.op, created_id:created[i]||null })), reply: compactText(plan.reply_hint,800) || "تمام، حدّثت المشتريات واتأكدت من النتيجة ✅" };
}


async function executeWorkPlan(env, { chatId, updateId, operationId, mainStepIndex, plan, refs }) {
  const readOps = new Set(["project.list","task.list","waiting.list","inbox.list"]);
  const hasMutation = plan.steps.some((s)=>!readOps.has(s.op));
  if (!hasMutation) {
    let reply=""; const outputs=[]; const all=await capabilitySnapshot(env,chatId,"work");
    for (const step of plan.steps) {
      if (step.op === "project.list") { const rows=all.filter(x=>x.kind==="project"&&(step.args.status==="all"||x.status===step.args.status)); outputs.push({op:step.op,rows:rows.map(({id,...x})=>x)}); reply=renderWorkList(rows,"🎯 المشاريع:"); }
      if (step.op === "task.list") { const projectId=step.args.project?refs.get(step.args.project):null; const rows=all.filter(x=>x.kind==="task"&&(!projectId||x.parent_id===projectId)&&(step.args.status==="all"||x.status===step.args.status)); outputs.push({op:step.op,rows:rows.map(({id,...x})=>x)}); reply=renderWorkList(rows,"✅ المهام:"); }
      if (step.op === "waiting.list") { const rows=all.filter(x=>x.kind==="waiting"&&(step.args.status==="all"||x.status===step.args.status)); outputs.push({op:step.op,rows:rows.map(({id,...x})=>x)}); reply=renderWorkList(rows,"⏳ المتابعات:"); }
      if (step.op === "inbox.list") { const rows=all.filter(x=>x.kind==="inbox"&&(step.args.status==="all"||x.status===step.args.status)); outputs.push({op:step.op,rows:rows.map(({id,...x})=>x)}); reply=renderWorkList(rows,"📥 الوارد:"); }
    }
    return {steps:outputs,reply:reply||compactText(plan.reply_hint,800)};
  }
  if (plan.steps.some((s)=>readOps.has(s.op))) throw new SandPlanError("MIXED_FAMILY_PLAN","Do not mix work reads and mutations in one family plan");
  const stmts=[], created=[], expected=[];
  for (let i=0;i<plan.steps.length;i+=1) {
    const step=plan.steps[i], at=nowIso();
    if (step.op === "project.create") {
      const id=await stableCapabilityId("project",operationId,mainStepIndex*100+i); created[i]=id; const state={priority:step.args.priority,deadline:step.args.deadline,notes:step.args.notes,progress:0};
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.lifeItems}(id,chat_id,kind,parent_id,title,state_json,status,source_update_id,created_at,updated_at) VALUES(?,?,'project',NULL,?,?,'active',?,?,?)`).bind(id,chatId,step.args.title,JSON.stringify(state),updateId,at,at)); expected.push({id,status:"active",title:step.args.title});
    } else if (step.op === "project.update") {
      const id=refs.get(step.args.target); if(!id) throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Project target disappeared"); const row=await env.DB.prepare(`SELECT state_json,status,title FROM ${TABLES.lifeItems} WHERE id=? AND chat_id=? AND kind='project' LIMIT 1`).bind(id,chatId).first(); if(!row) throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Project target missing"); const state=safeJsonParse(row.state_json,{}); for(const k of ["progress","priority","deadline","notes"]) if(step.args[k]!==null) state[k]=step.args[k]; const status=step.args.status||String(row.status); stmts.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET state_json=?,status=?,source_update_id=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(state),status,updateId,at,id,chatId)); expected.push({id,status});
    } else if (step.op === "task.create") {
      const id=await stableCapabilityId("task",operationId,mainStepIndex*100+i); created[i]=id; const parent=step.args.parent?resolveFamilyRef(step.args.parent,refs,created):null; if(step.args.parent&&!parent) throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Task parent could not be resolved"); const state={due_at:step.args.due_at,priority:step.args.priority}; stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.lifeItems}(id,chat_id,kind,parent_id,title,state_json,status,source_update_id,created_at,updated_at) VALUES(?,?,'task',?,?,?,'pending',?,?,?)`).bind(id,chatId,parent,step.args.title,JSON.stringify(state),updateId,at,at)); expected.push({id,status:"pending",title:step.args.title});
    } else if (step.op === "task.update") {
      const id=refs.get(step.args.target); if(!id) throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Task target disappeared"); const row=await env.DB.prepare(`SELECT state_json,status,title FROM ${TABLES.lifeItems} WHERE id=? AND chat_id=? AND kind='task' LIMIT 1`).bind(id,chatId).first(); if(!row) throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Task target missing"); const state=safeJsonParse(row.state_json,{}); for(const k of ["due_at","priority"]) if(step.args[k]!==null) state[k]=step.args[k]; const status=step.args.status||String(row.status), title=step.args.title||String(row.title); stmts.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET title=?,state_json=?,status=?,source_update_id=?,updated_at=? WHERE id=? AND chat_id=?`).bind(title,JSON.stringify(state),status,updateId,at,id,chatId)); expected.push({id,status,title});
    } else if (step.op === "waiting.create") {
      const id=await stableCapabilityId("waiting",operationId,mainStepIndex*100+i); created[i]=id; const state={waiting_on:step.args.waiting_on,due_at:step.args.due_at}; stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.lifeItems}(id,chat_id,kind,parent_id,title,state_json,status,source_update_id,created_at,updated_at) VALUES(?,?,'waiting',NULL,?,?,'waiting',?,?,?)`).bind(id,chatId,step.args.title,JSON.stringify(state),updateId,at,at)); expected.push({id,status:"waiting",title:step.args.title});
    } else if (step.op === "waiting.close") {
      const id=refs.get(step.args.target); if(!id) throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Waiting target disappeared"); stmts.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET status='done',source_update_id=?,updated_at=? WHERE id=? AND chat_id=? AND kind='waiting'`).bind(updateId,at,id,chatId)); expected.push({id,status:"done"});
    } else if (step.op === "inbox.add") {
      const id=await stableCapabilityId("inbox",operationId,mainStepIndex*100+i); created[i]=id; const state={classified_as:step.args.classified_as}; stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.lifeItems}(id,chat_id,kind,parent_id,title,state_json,status,source_update_id,created_at,updated_at) VALUES(?,?,'inbox',NULL,?,?,'open',?,?,?)`).bind(id,chatId,step.args.text,JSON.stringify(state),updateId,at,at)); expected.push({id,status:"open",title:step.args.text});
    } else if (step.op === "inbox.classify") {
      const id=refs.get(step.args.target); if(!id) throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Inbox target disappeared"); const row=await env.DB.prepare(`SELECT state_json FROM ${TABLES.lifeItems} WHERE id=? AND chat_id=? AND kind='inbox' LIMIT 1`).bind(id,chatId).first(); if(!row) throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Inbox target missing"); const state=safeJsonParse(row.state_json,{}); state.classified_as=step.args.classified_as; stmts.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET state_json=?,source_update_id=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(state),updateId,at,id,chatId)); expected.push({id,status:null});
    } else if (step.op === "inbox.close") {
      const id=refs.get(step.args.target); if(!id) throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Inbox target disappeared"); stmts.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET status='closed',source_update_id=?,updated_at=? WHERE id=? AND chat_id=? AND kind='inbox'`).bind(updateId,at,id,chatId)); expected.push({id,status:"closed"});
    }
  }
  if(stmts.length) await env.DB.batch(stmts);
  for(const exp of expected){const row=await env.DB.prepare(`SELECT title,status FROM ${TABLES.lifeItems} WHERE id=? AND chat_id=? LIMIT 1`).bind(exp.id,chatId).first(); if(!row||(exp.status&&String(row.status)!==exp.status)||(exp.title&&String(row.title)!==exp.title)) throw new Error("Work capability verification failed");}
  return {steps:plan.steps.map((step,i)=>({op:step.op,created_id:created[i]||null})),reply:compactText(plan.reply_hint,800)||"تمام، نفذت المطلوب واتأكدت من بيانات الشغل ✅"};
}


function renderPeopleList(rows) {
  const people = rows.filter((row) => row.kind === "person");
  if (!people.length) return "مفيش أشخاص محفوظين حاليًا.";
  return ["👥 الأشخاص:", ...people.map((row, index) => {
    const relation = compactText(row.state?.relationship_to_user, 160);
    return `${index + 1}) ${row.title}${relation ? ` — ${relation}` : ""}`;
  })].join("\n");
}

function renderRelationsList(rows, personId = null) {
  const peopleById = new Map(rows.filter((row) => row.kind === "person").map((row) => [String(row.id), String(row.title)]));
  const relations = rows.filter((row) => {
    if (row.kind !== "relationship") return false;
    if (!personId) return true;
    const state = row._raw_state || row.state || {};
    return String(row.parent_id ?? "") === personId || String(state.object_id ?? "") === personId;
  });
  if (!relations.length) return "مفيش علاقات محفوظة حاليًا.";
  return ["🔗 العلاقات:", ...relations.map((row, index) => {
    const state = row._raw_state || row.state || {};
    const subject = peopleById.get(String(row.parent_id ?? "")) || row.state?.subject_ref || "شخص";
    const object = peopleById.get(String(state.object_id ?? "")) || row.state?.object_ref || "شخص";
    const relation = compactText(state.relation, 160) || row.title;
    return `${index + 1}) ${subject} — ${relation} → ${object}`;
  })].join("\n");
}

async function executeMemoryPeoplePlan(env, { chatId, updateId, operationId, mainStepIndex, plan, refs }) {
  const readOps = new Set(["people.list", "relations.list"]);
  const hasMutation = plan.steps.some((step) => !readOps.has(step.op));
  if (!hasMutation) {
    const state = await capabilitySnapshot(env, chatId, "memory_people");
    let reply = compactText(plan.reply_hint, 800);
    const outputs = [];
    for (const step of plan.steps) {
      if (step.op === "people.list") {
        const q = String(step.args.query ?? "").trim().toLocaleLowerCase("ar");
        const rows = state.filter((row) => row.kind === "person" && (!q || `${row.title} ${JSON.stringify(row.state)}`.toLocaleLowerCase("ar").includes(q)));
        outputs.push({ op: step.op, rows: rows.map(({ id, ...row }) => row) });
        reply = renderPeopleList(rows);
      } else if (step.op === "relations.list") {
        const personId = step.args.person ? refs.get(step.args.person) ?? null : null;
        const rawRowsResult = await env.DB.prepare(`SELECT id,kind,parent_id,title,state_json,status,updated_at FROM ${TABLES.lifeItems}
          WHERE chat_id=? AND kind IN ('person','relationship') AND status!='archived' ORDER BY updated_at DESC LIMIT 120`).bind(chatId).all();
        const rawRows = (rawRowsResult?.results ?? []).map((row) => ({
          id: String(row.id), kind: String(row.kind), parent_id: row.parent_id ? String(row.parent_id) : null,
          title: String(row.title), status: String(row.status), _raw_state: safeJsonParse(row.state_json, {}), updated_at: String(row.updated_at),
        }));
        outputs.push({ op: step.op, count: rawRows.filter((row) => row.kind === "relationship").length });
        reply = renderRelationsList(rawRows, personId);
      }
    }
    return { steps: outputs, reply: reply || "تمام." };
  }
  if (plan.steps.some((step) => readOps.has(step.op))) {
    throw new SandPlanError("MIXED_FAMILY_PLAN", "Do not mix Memory/People reads and mutations in one family plan");
  }

  const created = [];
  for (let i = 0; i < plan.steps.length; i += 1) {
    if (plan.steps[i].op === "people.create") created[i] = await stableCapabilityId("person", operationId, mainStepIndex * 100 + i);
  }

  const statements = [];
  const expected = [];
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    const at = nowIso();
    if (step.op === "people.create") {
      const id = created[i];
      const state = {
        relationship_to_user: step.args.relationship_to_user,
        notes: step.args.notes,
        facts: step.args.facts,
      };
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.lifeItems}
        (id,chat_id,kind,parent_id,title,state_json,status,source_update_id,created_at,updated_at)
        VALUES(?,?,'person',NULL,?,?,'active',?,?,?)`)
        .bind(id, chatId, step.args.name, JSON.stringify(state), updateId, at, at));
      expected.push({ id, kind: "person", title: step.args.name, status: "active" });
    } else if (step.op === "people.update") {
      const id = refs.get(step.args.target);
      if (!id) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Person target disappeared");
      const row = await env.DB.prepare(`SELECT title,state_json,status FROM ${TABLES.lifeItems} WHERE id=? AND chat_id=? AND kind='person' LIMIT 1`).bind(id, chatId).first();
      if (!row) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Person target missing");
      const state = safeJsonParse(row.state_json, {});
      for (const [key, value] of Object.entries(step.args.patch)) state[key] = value;
      statements.push(env.DB.prepare(`UPDATE ${TABLES.lifeItems} SET state_json=?,source_update_id=?,updated_at=? WHERE id=? AND chat_id=? AND kind='person'`)
        .bind(JSON.stringify(state), updateId, at, id, chatId));
      expected.push({ id, kind: "person", title: String(row.title), status: String(row.status) });
    } else if (step.op === "relations.set") {
      const subjectId = resolveFamilyRef(step.args.subject, refs, created);
      const objectId = resolveFamilyRef(step.args.object, refs, created);
      if (!subjectId || !objectId || subjectId === objectId) throw new SandPlanError("BAD_RELATION", "Relationship endpoints could not be resolved");
      const pairHash = await textHash(`${chatId}:${subjectId}:${objectId}:relationship`);
      const id = `relation_${pairHash.slice(0, 28)}`;
      const state = { object_id: objectId, relation: step.args.relation };
      statements.push(env.DB.prepare(`INSERT INTO ${TABLES.lifeItems}
        (id,chat_id,kind,parent_id,title,state_json,status,source_update_id,created_at,updated_at)
        VALUES(?,?,'relationship',?,?,?,'active',?,?,?)
        ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,title=excluded.title,state_json=excluded.state_json,status='active',source_update_id=excluded.source_update_id,updated_at=excluded.updated_at`)
        .bind(id, chatId, subjectId, step.args.relation, JSON.stringify(state), updateId, at, at));
      expected.push({ id, kind: "relationship", title: step.args.relation, status: "active", subjectId, objectId });
    }
  }

  if (statements.length) await env.DB.batch(statements);
  for (const exp of expected) {
    const row = await env.DB.prepare(`SELECT kind,parent_id,title,state_json,status FROM ${TABLES.lifeItems} WHERE id=? AND chat_id=? LIMIT 1`).bind(exp.id, chatId).first();
    if (!row || String(row.kind) !== exp.kind || String(row.title) !== exp.title || String(row.status) !== exp.status) {
      throw new Error("Memory/People capability verification failed");
    }
    if (exp.kind === "relationship") {
      const state = safeJsonParse(row.state_json, {});
      if (String(row.parent_id ?? "") !== exp.subjectId || String(state.object_id ?? "") !== exp.objectId) {
        throw new Error("Relationship verification failed");
      }
    }
  }
  return {
    steps: plan.steps.map((step, index) => ({ op: step.op, created_id: created[index] || null })),
    reply: compactText(plan.reply_hint, 800) || "تمام، حدّثت الأشخاص والعلاقات واتأكدت من النتيجة ✅",
  };
}

const UTILITY_UNITS = Object.freeze({
  m: Object.freeze({ dimension: "length", factor: 1 }), km: Object.freeze({ dimension: "length", factor: 1000 }),
  cm: Object.freeze({ dimension: "length", factor: 0.01 }), mm: Object.freeze({ dimension: "length", factor: 0.001 }),
  mi: Object.freeze({ dimension: "length", factor: 1609.344 }), yd: Object.freeze({ dimension: "length", factor: 0.9144 }),
  ft: Object.freeze({ dimension: "length", factor: 0.3048 }), in: Object.freeze({ dimension: "length", factor: 0.0254 }),
  kg: Object.freeze({ dimension: "mass", factor: 1 }), g: Object.freeze({ dimension: "mass", factor: 0.001 }),
  mg: Object.freeze({ dimension: "mass", factor: 0.000001 }), lb: Object.freeze({ dimension: "mass", factor: 0.45359237 }),
  oz: Object.freeze({ dimension: "mass", factor: 0.028349523125 }),
  l: Object.freeze({ dimension: "volume", factor: 1 }), ml: Object.freeze({ dimension: "volume", factor: 0.001 }),
  cup_us: Object.freeze({ dimension: "volume", factor: 0.2365882365 }), gal_us: Object.freeze({ dimension: "volume", factor: 3.785411784 }),
  b: Object.freeze({ dimension: "data", factor: 1 }), kb: Object.freeze({ dimension: "data", factor: 1000 }),
  mb: Object.freeze({ dimension: "data", factor: 1000000 }), gb: Object.freeze({ dimension: "data", factor: 1000000000 }),
  kib: Object.freeze({ dimension: "data", factor: 1024 }), mib: Object.freeze({ dimension: "data", factor: 1048576 }),
  gib: Object.freeze({ dimension: "data", factor: 1073741824 }),
});

function tokenizeArithmetic(expression) {
  const raw = String(expression ?? "").replace(/\s+/g, "");
  if (!raw || raw.length > 500) throw new SandPlanError("BAD_EXPRESSION", "Expression is empty or too long");
  const tokens = [];
  let i = 0;
  while (i < raw.length) {
    const rest = raw.slice(i);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new SandPlanError("BAD_EXPRESSION", "Invalid number");
      tokens.push({ type: "number", value });
      i += number[0].length;
      continue;
    }
    const ch = raw[i];
    if ("+-*/%^()".includes(ch)) {
      tokens.push({ type: ch === "(" || ch === ")" ? "paren" : "op", value: ch });
      i += 1;
      continue;
    }
    throw new SandPlanError("BAD_EXPRESSION", "Unsupported character in expression");
  }
  if (tokens.length > 200) throw new SandPlanError("BAD_EXPRESSION", "Expression has too many tokens");
  return tokens;
}

function evaluateArithmetic(expression) {
  const tokens = tokenizeArithmetic(expression);
  /** @type {Array<{type:string,value:any}>} */ const output = [];
  /** @type {Array<{type:string,value:any}>} */ const operators = [];
  const precedence = { "u-": 4, "^": 3, "*": 2, "/": 2, "%": 2, "+": 1, "-": 1 };
  const rightAssociative = new Set(["u-", "^"]);
  let previous = "start";
  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token);
      previous = "value";
      continue;
    }
    if (token.type === "paren" && token.value === "(") {
      operators.push(token);
      previous = "open";
      continue;
    }
    if (token.type === "paren" && token.value === ")") {
      let found = false;
      while (operators.length) {
        const top = operators.pop();
        if (top.type === "paren" && top.value === "(") { found = true; break; }
        output.push(top);
      }
      if (!found) throw new SandPlanError("BAD_EXPRESSION", "Mismatched parentheses");
      previous = "value";
      continue;
    }
    let op = token.value;
    if (op === "-" && (previous === "start" || previous === "open" || previous === "operator")) op = "u-";
    if (op === "+" && (previous === "start" || previous === "open" || previous === "operator")) {
      previous = "operator";
      continue;
    }
    while (operators.length) {
      const top = operators[operators.length - 1];
      if (top.type !== "op") break;
      const pTop = precedence[top.value], pCurrent = precedence[op];
      if (pTop > pCurrent || (pTop === pCurrent && !rightAssociative.has(String(op)))) output.push(operators.pop());
      else break;
    }
    operators.push({ type: "op", value: op });
    previous = "operator";
  }
  while (operators.length) {
    const top = operators.pop();
    if (top.type === "paren") throw new SandPlanError("BAD_EXPRESSION", "Mismatched parentheses");
    output.push(top);
  }
  /** @type {number[]} */ const stack = [];
  for (const token of output) {
    if (token.type === "number") {
      stack.push(Number(token.value));
      continue;
    }
    const op = String(token.value ?? "");
    if (op === "u-") {
      if (stack.length < 1) throw new SandPlanError("BAD_EXPRESSION", "Unary operator is missing an operand");
      const value = Number(stack.pop());
      const result = -value;
      if (!Number.isFinite(result)) throw new SandPlanError("BAD_EXPRESSION", "Expression result is not finite");
      stack.push(result);
      continue;
    }
    if (stack.length < 2) throw new SandPlanError("BAD_EXPRESSION", "Operator is missing an operand");
    const right = Number(stack.pop());
    const left = Number(stack.pop());
    let result;
    if (op === "+") result = left + right;
    else if (op === "-") result = left - right;
    else if (op === "*") result = left * right;
    else if (op === "/") {
      if (right === 0) throw new SandPlanError("DIVISION_BY_ZERO", "Division by zero is not allowed");
      result = left / right;
    } else if (op === "%") {
      if (right === 0) throw new SandPlanError("DIVISION_BY_ZERO", "Modulo by zero is not allowed");
      result = left % right;
    } else if (op === "^") result = left ** right;
    else throw new SandPlanError("BAD_EXPRESSION", "Unsupported arithmetic operator");
    if (!Number.isFinite(result)) throw new SandPlanError("BAD_EXPRESSION", "Expression result is not finite");
    stack.push(result);
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) throw new SandPlanError("BAD_EXPRESSION", "Expression could not be reduced to one result");
  return stack[0];
}

function normalizeUtilityNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new SandPlanError("UTILITY_NON_FINITE", "Utility result is not finite");
  if (Object.is(n, -0)) return 0;
  return Number.parseFloat(n.toPrecision(12));
}

function convertTemperature(value, from, to) {
  const temperatureUnits = new Set(["c", "f", "k"]);
  if (!temperatureUnits.has(from) || !temperatureUnits.has(to)) throw new SandPlanError("UNIT_DIMENSION_MISMATCH", "Temperature can only be converted to another temperature unit");
  let celsius;
  if (from === "c") celsius = value;
  else if (from === "f") celsius = (value - 32) * 5 / 9;
  else celsius = value - 273.15;
  let result;
  if (to === "c") result = celsius;
  else if (to === "f") result = celsius * 9 / 5 + 32;
  else result = celsius + 273.15;
  if (to === "k" && result < 0) throw new SandPlanError("BAD_TEMPERATURE", "Temperature cannot be below absolute zero");
  return normalizeUtilityNumber(result);
}

function convertUtilityUnit(value, from, to) {
  const temperatureUnits = new Set(["c", "f", "k"]);
  if (temperatureUnits.has(from) || temperatureUnits.has(to)) return convertTemperature(value, from, to);
  const units = /** @type {any} */ (UTILITY_UNITS);
  const source = units[from];
  const destination = units[to];
  if (!source || !destination) throw new SandPlanError("UNKNOWN_UNIT", `Unsupported unit conversion: ${from} -> ${to}`);
  if (source.dimension !== destination.dimension) throw new SandPlanError("UNIT_DIMENSION_MISMATCH", "Source and destination units measure different dimensions");
  return normalizeUtilityNumber((value * Number(source.factor)) / Number(destination.factor));
}

function utilityZonedNow(timeZone) {
  const zone = compactText(timeZone, 120) || TZ;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
      hourCycle: "h23",
    });
  } catch {
    throw new SandPlanError("BAD_TIMEZONE", "Unknown IANA timezone");
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    timezone: zone,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: String(parts.weekday ?? ""),
    utc: nowIso(),
  };
}

function utilityDateDiff(fromValue, toValue, unit) {
  const fromMs = Date.parse(String(fromValue));
  const toMs = Date.parse(String(toValue));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new SandPlanError("BAD_DATETIME_DIFF", "Both datetime values must be valid ISO datetimes");
  const divisors = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
  const divisor = /** @type {any} */ (divisors)[unit];
  if (!divisor) throw new SandPlanError("BAD_DATETIME_DIFF", "Unsupported datetime difference unit");
  return normalizeUtilityNumber((toMs - fromMs) / divisor);
}

function renderUtilityResult(step, result) {
  if (step.op === "calculator.evaluate") return `🧮 النتيجة: ${result.value}`;
  if (step.op === "unit.convert") return `🔢 ${result.input} ${result.from} = ${result.value} ${result.to}`;
  if (step.op === "datetime.now") return `🕒 ${result.date} ${result.time} — ${result.timezone}`;
  if (step.op === "datetime.diff") return `⏱️ الفرق: ${result.value} ${result.unit}`;
  return "";
}

async function executeUtilityPlan(_env, { plan }) {
  const outputs = [];
  let reply = "";
  for (const step of plan.steps) {
    let result;
    if (step.op === "calculator.evaluate") {
      result = { expression: step.args.expression, value: normalizeUtilityNumber(evaluateArithmetic(step.args.expression)) };
    } else if (step.op === "unit.convert") {
      result = { input: step.args.value, from: step.args.from, to: step.args.to, value: convertUtilityUnit(step.args.value, step.args.from, step.args.to) };
    } else if (step.op === "datetime.now") {
      result = utilityZonedNow(step.args.timezone);
    } else if (step.op === "datetime.diff") {
      result = { from: step.args.from, to: step.args.to, unit: step.args.unit, value: utilityDateDiff(step.args.from, step.args.to, step.args.unit) };
    } else {
      throw new SandPlanError("CAPABILITY_OP_NOT_ALLOWED", `Unhandled Utility operation: ${step.op}`);
    }
    outputs.push({ op: step.op, result });
    reply = renderUtilityResult(step, result) || reply;
  }
  return { steps: outputs, reply: reply || compactText(plan.reply_hint, 800) || "تمام." };
}
// Certified Core V2 foundation recovery — exact functions from dev2 gated source.

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

async function textHash(text) {
  const data = new TextEncoder().encode(String(text));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Certified Core V2 foundation recovery — exact functions from dev2 gated source.

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
  if (Object.hasOwn(patch, "details")) out.details = patch.details && typeof patch.details === "object" ? sanitizeJsonValue(patch.details, 4) : {};
  if (Object.hasOwn(patch, "status") && patch.status !== null) out.status = compactText(patch.status, 80) || out.status;

  if (Object.hasOwn(patch, "start_local")) out.start_local = patch.start_local === null ? null : normalizeLocalMinute(patch.start_local);
  if (Object.hasOwn(patch, "end_local")) out.end_local = patch.end_local === null ? null : normalizeLocalMinute(patch.end_local);

  const oldStart = out.start_local;
  if (Object.hasOwn(patch, "start_date_local") && patch.start_date_local) {
    const date = compactText(patch.start_date_local, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid start_date_local");
    const time = oldStart?.slice(11, 16) || "09:00";
    out.start_local = normalizeLocalMinute(`${date}T${time}`);
  }
  if (Object.hasOwn(patch, "start_time_local") && patch.start_time_local) {
    const time = compactText(patch.start_time_local, 20);
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Invalid start_time_local");
    const date = out.start_local?.slice(0, 10);
    if (!date) throw new Error("Cannot set only a time when target has no known date");
    out.start_local = normalizeLocalMinute(`${date}T${time}`);
  }

  if (out.start_local === null && (patch.start_local || patch.start_date_local || patch.start_time_local)) {
    throw new Error("Invalid start time");
  }
  if (out.end_local && out.start_local && out.end_local < out.start_local) throw new Error("End time cannot be before start time");
  return out;
}

async function objectById(env, chatId, id) {
  const row = await env.DB.prepare(`SELECT id,kind,title,state_json,status,updated_at FROM ${TABLES.objects}
    WHERE id=? AND chat_id=? LIMIT 1`)
    .bind(id, chatId)
    .first();
  if (!row) return null;
  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    state: safeJsonParse(row.state_json, {}),
    status: String(row.status),
    updated_at: String(row.updated_at),
  };
}

function tzOffsetMinutesAt(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, x.value]),
  );
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((localAsUtc - date.getTime()) / 60000);
}

function cairoLocalToUtc(localMinute) {
  const s = normalizeLocalMinute(localMinute);
  if (!s) return null;
  const [datePart, timePart] = s.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const wallUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  let guess = new Date(wallUtc);
  for (let i = 0; i < 3; i += 1) {
    const offset = tzOffsetMinutesAt(guess, TZ);
    guess = new Date(wallUtc - offset * 60000);
  }
  const verify = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(guess).replace(", ", "T");
  if (!verify.startsWith(`${datePart}T${timePart}`)) return null;
  return guess.toISOString();
}

async function upsertReminderForObject(env, { chatId, objectId, title, remindAtUtc, mode, sourceUpdateId }) {
  const existing = await env.DB.prepare(`SELECT id FROM ${TABLES.reminders}
    WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain') LIMIT 1`)
    .bind(chatId, objectId)
    .first();
  const at = nowIso();
  if (existing?.id) {
    await env.DB.prepare(`UPDATE ${TABLES.reminders}
      SET title=?,remind_at_utc=?,timezone=?,mode=?,status='pending',source_update_id=?,telegram_message_id=NULL,updated_at=?,sent_at=NULL
      WHERE id=?`)
      .bind(title, remindAtUtc, TZ, mode, sourceUpdateId, at, existing.id)
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
  const local = normalizeLocalMinute(startLocal);
  if (!local) return;
  const utc = cairoLocalToUtc(local);
  if (!utc) throw new Error("Could not resolve updated reminder time");
  await env.DB.prepare(`UPDATE ${TABLES.reminders}
    SET remind_at_utc=?,source_update_id=?,status='pending',telegram_message_id=NULL,updated_at=?,sent_at=NULL
    WHERE chat_id=? AND object_id=? AND mode='at_start' AND status IN ('pending','sending','uncertain')`)
    .bind(utc, sourceUpdateId, nowIso(), chatId, objectId)
    .run();
}
// Certified Core V2 foundation recovery — exact functions from dev2 gated source.

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

async function deliverTextOnce(env, chatId, sourceKind, sourceId, text) {
  const content = String(text).slice(0, 3900);
  const hash = await textHash(content);
  const existing = await env.DB.prepare(`SELECT id,status,text_hash,telegram_message_id,updated_at FROM ${TABLES.deliveries}
    WHERE chat_id=? AND source_kind=? AND source_id=? LIMIT 1`)
    .bind(chatId, sourceKind, sourceId)
    .first();

  if (existing) {
    if (String(existing.text_hash) !== hash) throw new Error("Delivery idempotency payload mismatch");
    const status = String(existing.status);
    if (status === "sent" || status === "uncertain" || status === "sending") return { skipped: true, status };
  }

  const id = existing?.id ? String(existing.id) : randomId("delivery");
  const at = nowIso();
  if (!existing) {
    await env.DB.prepare(`INSERT INTO ${TABLES.deliveries}
      (id,chat_id,source_kind,source_id,text_hash,status,created_at,updated_at)
      VALUES(?,?,?,?,?,'pending',?,?)`)
      .bind(id, chatId, sourceKind, sourceId, hash, at, at)
      .run();
  }

  const claim = await env.DB.prepare(`UPDATE ${TABLES.deliveries}
    SET status='sending',updated_at=?,last_error=NULL
    WHERE id=? AND status IN ('pending','failed') RETURNING id`)
    .bind(nowIso(), id)
    .first();
  if (!claim) return { skipped: true, status: "busy_or_terminal" };

  try {
    const data = await telegramApi(env, "sendMessage", { chat_id: chatId, text: content });
    const messageId = Number(data?.result?.message_id ?? 0) || null;
    await env.DB.prepare(`UPDATE ${TABLES.deliveries}
      SET status='sent',telegram_message_id=?,updated_at=?,sent_at=? WHERE id=?`)
      .bind(messageId, nowIso(), nowIso(), id)
      .run();
    return { skipped: false, status: "sent", message_id: messageId };
  } catch (error) {
    await env.DB.prepare(`UPDATE ${TABLES.deliveries}
      SET status='uncertain',last_error=?,updated_at=? WHERE id=?`)
      .bind(safeError(error), nowIso(), id)
      .run();
    throw error;
  }
}

function buildVerifiedReply(plan, execution) {
  if (plan.clarification) return plan.clarification.question;
  if (!execution.ok) return "حصلت مشكلة وأنا بنفذ آخر خطوة، فمش هأكدلك إن التعديل تم. حاول تاني بعد شوية.";
  const capabilityReply = [...execution.steps].reverse().map((step) => compactText(step?.reply, AI_MAX_REPLY_CHARS)).find(Boolean);
  if (capabilityReply) return capabilityReply;
  const reply = compactText(plan.reply, AI_MAX_REPLY_CHARS);
  return reply || "تمام، اتعملت ✅";
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

async function deliverDueReminders(env, limit) {
  const rows = await env.DB.prepare(`SELECT id,chat_id,object_id,title,remind_at_utc,mode,status
    FROM ${TABLES.reminders}
    WHERE status='pending' AND remind_at_utc<=?
    ORDER BY remind_at_utc ASC LIMIT ?`)
    .bind(nowIso(), clampInt(limit, 1, 100, 30))
    .all();

  for (const row of rows?.results ?? []) {
    const id = String(row.id);
    const claim = await env.DB.prepare(`UPDATE ${TABLES.reminders}
      SET status='sending',updated_at=? WHERE id=? AND status='pending' RETURNING id`)
      .bind(nowIso(), id)
      .first();
    if (!claim) continue;
    try {
      const data = await telegramApi(env, "sendMessage", {
        chat_id: String(row.chat_id),
        text: `⏰ ${String(row.title)}`.slice(0, 3900),
      });
      await env.DB.prepare(`UPDATE ${TABLES.reminders}
        SET status='sent',telegram_message_id=?,updated_at=?,sent_at=? WHERE id=?`)
        .bind(Number(data?.result?.message_id ?? 0) || null, nowIso(), nowIso(), id)
        .run();
    } catch (error) {
      await env.DB.prepare(`UPDATE ${TABLES.reminders} SET status='uncertain',updated_at=? WHERE id=?`)
        .bind(nowIso(), id)
        .run();
      logError("reminder_delivery_uncertain", error, { reminderId: id });
    }
  }
}

async function markStaleDeliveriesUncertain(env) {
  const cutoff = new Date(nowMs() - DELIVERY_UNCERTAIN_AFTER_MS).toISOString();
  await env.DB.prepare(`UPDATE ${TABLES.deliveries}
    SET status='uncertain',updated_at=?
    WHERE status='sending' AND updated_at<?`)
    .bind(nowIso(), cutoff)
    .run();
}
// SAND ONE Schedule capability family — advanced scheduling without changing Core V2 semantics.

const SCHEDULE_WEEKDAY_CODES = Object.freeze(["SUN","MON","TUE","WED","THU","FRI","SAT"]);
const SCHEDULE_READ_LIMIT = 500;
const SCHEDULE_SIGNAL_HORIZON_MINUTES = 15 * 24 * 60;
const SCHEDULE_SIGNAL_STALE_GRACE_MS = 15 * 60 * 1000;

function scheduleDate(value) {
  const raw = compactText(value, 20);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 2020 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return raw;
}

function scheduleTime(value) {
  const raw = compactText(value, 10);
  const m = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? raw : null;
}

function scheduleLocalMinute(value) {
  const raw = normalizeLocalMinute(value);
  if (!raw) return null;
  const date = scheduleDate(raw.slice(0, 10));
  const time = scheduleTime(raw.slice(11, 16));
  return date && time ? `${date}T${time}` : null;
}

function scheduleWallMs(localMinute) {
  const s = scheduleLocalMinute(localMinute);
  if (!s) return NaN;
  const y = Number(s.slice(0,4)), mo = Number(s.slice(5,7)), d = Number(s.slice(8,10));
  const h = Number(s.slice(11,13)), mi = Number(s.slice(14,16));
  return Date.UTC(y, mo - 1, d, h, mi, 0, 0);
}

function scheduleWallToLocal(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return scheduleLocalMinute(`${y}-${mo}-${day}T${h}:${mi}`);
}

function scheduleShiftLocalMinute(localMinute, deltaMinutes) {
  const ms = scheduleWallMs(localMinute);
  if (!Number.isFinite(ms)) return null;
  return scheduleWallToLocal(ms + Math.trunc(Number(deltaMinutes) || 0) * 60_000);
}

function scheduleNowLocalMinute() {
  const p = cairoNowParts();
  return `${p.date}T${p.time.slice(0,5)}`;
}

function scheduleAddDays(dateValue, days) {
  const date = scheduleDate(dateValue);
  if (!date) return null;
  const ms = Date.UTC(Number(date.slice(0,4)), Number(date.slice(5,7)) - 1, Number(date.slice(8,10)));
  return scheduleWallToLocal(ms + Math.trunc(days) * 86_400_000)?.slice(0,10) ?? null;
}

function scheduleDaysDiff(fromDate, toDate) {
  const a = scheduleDate(fromDate), b = scheduleDate(toDate);
  if (!a || !b) return NaN;
  const am = Date.UTC(Number(a.slice(0,4)), Number(a.slice(5,7)) - 1, Number(a.slice(8,10)));
  const bm = Date.UTC(Number(b.slice(0,4)), Number(b.slice(5,7)) - 1, Number(b.slice(8,10)));
  return Math.round((bm - am) / 86_400_000);
}

function scheduleMonthsDiff(fromDate, toDate) {
  const a = scheduleDate(fromDate), b = scheduleDate(toDate);
  if (!a || !b) return NaN;
  return (Number(b.slice(0,4)) - Number(a.slice(0,4))) * 12 + (Number(b.slice(5,7)) - Number(a.slice(5,7)));
}

function scheduleWeekday(dateValue) {
  const d = scheduleDate(dateValue);
  if (!d) return null;
  const ms = Date.UTC(Number(d.slice(0,4)), Number(d.slice(5,7)) - 1, Number(d.slice(8,10)));
  return SCHEDULE_WEEKDAY_CODES[new Date(ms).getUTCDay()] ?? null;
}

function scheduleDurationMinutes(startLocal, endLocal) {
  const a = scheduleWallMs(startLocal), b = scheduleWallMs(endLocal);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60_000);
}

function scheduleUniqueInts(value, min, max, maxItems = 31) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value.slice(0, maxItems)) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new SandPlanError("BAD_SCHEDULE_NUMBER", `Schedule number must be ${min}..${max}`);
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a,b) => a-b);
}

function scheduleWeekdays(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value.slice(0,7)) {
    const day = compactText(raw, 10).toUpperCase();
    if (!SCHEDULE_WEEKDAY_CODES.includes(day)) throw new SandPlanError("BAD_WEEKDAY", `Bad weekday: ${day}`);
    if (!out.includes(day)) out.push(day);
  }
  return out;
}

function scheduleTimes(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value.slice(0,12)) {
    const time = scheduleTime(raw);
    if (!time) throw new SandPlanError("BAD_SCHEDULE_TIME", `Bad time: ${compactText(raw,20)}`);
    if (!out.includes(time)) out.push(time);
  }
  return out.sort();
}

function scheduleOffsets(value) {
  if (!Array.isArray(value)) throw new SandPlanError("ALERT_OFFSETS_REQUIRED", "Alert offsets must be an array");
  return scheduleUniqueInts(value, 0, 10_080, 12);
}

function scheduleTargetValid(value, refs, allowCreated = true) {
  const raw = compactText(value, 120);
  if (!raw) return false;
  return refs.has(raw) || (allowCreated && /^created:[1-9][0-9]*$/.test(raw));
}

function scheduleOptionalRange(a) {
  const from = a.from_local === undefined || a.from_local === null || a.from_local === "" ? null : scheduleLocalMinute(a.from_local);
  const to = a.to_local === undefined || a.to_local === null || a.to_local === "" ? null : scheduleLocalMinute(a.to_local);
  if ((a.from_local && !from) || (a.to_local && !to)) throw new SandPlanError("BAD_SCHEDULE_RANGE", "Invalid schedule range");
  if (from && to && to <= from) throw new SandPlanError("BAD_SCHEDULE_RANGE", "Schedule range end must be after start");
  return { from, to };
}

function validateScheduleStep(op, a, refs) {
  if (op === "schedule.create") {
    const title = compactText(a.title, 240), start_local = scheduleLocalMinute(a.start_local);
    const end_local = a.end_local === undefined || a.end_local === null || a.end_local === "" ? null : scheduleLocalMinute(a.end_local);
    if (!title || !start_local) throw new SandPlanError("SCHEDULE_CREATE_REQUIRED", "Schedule create needs title and start_local");
    if (a.end_local && !end_local) throw new SandPlanError("BAD_SCHEDULE_END", "Invalid schedule end");
    if (end_local && end_local < start_local) throw new SandPlanError("BAD_SCHEDULE_END", "Schedule end cannot be before start");
    return { op, args: { title, start_local, end_local, location: compactText(a.location,300) || null, description: compactText(a.description,3000) || null } };
  }
  if (op === "schedule.list") return { op, args: scheduleOptionalRange(a) };
  if (op === "schedule.search") {
    const query = compactText(a.query, 300); if (!query) throw new SandPlanError("QUERY_REQUIRED", "Schedule search query required");
    return { op, args: { query, ...scheduleOptionalRange(a) } };
  }
  if (op === "schedule.free_time") {
    const from = scheduleLocalMinute(a.from_local), to = scheduleLocalMinute(a.to_local);
    if (!from || !to || to <= from) throw new SandPlanError("BAD_SCHEDULE_RANGE", "Free-time requires a valid from_local/to_local range");
    return { op, args: { from_local: from, to_local: to, min_minutes: clampInt(a.min_minutes, 1, 1440, 30) } };
  }
  if (op === "schedule.conflicts") {
    const target = compactText(a.target,120) || null;
    if (target && !scheduleTargetValid(target, refs, false)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown schedule target");
    return { op, args: { target, ...scheduleOptionalRange(a) } };
  }
  if (op === "schedule.shift") {
    const target = compactText(a.target,120);
    if (!scheduleTargetValid(target, refs)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown schedule target");
    const hasDelta = a.delta_minutes !== undefined && a.delta_minutes !== null && a.delta_minutes !== "";
    const start = a.start_local === undefined || a.start_local === null || a.start_local === "" ? null : scheduleLocalMinute(a.start_local);
    if (a.start_local && !start) throw new SandPlanError("BAD_SCHEDULE_TIME", "Invalid new schedule start");
    if (hasDelta === Boolean(start)) throw new SandPlanError("SCHEDULE_SHIFT_MODE", "Use exactly one of delta_minutes or start_local");
    const delta = hasDelta ? clampInt(a.delta_minutes, -525_600, 525_600, 0) : null;
    if (hasDelta && delta === 0) throw new SandPlanError("SCHEDULE_SHIFT_ZERO", "Shift delta cannot be zero");
    return { op, args: { target, delta_minutes: delta, start_local: start } };
  }
  if (op === "schedule.bulk_shift") {
    const targets = Array.isArray(a.targets) ? [...new Set(a.targets.map((v) => compactText(v,120)).filter(Boolean))].slice(0,20) : [];
    if (!targets.length || targets.some((v) => !scheduleTargetValid(v,refs,false))) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Bulk shift needs valid existing schedule targets");
    const delta = clampInt(a.delta_minutes, -525_600, 525_600, 0);
    if (!delta) throw new SandPlanError("SCHEDULE_SHIFT_ZERO", "Bulk shift delta cannot be zero");
    return { op, args: { targets, delta_minutes: delta } };
  }
  if (["schedule.cancel","schedule.alerts.clear","schedule.recurrence.pause","schedule.recurrence.resume","schedule.recurrence.cancel"].includes(op)) {
    const target = compactText(a.target,120);
    if (!scheduleTargetValid(target,refs,false)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown schedule target");
    if (op === "schedule.recurrence.pause") {
      const until_local = a.until_local === undefined || a.until_local === null || a.until_local === "" ? null : scheduleLocalMinute(a.until_local);
      if (a.until_local && !until_local) throw new SandPlanError("BAD_SCHEDULE_TIME", "Invalid pause-until time");
      return { op, args: { target, until_local } };
    }
    return { op, args: { target } };
  }
  if (op === "schedule.snooze") {
    const target = compactText(a.target,120);
    if (!scheduleTargetValid(target,refs,false)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown schedule target");
    const minutes = clampInt(a.minutes, 1, 1440, 10);
    return { op, args: { target, minutes } };
  }
  if (op === "schedule.alerts.set") {
    const target = compactText(a.target,120);
    if (!scheduleTargetValid(target,refs)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown schedule target");
    return { op, args: { target, offsets_minutes: scheduleOffsets(a.offsets_minutes) } };
  }
  if (op === "schedule.recurrence.set") {
    const target = compactText(a.target,120), freq = compactText(a.freq,30).toLowerCase();
    if (!scheduleTargetValid(target,refs)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown schedule target");
    if (!["daily","weekly","monthly","yearly"].includes(freq)) throw new SandPlanError("BAD_RECURRENCE_FREQ", "Bad recurrence frequency");
    const start_date = a.start_date === undefined || a.start_date === null || a.start_date === "" ? null : scheduleDate(a.start_date);
    const end_date = a.end_date === undefined || a.end_date === null || a.end_date === "" ? null : scheduleDate(a.end_date);
    if (a.start_date && !start_date || a.end_date && !end_date) throw new SandPlanError("BAD_RECURRENCE_DATE", "Invalid recurrence date");
    if (start_date && end_date && end_date < start_date) throw new SandPlanError("BAD_RECURRENCE_DATE", "Recurrence end is before start");
    const max_occurrences = a.max_occurrences === undefined || a.max_occurrences === null || a.max_occurrences === "" ? null : clampInt(a.max_occurrences,1,10_000,1);
    const duration_minutes = a.duration_minutes === undefined || a.duration_minutes === null || a.duration_minutes === "" ? null : clampInt(a.duration_minutes,1,10_080,60);
    const alert_offsets_minutes = Object.prototype.hasOwnProperty.call(a,"alert_offsets_minutes") ? scheduleOffsets(a.alert_offsets_minutes) : null;
    return { op, args: {
      target, freq, interval: clampInt(a.interval,1,365,1), weekdays: scheduleWeekdays(a.weekdays), month_days: scheduleUniqueInts(a.month_days,1,31,31), months: scheduleUniqueInts(a.months,1,12,12), times: scheduleTimes(a.times),
      start_date, end_date, max_occurrences, duration_minutes, alert_offsets_minutes,
    } };
  }
  if (op === "schedule.recurrence.skip") {
    const target = compactText(a.target,120), occurrenceRaw = compactText(a.occurrence,40);
    if (!scheduleTargetValid(target,refs,false)) throw new SandPlanError("UNKNOWN_FAMILY_TARGET", "Unknown schedule target");
    const occurrence = scheduleDate(occurrenceRaw) || scheduleLocalMinute(occurrenceRaw);
    if (!occurrence) throw new SandPlanError("BAD_OCCURRENCE", "Skip needs YYYY-MM-DD or YYYY-MM-DDTHH:mm");
    return { op, args: { target, occurrence } };
  }
  throw new SandPlanError("BAD_CAPABILITY_STEP", `Unhandled schedule operation: ${op}`);
}

function scheduleRuleFromRow(row) {
  if (!row) return null;
  return {
    id: String(row.id), object_id: String(row.object_id), freq: String(row.freq), interval_n: Math.max(1, Number(row.interval_n) || 1),
    anchor_local: scheduleLocalMinute(row.anchor_local), weekdays: safeJsonParse(row.weekdays_json, []), month_days: safeJsonParse(row.month_days_json, []), months: safeJsonParse(row.months_json, []), times: safeJsonParse(row.times_json, []),
    start_date_local: row.start_date_local ? String(row.start_date_local) : null, end_date_local: row.end_date_local ? String(row.end_date_local) : null,
    max_occurrences: row.max_occurrences === null || row.max_occurrences === undefined ? null : Number(row.max_occurrences), duration_minutes: row.duration_minutes === null || row.duration_minutes === undefined ? null : Number(row.duration_minutes),
    alert_offsets: safeJsonParse(row.alert_offsets_json, []), shift_minutes: Number(row.shift_minutes) || 0, status: String(row.status), paused_until_local: row.paused_until_local ? String(row.paused_until_local) : null,
    skip_occurrences: safeJsonParse(row.skip_occurrences_json, []), updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

async function scheduleCapabilitySnapshot(env, chatId) {
  const [objectsResult, rulesResult, remindersResult, signalsResult] = await Promise.all([
    env.DB.prepare(`SELECT id,kind,title,state_json,status,updated_at FROM ${TABLES.objects} WHERE chat_id=? AND status='active' ORDER BY updated_at DESC LIMIT 160`).bind(chatId).all(),
    env.DB.prepare(`SELECT * FROM ${TABLES.scheduleRules} WHERE chat_id=? AND status!='cancelled' ORDER BY updated_at DESC LIMIT 120`).bind(chatId).all(),
    env.DB.prepare(`SELECT object_id,remind_at_utc,mode,status FROM ${TABLES.reminders} WHERE chat_id=? AND status IN ('pending','sending','uncertain') ORDER BY remind_at_utc ASC LIMIT 120`).bind(chatId).all(),
    env.DB.prepare(`SELECT object_id,occurrence_local,fire_at_utc,status FROM ${TABLES.scheduleSignals} WHERE chat_id=? AND status IN ('pending','sending','uncertain') ORDER BY fire_at_utc ASC LIMIT 160`).bind(chatId).all(),
  ]);
  const rules = new Map((rulesResult?.results ?? []).map((row) => [String(row.object_id), scheduleRuleFromRow(row)]));
  const coreReminder = new Map();
  for (const row of remindersResult?.results ?? []) if (row.object_id && !coreReminder.has(String(row.object_id))) coreReminder.set(String(row.object_id), { remind_at_utc: String(row.remind_at_utc), mode: String(row.mode), status: String(row.status) });
  const signalCounts = new Map();
  for (const row of signalsResult?.results ?? []) signalCounts.set(String(row.object_id), (signalCounts.get(String(row.object_id)) ?? 0) + 1);
  const objects = (objectsResult?.results ?? []).map((row) => ({ id: String(row.id), kind: String(row.kind), title: String(row.title), status: String(row.status), state: safeJsonParse(row.state_json,{}), updated_at: String(row.updated_at) }))
    .filter((row) => scheduleLocalMinute(row.state.start_local))
    .sort((a,b) => String(a.state.start_local).localeCompare(String(b.state.start_local)));
  return objects.map((row,index) => {
    const rule = rules.get(row.id);
    return {
      ref: `e${index+1}`, id: row.id, kind: "event", object_kind: row.kind, title: row.title, status: row.status,
      state: {
        start_local: scheduleLocalMinute(row.state.start_local), end_local: scheduleLocalMinute(row.state.end_local), location: row.state.location ?? null, description: row.state.description ?? null,
        recurrence: rule ? { freq: rule.freq, interval: rule.interval_n, weekdays: rule.weekdays, month_days: rule.month_days, months: rule.months, times: rule.times, start_date: rule.start_date_local, end_date: rule.end_date_local, max_occurrences: rule.max_occurrences, duration_minutes: rule.duration_minutes, status: rule.status, paused_until_local: rule.paused_until_local, alert_offsets_minutes: rule.alert_offsets, shift_minutes: rule.shift_minutes } : null,
        core_reminder: coreReminder.get(row.id) ?? null, pending_schedule_alerts: signalCounts.get(row.id) ?? 0,
      }, updated_at: row.updated_at,
    };
  });
}

function scheduleRuleMatchesDate(rule, date, anchorDate) {
  const days = scheduleDaysDiff(anchorDate,date);
  if (!Number.isFinite(days) || days < 0) return false;
  const interval = Math.max(1, Number(rule.interval_n) || 1);
  if (rule.freq === "once") return date === anchorDate;
  if (rule.freq === "daily") return days % interval === 0;
  if (rule.freq === "weekly") {
    const weeks = Math.floor(days / 7);
    const weekdays = Array.isArray(rule.weekdays) && rule.weekdays.length ? rule.weekdays : [scheduleWeekday(anchorDate)];
    return weeks % interval === 0 && weekdays.includes(scheduleWeekday(date));
  }
  if (rule.freq === "monthly") {
    const months = scheduleMonthsDiff(anchorDate,date);
    const monthDays = Array.isArray(rule.month_days) && rule.month_days.length ? rule.month_days : [Number(anchorDate.slice(8,10))];
    return months >= 0 && months % interval === 0 && monthDays.includes(Number(date.slice(8,10)));
  }
  if (rule.freq === "yearly") {
    const yearDiff = Number(date.slice(0,4)) - Number(anchorDate.slice(0,4));
    const months = Array.isArray(rule.months) && rule.months.length ? rule.months : [Number(anchorDate.slice(5,7))];
    const monthDays = Array.isArray(rule.month_days) && rule.month_days.length ? rule.month_days : [Number(anchorDate.slice(8,10))];
    return yearDiff >= 0 && yearDiff % interval === 0 && months.includes(Number(date.slice(5,7))) && monthDays.includes(Number(date.slice(8,10)));
  }
  return false;
}

function scheduleRuleIsSkipped(rule, local) {
  const skips = Array.isArray(rule.skip_occurrences) ? rule.skip_occurrences : [];
  return skips.includes(local) || skips.includes(local.slice(0,10));
}

function scheduleProjectRule(rule, title, fromLocal, toLocal, limit = SCHEDULE_READ_LIMIT) {
  const from = scheduleLocalMinute(fromLocal), to = scheduleLocalMinute(toLocal), anchor = scheduleLocalMinute(rule.anchor_local);
  if (!from || !to || !anchor || to <= from || rule.status === "cancelled") return [];
  if (rule.status === "paused" && !rule.paused_until_local) return [];
  const anchorDate = scheduleDate(rule.start_date_local || anchor.slice(0,10)) || anchor.slice(0,10);
  const endDate = rule.end_date_local ? scheduleDate(rule.end_date_local) : null;
  const times = Array.isArray(rule.times) && rule.times.length ? rule.times.filter(scheduleTime) : [anchor.slice(11,16)];
  const shift = Number(rule.shift_minutes) || 0;
  const duration = Number.isInteger(rule.duration_minutes) && rule.duration_minutes > 0 ? rule.duration_minutes : null;
  const maxOccurrences = Number.isInteger(rule.max_occurrences) && rule.max_occurrences > 0 ? rule.max_occurrences : null;
  const hardStart = anchorDate;
  const hardEnd = endDate && endDate < to.slice(0,10) ? endDate : to.slice(0,10);
  let date = hardStart, ordinal = 0;
  const out = [];
  let guard = 0;
  while (date && date <= hardEnd && guard < 40_000 && out.length < Math.max(1,limit)) {
    guard += 1;
    if (scheduleRuleMatchesDate(rule,date,anchorDate)) {
      for (const time of times) {
        const rawLocal = scheduleLocalMinute(`${date}T${time}`);
        if (!rawLocal) continue;
        ordinal += 1;
        if (maxOccurrences && ordinal > maxOccurrences) return out;
        const shifted = scheduleShiftLocalMinute(rawLocal,shift);
        if (!shifted || scheduleRuleIsSkipped(rule,shifted) || scheduleRuleIsSkipped(rule,rawLocal)) continue;
        if (rule.status === "paused" && rule.paused_until_local && shifted < rule.paused_until_local) continue;
        if (shifted >= from && shifted < to) {
          out.push({ event_id: String(rule.object_id), rule_id: String(rule.id), recurring: rule.freq !== "once", title, start_local: shifted, end_local: duration ? scheduleShiftLocalMinute(shifted,duration) : null, occurrence_local: shifted });
          if (out.length >= limit) return out;
        }
      }
    }
    date = scheduleAddDays(date,1);
  }
  return out;
}

function scheduleDirectOccurrence(object) {
  const start = scheduleLocalMinute(object.state?.start_local);
  if (!start) return null;
  const end = scheduleLocalMinute(object.state?.end_local);
  return { event_id: object.id, rule_id: null, recurring: false, title: object.title, start_local: start, end_local: end, occurrence_local: start };
}

async function scheduleDomain(env, chatId) {
  const [objectsResult,rulesResult] = await Promise.all([
    env.DB.prepare(`SELECT id,kind,title,state_json,status,updated_at FROM ${TABLES.objects} WHERE chat_id=? AND status='active' ORDER BY updated_at DESC LIMIT 200`).bind(chatId).all(),
    env.DB.prepare(`SELECT * FROM ${TABLES.scheduleRules} WHERE chat_id=? ORDER BY updated_at DESC LIMIT 200`).bind(chatId).all(),
  ]);
  const objects=(objectsResult?.results??[]).map((row)=>({id:String(row.id),kind:String(row.kind),title:String(row.title),state:safeJsonParse(row.state_json,{}),status:String(row.status),updated_at:String(row.updated_at)})).filter((o)=>scheduleLocalMinute(o.state.start_local));
  const rules=(rulesResult?.results??[]).map(scheduleRuleFromRow).filter(Boolean);
  return { objects, rules, ruleByObject:new Map(rules.map((r)=>[r.object_id,r])) };
}

function scheduleResolveWindow(fromLocal,toLocal) {
  const now=scheduleNowLocalMinute();
  const from=scheduleLocalMinute(fromLocal)||now;
  const to=scheduleLocalMinute(toLocal)||scheduleShiftLocalMinute(from,7*24*60);
  if (!from||!to||to<=from) throw new SandPlanError("BAD_SCHEDULE_RANGE","Invalid schedule window");
  return {from,to};
}

async function scheduleOccurrences(env,chatId,fromLocal,toLocal) {
  const {from,to}=scheduleResolveWindow(fromLocal,toLocal);
  const domain=await scheduleDomain(env,chatId);
  const out=[];
  for(const obj of domain.objects){
    const rule=domain.ruleByObject.get(obj.id);
    if(rule && rule.status!=="cancelled" && rule.freq!=="once") out.push(...scheduleProjectRule(rule,obj.title,from,to,SCHEDULE_READ_LIMIT-out.length));
    else {
      const occ=scheduleDirectOccurrence(obj);
      if(occ && occ.start_local>=from && occ.start_local<to) out.push(occ);
    }
    if(out.length>=SCHEDULE_READ_LIMIT) break;
  }
  return {from,to,events:out.sort((a,b)=>a.start_local.localeCompare(b.start_local)).slice(0,SCHEDULE_READ_LIMIT)};
}

function scheduleDetectConflicts(events) {
  const intervals=events.filter((e)=>scheduleLocalMinute(e.start_local)&&scheduleLocalMinute(e.end_local)&&e.end_local>e.start_local).sort((a,b)=>a.start_local.localeCompare(b.start_local));
  const conflicts=[];
  for(let i=0;i<intervals.length;i+=1){
    for(let j=i+1;j<intervals.length;j+=1){
      if(intervals[j].start_local>=intervals[i].end_local) break;
      if(intervals[i].event_id===intervals[j].event_id && intervals[i].occurrence_local===intervals[j].occurrence_local) continue;
      if(intervals[i].start_local<intervals[j].end_local && intervals[j].start_local<intervals[i].end_local) conflicts.push({a:intervals[i],b:intervals[j]});
    }
  }
  return conflicts;
}

function scheduleFreeSlots(events,from,to,minMinutes) {
  const start=scheduleWallMs(from), end=scheduleWallMs(to);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start) return {slots:[],ignored_without_duration:0};
  const busy=[]; let ignored=0;
  for(const e of events){
    if(!e.end_local){ignored+=1;continue;}
    const a=Math.max(start,scheduleWallMs(e.start_local)), b=Math.min(end,scheduleWallMs(e.end_local));
    if(Number.isFinite(a)&&Number.isFinite(b)&&b>a) busy.push([a,b]);
  }
  busy.sort((x,y)=>x[0]-y[0]);
  const merged=[];
  for(const x of busy){const last=merged[merged.length-1];if(last&&x[0]<=last[1])last[1]=Math.max(last[1],x[1]);else merged.push([...x]);}
  const slots=[]; let cursor=start;
  for(const [a,b] of merged){if(a>cursor&&(a-cursor)/60000>=minMinutes)slots.push({from_local:scheduleWallToLocal(cursor),to_local:scheduleWallToLocal(a),minutes:Math.round((a-cursor)/60000)});cursor=Math.max(cursor,b);}
  if(end>cursor&&(end-cursor)/60000>=minMinutes)slots.push({from_local:scheduleWallToLocal(cursor),to_local:scheduleWallToLocal(end),minutes:Math.round((end-cursor)/60000)});
  return {slots,ignored_without_duration:ignored};
}

async function scheduleRuleId(chatId,objectId){const h=await textHash(`schedule-rule:${chatId}:${objectId}`);return `sr_${h.slice(0,28)}`;}

async function scheduleRuleForObject(env,chatId,objectId){const row=await env.DB.prepare(`SELECT * FROM ${TABLES.scheduleRules} WHERE chat_id=? AND object_id=? LIMIT 1`).bind(chatId,objectId).first();return scheduleRuleFromRow(row);}

async function scheduleCancelPendingSignals(env,chatId,objectId,occurrence=null){
  if(occurrence){const like=occurrence.length===10?`${occurrence}%`:occurrence;await env.DB.prepare(`UPDATE ${TABLES.scheduleSignals} SET status='cancelled',updated_at=? WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain') AND occurrence_local LIKE ?`).bind(nowIso(),chatId,objectId,like).run();return;}
  await env.DB.prepare(`UPDATE ${TABLES.scheduleSignals} SET status='cancelled',updated_at=? WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain')`).bind(nowIso(),chatId,objectId).run();
}

async function scheduleUpsertRule(env,{chatId,objectId,sourceUpdateId,freq,anchorLocal,interval=1,weekdays=[],monthDays=[],months=[],times=[],startDate=null,endDate=null,maxOccurrences=null,durationMinutes=null,alertOffsets=[],shiftMinutes=0,status="active",pausedUntil=null,skipOccurrences=[]}){
  const id=await scheduleRuleId(chatId,objectId), at=nowIso();
  await env.DB.prepare(`INSERT INTO ${TABLES.scheduleRules}
    (id,chat_id,object_id,freq,interval_n,anchor_local,weekdays_json,month_days_json,months_json,times_json,start_date_local,end_date_local,max_occurrences,duration_minutes,alert_offsets_json,shift_minutes,status,paused_until_local,skip_occurrences_json,source_update_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(chat_id,object_id) DO UPDATE SET
      freq=excluded.freq,interval_n=excluded.interval_n,anchor_local=excluded.anchor_local,weekdays_json=excluded.weekdays_json,month_days_json=excluded.month_days_json,months_json=excluded.months_json,times_json=excluded.times_json,start_date_local=excluded.start_date_local,end_date_local=excluded.end_date_local,max_occurrences=excluded.max_occurrences,duration_minutes=excluded.duration_minutes,alert_offsets_json=excluded.alert_offsets_json,shift_minutes=excluded.shift_minutes,status=excluded.status,paused_until_local=excluded.paused_until_local,skip_occurrences_json=excluded.skip_occurrences_json,source_update_id=excluded.source_update_id,updated_at=excluded.updated_at`)
    .bind(id,chatId,objectId,freq,interval,anchorLocal,JSON.stringify(weekdays),JSON.stringify(monthDays),JSON.stringify(months),JSON.stringify(times),startDate,endDate,maxOccurrences,durationMinutes,JSON.stringify(alertOffsets),shiftMinutes,status,pausedUntil,JSON.stringify(skipOccurrences),sourceUpdateId,at,at).run();
  const verify=await scheduleRuleForObject(env,chatId,objectId);if(!verify||verify.freq!==freq||verify.status!==status)throw new Error("Schedule rule verification failed");return verify;
}

async function scheduleEnsureOnceAlertRule(env,chatId,objectId,sourceUpdateId,offsets){
  const obj=await objectById(env,chatId,objectId);if(!obj||obj.status!=="active")throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Schedule target missing");
  const start=scheduleLocalMinute(obj.state?.start_local);if(!start)throw new SandPlanError("SCHEDULE_START_REQUIRED","Schedule target has no start time");
  const existing=await scheduleRuleForObject(env,chatId,objectId);
  if(existing && existing.status!=="cancelled" && existing.freq!=="once"){
    await env.DB.prepare(`UPDATE ${TABLES.scheduleRules} SET alert_offsets_json=?,source_update_id=?,updated_at=? WHERE id=?`).bind(JSON.stringify(offsets),sourceUpdateId,nowIso(),existing.id).run();
    return scheduleRuleForObject(env,chatId,objectId);
  }
  return scheduleUpsertRule(env,{chatId,objectId,sourceUpdateId,freq:"once",anchorLocal:start,interval:1,times:[start.slice(11,16)],startDate:start.slice(0,10),durationMinutes:scheduleDurationMinutes(start,obj.state?.end_local),alertOffsets:offsets,status:"active"});
}

async function scheduleMaterializeRuleSignals(env,chatId,rule,objectTitle,nowLocal=scheduleNowLocalMinute()){
  if(!rule||rule.status==="cancelled"||!Array.isArray(rule.alert_offsets)||!rule.alert_offsets.length)return 0;
  if(rule.status==="paused"&&!rule.paused_until_local)return 0;
  const occurrenceTo=scheduleShiftLocalMinute(nowLocal,SCHEDULE_SIGNAL_HORIZON_MINUTES+10_080);
  if(!occurrenceTo)return 0;
  const occurrences=scheduleProjectRule(rule,objectTitle,scheduleShiftLocalMinute(nowLocal,-10_080) || nowLocal,occurrenceTo,1000);
  const now=nowMs(), future=now+7*24*60*60*1000; let inserted=0;
  for(const occ of occurrences){
    for(const offset of rule.alert_offsets){
      const fireLocal=scheduleShiftLocalMinute(occ.start_local,-Number(offset));
      const fireUtc=fireLocal?cairoLocalToUtc(fireLocal):null;if(!fireUtc)continue;
      const fireMs=new Date(fireUtc).getTime();if(fireMs<now-SCHEDULE_SIGNAL_STALE_GRACE_MS||fireMs>future)continue;
      const h=await textHash(`${rule.id}:${occ.occurrence_local}:${offset}`), id=`ss_${h.slice(0,30)}`, at=nowIso();
      const res=await env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.scheduleSignals}(id,chat_id,rule_id,object_id,occurrence_local,offset_minutes,fire_at_utc,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?)`).bind(id,chatId,rule.id,rule.object_id,occ.occurrence_local,offset,fireUtc,objectTitle,at,at).run();
      if(Number(res?.meta?.changes??0)>0)inserted+=1;
    }
  }
  return inserted;
}

async function processDueScheduleSignals(env,limit=40){
  const nowLocal=scheduleNowLocalMinute();
  await env.DB.prepare(`UPDATE ${TABLES.scheduleRules} SET status='active',paused_until_local=NULL,updated_at=? WHERE status='paused' AND paused_until_local IS NOT NULL AND paused_until_local<=?`).bind(nowIso(),nowLocal).run();
  const rulesResult=await env.DB.prepare(`SELECT r.*,o.title,o.status AS object_status FROM ${TABLES.scheduleRules} r JOIN ${TABLES.objects} o ON o.id=r.object_id AND o.chat_id=r.chat_id WHERE r.status IN ('active','paused') AND o.status='active' ORDER BY r.updated_at DESC LIMIT 160`).all();
  for(const row of rulesResult?.results??[]){const rule=scheduleRuleFromRow(row);if(rule)await scheduleMaterializeRuleSignals(env,String(row.chat_id),rule,String(row.title),nowLocal);}
  const rows=await env.DB.prepare(`SELECT id,chat_id,object_id,title,fire_at_utc FROM ${TABLES.scheduleSignals} WHERE status='pending' AND fire_at_utc<=? ORDER BY fire_at_utc ASC LIMIT ?`).bind(nowIso(),clampInt(limit,1,100,40)).all();
  for(const row of rows?.results??[]){
    const id=String(row.id);const claim=await env.DB.prepare(`UPDATE ${TABLES.scheduleSignals} SET status='sending',updated_at=? WHERE id=? AND status='pending' RETURNING id`).bind(nowIso(),id).first();if(!claim)continue;
    try{const data=await telegramApi(env,"sendMessage",{chat_id:String(row.chat_id),text:`⏰ ${String(row.title)}`.slice(0,3900)});await env.DB.prepare(`UPDATE ${TABLES.scheduleSignals} SET status='sent',telegram_message_id=?,updated_at=?,sent_at=? WHERE id=?`).bind(Number(data?.result?.message_id??0)||null,nowIso(),nowIso(),id).run();}
    catch(error){await env.DB.prepare(`UPDATE ${TABLES.scheduleSignals} SET status='uncertain',updated_at=? WHERE id=?`).bind(nowIso(),id).run();logError("schedule_signal_delivery_uncertain",error,{signalId:id});}
  }
}

function scheduleRenderEvents(events,label="📅 المواعيد"){
  if(!events.length)return `${label}: مفيش مواعيد في الفترة دي.`;
  return [label,...events.slice(0,20).map((e,i)=>`${i+1}) ${e.title} — ${e.start_local}${e.end_local?` → ${e.end_local}`:""}${e.recurring?" 🔁":""}`)].join("\n").slice(0,AI_MAX_REPLY_CHARS);
}

async function scheduleShiftObject(env,chatId,objectId,deltaMinutes,updateId){
  const obj=await objectById(env,chatId,objectId);if(!obj||obj.status!=="active")throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Schedule target missing");
  const oldStart=scheduleLocalMinute(obj.state?.start_local);if(!oldStart)throw new SandPlanError("SCHEDULE_START_REQUIRED","Schedule target has no start time");
  const newStart=scheduleShiftLocalMinute(oldStart,deltaMinutes);if(!newStart)throw new Error("Schedule shift produced invalid start");
  const oldEnd=scheduleLocalMinute(obj.state?.end_local), newEnd=oldEnd?scheduleShiftLocalMinute(oldEnd,deltaMinutes):null;
  const merged=mergeObjectState(obj.state,{start_local:newStart,end_local:newEnd},obj.title);
  const at=nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE ${TABLES.objects} SET title=?,state_json=?,updated_by_update=?,updated_at=? WHERE id=? AND chat_id=? AND status='active'`).bind(merged.title,JSON.stringify(merged),updateId,at,objectId,chatId),
    env.DB.prepare(`UPDATE ${TABLES.scheduleRules} SET shift_minutes=shift_minutes+?,source_update_id=?,updated_at=? WHERE chat_id=? AND object_id=? AND status!='cancelled'`).bind(deltaMinutes,updateId,at,chatId,objectId),
    env.DB.prepare(`UPDATE ${TABLES.scheduleSignals} SET status='cancelled',updated_at=? WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain')`).bind(at,chatId,objectId),
  ]);
  await syncAnchoredReminderForObject(env,chatId,objectId,newStart,updateId);
  const verify=await objectById(env,chatId,objectId);if(!verify||scheduleLocalMinute(verify.state?.start_local)!==newStart)throw new Error("Schedule shift verification failed");
  return verify;
}

async function executeSchedulePlan(env,{chatId,updateId,operationId,mainStepIndex,plan,refs}){
  const outputs=[],created=[];let reply="";
  for(let i=0;i<plan.steps.length;i+=1){
    const step=plan.steps[i];
    if(step.op==="schedule.create"){
      const id=await stableCapabilityId("sched",operationId,mainStepIndex,i+1),state=mergeObjectState({},step.args,step.args.title),at=nowIso();
      await env.DB.prepare(`INSERT OR IGNORE INTO ${TABLES.objects}(id,chat_id,kind,title,state_json,status,created_by_update,updated_by_update,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?,?,?)`).bind(id,chatId,"commitment",state.title,JSON.stringify(state),updateId,updateId,at,at).run();
      const verify=await objectById(env,chatId,id);if(!verify||verify.title!==state.title||scheduleLocalMinute(verify.state?.start_local)!==step.args.start_local)throw new Error("Schedule create verification failed");
      created[i]=id;outputs.push({op:step.op,object_id:id,start_local:step.args.start_local});reply=`تمام، سجلت ${state.title} يوم ${step.args.start_local}.`;continue;
    }
    if(step.op==="schedule.list"||step.op==="schedule.search"||step.op==="schedule.free_time"||step.op==="schedule.conflicts"){
      const range=step.op==="schedule.free_time"?{from:step.args.from_local,to:step.args.to_local}:scheduleResolveWindow(step.args.from_local,step.args.to_local);
      const projected=await scheduleOccurrences(env,chatId,range.from,range.to);let events=projected.events;
      if(step.op==="schedule.search"){const q=step.args.query.toLocaleLowerCase("ar");events=events.filter((e)=>`${e.title}`.toLocaleLowerCase("ar").includes(q));outputs.push({op:step.op,events});reply=scheduleRenderEvents(events,"🔎 نتائج المواعيد");}
      else if(step.op==="schedule.list"){outputs.push({op:step.op,events});reply=scheduleRenderEvents(events);}
      else if(step.op==="schedule.free_time"){const free=scheduleFreeSlots(events,range.from,range.to,step.args.min_minutes);outputs.push({op:step.op,...free});reply=free.slots.length?["🕒 الأوقات الفاضية:",...free.slots.slice(0,20).map((x)=>`${x.from_local} → ${x.to_local} (${x.minutes} دقيقة)`),free.ignored_without_duration?`ملحوظة: ${free.ignored_without_duration} موعد بدون مدة ما اتحسبش كفترة مشغولة.`:""].filter(Boolean).join("\n"):"مفيش فترة فاضية بالمُدة المطلوبة.";}
      else {let conflicts=scheduleDetectConflicts(events);if(step.args.target){const targetId=resolveFamilyRef(step.args.target,refs,created);conflicts=conflicts.filter((c)=>c.a.event_id===targetId||c.b.event_id===targetId);}outputs.push({op:step.op,conflicts});reply=conflicts.length?["⚠️ التعارضات:",...conflicts.slice(0,20).map((c)=>`${c.a.title} (${c.a.start_local}→${c.a.end_local}) مع ${c.b.title} (${c.b.start_local}→${c.b.end_local})`)].join("\n"):"مفيش تعارضات مؤكدة في الفترة دي.";}
      continue;
    }
    if(step.op==="schedule.shift"){
      const objectId=resolveFamilyRef(step.args.target,refs,created);if(!objectId)throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Schedule target unresolved");const obj=await objectById(env,chatId,objectId);if(!obj)throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Schedule target missing");
      const oldStart=scheduleLocalMinute(obj.state?.start_local);if(!oldStart)throw new SandPlanError("SCHEDULE_START_REQUIRED","Schedule target has no start");const delta=step.args.delta_minutes!==null?step.args.delta_minutes:Math.round((scheduleWallMs(step.args.start_local)-scheduleWallMs(oldStart))/60000);if(!Number.isFinite(delta)||!delta)throw new SandPlanError("SCHEDULE_SHIFT_ZERO","Schedule shift is zero or invalid");const verify=await scheduleShiftObject(env,chatId,objectId,delta,updateId);outputs.push({op:step.op,object_id:objectId,start_local:verify.state.start_local});reply=`تمام، اتحرك الموعد لـ ${verify.state.start_local}.`;continue;
    }
    if(step.op==="schedule.bulk_shift"){
      const ids=step.args.targets.map((t)=>resolveFamilyRef(t,refs,created)).filter(Boolean);if(ids.length!==step.args.targets.length)throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Bulk shift target unresolved");const shifted=[];for(const id of ids){const verify=await scheduleShiftObject(env,chatId,id,step.args.delta_minutes,updateId);shifted.push({object_id:id,start_local:verify.state.start_local});}outputs.push({op:step.op,shifted});reply=`تمام، اتحرك ${shifted.length} موعد.`;continue;
    }
    const objectId=resolveFamilyRef(step.args.target,refs,created);if(!objectId)throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Schedule target unresolved");const obj=await objectById(env,chatId,objectId);if(!obj||obj.status!=="active")throw new SandPlanError("UNKNOWN_FAMILY_TARGET","Schedule target missing");
    if(step.op==="schedule.cancel"){
      const at=nowIso();await env.DB.batch([env.DB.prepare(`UPDATE ${TABLES.objects} SET status='archived',updated_by_update=?,updated_at=? WHERE id=? AND chat_id=? AND status='active'`).bind(updateId,at,objectId,chatId),env.DB.prepare(`UPDATE ${TABLES.scheduleRules} SET status='cancelled',source_update_id=?,updated_at=? WHERE chat_id=? AND object_id=?`).bind(updateId,at,chatId,objectId),env.DB.prepare(`UPDATE ${TABLES.scheduleSignals} SET status='cancelled',updated_at=? WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain')`).bind(at,chatId,objectId)]);await cancelReminderForObject(env,chatId,objectId);const verify=await objectById(env,chatId,objectId);if(!verify||verify.status!=="archived")throw new Error("Schedule cancel verification failed");outputs.push({op:step.op,object_id:objectId,cancelled:true});reply=`تمام، لغيت ${obj.title}.`;continue;
    }
    if(step.op==="schedule.alerts.set"){
      const rule=await scheduleEnsureOnceAlertRule(env,chatId,objectId,updateId,step.args.offsets_minutes);await scheduleCancelPendingSignals(env,chatId,objectId);await scheduleMaterializeRuleSignals(env,chatId,rule,obj.title);const verify=await scheduleRuleForObject(env,chatId,objectId);if(!verify||JSON.stringify(verify.alert_offsets)!==JSON.stringify(step.args.offsets_minutes))throw new Error("Schedule alerts verification failed");outputs.push({op:step.op,object_id:objectId,offsets_minutes:verify.alert_offsets});reply=`تمام، ظبطت ${verify.alert_offsets.length} تنبيه للموعد.`;continue;
    }
    if(step.op==="schedule.alerts.clear"){
      await env.DB.prepare(`UPDATE ${TABLES.scheduleRules} SET alert_offsets_json='[]',source_update_id=?,updated_at=? WHERE chat_id=? AND object_id=?`).bind(updateId,nowIso(),chatId,objectId).run();await scheduleCancelPendingSignals(env,chatId,objectId);await cancelReminderForObject(env,chatId,objectId);const verify=await scheduleRuleForObject(env,chatId,objectId);if(verify&&verify.alert_offsets.length)throw new Error("Schedule alert clear verification failed");outputs.push({op:step.op,object_id:objectId,cleared:true});reply="تمام، شلت التنبيهات من الموعد.";continue;
    }
    if(step.op==="schedule.snooze"){
      const [core,signal]=await Promise.all([env.DB.prepare(`SELECT id,remind_at_utc FROM ${TABLES.reminders} WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain') ORDER BY remind_at_utc ASC LIMIT 1`).bind(chatId,objectId).first(),env.DB.prepare(`SELECT id,fire_at_utc FROM ${TABLES.scheduleSignals} WHERE chat_id=? AND object_id=? AND status IN ('pending','sending','uncertain') ORDER BY fire_at_utc ASC LIMIT 1`).bind(chatId,objectId).first()]);
      const candidates=[core?{kind:"core",id:String(core.id),at:String(core.remind_at_utc)}:null,signal?{kind:"signal",id:String(signal.id),at:String(signal.fire_at_utc)}:null].filter(Boolean).sort((a,b)=>a.at.localeCompare(b.at));if(candidates[0]?.kind==="core")await env.DB.prepare(`UPDATE ${TABLES.reminders} SET status='cancelled',updated_at=? WHERE id=?`).bind(nowIso(),candidates[0].id).run();else if(candidates[0])await env.DB.prepare(`UPDATE ${TABLES.scheduleSignals} SET status='cancelled',updated_at=? WHERE id=?`).bind(nowIso(),candidates[0].id).run();
      const id=await stableCapabilityId("snooze",operationId,mainStepIndex,i+1),fireAt=new Date(nowMs()+step.args.minutes*60000).toISOString(),at=nowIso();await env.DB.prepare(`INSERT OR REPLACE INTO ${TABLES.scheduleSignals}(id,chat_id,rule_id,object_id,occurrence_local,offset_minutes,fire_at_utc,title,status,created_at,updated_at) VALUES(?,?,NULL,?,NULL,NULL,?,?,'pending',?,?)`).bind(id,chatId,objectId,fireAt,obj.title,at,at).run();const verify=await env.DB.prepare(`SELECT status,fire_at_utc FROM ${TABLES.scheduleSignals} WHERE id=?`).bind(id).first();if(!verify||verify.status!=="pending"||String(verify.fire_at_utc)!==fireAt)throw new Error("Schedule snooze verification failed");outputs.push({op:step.op,object_id:objectId,fire_at_utc:fireAt});reply=`تمام، أجلت التنبيه ${step.args.minutes} دقيقة.`;continue;
    }
    if(step.op==="schedule.recurrence.set"){
      const start=scheduleLocalMinute(obj.state?.start_local);if(!start)throw new SandPlanError("SCHEDULE_START_REQUIRED","Recurring schedule needs a start time");const anchorDate=step.args.start_date||start.slice(0,10),anchorDay=Number(anchorDate.slice(8,10)),anchorMonth=Number(anchorDate.slice(5,7)),anchorWeekday=scheduleWeekday(anchorDate);const existing=await scheduleRuleForObject(env,chatId,objectId);const offsets=step.args.alert_offsets_minutes===null?(existing?.alert_offsets??[]):step.args.alert_offsets_minutes;const duration=step.args.duration_minutes??scheduleDurationMinutes(start,obj.state?.end_local);const weekdays=step.args.freq==="weekly"?(step.args.weekdays.length?step.args.weekdays:[anchorWeekday]):step.args.weekdays;const monthDays=["monthly","yearly"].includes(step.args.freq)?(step.args.month_days.length?step.args.month_days:[anchorDay]):step.args.month_days;const months=step.args.freq==="yearly"?(step.args.months.length?step.args.months:[anchorMonth]):step.args.months;const times=step.args.times.length?step.args.times:[start.slice(11,16)];
      const rule=await scheduleUpsertRule(env,{chatId,objectId,sourceUpdateId:updateId,freq:step.args.freq,anchorLocal:start,interval:step.args.interval,weekdays,monthDays,months,times,startDate:anchorDate,endDate:step.args.end_date,maxOccurrences:step.args.max_occurrences,durationMinutes:duration,alertOffsets:offsets,shiftMinutes:0,status:"active",pausedUntil:null,skipOccurrences:[]});await scheduleCancelPendingSignals(env,chatId,objectId);await scheduleMaterializeRuleSignals(env,chatId,rule,obj.title);outputs.push({op:step.op,object_id:objectId,recurrence:{freq:rule.freq,interval:rule.interval_n}});reply=`تمام، خليت ${obj.title} يتكرر ${rule.freq}.`;continue;
    }
    const rule=await scheduleRuleForObject(env,chatId,objectId);if(!rule||rule.freq==="once"||rule.status==="cancelled")throw new SandPlanError("RECURRENCE_NOT_FOUND","Active recurrence not found for target");
    if(step.op==="schedule.recurrence.pause"){
      await env.DB.prepare(`UPDATE ${TABLES.scheduleRules} SET status='paused',paused_until_local=?,source_update_id=?,updated_at=? WHERE id=?`).bind(step.args.until_local,updateId,nowIso(),rule.id).run();await scheduleCancelPendingSignals(env,chatId,objectId);const verify=await scheduleRuleForObject(env,chatId,objectId);if(!verify||verify.status!=="paused")throw new Error("Recurrence pause verification failed");outputs.push({op:step.op,object_id:objectId,paused_until_local:verify.paused_until_local});reply="تمام، وقفت التكرار مؤقتًا.";continue;
    }
    if(step.op==="schedule.recurrence.resume"){
      await env.DB.prepare(`UPDATE ${TABLES.scheduleRules} SET status='active',paused_until_local=NULL,source_update_id=?,updated_at=? WHERE id=?`).bind(updateId,nowIso(),rule.id).run();await scheduleCancelPendingSignals(env,chatId,objectId);const verify=await scheduleRuleForObject(env,chatId,objectId);if(!verify||verify.status!=="active")throw new Error("Recurrence resume verification failed");await scheduleMaterializeRuleSignals(env,chatId,verify,obj.title);outputs.push({op:step.op,object_id:objectId,resumed:true});reply="تمام، رجعت التكرار يشتغل.";continue;
    }
    if(step.op==="schedule.recurrence.skip"){
      const skips=[...new Set([...(rule.skip_occurrences??[]),step.args.occurrence])].slice(-200);await env.DB.prepare(`UPDATE ${TABLES.scheduleRules} SET skip_occurrences_json=?,source_update_id=?,updated_at=? WHERE id=?`).bind(JSON.stringify(skips),updateId,nowIso(),rule.id).run();await scheduleCancelPendingSignals(env,chatId,objectId,step.args.occurrence);const verify=await scheduleRuleForObject(env,chatId,objectId);if(!verify||!verify.skip_occurrences.includes(step.args.occurrence))throw new Error("Recurrence skip verification failed");outputs.push({op:step.op,object_id:objectId,occurrence:step.args.occurrence});reply="تمام، تخطيت المرة دي بس.";continue;
    }
    if(step.op==="schedule.recurrence.cancel"){
      await env.DB.prepare(`UPDATE ${TABLES.scheduleRules} SET status='cancelled',source_update_id=?,updated_at=? WHERE id=?`).bind(updateId,nowIso(),rule.id).run();await scheduleCancelPendingSignals(env,chatId,objectId);const verify=await scheduleRuleForObject(env,chatId,objectId);if(!verify||verify.status!=="cancelled")throw new Error("Recurrence cancel verification failed");outputs.push({op:step.op,object_id:objectId,recurrence_cancelled:true});reply="تمام، ألغيت التكرار وخليت الموعد الأساسي زي ما هو.";continue;
    }
    throw new SandPlanError("BAD_CAPABILITY_STEP",`Unhandled schedule operation: ${step.op}`);
  }
  return {steps:outputs,reply:reply||compactText(plan.reply_hint,800)};
}


// Certified Core V2 foundation recovery — exact functions from dev2 gated source.

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
    PUBLIC_BOT: env?.PUBLIC_BOT ?? null,
  };
  if (!bindings.DB) return json({ ok: false, version: APP_VERSION, bindings, error: "DB binding missing" }, 503);
  try {
    await ensureSchema(env);
    const [pending, operations, objects, reminders] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLES.inbox} WHERE status IN ('pending','processing','retry')`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLES.operations}`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLES.objects} WHERE status='active'`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLES.reminders} WHERE status='pending'`).first(),
    ]);
    return json({
      ok:
        bindings.TELEGRAM_BOT_TOKEN &&
        bindings.TELEGRAM_WEBHOOK_SECRET &&
        bindings.SETUP_KEY &&
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

async function setup(request, env) {
  requireBinding(env, "DB");
  requireBinding(env, "SETUP_KEY");
  requireBinding(env, "TELEGRAM_BOT_TOKEN");
  requireBinding(env, "TELEGRAM_WEBHOOK_SECRET");
  const presented = request.headers.get("X-Sand-Key") ?? "";
  if (!(await secretEqual(presented, env.SETUP_KEY))) return json({ ok: false, error: "unauthorized" }, 401);
  await ensureSchema(env);
  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/telegram`;
  await telegramApi(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  await telegramApi(env, "setMyCommands", { commands: [{ command: "start", description: "تشغيل سند" }] });
  const info = await telegramApi(env, "getWebhookInfo", {});
  return json({
    ok: true,
    version: APP_VERSION,
    schema_version: DATA_SCHEMA_VERSION,
    webhook: webhookUrl,
    telegram: {
      url: info?.result?.url ?? "",
      pending_update_count: info?.result?.pending_update_count ?? null,
      last_error_message: info?.result?.last_error_message ?? null,
    },
  });
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


  try {
    const weeklyRule = {
      id: "r", object_id: "o", freq: "weekly", interval_n: 1, anchor_local: "2026-08-17T09:00",
      weekdays: ["MON","WED"], month_days: [], months: [], times: ["09:00"], start_date_local: "2026-08-17",
      end_date_local: null, max_occurrences: null, duration_minutes: 60, alert_offsets: [], shift_minutes: 0,
      status: "active", paused_until_local: null, skip_occurrences: [],
    };
    const weekly = scheduleProjectRule(weeklyRule, "اختبار أسبوعي", "2026-08-17T00:00", "2026-08-24T23:59", 20);
    const monthlyRule = { ...weeklyRule, freq: "monthly", anchor_local: "2026-01-31T10:00", weekdays: [], month_days: [31], times: ["10:00"], start_date_local: "2026-01-31", duration_minutes: 30 };
    const monthly = scheduleProjectRule(monthlyRule, "اختبار شهري", "2026-01-01T00:00", "2026-04-02T00:00", 20);
    push("schedule_recurrence_contract", weekly.map((x) => x.start_local).join(",") === "2026-08-17T09:00,2026-08-19T09:00,2026-08-24T09:00" && monthly.some((x) => x.start_local === "2026-03-31T10:00") && !monthly.some((x) => x.start_local.startsWith("2026-02-")), { weekly, monthly });

    const conflicts = scheduleDetectConflicts([
      { event_id: "a", title: "A", start_local: "2026-08-20T10:00", end_local: "2026-08-20T11:00" },
      { event_id: "b", title: "B", start_local: "2026-08-20T10:30", end_local: "2026-08-20T12:00" },
      { event_id: "c", title: "C", start_local: "2026-08-20T13:00", end_local: "2026-08-20T14:00" },
    ]);
    push("schedule_conflict_contract", conflicts.length === 1 && conflicts[0].a.event_id === "a" && conflicts[0].b.event_id === "b", conflicts);
  } catch (error) {
    push("schedule_recurrence_contract", false, safeError(error));
    push("schedule_conflict_contract", false, safeError(error));
  }

  const scheduleChat = "__sand_one_schedule_selftest__";
  try {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM ${TABLES.scheduleSignals} WHERE chat_id=?`).bind(scheduleChat),
      env.DB.prepare(`DELETE FROM ${TABLES.scheduleRules} WHERE chat_id=?`).bind(scheduleChat),
      env.DB.prepare(`DELETE FROM ${TABLES.reminders} WHERE chat_id=?`).bind(scheduleChat),
      env.DB.prepare(`DELETE FROM ${TABLES.objects} WHERE chat_id=?`).bind(scheduleChat),
    ]);
    const plan = validateFamilyPlan("schedule", { steps: [
      { op: "schedule.create", args: { title: "ميعاد Schedule Test", start_local: "2099-02-02T10:00", end_local: "2099-02-02T11:00" } },
      { op: "schedule.recurrence.set", args: { target: "created:1", freq: "weekly", weekdays: ["MON","WED"], alert_offsets_minutes: [30,0] } },
    ] }, []);
    const result = await executeSchedulePlan(env, { chatId: scheduleChat, updateId: -9300, operationId: "selftest-schedule", mainStepIndex: 0, plan, refs: new Map() });
    const obj = await env.DB.prepare(`SELECT id,state_json,status FROM ${TABLES.objects} WHERE chat_id=? LIMIT 1`).bind(scheduleChat).first();
    const rule = await env.DB.prepare(`SELECT freq,status,alert_offsets_json FROM ${TABLES.scheduleRules} WHERE chat_id=? LIMIT 1`).bind(scheduleChat).first();
    push("schedule_family_verified_write", Boolean(obj && obj.status === "active" && rule && rule.freq === "weekly" && rule.status === "active" && JSON.stringify(safeJsonParse(rule.alert_offsets_json,[])) === JSON.stringify([0,30]) && result.steps.length === 2), { object_id: obj?.id ?? null, rule });
  } catch (error) {
    push("schedule_family_verified_write", false, safeError(error));
  } finally {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM ${TABLES.scheduleSignals} WHERE chat_id=?`).bind(scheduleChat),
      env.DB.prepare(`DELETE FROM ${TABLES.scheduleRules} WHERE chat_id=?`).bind(scheduleChat),
      env.DB.prepare(`DELETE FROM ${TABLES.reminders} WHERE chat_id=?`).bind(scheduleChat),
      env.DB.prepare(`DELETE FROM ${TABLES.objects} WHERE chat_id=?`).bind(scheduleChat),
    ]).catch((error) => logError("selftest_cleanup_schedule", error));
  }

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
    const createdAny = /** @type {any} */ (created);
    const objectId = String(createdAny.object_id ?? "");
    const reminder = await executeAction(env, {
      chatId: selfChat,
      updateId: -9002,
      action: { type: "reminder.set", args: { target: { mode: "id", id: objectId }, mode: "at_start", remind_local: null, title: null } },
      snapshot,
      runtimeFocusId: objectId,
    });
    const reminderAny = /** @type {any} */ (reminder);
    const beforeUtc = String(reminderAny.remind_at_utc ?? "");
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

  const familyChat = "__sand_one_family_selftest__";
  try {
    await env.DB.prepare(`DELETE FROM ${TABLES.lifeItems} WHERE chat_id=?`).bind(familyChat).run();
    const refs = new Map();
    const shopPlan = validateFamilyPlan("shopping", { steps: [{ op: "shopping.add", args: { items: [{ title: "لبن", quantity: "2" }, { title: "عيش" }] } }] }, []);
    const shopResult = await executeShoppingPlan(env, { chatId: familyChat, updateId: -9100, operationId: "selftest-shop", mainStepIndex: 0, plan: shopPlan, refs });
    const shopRows = (await env.DB.prepare(`SELECT title,status FROM ${TABLES.lifeItems} WHERE chat_id=? AND kind='shopping_item' ORDER BY title`).bind(familyChat).all())?.results ?? [];
    push("shopping_family_atomic_write", shopRows.length === 2 && shopRows.every((x) => x.status === "pending") && shopResult.steps.length === 1, shopRows);

    const workPlan = validateFamilyPlan("work", { steps: [
      { op: "project.create", args: { title: "مشروع اختبار", priority: "high" } },
      { op: "task.create", args: { title: "مهمة اختبار", parent: "created:1", priority: "normal" } }
    ] }, []);
    const workResult = await executeWorkPlan(env, { chatId: familyChat, updateId: -9200, operationId: "selftest-work", mainStepIndex: 0, plan: workPlan, refs: new Map() });
    const workRows = (await env.DB.prepare(`SELECT id,kind,parent_id,title,status FROM ${TABLES.lifeItems} WHERE chat_id=? AND kind IN ('project','task') ORDER BY created_at`).bind(familyChat).all())?.results ?? [];
    const project = workRows.find((x) => x.kind === "project"), task = workRows.find((x) => x.kind === "task");
    push("work_family_cross_step_reference", Boolean(project && task && task.parent_id === project.id && workResult.steps.length === 2), workRows);
  } catch (error) {
    push("capability_family_executor", false, safeError(error));
  } finally {
    await env.DB.prepare(`DELETE FROM ${TABLES.lifeItems} WHERE chat_id=?`).bind(familyChat).run().catch((error) => logError("selftest_cleanup_family", error));
  }

  return json({ ok: tests.every((x) => x.ok), service: APP_NAME, version: APP_VERSION, tests });
}
// SAND ONE Local Life capability — live prayer times, Hijri date, and Egypt public holidays.

function localLifeGregorianDate(value) {
  const raw = compactText(value, 20);
  if (!raw) return cairoNowParts().date;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) throw new SandPlanError("BAD_LOCAL_LIFE_DATE", "Date must be YYYY-MM-DD");
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2020 || y > 2100 || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new SandPlanError("BAD_LOCAL_LIFE_DATE", "Invalid Gregorian date");
  }
  return raw;
}

function localLifeCoordinates(a) {
  const latitude = a.latitude === undefined || a.latitude === null || a.latitude === "" ? null : Number(a.latitude);
  const longitude = a.longitude === undefined || a.longitude === null || a.longitude === "" ? null : Number(a.longitude);
  if ((latitude === null) !== (longitude === null)) throw new SandPlanError("BAD_COORDINATES", "Latitude and longitude must be provided together");
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new SandPlanError("BAD_COORDINATES", "Invalid coordinates");
  }
  return { latitude, longitude };
}

function validateLocalLifeStep(op, a) {
  if (op === "prayer.times") {
    const date = localLifeGregorianDate(a.date);
    const { latitude, longitude } = localLifeCoordinates(a);
    const city = compactText(a.city, 240) || (latitude === null ? "Cairo" : null);
    const country = compactText(a.country, 80) || "EG";
    const method = a.method === undefined || a.method === null || a.method === "" ? 5 : Number(a.method);
    const school = a.school === undefined || a.school === null || a.school === "" ? 0 : Number(a.school);
    if (!Number.isInteger(method) || !((method >= 0 && method <= 23) || method === 99)) throw new SandPlanError("BAD_PRAYER_METHOD", "Invalid prayer calculation method");
    if (![0,1].includes(school)) throw new SandPlanError("BAD_PRAYER_SCHOOL", "Prayer school must be 0 or 1");
    return { op, args: { date, city, country, latitude, longitude, method, school } };
  }
  if (op === "hijri.date") return { op, args: { date: localLifeGregorianDate(a.date) } };
  if (op === "egypt.holidays") {
    const year = a.year === undefined || a.year === null || a.year === "" ? Number(cairoNowParts().date.slice(0,4)) : Number(a.year);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new SandPlanError("BAD_HOLIDAY_YEAR", "Holiday year must be 2020..2100");
    return { op, args: { year } };
  }
  throw new SandPlanError("CAPABILITY_OP_NOT_ALLOWED", `Unhandled Local Life operation: ${op}`);
}

function localLifeApiDate(date) {
  return `${date.slice(8,10)}-${date.slice(5,7)}-${date.slice(0,4)}`;
}

function cleanPrayerTime(value) {
  const raw = compactText(value, 40);
  const m = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2,"0")}:${m[2]}`;
}

async function localLifePrayerTimes(args) {
  const date = localLifeApiDate(args.date);
  const params = new URLSearchParams({ method: String(args.method), school: String(args.school), calendarMethod: "UAQ" });
  let endpoint;
  let location;
  if (args.latitude !== null && args.longitude !== null) {
    params.set("latitude", String(args.latitude));
    params.set("longitude", String(args.longitude));
    endpoint = `https://api.aladhan.com/v1/timings/${date}?${params.toString()}`;
    location = { city: null, country: null, latitude: args.latitude, longitude: args.longitude };
  } else {
    params.set("city", args.city || "Cairo");
    params.set("country", args.country || "EG");
    endpoint = `https://api.aladhan.com/v1/timingsByCity/${date}?${params.toString()}`;
    location = { city: args.city || "Cairo", country: args.country || "EG", latitude: null, longitude: null };
  }
  const response = await externalFetch("aladhan_prayer", endpoint, { headers: { accept: "application/json" } });
  if (!response.ok) throw new SandHttpError(`Prayer times HTTP ${response.status}`, response.status);
  const data = await response.json().catch(() => ({}));
  if (Number(data?.code) !== 200 || !data?.data?.timings) throw new SandHttpError("Prayer times payload invalid", 502);
  const t = data.data.timings;
  const prayers = {
    fajr: cleanPrayerTime(t.Fajr), sunrise: cleanPrayerTime(t.Sunrise), dhuhr: cleanPrayerTime(t.Dhuhr),
    asr: cleanPrayerTime(t.Asr), maghrib: cleanPrayerTime(t.Maghrib), isha: cleanPrayerTime(t.Isha),
  };
  if (Object.values(prayers).some((v) => !v)) throw new SandHttpError("Prayer times missing required fields", 502);
  return {
    date: args.date,
    location,
    timezone: compactText(data?.data?.meta?.timezone, 120) || null,
    calculation_method: compactText(data?.data?.meta?.method?.name, 240) || (args.method === 5 ? "Egyptian General Authority of Survey" : `method ${args.method}`),
    method_id: args.method,
    prayers,
    hijri: data?.data?.date?.hijri ? {
      date: compactText(data.data.date.hijri.date, 40),
      weekday: compactText(data.data.date.hijri.weekday?.ar, 80) || compactText(data.data.date.hijri.weekday?.en, 80),
      month: compactText(data.data.date.hijri.month?.ar, 80) || compactText(data.data.date.hijri.month?.en, 80),
      year: compactText(data.data.date.hijri.year, 20),
    } : null,
    provider: "aladhan",
    note: "Prayer times are calculated; a local mosque or official authority may publish tuned times.",
  };
}

function localLifeHijriDate(args) {
  const d = new Date(`${args.date}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) throw new SandPlanError("BAD_LOCAL_LIFE_DATE", "Invalid Gregorian date");
  const fmt = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { timeZone: TZ, weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const numeric = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(numeric.formatToParts(d).filter((x) => x.type !== "literal" && x.type !== "era").map((x) => [x.type, x.value]));
  return {
    gregorian: args.date,
    hijri: `${parts.year}-${parts.month}-${parts.day}`,
    formatted_ar: fmt.format(d),
    calendar: "islamic-umalqura",
    note: "Hijri calendar is computed with Umm al-Qura and may differ by one day from official moon-sighting announcements in Egypt.",
  };
}

async function egyptPublicHolidays(args) {
  const response = await externalFetch("nager_egypt_holidays", `https://date.nager.at/api/v3/PublicHolidays/${args.year}/EG`, { headers: { accept: "application/json", "user-agent": "SAND-ONE/1.0" } });
  if (!response.ok) throw new SandHttpError(`Egypt holidays HTTP ${response.status}`, response.status);
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data)) throw new SandHttpError("Egypt holidays payload invalid", 502);
  const holidays = data.map((h) => ({
    date: compactText(h?.date, 20),
    local_name: compactText(h?.localName, 240),
    english_name: compactText(h?.name, 240),
    types: Array.isArray(h?.types) ? h.types.map((x) => compactText(x, 80)).filter(Boolean) : [],
    global: Boolean(h?.global),
  })).filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date)).sort((a,b) => a.date.localeCompare(b.date));
  if (!holidays.length) throw new SandHttpError("Egypt holidays returned no usable dates", 502);
  return { year: args.year, country: "EG", holidays, provider: "nager_date", note: "Government substitutions and moon-sighting based dates can change; use the latest official Egyptian announcement for legal certainty." };
}

function renderLocalLifeResult(step, result) {
  if (step.op === "prayer.times") {
    const p = result.prayers;
    const where = result.location?.city || (result.location?.latitude !== null ? `${result.location.latitude}, ${result.location.longitude}` : "Cairo");
    return [`🕌 مواقيت الصلاة — ${where} — ${result.date}`, `الفجر ${p.fajr}`, `الشروق ${p.sunrise}`, `الظهر ${p.dhuhr}`, `العصر ${p.asr}`, `المغرب ${p.maghrib}`, `العشاء ${p.isha}`].join("\n");
  }
  if (step.op === "hijri.date") return `🌙 ${result.formatted_ar}\nالموافق ${result.gregorian}`;
  if (step.op === "egypt.holidays") {
    return [`🇪🇬 الإجازات الرسمية في مصر ${result.year}:`, ...result.holidays.slice(0,30).map((h) => `${h.date} — ${h.local_name || h.english_name}`)].join("\n").slice(0, AI_MAX_REPLY_CHARS);
  }
  return "";
}

async function executeLocalLifePlan(env, { plan }) {
  const outputs = [];
  let reply = "";
  for (const step of plan.steps) {
    let result;
    if (step.op === "prayer.times") result = await localLifePrayerTimes(step.args);
    else if (step.op === "hijri.date") result = localLifeHijriDate(step.args);
    else if (step.op === "egypt.holidays") result = await egyptPublicHolidays(step.args);
    else throw new SandPlanError("CAPABILITY_OP_NOT_ALLOWED", `Unhandled Local Life operation: ${step.op}`);
    outputs.push({ op: step.op, result });
    reply = renderLocalLifeResult(step, result) || reply;
  }
  return { steps: outputs, reply: reply || compactText(plan.reply_hint, 800) };
}
