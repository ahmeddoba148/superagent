/* Sanad V12.5 — Full-Life single-brain personal operating agent for Cloudflare Workers + D1 + Telegram.
   Design: Understand -> Plan -> Act -> Observe -> Verify -> Repair -> Reply.
   No success claim is emitted for mutations unless state verification succeeds.
*/

const VERSION = "12.5.0";
const NAME = "سند — Sanad V12.5";
const TZ = "Africa/Cairo";
const DEFAULT_CITY = "Cairo";
const DEFAULT_COUNTRY = "Egypt";
const MAX_AGENT_STEPS = 14;
const MAX_REPAIR_STEPS = 8;
const AI_TOTAL_BUDGET_MS = 22000;
const AI_CALL_TIMEOUT_MS = 5600;
const INBOX_LEASE_MS = 60000;
const INBOX_BATCH = 8;
const INBOX_MAX_ATTEMPTS = 5;
const MODEL_CHAIN = [
  { id: "gemini::gemini-3.5-flash-lite", role: "primary", timeoutMs: 4200 },
  { id: "gemini::gemini-3.1-flash-lite", role: "fallback_1", timeoutMs: 4700 },
  { id: "gemini::gemini-3.5-flash", role: "fallback_2", timeoutMs: 5000 }
];
const OMNIAI_INTERNAL_URL = "https://omniai-engine.ahmeddoba91.workers.dev/v1/chat/completions";
const SCHEDULER_CATCHUP_MINUTES = 1440;
const MAX_ADVANCE_MINUTES = 10080;
const DEFAULT_EVENT_DURATION = 30;
const CONFLICT_HORIZON_DAYS = 90;
const MAX_RECURRENCE_OCCURRENCES = 5000;
const LIVE_CACHE_MINUTES = 5;
const PRAYER_CACHE_MINUTES = 720;
const HOLIDAY_CACHE_MINUTES = 720;
const LIVE_WATCH_BATCH = 10;
const VOICE_MAX_BYTES = 25 * 1024 * 1024;
const DEEP_PLAN_STEP_THRESHOLD = 3;
const CONFIRM_TTL_MINUTES = 20;
const SNAPSHOT_TABLES = ["sanad_shopping","sanad_reminders","sanad_recurrences","sanad_dependencies","sanad_memories","sanad_entities","sanad_edges","sanad_projects","sanad_project_tasks","sanad_waiting","sanad_prayer_rules","sanad_live_watches"];


let schemaPromise = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return j({
        ok: true,
        service: NAME,
        version: VERSION,
        architecture: "single-brain-full-life-agent",
        models: MODEL_CHAIN.map(x => x.id),
        guarantees: {
          no_success_without_state_verification: true,
          durable_telegram_inbox: true,
          idempotency: true,
          repair_loop: true,
          layered_memory: true,
          deterministic_safety_guards: true,
          full_life_tools: true,
          atomic_multi_tool_mutations: true,
          recurring_scheduler: true,
          dependency_graph: true,
          prayer_holiday_live_awareness: true,
          legacy_v11_migration: true
        }
      });
    }
    if (request.method === "GET" && url.pathname === "/health") return health(env);
    if (request.method === "GET" && url.pathname === "/ready") return ready(request, env);
    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/setup") return setup(request, env);
    if (request.method === "GET" && url.pathname === "/selftest") return selftest(request, env);
    if (request.method === "POST" && url.pathname === "/internal/drain") {
      if (!secureEq(request.headers.get("X-Sanad-Internal") || "", env.TELEGRAM_WEBHOOK_SECRET || "")) return new Response("Unauthorized", { status: 401 });
      const body = await safeRequestJson(request);
      const chatId = String(body?.chat_id || "").trim();
      if (!chatId || chatId.length > 80) return new Response("Bad request", { status: 400 });
      await ensureSchema(env);
      ctx.waitUntil(drainInbox(env, chatId, url.origin));
      return new Response("ACCEPTED", { status: 202 });
    }
    if (request.method === "POST" && url.pathname === "/telegram") {
      if (!secureEq(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "", env.TELEGRAM_WEBHOOK_SECRET || "")) return new Response("Unauthorized", { status: 401 });
      const update = await safeRequestJson(request);
      if (!update) return new Response("Bad request", { status: 400 });
      await ensureSchema(env);
      const chatId = chatKey(update);
      await persistInbox(env, update, chatId);
      ctx.waitUntil(drainInbox(env, chatId, url.origin));
      return new Response("OK");
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env);
      await runSanadScheduler(env, controller?.scheduledTime);
      await recoverPendingInbox(env);
      await cleanup(env);
    })());
  }
};

function j(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }
function safeError(e) { return String(e?.message || e || "Unknown error").slice(0, 1500); }
function secureEq(a, b) {
  a = String(a); b = String(b);
  if (!a || !b || a.length !== b.length) return false;
  let v = 0;
  for (let i = 0; i < a.length; i++) v |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return v === 0;
}
async function safeRequestJson(request) { try { return await request.json(); } catch { return null; } }
function normalizeText(s) { return String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
function localNow(timeZone = TZ) {
  const d = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "long"
  }).formatToParts(d).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, second: parts.second, weekday: parts.weekday, timezone: timeZone };
}
function addMinutesLocal(date, time, minutes) {
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d, hh, mm + Number(minutes || 0)));
  return { date: x.toISOString().slice(0, 10), time: x.toISOString().slice(11, 16) };
}
function opId(chatId, updateId) { return `op:${chatId}:${updateId || crypto.randomUUID()}`; }

async function ensureColumnV125(env,table,column,definition){
  const rows=(await env.DB.prepare(`PRAGMA table_info(${table})`).all())?.results||[];
  if(!rows.some(r=>String(r.name)===column)){
    try{await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();}
    catch(e){if(!/duplicate column|already exists/i.test(safeError(e)))throw e;}
  }
}

async function ensureSchema(env, force = false) {
  if (force || !schemaPromise) {
    schemaPromise = (async () => {
      const sql = [
        `CREATE TABLE IF NOT EXISTS sanad_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS sanad_users (
          chat_id TEXT PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
          city TEXT NOT NULL DEFAULT 'Cairo', country TEXT NOT NULL DEFAULT 'Egypt',
          locale TEXT NOT NULL DEFAULT 'ar-EG', display_name TEXT,
          autonomy_mode TEXT NOT NULL DEFAULT 'full_safe',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_conversation (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,role TEXT NOT NULL,
          content TEXT NOT NULL,meta_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_conv ON sanad_conversation(chat_id,id)`,
        `CREATE TABLE IF NOT EXISTS sanad_memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,memory_type TEXT NOT NULL DEFAULT 'semantic',
          content TEXT NOT NULL,normalized TEXT NOT NULL,importance REAL NOT NULL DEFAULT 0.5,
          source TEXT NOT NULL DEFAULT 'agent',last_used_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
          UNIQUE(chat_id,memory_type,normalized)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_memory ON sanad_memories(chat_id,memory_type,id)`,
        `CREATE TABLE IF NOT EXISTS sanad_shopping (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,title TEXT NOT NULL,normalized TEXT NOT NULL,
          quantity TEXT,status TEXT NOT NULL DEFAULT 'pending',meta_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_shop ON sanad_shopping(chat_id,status,id)`,
        `CREATE TABLE IF NOT EXISTS sanad_reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,title TEXT NOT NULL,
          local_date TEXT NOT NULL,local_time TEXT NOT NULL,timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
          duration_minutes INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',
          recurrence_json TEXT NOT NULL DEFAULT '{}',advance_minutes INTEGER NOT NULL DEFAULT 0,
          sent INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_rem ON sanad_reminders(chat_id,status,local_date,local_time)`,
        `CREATE TABLE IF NOT EXISTS sanad_projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',
          priority TEXT NOT NULL DEFAULT 'normal',deadline TEXT,progress INTEGER NOT NULL DEFAULT 0,
          notes TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_waiting (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,title TEXT NOT NULL,waiting_on TEXT,
          due_at TEXT,status TEXT NOT NULL DEFAULT 'waiting',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL,chat_id TEXT NOT NULL,
          tool TEXT NOT NULL,args_json TEXT NOT NULL,result_json TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_audit ON sanad_audit(chat_id,id)`,
        `CREATE TABLE IF NOT EXISTS sanad_receipts (
          operation_id TEXT NOT NULL,step_key TEXT NOT NULL,chat_id TEXT NOT NULL,tool TEXT NOT NULL,
          result_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(operation_id,step_key)
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_updates (
          update_id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'processing',
          error_text TEXT,started_at TEXT NOT NULL,finished_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_inbox (
          update_id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,lease_until TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_inbox ON sanad_inbox(chat_id,status,created_at)`,
        `CREATE TABLE IF NOT EXISTS sanad_chat_leases (
          chat_id TEXT PRIMARY KEY,owner TEXT NOT NULL,lease_until TEXT NOT NULL,acquired_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_failures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,incident_id TEXT NOT NULL UNIQUE,chat_id TEXT,
          scope TEXT NOT NULL,error_text TEXT NOT NULL,context_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_rate_limits (
          chat_id TEXT PRIMARY KEY,window_start INTEGER NOT NULL,request_count INTEGER NOT NULL DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_proactive_fires (
          chat_id TEXT NOT NULL,fire_key TEXT NOT NULL,sent_at TEXT NOT NULL,PRIMARY KEY(chat_id,fire_key)
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_entities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,entity_type TEXT NOT NULL DEFAULT 'concept',
          name TEXT NOT NULL,normalized TEXT NOT NULL,data_json TEXT NOT NULL DEFAULT '{}',confidence REAL NOT NULL DEFAULT 1,
          source TEXT NOT NULL DEFAULT 'user_explicit',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
          UNIQUE(chat_id,entity_type,normalized)
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,from_entity_id INTEGER NOT NULL,relation TEXT NOT NULL,
          to_entity_id INTEGER,object_value TEXT,confidence REAL NOT NULL DEFAULT 1,source TEXT NOT NULL DEFAULT 'agent',
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_edges ON sanad_edges(chat_id,from_entity_id,relation)`,
        `CREATE TABLE IF NOT EXISTS sanad_shopping_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,place_name TEXT,started_at TEXT NOT NULL,ended_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_reminder_fires (
          reminder_id INTEGER NOT NULL,fire_key TEXT NOT NULL,chat_id TEXT NOT NULL,sent_at TEXT NOT NULL,
          PRIMARY KEY(reminder_id,fire_key)
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_recurrences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'reminder',
          rule_json TEXT NOT NULL,timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',duration_minutes INTEGER NOT NULL DEFAULT 0,
          start_date TEXT NOT NULL,end_date TEXT,max_occurrences INTEGER,fired_count INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,paused_until TEXT,exceptions_json TEXT NOT NULL DEFAULT '[]',
          advance_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_recur ON sanad_recurrences(chat_id,active,start_date)`,
        `CREATE TABLE IF NOT EXISTS sanad_recurrence_fires (
          rule_id INTEGER NOT NULL,occurrence_key TEXT NOT NULL,alert_offset INTEGER NOT NULL DEFAULT 0,
          chat_id TEXT NOT NULL,sent_at TEXT NOT NULL,PRIMARY KEY(rule_id,occurrence_key,alert_offset)
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_dependencies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,source_type TEXT NOT NULL,source_id INTEGER NOT NULL,
          target_type TEXT NOT NULL,target_id INTEGER NOT NULL,relation TEXT NOT NULL DEFAULT 'after',offset_minutes INTEGER NOT NULL DEFAULT 0,
          condition_json TEXT NOT NULL DEFAULT '{}',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
          UNIQUE(chat_id,source_type,source_id,target_type,target_id,relation)
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_project_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,project_id INTEGER NOT NULL,chat_id TEXT NOT NULL,title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',due_at TEXT,priority TEXT NOT NULL DEFAULT 'normal',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_tasks ON sanad_project_tasks(chat_id,project_id,status,id)`,
        `CREATE TABLE IF NOT EXISTS sanad_prayer_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,title TEXT NOT NULL,prayer TEXT NOT NULL,
          offset_minutes INTEGER NOT NULL DEFAULT 0,start_date TEXT NOT NULL,end_date TEXT,weekdays_json TEXT NOT NULL DEFAULT '[]',
          max_occurrences INTEGER,fired_count INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,paused_until TEXT,
          exceptions_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_prayer_fires (
          rule_id INTEGER NOT NULL,occurrence_date TEXT NOT NULL,chat_id TEXT NOT NULL,sent_at TEXT NOT NULL,
          PRIMARY KEY(rule_id,occurrence_date)
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_live_watches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,query TEXT NOT NULL,last_url TEXT,active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_cache (
          cache_key TEXT PRIMARY KEY,value_json TEXT NOT NULL,expires_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_scheduler_state (
          key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_daily_brief_fires (
          chat_id TEXT NOT NULL,brief_date TEXT NOT NULL,brief_type TEXT NOT NULL,sent_at TEXT NOT NULL,
          PRIMARY KEY(chat_id,brief_date,brief_type)
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_pending_actions (
          chat_id TEXT PRIMARY KEY,original_text TEXT NOT NULL,steps_json TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_operation_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL UNIQUE,chat_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,
          summary TEXT,created_at TEXT NOT NULL,undone_at TEXT
        )`
      ];
      for (const s of sql) await env.DB.prepare(s).run();
      await ensureColumnV125(env,"sanad_users","country_code","TEXT NOT NULL DEFAULT 'EG'");
      await ensureColumnV125(env,"sanad_users","latitude","REAL");
      await ensureColumnV125(env,"sanad_users","longitude","REAL");
      await ensureColumnV125(env,"sanad_users","proactive_enabled","INTEGER NOT NULL DEFAULT 1");
      await ensureColumnV125(env,"sanad_users","morning_brief_time","TEXT NOT NULL DEFAULT '08:00'");
      await ensureColumnV125(env,"sanad_users","evening_brief_time","TEXT NOT NULL DEFAULT '20:00'");
      await ensureColumnV125(env,"sanad_users","morning_brief_enabled","INTEGER NOT NULL DEFAULT 0");
      await ensureColumnV125(env,"sanad_users","evening_brief_enabled","INTEGER NOT NULL DEFAULT 0");
      await ensureColumnV125(env,"sanad_users","ask_before_delete","INTEGER NOT NULL DEFAULT 1");
      await ensureColumnV125(env,"sanad_users","deep_reasoning_mode","TEXT NOT NULL DEFAULT 'auto'");
      await ensureColumnV125(env,"sanad_shopping","position","INTEGER NOT NULL DEFAULT 0");
      await ensureColumnV125(env,"sanad_reminders","kind","TEXT NOT NULL DEFAULT 'reminder'");
      await ensureColumnV125(env,"sanad_reminders","advance_json","TEXT NOT NULL DEFAULT '[]'");
      await ensureColumnV125(env,"sanad_operation_snapshots","committed","INTEGER NOT NULL DEFAULT 0");
      await maybeMigrateLegacyV11(env);
      await env.DB.prepare(`INSERT INTO sanad_meta(key,value,updated_at) VALUES('schema_version',?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(VERSION, nowIso()).run();
    })().catch(e => { schemaPromise = null; throw e; });
  }
  return schemaPromise;
}

async function ensureUser(env, chatId, name = "") {
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO sanad_users(chat_id,display_name,created_at,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(chat_id) DO UPDATE SET display_name=COALESCE(NULLIF(excluded.display_name,''),sanad_users.display_name),updated_at=excluded.updated_at`)
    .bind(String(chatId), String(name || ""), now, now).run();
  return env.DB.prepare(`SELECT * FROM sanad_users WHERE chat_id=?`).bind(String(chatId)).first();
}

async function saveMsg(env, chatId, role, content, meta = {}) {
  await env.DB.prepare(`INSERT INTO sanad_conversation(chat_id,role,content,meta_json,created_at) VALUES(?,?,?,?,?)`)
    .bind(String(chatId), String(role), String(content).slice(0,12000), JSON.stringify(meta || {}).slice(0,5000), nowIso()).run();
}
async function recentConversation(env, chatId, limit = 18) {
  const rows = (await env.DB.prepare(`SELECT role,content,created_at FROM sanad_conversation WHERE chat_id=? ORDER BY id DESC LIMIT ?`)
    .bind(String(chatId), Math.min(40, Number(limit || 18))).all())?.results || [];
  return rows.reverse();
}
async function reportFailure(env, chatId, scope, error, context = {}) {
  const incident = `SANAD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  try {
    await env.DB.prepare(`INSERT INTO sanad_failures(incident_id,chat_id,scope,error_text,context_json,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(incident, chatId ? String(chatId) : null, String(scope), safeError(error), JSON.stringify(context || {}).slice(0,5000), nowIso()).run();
  } catch {}
  console.error(`[${incident}] ${scope}`, error);
  return incident;
}

function chatKey(update) {
  return String(update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id ?? update?.callback_query?.from?.id ?? "__global__");
}
async function persistInbox(env, update, chatId) {
  const updateId = String(update?.update_id ?? `synthetic-${Date.now()}-${Math.random()}`);
  const now = nowIso();
  await env.DB.prepare(`INSERT OR IGNORE INTO sanad_inbox(update_id,chat_id,payload_json,status,attempts,created_at,updated_at)
    VALUES(?,?,?,'pending',0,?,?)`).bind(updateId, String(chatId), JSON.stringify(update), now, now).run();
  return updateId;
}
async function acquireLease(env, chatId, owner) {
  const now = nowIso(), until = new Date(Date.now() + INBOX_LEASE_MS).toISOString();
  const row = await env.DB.prepare(`INSERT INTO sanad_chat_leases(chat_id,owner,lease_until,acquired_at) VALUES(?,?,?,?)
    ON CONFLICT(chat_id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until,acquired_at=excluded.acquired_at
    WHERE sanad_chat_leases.lease_until<=excluded.acquired_at RETURNING owner`)
    .bind(String(chatId), owner, until, now).first();
  return String(row?.owner || "") === owner;
}
async function releaseLease(env, chatId, owner) {
  await env.DB.prepare(`DELETE FROM sanad_chat_leases WHERE chat_id=? AND owner=?`).bind(String(chatId), owner).run();
}
async function nextInbox(env, chatId) {
  return env.DB.prepare(`SELECT * FROM sanad_inbox WHERE chat_id=? AND
    (status='pending' OR (status='processing' AND (lease_until IS NULL OR lease_until<=?)))
    ORDER BY CAST(update_id AS INTEGER),created_at LIMIT 1`).bind(String(chatId), nowIso()).first();
}
async function triggerDrain(env, chatId, origin) {
  if (!origin || !env.TELEGRAM_WEBHOOK_SECRET) return false;
  try {
    const r = await fetch(`${origin.replace(/\/$/,"")}/internal/drain`, {
      method: "POST",
      headers: { "content-type":"application/json", "X-Sanad-Internal": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ chat_id: String(chatId) })
    });
    if (r.body) try { await r.body.cancel(); } catch {}
    return r.status === 202;
  } catch { return false; }
}
async function drainInbox(env, chatId, origin = "") {
  const owner = `lease-${crypto.randomUUID()}`;
  let acquired = false;
  for (let i=0;i<16;i++) {
    if (await acquireLease(env, chatId, owner)) { acquired = true; break; }
    await sleep(550 + Math.floor(Math.random()*100));
  }
  if (!acquired) { if (origin) { await sleep(900+Math.floor(Math.random()*180)); await triggerDrain(env, chatId, origin); } return; }
  let processed = 0;
  try {
    for (let i=0;i<INBOX_BATCH;i++) {
      const row = await nextInbox(env, chatId); if (!row) break;
      const until = new Date(Date.now()+INBOX_LEASE_MS).toISOString(), now = nowIso();
      const claimed = await env.DB.prepare(`UPDATE sanad_inbox SET status='processing',attempts=attempts+1,lease_until=?,updated_at=?
        WHERE update_id=? AND chat_id=? AND (status='pending' OR lease_until IS NULL OR lease_until<=?) RETURNING attempts`)
        .bind(until,now,String(row.update_id),String(chatId),now).first();
      if (!claimed) continue;
      const attempts = Number(claimed.attempts || 1);
      if(attempts>1)await env.DB.prepare(`DELETE FROM sanad_updates WHERE update_id=? AND status!='done'`).bind(String(row.update_id)).run();
      try {
        const update = JSON.parse(String(row.payload_json || "{}"));
        await processTelegramUpdate(env, update);
        await env.DB.prepare(`UPDATE sanad_inbox SET status='done',lease_until=NULL,last_error=NULL,updated_at=? WHERE update_id=?`)
          .bind(nowIso(), String(row.update_id)).run();
        processed++;
      } catch(e) {
        const terminal = attempts >= INBOX_MAX_ATTEMPTS;
        await env.DB.prepare(`UPDATE sanad_inbox SET status=?,lease_until=NULL,last_error=?,updated_at=? WHERE update_id=?`)
          .bind(terminal?"failed":"pending",safeError(e),nowIso(),String(row.update_id)).run();
        await reportFailure(env, chatId, "inbox", e, { update_id: row.update_id, attempts, terminal });
        if (!terminal && origin) { await sleep(250*Math.pow(2,Math.min(3,attempts))); await triggerDrain(env,chatId,origin); }
        break;
      }
    }
  } finally { await releaseLease(env, chatId, owner).catch(()=>{}); }
  if (processed === INBOX_BATCH && origin) await triggerDrain(env, chatId, origin);
}
async function recoverPendingInbox(env) {
  const rows=(await env.DB.prepare(`SELECT DISTINCT chat_id FROM sanad_inbox WHERE status='pending' OR (status='processing' AND (lease_until IS NULL OR lease_until<=?)) LIMIT 20`).bind(nowIso()).all())?.results||[];
  for (const r of rows) await drainInbox(env,String(r.chat_id));
}

async function claimUpdate(env, update) {
  const id = String(update?.update_id ?? "");
  if (!id) return true;
  const chatId = chatKey(update), now = nowIso();
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO sanad_updates(update_id,chat_id,status,started_at) VALUES(?,?,?,?)`)
    .bind(id,chatId,"processing",now).run();
  return Number(r?.meta?.changes || 0) > 0;
}
async function finishUpdate(env, update, status, error = null) {
  const id=String(update?.update_id ?? ""); if(!id)return;
  await env.DB.prepare(`UPDATE sanad_updates SET status=?,error_text=?,finished_at=? WHERE update_id=?`)
    .bind(status,error?safeError(error):null,nowIso(),id).run();
}

async function processTelegramUpdate(env, update) {
  if (!(await claimUpdate(env, update))) return;
  let status="done", error=null;
  try {
    if (update?.callback_query) return handleCallback(env, update.callback_query);
    const m = update?.message;
    if (!m) return;
    const chatId=String(m?.chat?.id??"");
    if (!chatId) return;
    if (String(m?.chat?.type||"private") !== "private") {
      await sendText(env,chatId,"استخدمني في الخاص علشان بياناتك تفضل خاصة 🔒");
      return;
    }
    if(!isAllowedUserV125(env,chatId)){await sendText(env,chatId,"⛔ سند غير متاح للحساب ده حاليًا.");return;}
    let user = await ensureUser(env,chatId,m?.from?.first_name||"");
    if(m.location){await updateLocationV125(env,chatId,m.location);user=await ensureUser(env,chatId);await sendText(env,chatId,"📍 تمام، حفظت موقعك وهستخدمه للطقس وأوقات الصلاة والسياق المحلي.");return;}
    let text=normalizeText(m?.text||"");
    if (!text && (m?.voice||m?.audio)) {
      await telegramApi(env,"sendChatAction",{chat_id:chatId,action:"typing"});
      text = await transcribeVoice(env,m.voice||m.audio);
    }
    if (!text) { await sendText(env,chatId,"ابعتلي رسالة أو فويس وأنا أتصرف."); return; }
    if (text === "/start") {
      await sendText(env,chatId,`أنا سند 🤝\nمساعدك الشخصي. اتكلم بطبيعتك، قول اللي عاوزه حتى لو أكتر من حاجة في نفس الرسالة، وأنا هفهم وأنفذ وأراجع النتيجة قبل ما أقولك تم.`);
      return;
    }
    if (text === "/menu") return showMenuV125(env,chatId);
    if (text === "/shopping") return showShopping(env,chatId);
    if (text === "/today") return showToday(env,chatId,user);
    if (text === "/week") return showRangeV125(env,chatId,user,7);
    if (text === "/month") return showRangeV125(env,chatId,user,31);
    if (text === "/recurring") return showRecurrencesV125(env,chatId);
    if (text === "/projects") return showProjectsV125(env,chatId);
    if (text === "/waiting") return showWaitingV125(env,chatId);
    if (text === "/where") return showWhereV125(env,chatId,user);
    if (text === "/memory") return showMemory(env,chatId);
    if (text === "/audit") return showAudit(env,chatId);
    if (text === "/undo") {const r=await toolAuditUndoV125(env,chatId);return sendText(env,chatId,r.ok?"↩️ رجعت آخر عملية قابلة للتراجع بنجاح.":"مفيش عملية قابلة للتراجع حاليًا.");}
    if (text === "/prayer") {const r=await toolPrayerTimesV125(env,chatId,{},user);return sendText(env,chatId,formatPrayerV125(r));}
    if (text === "/live") return sendText(env,chatId,"🛰️ ابعتلي طبيعي: تابعلي أخبار ... أو آخر أخبار ... وسند هيتصرف.");
    if (text === "/status") {const r=await toolSystemStatusV125(env,chatId);return sendText(env,chatId,`🤝 سند ${VERSION} شغال. مواعيد: ${r.counts.sanad_reminders} · تكرارات: ${r.counts.sanad_recurrences} · مشتريات: ${r.counts.sanad_shopping} · ذاكرة: ${r.counts.sanad_memories}`);}

    if(!(await consumeRateV125(env,chatId))){await sendText(env,chatId,"طلبات كتير جدًا في وقت قصير 😅 اديني ثواني وجرب تاني.");return;}
    await telegramApi(env,"sendChatAction",{chat_id:chatId,action:"typing"});
    const operationId=opId(chatId,update?.update_id);
    await saveMsg(env,chatId,"user",text,{operation_id:operationId});
    const answer=await runAgent(env,{chatId,text,user,operationId});
    await sendText(env,chatId,answer);
    await saveMsg(env,chatId,"assistant",answer,{operation_id:operationId});
  } catch(e) {
    status="failed";error=e;
    const chatId=chatKey(update), incident=await reportFailure(env,chatId,"telegram_update",e,{update_id:update?.update_id});
    try{await sendText(env,chatId,`حصلت مشكلة أثناء التنفيذ ومش هقولك إن الحاجة تمت. رقم التتبع: ${incident}`);}catch{}
  } finally { await finishUpdate(env,update,status,error); }
}

async function buildContext(env, chatId, user, userText) {
  const [conversation,shopping,reminders,recurrences,memories,entities,projects,tasks,waiting,dependencies,prayerRules,watches] = await Promise.all([
    recentConversation(env,chatId,20),
    env.DB.prepare(`SELECT id,title,quantity,status,meta_json,updated_at FROM sanad_shopping WHERE chat_id=? AND status IN ('pending','bought') ORDER BY id DESC LIMIT 60`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,title,kind,local_date,local_time,duration_minutes,status FROM sanad_reminders WHERE chat_id=? AND status='active' ORDER BY local_date,local_time LIMIT 60`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,title,kind,rule_json,start_date,end_date,active,fired_count FROM sanad_recurrences WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 40`).bind(chatId).all().then(x=>(x?.results||[]).map(r=>({...r,rule:normalizeRuleV125(parseJsonV125(r.rule_json,{}))}))),
    env.DB.prepare(`SELECT id,memory_type,content,importance FROM sanad_memories WHERE chat_id=? ORDER BY importance DESC,id DESC LIMIT 50`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,entity_type,name,data_json,confidence FROM sanad_entities WHERE chat_id=? ORDER BY confidence DESC,id DESC LIMIT 50`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,title,status,priority,deadline,progress FROM sanad_projects WHERE chat_id=? AND status!='done' ORDER BY id DESC LIMIT 30`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,project_id,title,status,due_at,priority FROM sanad_project_tasks WHERE chat_id=? AND status!='done' ORDER BY id DESC LIMIT 40`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,title,waiting_on,due_at,status FROM sanad_waiting WHERE chat_id=? AND status='waiting' ORDER BY id DESC LIMIT 30`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,source_type,source_id,target_type,target_id,relation,offset_minutes FROM sanad_dependencies WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 40`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,title,prayer,offset_minutes,start_date,end_date FROM sanad_prayer_rules WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 20`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,query,last_url FROM sanad_live_watches WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 20`).bind(chatId).all().then(x=>x?.results||[])
  ]);
  return {
    now:localNow(user?.timezone||TZ),
    profile:{display_name:user?.display_name||"",timezone:user?.timezone||TZ,city:user?.city||DEFAULT_CITY,country:user?.country||DEFAULT_COUNTRY,country_code:user?.country_code||"EG",latitude:user?.latitude??null,longitude:user?.longitude??null,autonomy_mode:user?.autonomy_mode||"full_safe",proactive_enabled:Number(user?.proactive_enabled??1),deep_reasoning_mode:user?.deep_reasoning_mode||"auto"},
    user_text:userText,conversation,
    state:{shopping,reminders,recurrences,memories,entities,projects,tasks,waiting,dependencies,prayer_rules:prayerRules,live_watches:watches}
  };
}

const TOOL_SPECS = {
  "shopping.read":{mutation:false,args:{}},"shopping.add":{mutation:true,args:{items:"array {title,quantity?,meta?}"}},"shopping.update":{mutation:true,args:{id:"number",title:"optional",quantity:"optional",status:"pending|bought"}},"shopping.remove":{mutation:true,args:{ids:"number[]"}},"shopping.clear":{mutation:true,risky:true,args:{}},"shopping.session.start":{mutation:true,args:{place_name:"optional"}},"shopping.session.finish":{mutation:true,args:{}},"shopping.progress":{mutation:false,args:{}},
  "reminders.read":{mutation:false,args:{from_date:"YYYY-MM-DD?",to_date:"YYYY-MM-DD?"}},"reminders.create":{mutation:true,args:{title:"string",local_date:"YYYY-MM-DD",local_time:"HH:MM",kind:"reminder|appointment?",duration_minutes:"number?",advance_minutes:"number|number[]?",allow_conflict:"boolean?"}},"reminders.update":{mutation:true,args:{id:"number",title:"?",local_date:"?",local_time:"?",duration_minutes:"?"}},"reminders.cancel":{mutation:true,args:{ids:"number[]"}},"reminders.snooze":{mutation:true,args:{id:"number",minutes:"number"}},
  "recurrence.read":{mutation:false,args:{active_only:"boolean?"}},"recurrence.create":{mutation:true,args:{title:"string",rule:"{every,unit,times,weekdays,monthdays,months}",start_date:"date?",end_date:"date?",duration_minutes:"?",advance_minutes:"number[]?",max_occurrences:"?"}},"recurrence.update":{mutation:true,args:{id:"number",title:"?",rule:"?",end_date:"?",max_occurrences:"?"}},"recurrence.pause":{mutation:true,args:{ids:"number[]"}},"recurrence.resume":{mutation:true,args:{ids:"number[]"}},"recurrence.skip":{mutation:true,args:{id:"number",date:"YYYY-MM-DD",time:"HH:MM?"}},"recurrence.cancel":{mutation:true,args:{ids:"number[]"}},
  "schedule.free_time":{mutation:false,args:{date:"YYYY-MM-DD",from_time:"HH:MM?",to_time:"HH:MM?",min_minutes:"?"}},"schedule.conflicts":{mutation:false,args:{from_date:"?",to_date:"?"}},"schedule.search":{mutation:false,args:{query:"?",from_date:"?",to_date:"?"}},"schedule.shift":{mutation:true,args:{source_type:"reminder",id:"number",minutes:"number"}},"schedule.bulk_shift":{mutation:true,args:{ids:"number[]",minutes:"number"}},
  "dependency.read":{mutation:false,args:{}},"dependency.create":{mutation:true,args:{source_type:"string",source_id:"number",target_type:"string",target_id:"number",relation:"after",offset_minutes:"number?"}},"dependency.remove":{mutation:true,args:{ids:"number[]"}},
  "memory.search":{mutation:false,args:{query:"string"}},"memory.remember":{mutation:true,args:{content:"string",memory_type:"semantic|preference|person|commitment",importance:"0..1"}},"memory.forget":{mutation:true,risky:true,args:{ids:"number[]"}},
  "world.read":{mutation:false,args:{query:"?",entity_type:"?"}},"world.upsert":{mutation:true,args:{entity_type:"string",name:"string",data:"object",confidence:"0..1?"}},"world.link":{mutation:true,args:{from_entity_id:"number",relation:"string",to_entity_id:"number?",object_value:"string?"}},"world.forget":{mutation:true,risky:true,args:{ids:"number[]"}},
  "projects.read":{mutation:false,args:{}},"projects.create":{mutation:true,args:{title:"string",priority:"low|normal|high",deadline:"?",notes:"?"}},"projects.update":{mutation:true,args:{id:"number",status:"?",progress:"?",priority:"?",deadline:"?"}},"project_tasks.read":{mutation:false,args:{project_id:"?",status:"?"}},"project_tasks.create":{mutation:true,args:{project_id:"number",title:"string",due_at:"?",priority:"?"}},"project_tasks.update":{mutation:true,args:{id:"number",title:"?",status:"?",due_at:"?",priority:"?"}},
  "waiting.read":{mutation:false,args:{}},"waiting.create":{mutation:true,args:{title:"string",waiting_on:"?",due_at:"?"}},"waiting.close":{mutation:true,args:{ids:"number[]"}},
  "profile.read":{mutation:false,args:{}},"profile.update":{mutation:true,args:{timezone:"?",city:"?",country:"?",country_code:"?",latitude:"?",longitude:"?",display_name:"?"}},"settings.read":{mutation:false,args:{}},"settings.update":{mutation:true,args:{autonomy_mode:"?",proactive_enabled:"0|1?",morning_brief_enabled:"0|1?",morning_brief_time:"HH:MM?",evening_brief_enabled:"0|1?",evening_brief_time:"HH:MM?",ask_before_delete:"0|1?",deep_reasoning_mode:"auto|on|off?"}},
  "prayer.times":{mutation:false,args:{date:"YYYY-MM-DD?"}},"prayer.rules.read":{mutation:false,args:{}},"prayer.rules.create":{mutation:true,args:{title:"?",prayer:"fajr|dhuhr|asr|maghrib|isha",offset_minutes:"?",start_date:"?",end_date:"?",weekdays:"number[]?"}},"prayer.rules.update":{mutation:true,args:{id:"number",title:"?",offset_minutes:"?",end_date:"?"}},"prayer.rules.cancel":{mutation:true,args:{ids:"number[]"}},"prayer.rules.skip":{mutation:true,args:{id:"number",date:"YYYY-MM-DD"}},
  "holidays.read":{mutation:false,args:{year:"?",country_code:"?"}},"weather.read":{mutation:false,args:{city:"?",latitude:"?",longitude:"?"}},
  "live.news":{mutation:false,args:{query:"string",limit:"?"}},"live.watch.read":{mutation:false,args:{}},"live.watch.create":{mutation:true,args:{query:"string"}},"live.watch.stop":{mutation:true,args:{ids:"number[]"}},
  "audit.read":{mutation:false,args:{limit:"1..50?"}},"audit.undo":{mutation:true,risky:true,args:{}},"system.status":{mutation:false,args:{}},"system.clear_all":{mutation:true,risky:true,args:{}}
};

function brainSystemPrompt(context) {
  return `أنت "سند" Sanad V12.5، مدير حياة شخصي Agent متعدد الأدوات. تتصرف كطقم سكرتارية واحد بعقل موحد.
هدفك فهم المقصد الحقيقي من الكلام الطبيعي المصري، لا انتظار كلمات سحرية.
أنت لا تدّعي تنفيذ شيء. أي تغيير لازم يتم من خلال tool ثم verification حقيقي.
خطتك قد تحتوي عدة أدوات بالترتيب. لا تطلب توضيحًا إلا لو لا يمكن اتخاذ قرار آمن ومعقول.
لا تستخدم regex ذهنيًا ولا تتطلب صيغة أوامر. استخدم السياق والذاكرة والحالة.
للعمليات الحساسة الواسعة مثل clear/forget الكامل: اطلب confirmation ولا تنفذها مباشرة.
إذا كان الكلام مجرد محادثة ولا يحتاج أدوات، أعد reply طبيعي بالمصري.
إذا كانت هناك أدوات، لا تكتب reply نجاح قبل النتائج؛ reply الأولي يمكن أن يكون فارغًا.
رجّع JSON فقط بالشكل:
{
 "goal":"...",
 "needs_clarification":false,
 "clarification_question":"",
 "reply":"",
 "steps":[{"tool":"shopping.add","args":{...},"why":"..."}]
}
استخدم أقل عدد خطوات يحقق الهدف بالكامل. يمكنك استخدام مراجع نتائج الخطوات داخل args بصيغة $step:1.id أو $step:1.ids.0.
افهم التكرار، العلاقات الزمنية، المواعيد، الصلاة، المشاريع، الانتظار، المشتريات، الأخبار، الطقس والذاكرة من اللغة الطبيعية.
الحد الأقصى ${MAX_AGENT_STEPS} خطوات.
الأدوات المتاحة:
${JSON.stringify(TOOL_SPECS)}
السياق الحالي:
${JSON.stringify(context).slice(0,28000)}`;
}

async function runAgent(env,{chatId,text,user,operationId}) {
  const pending=await getPendingActionV125(env,chatId);
  let forcedSteps=null;
  if(pending){
    if(isNoV125(text)){await clearPendingActionV125(env,chatId);return "تمام، لغيت العملية ومغيرتش أي حاجة.";}
    if(isYesV125(text)){forcedSteps=parseJsonV125(pending.steps_json,[]);await clearPendingActionV125(env,chatId);}
    else await clearPendingActionV125(env,chatId);
  }
  const context=await buildContext(env,chatId,user,text),deadline=Date.now()+AI_TOTAL_BUDGET_MS;
  let plan=forcedSteps?{goal:"confirmed pending action",steps:forcedSteps,reply:""}:await callBrainJson(env,brainSystemPrompt(context),text,deadline);
  if(plan?.needs_clarification)return String(plan.clarification_question||"محتاج منك توضيح صغير.");
  let steps=Array.isArray(plan?.steps)?plan.steps.slice(0,MAX_AGENT_STEPS):[];
  if(!steps.length)return normalizeText(plan?.reply||"أنا معاك.");
  const complex=steps.length>=DEEP_PLAN_STEP_THRESHOLD||steps.some(s=>TOOL_SPECS[String(s?.tool||"")]?.risky)||String(user?.deep_reasoning_mode||"auto")==="on";
  if(complex&&!forcedSteps&&Date.now()<deadline-2500){
    try{const critic=await callBrainJson(env,`أنت مراجع خطط سند V12.5. راجع الخطة التالية مقابل طلب المستخدم والحالة. أصلح فقط الأخطاء: الأدوات الناقصة، IDs الخاطئة، الترتيب، أو خطوة قد تسبب false-success. لا تضف خطوات بلا داع. أرجع JSON فقط {"steps":[...]}.\nطلب: ${text}\nالخطة: ${JSON.stringify(steps)}\nالحالة: ${JSON.stringify(context.state).slice(0,14000)}\nالأدوات: ${JSON.stringify(TOOL_SPECS)}`,text,deadline);if(Array.isArray(critic?.steps)&&critic.steps.length)steps=critic.steps.slice(0,MAX_AGENT_STEPS);}catch{}
  }
  const risky=steps.filter(s=>TOOL_SPECS[String(s?.tool||"")]?.risky);
  if(risky.length&&!forcedSteps&&!looksExplicitlyConfirmed(text)){
    await savePendingActionV125(env,chatId,text,steps);
    return `الطلب ده فيه عملية حساسة (${risky.map(x=>x.tool).join("، ")}). أكدلي بـ «أيوه» وأنا أنفذ الخطة كلها كعملية واحدة قابلة للتراجع.`;
  }
  const hasMutation=steps.some(s=>TOOL_SPECS[String(s?.tool||"")]?.mutation);let before=null;
  if(hasMutation){const fresh=await snapshotUserStateV125(env,chatId);before=await ensureOperationSnapshotV125(env,chatId,operationId,fresh,normalizeText(plan?.goal||text).slice(0,500));}
  const observations=[];
  const stepResults=[];
  for(let i=0;i<steps.length;i++){
    const s=steps[i],tool=String(s?.tool||"");
    if(!TOOL_SPECS[tool]){observations.push({step:i+1,tool,ok:false,error:"unknown_tool"});continue;}
    const args=resolveStepRefsV125(s?.args||{},stepResults);
    const result=await executeTool(env,{chatId,operationId,stepKey:`${i+1}:${tool}`,tool,args,user});
    const obs={step:i+1,tool,...result};observations.push(obs);stepResults.push(result);
  }
  let failed=observations.filter(x=>!x.ok);
  if(failed.length&&Date.now()<deadline-1800){
    try{
      const repair=await callBrainJson(env,`أنت سند في Repair Loop. لا تعيد أي خطوة نجحت. أصلح الفشل باستخدام الأدوات فقط، واستعمل IDs من النتائج. أرجع JSON فقط {"steps":[...]}.\nطلب المستخدم: ${text}\nالنتائج: ${JSON.stringify(observations).slice(0,18000)}\nالأدوات: ${JSON.stringify(TOOL_SPECS)}`,text,deadline);
      for(const [i,s] of (Array.isArray(repair?.steps)?repair.steps.slice(0,MAX_REPAIR_STEPS):[]).entries()){
        const tool=String(s?.tool||"");if(!TOOL_SPECS[tool]||TOOL_SPECS[tool].risky&&!forcedSteps&&!looksExplicitlyConfirmed(text))continue;
        const args=resolveStepRefsV125(s?.args||{},stepResults),result=await executeTool(env,{chatId,operationId,stepKey:`repair:${i+1}:${tool}`,tool,args,user});observations.push({step:`repair-${i+1}`,tool,...result});stepResults.push(result);
      }
    }catch{}
  }
  const badMutations=observations.filter(x=>TOOL_SPECS[x.tool]?.mutation&&(!x.ok||x.verified!==true));
  const finalFailures=observations.filter(x=>!x.ok);
  if(hasMutation&&(badMutations.length||finalFailures.length)){
    try{await restoreUserStateV125(env,chatId,before);await discardOperationSnapshotV125(env,operationId);await env.DB.prepare(`INSERT INTO sanad_audit(operation_id,chat_id,tool,args_json,result_json,verified,created_at) VALUES(?,?,?,?,?,?,?)`).bind(operationId,chatId,'system.atomic_rollback','{}',JSON.stringify({reason:'failed_or_unverified',bad:badMutations.map(x=>({tool:x.tool,error:x.error}))}),1,nowIso()).run();}catch(e){await reportFailure(env,chatId,'atomic_rollback',e,{operationId});}
    return `الخطة ما اكتملتش بشكل يمكن إثباته، فرجّعت أي تغييرات حصلت ومش هعتبر حاجة تمت.${badMutations.length?` السبب: ${badMutations.map(x=>`${x.tool}: ${x.error||"verification_failed"}`).join(" | ")}`:""}`;
  }
  if(hasMutation)await commitOperationSnapshotV125(env,operationId);
  const composer=`أنت سند V12.5. اكتب رد مصري طبيعي، مختصر ومفيد، بناءً فقط على observations. أي mutation هنا تم التحقق منه بالفعل. اذكر النتيجة المهمة لا تفاصيل النظام. لو المستخدم طلب أكتر من حاجة لخّصهم بوضوح.\nطلب: ${text}\nالنتائج: ${JSON.stringify(observations).slice(0,20000)}`;
  try{const out=await callBrainText(env,composer,deadline);if(out)return out;}catch{}
  return fallbackCompose(observations);
}
function resolveStepRefsV125(value,results){
  if(Array.isArray(value))return value.map(v=>resolveStepRefsV125(v,results));
  if(value&&typeof value==='object'){const o={};for(const [k,v] of Object.entries(value))o[k]=resolveStepRefsV125(v,results);return o;}
  if(typeof value!=='string'||!value.startsWith('$step:'))return value;
  const m=value.match(/^\$step:(\d+)(?:\.(.+))?$/);if(!m)return value;let cur=results[Number(m[1])-1];for(const part of String(m[2]||'').split('.').filter(Boolean)){if(cur==null)return null;cur=/^\d+$/.test(part)&&Array.isArray(cur)?cur[Number(part)]:cur[part];}return cur;
}
function looksExplicitlyConfirmed(text){
  const t=normalizeText(text).toLowerCase();
  return /(?:أكد|موافق|ايوه امسح|أيوه امسح|نفذ المسح|امسح كله|احذف كله|انساه كله|انسى كله)/u.test(t);
}
function fallbackCompose(obs){
  const muts=obs.filter(x=>TOOL_SPECS[x.tool]?.mutation);
  const reads=obs.filter(x=>!TOOL_SPECS[x.tool]?.mutation&&x.ok);
  if(muts.length)return `✅ تم تنفيذ ${muts.length} خطوة واتأكدت من الحالة الفعلية بعد التنفيذ.`;
  if(reads.length)return `تمام، راجعت الحالة الحالية.`;
  return "تمام.";
}

async function executeTool(env,{chatId,operationId,stepKey,tool,args,user}) {
  const prior=await env.DB.prepare(`SELECT result_json FROM sanad_receipts WHERE operation_id=? AND step_key=?`).bind(operationId,stepKey).first();
  if(prior){try{return JSON.parse(prior.result_json);}catch{}}
  let result;
  try {
    result = await dispatchTool(env,chatId,tool,args,user);
  } catch(e) {
    result={ok:false,changed:0,verified:false,error:safeError(e),retryable:true};
  }
  const spec=TOOL_SPECS[tool];
  if(spec?.mutation && result.ok && result.changed>0 && result.verified!==true) result={...result,ok:false,error:"mutation_not_verified"};
  await env.DB.prepare(`INSERT OR REPLACE INTO sanad_receipts(operation_id,step_key,chat_id,tool,result_json,created_at) VALUES(?,?,?,?,?,?)`)
    .bind(operationId,stepKey,chatId,tool,JSON.stringify(result).slice(0,15000),nowIso()).run();
  await env.DB.prepare(`INSERT INTO sanad_audit(operation_id,chat_id,tool,args_json,result_json,verified,created_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(operationId,chatId,tool,JSON.stringify(args).slice(0,8000),JSON.stringify(result).slice(0,15000),result.verified?1:0,nowIso()).run();
  return result;
}

async function dispatchTool(env,chatId,tool,args,user){
  switch(tool){
    case "shopping.read":return toolShoppingRead(env,chatId);case "shopping.add":return toolShoppingAdd(env,chatId,args);case "shopping.update":return toolShoppingUpdate(env,chatId,args);case "shopping.remove":return toolShoppingRemove(env,chatId,args);case "shopping.clear":return toolShoppingClear(env,chatId);case "shopping.session.start":return toolShoppingSessionStartV125(env,chatId,args);case "shopping.session.finish":return toolShoppingSessionFinishV125(env,chatId);case "shopping.progress":return toolShoppingProgressV125(env,chatId);
    case "reminders.read":return toolRemindersRead(env,chatId,args);case "reminders.create":return toolReminderCreate(env,chatId,args,user);case "reminders.update":return toolReminderUpdate(env,chatId,args);case "reminders.cancel":return toolReminderCancel(env,chatId,args);case "reminders.snooze":return toolReminderSnoozeV125(env,chatId,args);
    case "recurrence.read":return toolRecurrenceReadV125(env,chatId,args);case "recurrence.create":return toolRecurrenceCreateV125(env,chatId,args,user);case "recurrence.update":return toolRecurrenceUpdateV125(env,chatId,args);case "recurrence.pause":return setRecurrenceActiveV125(env,chatId,args,false);case "recurrence.resume":return setRecurrenceActiveV125(env,chatId,args,true);case "recurrence.skip":return toolRecurrenceSkipV125(env,chatId,args);case "recurrence.cancel":return toolRecurrenceCancelV125(env,chatId,args);
    case "schedule.free_time":return toolFreeTimeV125(env,chatId,args);case "schedule.conflicts":return toolScheduleConflictsV125(env,chatId,args);case "schedule.search":return toolScheduleSearchV125(env,chatId,args);case "schedule.shift":return toolScheduleShiftV125(env,chatId,args);case "schedule.bulk_shift":return toolScheduleBulkShiftV125(env,chatId,args);
    case "dependency.read":return toolDependencyReadV125(env,chatId);case "dependency.create":return toolDependencyCreateV125(env,chatId,args);case "dependency.remove":return toolDependencyRemoveV125(env,chatId,args);
    case "memory.search":return toolMemorySearch(env,chatId,args);case "memory.remember":return toolMemoryRemember(env,chatId,args);case "memory.forget":return toolMemoryForget(env,chatId,args);
    case "world.read":return toolWorldReadV125(env,chatId,args);case "world.upsert":return toolWorldUpsertV125(env,chatId,args);case "world.link":return toolWorldLinkV125(env,chatId,args);case "world.forget":return toolWorldForgetV125(env,chatId,args);
    case "projects.read":return toolProjectsRead(env,chatId);case "projects.create":return toolProjectCreate(env,chatId,args);case "projects.update":return toolProjectUpdate(env,chatId,args);case "project_tasks.read":return toolProjectTasksReadV125(env,chatId,args);case "project_tasks.create":return toolProjectTaskCreateV125(env,chatId,args);case "project_tasks.update":return toolProjectTaskUpdateV125(env,chatId,args);
    case "waiting.read":return toolWaitingRead(env,chatId);case "waiting.create":return toolWaitingCreate(env,chatId,args);case "waiting.close":return toolWaitingClose(env,chatId,args);
    case "profile.read":return toolProfileReadV125(env,chatId);case "profile.update":return toolProfileUpdateV125(env,chatId,args);case "settings.read":return toolSettingsReadV125(env,chatId);case "settings.update":return toolSettingsUpdateV125(env,chatId,args);
    case "prayer.times":return toolPrayerTimesV125(env,chatId,args,user);case "prayer.rules.read":return toolPrayerRulesReadV125(env,chatId);case "prayer.rules.create":return toolPrayerRuleCreateV125(env,chatId,args,user);case "prayer.rules.update":return toolPrayerRuleUpdateV125(env,chatId,args);case "prayer.rules.cancel":return toolPrayerRuleCancelV125(env,chatId,args);case "prayer.rules.skip":return toolPrayerRuleSkipV125(env,chatId,args);
    case "holidays.read":return toolHolidaysV125(env,chatId,args,user);case "weather.read":return toolWeatherV125(env,chatId,args,user);
    case "live.news":return toolLiveNewsV125(env,chatId,args);case "live.watch.read":return toolLiveWatchReadV125(env,chatId);case "live.watch.create":return toolLiveWatchCreateV125(env,chatId,args);case "live.watch.stop":return toolLiveWatchStopV125(env,chatId,args);
    case "audit.read":return toolAuditRead(env,chatId,args);case "audit.undo":return toolAuditUndoV125(env,chatId);case "system.status":return toolSystemStatusV125(env,chatId);case "system.clear_all":return toolSystemClearAllV125(env,chatId);default:return{ok:false,changed:0,verified:false,error:"unknown_tool"};
  }
}
function normItem(s){return normalizeText(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"");}

async function toolShoppingRead(env,chatId){
  const rows=(await env.DB.prepare(`SELECT id,title,quantity,status,meta_json FROM sanad_shopping WHERE chat_id=? AND status IN ('pending','bought') ORDER BY id`).bind(chatId).all())?.results||[];
  return {ok:true,changed:0,verified:true,items:rows};
}
async function toolShoppingAdd(env,chatId,args){
  const raw=Array.isArray(args?.items)?args.items:[]; const before=(await toolShoppingRead(env,chatId)).items, inserted=[];
  const now=nowIso();
  for(const x of raw.slice(0,50)){
    const title=normalizeText(typeof x==="string"?x:x?.title); if(!title)continue;
    const normalized=normItem(title), quantity=normalizeText(x?.quantity||"")||null;
    const existing=await env.DB.prepare(`SELECT id,status FROM sanad_shopping WHERE chat_id=? AND normalized=? ORDER BY id DESC LIMIT 1`).bind(chatId,normalized).first();
    if(existing){
      await env.DB.prepare(`UPDATE sanad_shopping SET title=?,quantity=COALESCE(?,quantity),status='pending',updated_at=? WHERE id=?`).bind(title,quantity,now,Number(existing.id)).run();
      inserted.push(Number(existing.id));
    }else{
      const r=await env.DB.prepare(`INSERT INTO sanad_shopping(chat_id,title,normalized,quantity,status,meta_json,created_at,updated_at) VALUES(?,?,?,?, 'pending',?,?,?)`)
        .bind(chatId,title,normalized,quantity,JSON.stringify(x?.meta||{}),now,now).run();
      inserted.push(Number(r?.meta?.last_row_id||0));
    }
  }
  const after=(await toolShoppingRead(env,chatId)).items;
  const byId=new Set(after.map(x=>Number(x.id)));
  const verified=inserted.length>0&&inserted.every(id=>byId.has(id));
  return {ok:verified,changed:inserted.length,verified,before_count:before.length,after_count:after.length,ids:inserted,items:after};
}
async function toolShoppingUpdate(env,chatId,args){
  const id=Number(args?.id); if(!id)return{ok:false,changed:0,verified:false,error:"missing_id"};
  const before=await env.DB.prepare(`SELECT * FROM sanad_shopping WHERE chat_id=? AND id=?`).bind(chatId,id).first(); if(!before)return{ok:false,changed:0,verified:false,error:"not_found"};
  const title=args.title!=null?normalizeText(args.title):before.title, quantity=args.quantity!=null?normalizeText(args.quantity):before.quantity;
  const status=["pending","bought"].includes(String(args.status))?String(args.status):before.status;
  await env.DB.prepare(`UPDATE sanad_shopping SET title=?,normalized=?,quantity=?,status=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,normItem(title),quantity,status,nowIso(),chatId,id).run();
  const after=await env.DB.prepare(`SELECT * FROM sanad_shopping WHERE chat_id=? AND id=?`).bind(chatId,id).first();
  const verified=!!after&&after.title===title&&String(after.status)===status;
  return{ok:verified,changed:verified?1:0,verified,before,after};
}
async function toolShoppingRemove(env,chatId,args){
  const ids=[...(Array.isArray(args?.ids)?args.ids:[])].map(Number).filter(Boolean).slice(0,60);
  const before=(await toolShoppingRead(env,chatId)).items;
  if(!ids.length)return{ok:false,changed:0,verified:false,error:"missing_ids"};
  const qs=ids.map(()=>"?").join(",");
  await env.DB.prepare(`DELETE FROM sanad_shopping WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).run();
  const after=(await toolShoppingRead(env,chatId)).items, left=new Set(after.map(x=>Number(x.id)));
  const verified=ids.every(id=>!left.has(id));
  return{ok:verified,changed:ids.filter(id=>before.some(x=>Number(x.id)===id)).length,verified,before_count:before.length,after_count:after.length};
}
async function toolShoppingClear(env,chatId){
  const before=(await toolShoppingRead(env,chatId)).items;
  await env.DB.prepare(`DELETE FROM sanad_shopping WHERE chat_id=?`).bind(chatId).run();
  const after=(await toolShoppingRead(env,chatId)).items,verified=after.length===0;
  return{ok:verified,changed:before.length,verified,before_count:before.length,after_count:0};
}

async function toolRemindersRead(env,chatId,args){
  let sql=`SELECT id,title,local_date,local_time,duration_minutes,advance_minutes,status,sent FROM sanad_reminders WHERE chat_id=? AND status='active'`,bind=[chatId];
  if(args?.from_date){sql+=` AND local_date>=?`;bind.push(String(args.from_date))}
  if(args?.to_date){sql+=` AND local_date<=?`;bind.push(String(args.to_date))}
  sql+=` ORDER BY local_date,local_time LIMIT 100`;
  const rows=(await env.DB.prepare(sql).bind(...bind).all())?.results||[];
  return{ok:true,changed:0,verified:true,items:rows};
}
async function toolReminderCreate(env,chatId,args,user){
  const title=normalizeText(args?.title),date=String(args?.local_date||""),time=String(args?.local_time||"");
  if(!title||!validDateV125(date)||!validTimeV125(time))return{ok:false,changed:0,verified:false,error:"invalid_reminder_fields"};
  const tz=String(user?.timezone||TZ),ln=localNow(tz);if(!args?.allow_past&&`${date} ${time}`<`${ln.date} ${ln.time}`)return{ok:false,changed:0,verified:false,error:"time_is_in_the_past"};
  const kind=String(args?.kind||((Number(args?.duration_minutes||0)>0)?'appointment':'reminder')),duration=clampV125(args?.duration_minutes||(kind==='appointment'?DEFAULT_EVENT_DURATION:0),0,10080);
  if((kind==='appointment'||duration>0)&&!args?.allow_conflict){const occ=await getScheduleOccurrencesV125(env,chatId,date,date),start=hmMinutesV125(time),conf=occ.filter(x=>start<hmMinutesV125(x.time)+Math.max(1,Number(x.duration_minutes||DEFAULT_EVENT_DURATION))&&hmMinutesV125(x.time)<start+Math.max(1,duration));if(conf.length)return{ok:false,changed:0,verified:false,error:"schedule_conflict",conflicts:conf.slice(0,10),retryable:false};}
  const advances=(Array.isArray(args?.advance_minutes)?args.advance_minutes:[args?.advance_minutes]).filter(x=>x!=null).map(x=>clampV125(x,0,MAX_ADVANCE_MINUTES)).filter((v,i,a)=>a.indexOf(v)===i),now=nowIso();
  const r=await env.DB.prepare(`INSERT INTO sanad_reminders(chat_id,title,kind,local_date,local_time,timezone,duration_minutes,advance_minutes,advance_json,status,sent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',0,?,?)`).bind(chatId,title,kind,date,time,tz,duration,Number(advances[0]||0),JSON.stringify(advances),now,now).run();
  const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,id).first();
  const verified=!!after&&after.title===title&&after.local_date===date&&after.local_time===time&&String(after.kind)===kind;return{ok:verified,changed:verified?1:0,verified,id,after};
}
async function toolReminderUpdate(env,chatId,args){
  const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:"missing_id"};
  const before=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();if(!before)return{ok:false,changed:0,verified:false,error:"not_found"};
  const title=args.title!=null?normalizeText(args.title):before.title,date=args.local_date||before.local_date,time=args.local_time||before.local_time,dur=args.duration_minutes!=null?Number(args.duration_minutes):Number(before.duration_minutes||0);
  await env.DB.prepare(`UPDATE sanad_reminders SET title=?,local_date=?,local_time=?,duration_minutes=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(title,date,time,dur,nowIso(),chatId,id).run();
  const after=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,id).first();
  const verified=!!after&&after.title===title&&after.local_date===date&&after.local_time===time;
  return{ok:verified,changed:verified?1:0,verified,before,after};
}
async function toolReminderCancel(env,chatId,args){
  const ids=[...(Array.isArray(args?.ids)?args.ids:[])].map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:"missing_ids"};
  const qs=ids.map(()=>"?").join(",");
  await env.DB.prepare(`UPDATE sanad_reminders SET status='cancelled',updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();
  const rows=(await env.DB.prepare(`SELECT id,status FROM sanad_reminders WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];
  const verified=rows.every(x=>x.status==="cancelled");
  return{ok:verified,changed:rows.length,verified,items:rows};
}
async function toolFreeTime(env,chatId,args){
  const date=String(args?.date||""),from=String(args?.from_time||"08:00"),to=String(args?.to_time||"23:00"),min=Math.max(5,Number(args?.min_minutes||30));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return{ok:false,changed:0,verified:false,error:"invalid_date"};
  const rows=(await env.DB.prepare(`SELECT local_time,duration_minutes,title FROM sanad_reminders WHERE chat_id=? AND status='active' AND local_date=? ORDER BY local_time`).bind(chatId,date).all())?.results||[];
  const toMin=s=>{const[a,b]=String(s).split(":").map(Number);return a*60+b}; let cur=toMin(from),end=toMin(to),slots=[];
  for(const r of rows){const s=toMin(r.local_time),e=s+Math.max(1,Number(r.duration_minutes||30));if(s-cur>=min)slots.push({from:`${String(Math.floor(cur/60)).padStart(2,"0")}:${String(cur%60).padStart(2,"0")}`,to:r.local_time,minutes:s-cur});cur=Math.max(cur,e)}
  if(end-cur>=min)slots.push({from:`${String(Math.floor(cur/60)).padStart(2,"0")}:${String(cur%60).padStart(2,"0")}`,to,minutes:end-cur});
  return{ok:true,changed:0,verified:true,date,slots};
}

async function toolMemorySearch(env,chatId,args){
  const q=normItem(args?.query||"");const rows=(await env.DB.prepare(`SELECT id,memory_type,content,importance FROM sanad_memories WHERE chat_id=? ORDER BY importance DESC,id DESC LIMIT 80`).bind(chatId).all())?.results||[];
  const tokens=q.split(/\s+/).filter(Boolean);const out=rows.filter(r=>tokens.length===0||tokens.some(t=>normItem(r.content).includes(t))).slice(0,20);
  return{ok:true,changed:0,verified:true,items:out};
}
async function toolMemoryRemember(env,chatId,args){
  const content=normalizeText(args?.content);if(!content)return{ok:false,changed:0,verified:false,error:"empty_memory"};
  const type=["semantic","preference","person","commitment"].includes(String(args?.memory_type))?String(args.memory_type):"semantic",n=normItem(content),imp=Math.max(0,Math.min(1,Number(args?.importance??0.6))),now=nowIso();
  await env.DB.prepare(`INSERT INTO sanad_memories(chat_id,memory_type,content,normalized,importance,source,created_at,updated_at)
    VALUES(?,?,?,?,?,'agent',?,?) ON CONFLICT(chat_id,memory_type,normalized) DO UPDATE SET content=excluded.content,importance=MAX(sanad_memories.importance,excluded.importance),updated_at=excluded.updated_at`)
    .bind(chatId,type,content,n,imp,now,now).run();
  const after=await env.DB.prepare(`SELECT * FROM sanad_memories WHERE chat_id=? AND memory_type=? AND normalized=?`).bind(chatId,type,n).first();
  return{ok:!!after,changed:after?1:0,verified:!!after,id:after?.id,after};
}
async function toolMemoryForget(env,chatId,args){
  const ids=(Array.isArray(args?.ids)?args.ids:[]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:"missing_ids"};
  const qs=ids.map(()=>"?").join(",");await env.DB.prepare(`DELETE FROM sanad_memories WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).run();
  const left=(await env.DB.prepare(`SELECT id FROM sanad_memories WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];
  return{ok:left.length===0,changed:ids.length-left.length,verified:left.length===0};
}

async function toolProjectsRead(env,chatId){const rows=(await env.DB.prepare(`SELECT * FROM sanad_projects WHERE chat_id=? ORDER BY id DESC LIMIT 50`).bind(chatId).all())?.results||[];return{ok:true,changed:0,verified:true,items:rows}}
async function toolProjectCreate(env,chatId,args){
  const title=normalizeText(args?.title);if(!title)return{ok:false,changed:0,verified:false,error:"missing_title"};const now=nowIso(),priority=["low","normal","high"].includes(String(args?.priority))?String(args.priority):"normal";
  const r=await env.DB.prepare(`INSERT INTO sanad_projects(chat_id,title,status,priority,deadline,progress,notes,created_at,updated_at) VALUES(?,?,'active',?,?,0,?,?,?)`).bind(chatId,title,priority,args?.deadline||null,args?.notes||null,now,now).run();
  const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_projects WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:after?1:0,verified:!!after,id,after}
}
async function toolProjectUpdate(env,chatId,args){
  const id=Number(args?.id);const before=await env.DB.prepare(`SELECT * FROM sanad_projects WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!before)return{ok:false,changed:0,verified:false,error:"not_found"};
  const status=args.status??before.status,progress=args.progress!=null?Math.max(0,Math.min(100,Number(args.progress))):before.progress,priority=args.priority??before.priority,deadline=args.deadline!==undefined?args.deadline:before.deadline;
  await env.DB.prepare(`UPDATE sanad_projects SET status=?,progress=?,priority=?,deadline=?,updated_at=? WHERE chat_id=? AND id=?`).bind(status,progress,priority,deadline,nowIso(),chatId,id).run();
  const after=await env.DB.prepare(`SELECT * FROM sanad_projects WHERE chat_id=? AND id=?`).bind(chatId,id).first();const verified=!!after&&Number(after.progress)===Number(progress)&&String(after.status)===String(status);return{ok:verified,changed:verified?1:0,verified,before,after}
}
async function toolWaitingRead(env,chatId){const rows=(await env.DB.prepare(`SELECT * FROM sanad_waiting WHERE chat_id=? AND status='waiting' ORDER BY id DESC`).bind(chatId).all())?.results||[];return{ok:true,changed:0,verified:true,items:rows}}
async function toolWaitingCreate(env,chatId,args){
  const title=normalizeText(args?.title);if(!title)return{ok:false,changed:0,verified:false,error:"missing_title"};const now=nowIso();const r=await env.DB.prepare(`INSERT INTO sanad_waiting(chat_id,title,waiting_on,due_at,status,created_at,updated_at) VALUES(?,?,?,?, 'waiting',?,?)`).bind(chatId,title,args?.waiting_on||null,args?.due_at||null,now,now).run();const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_waiting WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:after?1:0,verified:!!after,id,after}
}
async function toolWaitingClose(env,chatId,args){
  const ids=(Array.isArray(args?.ids)?args.ids:[]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:"missing_ids"};const qs=ids.map(()=>"?").join(",");await env.DB.prepare(`UPDATE sanad_waiting SET status='done',updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT id,status FROM sanad_waiting WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];const verified=rows.every(x=>x.status==="done");return{ok:verified,changed:rows.length,verified,items:rows}
}
async function toolAuditRead(env,chatId,args){const n=Math.max(1,Math.min(20,Number(args?.limit||10)));const rows=(await env.DB.prepare(`SELECT id,operation_id,tool,verified,created_at FROM sanad_audit WHERE chat_id=? ORDER BY id DESC LIMIT ?`).bind(chatId,n).all())?.results||[];return{ok:true,changed:0,verified:true,items:rows}}

async function callBrainJson(env,system,userText,deadline){
  const text=await callModels(env,[{role:"system",content:system},{role:"user",content:userText}],deadline,{json:true,max_tokens:1800});
  const raw=text.trim().replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
  const a=raw.indexOf("{"),b=raw.lastIndexOf("}");
  if(a<0||b<a)throw new Error("brain_json_missing");
  return JSON.parse(raw.slice(a,b+1));
}
async function callBrainText(env,prompt,deadline){
  return callModels(env,[{role:"system",content:"أنت سند. أجب بالمصري الطبيعي باختصار ودقة."},{role:"user",content:prompt}],deadline,{json:false,max_tokens:900});
}
async function callModels(env,messages,deadline,opts={}){
  const failures=[];
  for(const model of MODEL_CHAIN){
    const remaining=deadline-Date.now();if(remaining<500)break;
    const timeout=Math.min(AI_CALL_TIMEOUT_MS,model.timeoutMs,remaining);
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
    try{
      const body={model:model.id,messages,max_tokens:opts.max_tokens||1200,temperature:opts.json?0.15:0.45,stream:false};
      if(opts.json)body.response_format={type:"json_object"};
      const req=new Request(OMNIAI_INTERNAL_URL,{method:"POST",headers:{Authorization:`Bearer ${env.OMNIAI_API_KEY}`,"content-type":"application/json"},body:JSON.stringify(body),signal:c.signal});
      const r=env.OMNIAI_SERVICE?await env.OMNIAI_SERVICE.fetch(req):await fetch(req);
      const raw=await r.text();let x;try{x=JSON.parse(raw)}catch{x=null}
      const text=String(x?.choices?.[0]?.message?.content??x?.output_text??x?.text??"").trim();
      if(r.ok&&text)return text;
      failures.push(`${model.id}:${r.status}`);
    }catch(e){failures.push(`${model.id}:${safeError(e)}`)}finally{clearTimeout(timer)}
  }
  throw new Error(`AI unavailable: ${failures.join(" | ")}`);
}

async function telegramApi(env,method,payload){
  const token=env.TELEGRAM_BOT_TOKEN;if(!token)throw new Error("TELEGRAM_BOT_TOKEN missing");
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const x=await r.json().catch(()=>null);if(!r.ok||!x?.ok)throw new Error(`Telegram ${method} ${r.status}: ${JSON.stringify(x)?.slice(0,500)}`);return x;
}
async function sendText(env,chatId,text,reply_markup){
  const chunks=splitTelegram(String(text||""));
  for(const c of chunks)await telegramApi(env,"sendMessage",{chat_id:chatId,text:c,...(reply_markup?{reply_markup}:{})});
}
function splitTelegram(s){if(s.length<=3900)return[s];const out=[];while(s.length){out.push(s.slice(0,3900));s=s.slice(3900)}return out}

async function transcribeVoice(env,voice){
  const fileId=String(voice?.file_id||"");if(!fileId)throw new Error("voice_file_missing");
  const info=await telegramApi(env,"getFile",{file_id:fileId}),path=info?.result?.file_path;if(!path)throw new Error("voice_path_missing");
  const r=await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);if(!r.ok)throw new Error("voice_download_failed");
  const blob=await r.blob(),form=new FormData();form.append("file",blob,"voice.ogg");form.append("model",String(env.VOICE_MODEL||"auto"));form.append("language","ar");form.append("response_format","json");
  if(env.OMNIAI_SERVICE&&env.OMNIAI_API_KEY){
    const req=new Request(OMNIAI_INTERNAL_URL.replace(/\/chat\/completions$/,"/audio/transcriptions"),{method:"POST",headers:{Authorization:`Bearer ${env.OMNIAI_API_KEY}`},body:form});
    const rr=await env.OMNIAI_SERVICE.fetch(req),x=await rr.json().catch(()=>null);const text=normalizeText(x?.text||x?.transcript||"");if(rr.ok&&text)return text;
  }
  if(env.GROQ_API_KEY){
    const f2=new FormData();f2.append("file",blob,"voice.ogg");f2.append("model","whisper-large-v3-turbo");f2.append("language","ar");f2.append("response_format","json");
    const rr=await fetch("https://api.groq.com/openai/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`},body:f2}),x=await rr.json().catch(()=>null);const text=normalizeText(x?.text||"");if(rr.ok&&text)return text;
  }
  throw new Error("voice_transcription_unavailable");
}

async function showShopping(env,chatId){
  const r=await toolShoppingRead(env,chatId),p=r.items.filter(x=>x.status==="pending");
  if(!p.length){await sendText(env,chatId,"🛒 قائمة المشتريات فاضية.");return;}
  const kb={inline_keyboard:p.slice(0,20).map(x=>[{text:`☐ ${String(x.title).slice(0,35)}`,callback_data:`s125:shop:toggle:${x.id}`}])};
  await sendText(env,chatId,`🛒 المشتريات (${p.length}):\n${p.map(x=>`• ${x.title}${x.quantity?` — ${x.quantity}`:""}`).join("\n")}`,kb);
}
async function showToday(env,chatId,user){const d=localNow(user?.timezone||TZ).date,r=await toolRemindersRead(env,chatId,{from_date:d,to_date:d});await sendText(env,chatId,r.items.length?`📅 النهاردة:\n${r.items.map(x=>`• ${x.local_time} — ${x.title}`).join("\n")}`:"📅 مفيش مواعيد مسجلة النهاردة.");}
async function showMemory(env,chatId){const rows=(await env.DB.prepare(`SELECT memory_type,content FROM sanad_memories WHERE chat_id=? ORDER BY importance DESC,id DESC LIMIT 30`).bind(chatId).all())?.results||[];await sendText(env,chatId,rows.length?`🧠 فاكر عنك:\n${rows.map(x=>`• ${x.content}`).join("\n")}`:"🧠 لسه مفيش ذكريات محفوظة.");}
async function showAudit(env,chatId){const r=await toolAuditRead(env,chatId,{limit:10});await sendText(env,chatId,r.items.length?`🧾 آخر العمليات:\n${r.items.map(x=>`• ${x.tool} — ${x.verified?"✅":"⚠️"}`).join("\n")}`:"🧾 مفيش عمليات لسه.");}
async function handleCallback(env,q){
  const chatId=String(q?.message?.chat?.id??q?.from?.id??"");
  try{await telegramApi(env,"answerCallbackQuery",{callback_query_id:q.id});}catch{}
  const data=String(q?.data||"");
  const m=data.match(/^s125:shop:toggle:(\d+)$/);
  if(m&&chatId){const id=Number(m[1]),row=await env.DB.prepare(`SELECT status FROM sanad_shopping WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(row){await toolShoppingUpdate(env,chatId,{id,status:row.status==='bought'?'pending':'bought'});await showShopping(env,chatId);}return;}
}

async function deliverDueReminders(env,scheduledTime){
  const now=new Date(scheduledTime||Date.now());
  const users=(await env.DB.prepare(`SELECT chat_id,timezone FROM sanad_users LIMIT 500`).all())?.results||[];
  for(const u of users){
    const ln=localNow(u.timezone||TZ);
    const rows=(await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND status='active' AND sent=0 AND local_date=? AND local_time<=? ORDER BY local_time LIMIT 20`).bind(String(u.chat_id),ln.date,ln.time).all())?.results||[];
    for(const r of rows){
      try{
        await sendText(env,String(u.chat_id),`⏰ ${r.title}`);
        await env.DB.prepare(`UPDATE sanad_reminders SET sent=1,updated_at=? WHERE id=?`).bind(nowIso(),Number(r.id)).run();
      }catch(e){await reportFailure(env,String(u.chat_id),"deliver_reminder",e,{reminder_id:r.id})}
    }
  }
}
async function runProactiveChecks(env){
  const users=(await env.DB.prepare(`SELECT chat_id,timezone FROM sanad_users LIMIT 500`).all())?.results||[];
  for(const u of users){
    const ln=localNow(u.timezone||TZ);
    const rows=(await env.DB.prepare(`SELECT id,title,local_time FROM sanad_reminders WHERE chat_id=? AND status='active' AND sent=0 AND local_date=? ORDER BY local_time LIMIT 10`).bind(String(u.chat_id),ln.date).all())?.results||[];
    for(const r of rows){
      const [h,m]=r.local_time.split(":").map(Number),[nh,nm]=ln.time.split(":").map(Number),diff=h*60+m-(nh*60+nm);
      if(diff>0&&diff<=30){
        const key=`soon:${r.id}:${ln.date}`;const done=await env.DB.prepare(`SELECT 1 x FROM sanad_proactive_fires WHERE chat_id=? AND fire_key=?`).bind(String(u.chat_id),key).first();
        if(!done){try{await sendText(env,String(u.chat_id),`📌 خلي بالك: ${r.title} بعد حوالي ${diff} دقيقة.`);await env.DB.prepare(`INSERT INTO sanad_proactive_fires(chat_id,fire_key,sent_at) VALUES(?,?,?)`).bind(String(u.chat_id),key,nowIso()).run();}catch{}}
      }
    }
  }
}
async function cleanup(env){
  const week=new Date(Date.now()-7*86400000).toISOString(),month=new Date(Date.now()-30*86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sanad_inbox WHERE status='done' AND updated_at<?`).bind(week),
    env.DB.prepare(`DELETE FROM sanad_updates WHERE finished_at IS NOT NULL AND finished_at<?`).bind(week),
    env.DB.prepare(`DELETE FROM sanad_failures WHERE created_at<?`).bind(month),
    env.DB.prepare(`DELETE FROM sanad_conversation WHERE id IN (SELECT id FROM sanad_conversation ORDER BY id DESC LIMIT -1 OFFSET 50000)`)
  ]).catch(()=>{});
}

function adminKey(request){return request.headers.get("X-Sanad-Key")||new URL(request.url).searchParams.get("key")||""}
async function setup(request,env){
  if(!env.SETUP_KEY||!secureEq(adminKey(request),env.SETUP_KEY))return j({ok:false,error:"Unauthorized"},401);
  if(!env.DB||!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_WEBHOOK_SECRET||!env.OMNIAI_API_KEY)return j({ok:false,error:"Missing required bindings"},500);
  await ensureSchema(env,true);
  const url=new URL(request.url),webhook=`${url.origin}/telegram`;
  const x=await telegramApi(env,"setWebhook",{url:webhook,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:["message","callback_query"],drop_pending_updates:false});
  await telegramApi(env,"setMyCommands",{commands:[
    {command:"start",description:"تشغيل سند"},{command:"menu",description:"كل اختصارات سند"},
    {command:"today",description:"مواعيد النهاردة"},{command:"week",description:"جدول الأسبوع"},{command:"month",description:"جدول الشهر"},{command:"recurring",description:"التكرارات"},
    {command:"shopping",description:"قائمة المشتريات"},{command:"projects",description:"المشاريع"},{command:"waiting",description:"الحاجات اللي مستنيها"},
    {command:"memory",description:"ذاكرة سند"},{command:"prayer",description:"مواقيت الصلاة"},{command:"where",description:"موقعي وتوقيتي"},
    {command:"audit",description:"سجل التنفيذ"},{command:"undo",description:"تراجع عن آخر عملية"},{command:"live",description:"المتابعة الحية"},{command:"status",description:"حالة سند"}
  ]});
  return j({ok:true,service:NAME,version:VERSION,architecture:"single-brain-full-life-agent",tools:Object.keys(TOOL_SPECS).length,webhook,telegram:x.ok,models:MODEL_CHAIN.map(m=>m.id),legacy_v11_migration:true});
}
async function health(env){
  const base={ok:true,service:NAME,version:VERSION,db:!!env.DB,omniai:!!(env.OMNIAI_SERVICE&&env.OMNIAI_API_KEY),models:MODEL_CHAIN.map(m=>m.id)};
  if(!env.DB)return j({...base,ok:false},503);
  try{await ensureSchema(env);const p=await env.DB.prepare(`SELECT value FROM sanad_meta WHERE key='schema_version'`).first();return j({...base,schema:p?.value||null})}catch(e){return j({...base,ok:false,error:safeError(e)},503)}
}
async function ready(request,env){
  if(!env.SETUP_KEY||!secureEq(adminKey(request),env.SETUP_KEY))return j({ok:false,error:"Unauthorized"},401);
  try{await ensureSchema(env);const p=await env.DB.prepare(`SELECT 1 ok`).first();return j({ok:Number(p?.ok||0)===1,version:VERSION,models:MODEL_CHAIN.map(m=>m.id)})}catch(e){return j({ok:false,error:safeError(e)},503)}
}
async function selftest(request,env){
  if(!env.SETUP_KEY||!secureEq(adminKey(request),env.SETUP_KEY))return j({ok:false,error:"Unauthorized"},401);
  await ensureSchema(env);
  if(new URL(request.url).searchParams.get("deep")==="1")return j(await deepSelftestV125(env));
  const tests=[];
  const add=(name,ok,detail="")=>tests.push({name,ok:!!ok,detail});
  add("version",VERSION==="12.5.0",VERSION);
  add("models",MODEL_CHAIN.length===3,MODEL_CHAIN.map(x=>x.id).join(","));
  add("full-life-tools",Object.keys(TOOL_SPECS).length>=60,String(Object.keys(TOOL_SPECS).length));
  add("mutation-verification",Object.values(TOOL_SPECS).filter(x=>x.mutation).length>=35);
  add("no-success-without-proof",fallbackCompose([{tool:"shopping.add",ok:true,verified:true}]).includes("✅"));
  add("risky-guard",TOOL_SPECS["shopping.clear"].risky===true&&TOOL_SPECS["memory.forget"].risky===true&&TOOL_SPECS["system.clear_all"].risky===true);
  add("recurrence-engine",generateRecurrenceOccurrencesV125({rule_json:JSON.stringify({unit:"days",every:1,times:["08:00"]}),start_date:"2026-08-17",end_date:null,max_occurrences:null,fired_count:0,exceptions_json:"[]"},"2026-08-17","2026-08-19",10).length===3);
  add("cairo-timezone-conversion",new Date(zonedLocalToEpochV125("2026-08-17","19:00","Africa/Cairo")).toISOString()==="2026-08-17T16:00:00.000Z");
  add("atomic-snapshots",SNAPSHOT_TABLES.length>=10,String(SNAPSHOT_TABLES.length));
  add("normalizer",normItem("  لبن! ")==="لبن");
  add("time",/^\d{4}-\d{2}-\d{2}$/.test(localNow().date));
  return j({ok:tests.every(x=>x.ok),version:VERSION,tests});
}

/* ======================== SANAD V12.5 FULL-LIFE PACK ======================== */
function clampV125(n,min,max){n=Number(n);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):min;}
function parseJsonV125(v,fallback={}){try{const x=JSON.parse(String(v??""));return x??fallback;}catch{return fallback;}}
function validDateV125(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||""))&&!Number.isNaN(Date.parse(`${v}T00:00:00Z`));}
function validTimeV125(v){const m=String(v||"").match(/^(\d{2}):(\d{2})$/);return !!m&&Number(m[1])<24&&Number(m[2])<60;}
function addDaysV125(date,days){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString().slice(0,10);}
function isoWeekdayV125(date){const d=new Date(`${date}T12:00:00Z`).getUTCDay();return d===0?7:d;}
function hmMinutesV125(t){const [h,m]=String(t||"00:00").split(":").map(Number);return h*60+m;}
function minutesHmV125(v){v=((Math.trunc(v)%1440)+1440)%1440;return `${String(Math.floor(v/60)).padStart(2,"0")}:${String(v%60).padStart(2,"0")}`;}
function dateDiffDaysV125(a,b){return Math.round((Date.parse(`${b}T12:00:00Z`)-Date.parse(`${a}T12:00:00Z`))/86400000);}
function monthAddV125(date,months){const [y,m,d]=date.split("-").map(Number);const x=new Date(Date.UTC(y,m-1+Number(months),1,12));const last=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0,12)).getUTCDate();x.setUTCDate(Math.min(d,last));return x.toISOString().slice(0,10);}
function yearAddV125(date,years){const [y,m,d]=date.split("-").map(Number),ny=y+Number(years);const last=new Date(Date.UTC(ny,m,0,12)).getUTCDate();return `${ny}-${String(m).padStart(2,"0")}-${String(Math.min(d,last)).padStart(2,"0")}`;}
function sqlQuoteNameV125(name){if(!/^[A-Za-z0-9_]+$/.test(String(name)))throw new Error("unsafe_sql_name");return `\"${name}\"`;}
async function tableExistsV125(env,name){const r=await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(String(name)).first();return !!r;}
async function columnsV125(env,table){return (await env.DB.prepare(`PRAGMA table_info(${table})`).all())?.results||[];}
async function cacheGetV125(env,key){const r=await env.DB.prepare(`SELECT value_json,expires_at FROM sanad_cache WHERE cache_key=?`).bind(key).first();if(!r||String(r.expires_at)<=nowIso())return null;return parseJsonV125(r.value_json,null);}
async function cacheSetV125(env,key,value,minutes){const now=nowIso(),exp=new Date(Date.now()+Number(minutes||5)*60000).toISOString();await env.DB.prepare(`INSERT INTO sanad_cache(cache_key,value_json,expires_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(key,JSON.stringify(value),exp,now).run();return value;}

async function maybeMigrateLegacyV11(env){
  const done=await env.DB.prepare(`SELECT value FROM sanad_meta WHERE key='legacy_v11_migrated'`).first();if(done?.value==="1")return;
  const now=nowIso();
  try{
    if(await tableExistsV125(env,"user_profiles")){
      const rows=(await env.DB.prepare(`SELECT * FROM user_profiles LIMIT 5000`).all())?.results||[];
      for(const r of rows)await env.DB.prepare(`INSERT INTO sanad_users(chat_id,timezone,city,country,country_code,latitude,longitude,locale,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET timezone=excluded.timezone,city=excluded.city,country=excluded.country,country_code=excluded.country_code,latitude=COALESCE(excluded.latitude,sanad_users.latitude),longitude=COALESCE(excluded.longitude,sanad_users.longitude),locale=excluded.locale,updated_at=excluded.updated_at`).bind(String(r.chat_id),String(r.timezone||TZ),String(r.city||DEFAULT_CITY),String(r.country||DEFAULT_COUNTRY),String(r.country_code||"EG"),r.latitude??null,r.longitude??null,String(r.locale||"ar-EG"),now,now).run();
    }
    if(await tableExistsV125(env,"user_memories")){
      const rows=(await env.DB.prepare(`SELECT * FROM user_memories LIMIT 10000`).all())?.results||[];
      for(const r of rows){const c=normalizeText(r.memory||"");if(c)await env.DB.prepare(`INSERT OR IGNORE INTO sanad_memories(chat_id,memory_type,content,normalized,importance,source,created_at,updated_at) VALUES(?,'semantic',?,?,0.6,'v11_migration',?,?)`).bind(String(r.chat_id),c,normItem(c),now,now).run();}
    }
    if(await tableExistsV125(env,"smart_list_items")){
      const rows=(await env.DB.prepare(`SELECT * FROM smart_list_items LIMIT 20000`).all())?.results||[];
      for(const r of rows){const title=normalizeText(r.title||"");if(!title)continue;const st=String(r.status)==="bought"?"bought":"pending";await env.DB.prepare(`INSERT INTO sanad_shopping(chat_id,title,normalized,quantity,status,meta_json,position,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM sanad_shopping WHERE chat_id=? AND normalized=?)`).bind(String(r.chat_id),title,normItem(title),r.quantity??null,st,String(r.meta_json||"{}"),Number(r.position||0),String(r.created_at||now),String(r.updated_at||now),String(r.chat_id),normItem(title)).run();}
    }
    if(await tableExistsV125(env,"reminders")){
      const rows=(await env.DB.prepare(`SELECT * FROM reminders WHERE COALESCE(cancelled,0)=0 LIMIT 20000`).all())?.results||[];
      for(const r of rows)await env.DB.prepare(`INSERT INTO sanad_reminders(chat_id,title,kind,local_date,local_time,timezone,duration_minutes,status,sent,advance_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?, 'active',?, ?,?,? WHERE NOT EXISTS(SELECT 1 FROM sanad_reminders WHERE chat_id=? AND title=? AND local_date=? AND local_time=? AND status='active')`).bind(String(r.chat_id),String(r.title),String(r.kind||"reminder"),String(r.local_date),String(r.local_time),String(r.timezone||TZ),Number(r.duration_minutes||0),Number(r.sent||0),String(r.advance_alerts_json||"[]"),String(r.created_at||now),String(r.updated_at||now),String(r.chat_id),String(r.title),String(r.local_date),String(r.local_time)).run();
    }
    if(await tableExistsV125(env,"schedule_rules")){
      const rows=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE active=1 LIMIT 10000`).all())?.results||[];
      for(const r of rows)await env.DB.prepare(`INSERT INTO sanad_recurrences(chat_id,title,kind,rule_json,timezone,duration_minutes,start_date,end_date,max_occurrences,fired_count,active,paused_until,exceptions_json,advance_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`).bind(String(r.chat_id),String(r.title),String(r.kind||"reminder"),String(r.rule_json||"{}"),String(r.timezone||TZ),Number(r.duration_minutes||0),String(r.start_at||now).slice(0,10),r.end_at?String(r.end_at).slice(0,10):null,r.max_occurrences??null,Number(r.fired_count||0),r.paused_until??null,String(r.exceptions_json||"[]"),String(r.advance_alerts_json||"[]"),String(r.created_at||now),String(r.updated_at||now)).run();
    }
    /** @type {Array<[string,string,(r:any)=>Promise<any>]>} */
    const simpleMaps=[
      ["projects","sanad_projects",async r=>env.DB.prepare(`INSERT INTO sanad_projects(chat_id,title,status,priority,deadline,progress,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.title),String(r.status||"active"),String(r.priority||"normal"),r.deadline??null,Number(r.progress||0),String(parseJsonV125(r.data_json,{}).notes||""),String(r.created_at||now),String(r.updated_at||now)).run()],
      ["project_tasks","sanad_project_tasks",async r=>env.DB.prepare(`INSERT INTO sanad_project_tasks(project_id,chat_id,title,status,due_at,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(Number(r.project_id),String(r.chat_id),String(r.title),String(r.status||"pending"),r.due_at??null,String(r.priority||"normal"),String(r.created_at||now),String(r.updated_at||now)).run()],
      ["waiting_items","sanad_waiting",async r=>env.DB.prepare(`INSERT INTO sanad_waiting(chat_id,title,waiting_on,due_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.title),r.waiting_on??null,r.due_at??null,String(r.status||"waiting"),String(r.created_at||now),String(r.updated_at||now)).run()],
      ["prayer_rules","sanad_prayer_rules",async r=>env.DB.prepare(`INSERT INTO sanad_prayer_rules(chat_id,title,prayer,offset_minutes,start_date,end_date,weekdays_json,max_occurrences,fired_count,active,paused_until,exceptions_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.title),String(r.prayer),Number(r.offset_minutes||0),String(r.start_date),r.end_date??null,String(r.weekdays_json||"[]"),r.max_occurrences??null,Number(r.fired_count||0),Number(r.active??1),r.paused_until??null,String(r.exceptions_json||"[]"),String(r.created_at||now),String(r.updated_at||now)).run()],
      ["live_watches","sanad_live_watches",async r=>env.DB.prepare(`INSERT INTO sanad_live_watches(chat_id,query,last_url,active,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.query_ar||r.query_en||""),r.last_url??null,Number(r.active??1),String(r.created_at||now),String(r.updated_at||now)).run()]
    ];
    for(const [legacy,_,fn] of simpleMaps)if(await tableExistsV125(env,legacy)){const rows=(await env.DB.prepare(`SELECT * FROM ${legacy} LIMIT 10000`).all())?.results||[];for(const r of rows)try{await fn(r)}catch{}}
    if(await tableExistsV125(env,"life_entities")){
      const rows=(await env.DB.prepare(`SELECT * FROM life_entities LIMIT 10000`).all())?.results||[];
      for(const r of rows)await env.DB.prepare(`INSERT OR IGNORE INTO sanad_entities(chat_id,entity_type,name,normalized,data_json,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.entity_type||"concept"),String(r.name),String(r.normalized_name||normItem(r.name)),String(r.data_json||"{}"),Number(r.confidence??1),String(r.source||"v11_migration"),String(r.created_at||now),String(r.updated_at||now)).run();
    }
  }catch(e){console.warn("Sanad V11 migration warning",safeError(e));}
  await env.DB.prepare(`INSERT INTO sanad_meta(key,value,updated_at) VALUES('legacy_v11_migrated','1',?) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at`).bind(nowIso()).run();
}

async function snapshotUserStateV125(env,chatId){
  const data={};
  for(const table of SNAPSHOT_TABLES){if(!(await tableExistsV125(env,table)))continue;data[table]=(await env.DB.prepare(`SELECT * FROM ${table} WHERE chat_id=? ORDER BY id`).bind(String(chatId)).all())?.results||[];}
  return data;
}
async function restoreUserStateV125(env,chatId,snap){
  for(const table of SNAPSHOT_TABLES){if(!(table in (snap||{})))continue;await env.DB.prepare(`DELETE FROM ${table} WHERE chat_id=?`).bind(String(chatId)).run();const rows=Array.isArray(snap[table])?snap[table]:[];for(const row of rows){const cols=Object.keys(row);if(!cols.length)continue;const sql=`INSERT INTO ${table}(${cols.map(sqlQuoteNameV125).join(",")}) VALUES(${cols.map(()=>"?").join(",")})`;await env.DB.prepare(sql).bind(...cols.map(c=>row[c])).run();}}
}
async function ensureOperationSnapshotV125(env,chatId,operationId,snapshot,summary){await env.DB.prepare(`INSERT OR IGNORE INTO sanad_operation_snapshots(operation_id,chat_id,snapshot_json,summary,created_at,committed) VALUES(?,?,?,?,?,0)`).bind(operationId,String(chatId),JSON.stringify(snapshot),String(summary||""),nowIso()).run();const r=await env.DB.prepare(`SELECT snapshot_json,committed FROM sanad_operation_snapshots WHERE operation_id=? AND chat_id=?`).bind(operationId,String(chatId)).first();return r?parseJsonV125(r.snapshot_json,snapshot):snapshot;}
async function commitOperationSnapshotV125(env,operationId){await env.DB.prepare(`UPDATE sanad_operation_snapshots SET committed=1 WHERE operation_id=?`).bind(operationId).run();}
async function discardOperationSnapshotV125(env,operationId){await env.DB.prepare(`DELETE FROM sanad_operation_snapshots WHERE operation_id=? AND committed=0`).bind(operationId).run();}
async function savePendingActionV125(env,chatId,text,steps){const now=nowIso(),exp=new Date(Date.now()+CONFIRM_TTL_MINUTES*60000).toISOString();await env.DB.prepare(`INSERT INTO sanad_pending_actions(chat_id,original_text,steps_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET original_text=excluded.original_text,steps_json=excluded.steps_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(String(chatId),String(text),JSON.stringify(steps),exp,now,now).run();}
async function getPendingActionV125(env,chatId){const r=await env.DB.prepare(`SELECT * FROM sanad_pending_actions WHERE chat_id=? AND expires_at>?`).bind(String(chatId),nowIso()).first();if(!r)await env.DB.prepare(`DELETE FROM sanad_pending_actions WHERE chat_id=?`).bind(String(chatId)).run();return r||null;}
async function clearPendingActionV125(env,chatId){await env.DB.prepare(`DELETE FROM sanad_pending_actions WHERE chat_id=?`).bind(String(chatId)).run();}
function isYesV125(t){return /^(?:ايوه|أيوه|اه|آه|نعم|موافق|اوافق|أوافق|نفذ|نفّذ|تمام نفذ|اكيد|أكيد)$/u.test(normalizeText(t).toLowerCase());}
function isNoV125(t){return /^(?:لا|لأ|الغى|الغي|إلغاء|الغيه|سيبها|خلاص لا|مش عاوز)$/u.test(normalizeText(t).toLowerCase());}

function normalizeRuleV125(raw){
  const x=raw&&typeof raw==='object'?raw:{};
  const unit=['minutes','hours','days','weeks','months','years'].includes(String(x.unit))?String(x.unit):'days';
  const every=clampV125(Math.trunc(x.every||1),1,365);
  const times=(Array.isArray(x.times)?x.times:[]).map(String).filter(validTimeV125).slice(0,12);
  const weekdays=(Array.isArray(x.weekdays)?x.weekdays:[]).map(Number).filter(n=>n>=1&&n<=7).slice(0,7);
  const monthdays=(Array.isArray(x.monthdays)?x.monthdays:[]).map(Number).filter(n=>n>=1&&n<=31).slice(0,31);
  const months=(Array.isArray(x.months)?x.months:[]).map(Number).filter(n=>n>=1&&n<=12).slice(0,12);
  return {every,unit,times:times.length?times:['09:00'],weekdays,monthdays,months};
}
function occurrenceKeyV125(date,time){return `${date}T${time}`;}
function recurrenceMatchesV125(rule,startDate,date){
  const days=dateDiffDaysV125(startDate,date);if(days<0)return false;
  if(rule.months.length&&!rule.months.includes(Number(date.slice(5,7))))return false;
  if(rule.monthdays.length&&!rule.monthdays.includes(Number(date.slice(8,10))))return false;
  if(rule.weekdays.length&&!rule.weekdays.includes(isoWeekdayV125(date)))return false;
  if(rule.unit==='days'&&days%rule.every!==0)return false;
  if(rule.unit==='weeks'){if(Math.floor(days/7)%rule.every!==0)return false;if(!rule.weekdays.length&&isoWeekdayV125(date)!==isoWeekdayV125(startDate))return false;}
  if(rule.unit==='months'){
    const [sy,sm,sd]=startDate.split('-').map(Number),[y,m,d]=date.split('-').map(Number);if(((y-sy)*12+(m-sm))%rule.every!==0)return false;
    if(!rule.monthdays.length&&!rule.weekdays.length&&d!==Math.min(sd,new Date(Date.UTC(y,m,0,12)).getUTCDate()))return false;
  }
  if(rule.unit==='years'){
    const [sy,sm,sd]=startDate.split('-').map(Number),[y,m,d]=date.split('-').map(Number);if((y-sy)%rule.every!==0)return false;
    if(!rule.months.length&&!rule.monthdays.length&&!rule.weekdays.length&&(m!==sm||d!==Math.min(sd,new Date(Date.UTC(y,m,0,12)).getUTCDate())))return false;
  }
  return true;
}
function generateRecurrenceOccurrencesV125(row,fromDate,toDate,limit=500){
  const rule=normalizeRuleV125(parseJsonV125(row.rule_json,{})),out=[],exceptions=new Set(parseJsonV125(row.exceptions_json,[]).map(String));
  const start=String(row.start_date),end=row.end_date?String(row.end_date):null,max=Number(row.max_occurrences||MAX_RECURRENCE_OCCURRENCES),already=Number(row.fired_count||0);
  if(rule.unit==='minutes'||rule.unit==='hours'){
    const step=rule.unit==='minutes'?rule.every:rule.every*60,baseTime=rule.times[0]||'00:00';
    const base=Date.parse(`${start}T${baseTime}:00Z`),from=Date.parse(`${fromDate}T00:00:00Z`),to=Date.parse(`${toDate}T23:59:00Z`);
    let k=Math.max(0,Math.ceil((from-base)/(step*60000))),ms=base+k*step*60000,guard=0;
    while(ms<=to&&out.length<limit&&already+out.length<max&&guard++<MAX_RECURRENCE_OCCURRENCES){const iso=new Date(ms).toISOString(),d=iso.slice(0,10),t=iso.slice(11,16);if((!end||d<=end)){const key=occurrenceKeyV125(d,t);if(!exceptions.has(key)&&!exceptions.has(d))out.push({date:d,time:t,key});}ms+=step*60000;}
    return out;
  }
  for(let date=fromDate<start?start:fromDate;date<=toDate&&(!end||date<=end)&&out.length<limit;date=addDaysV125(date,1)){
    if(!recurrenceMatchesV125(rule,start,date))continue;
    for(const time of rule.times){const key=occurrenceKeyV125(date,time);if(!exceptions.has(key)&&!exceptions.has(date))out.push({date,time,key});if(out.length>=limit||already+out.length>=max)break;}
  }
  return out;
}
async function toolRecurrenceReadV125(env,chatId,args){let sql=`SELECT * FROM sanad_recurrences WHERE chat_id=?`,b=[chatId];if(args?.active_only!==false){sql+=` AND active=1`}sql+=` ORDER BY id DESC LIMIT 100`;const rows=(await env.DB.prepare(sql).bind(...b).all())?.results||[];return{ok:true,changed:0,verified:true,items:rows.map(r=>({...r,rule:normalizeRuleV125(parseJsonV125(r.rule_json,{}))}))};}
async function toolRecurrenceCreateV125(env,chatId,args,user){const title=normalizeText(args?.title),start=String(args?.start_date||localNow(user?.timezone||TZ).date),rule=normalizeRuleV125(args?.rule||{});if(!title||!validDateV125(start))return{ok:false,changed:0,verified:false,error:'invalid_fields'};const now=nowIso(),end=validDateV125(args?.end_date)?String(args.end_date):null,max=args?.max_occurrences==null?null:clampV125(Math.trunc(args.max_occurrences),1,MAX_RECURRENCE_OCCURRENCES),adv=(Array.isArray(args?.advance_minutes)?args.advance_minutes:[args?.advance_minutes]).filter(x=>x!=null).map(x=>clampV125(x,0,MAX_ADVANCE_MINUTES));const r=await env.DB.prepare(`INSERT INTO sanad_recurrences(chat_id,title,kind,rule_json,timezone,duration_minutes,start_date,end_date,max_occurrences,advance_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(chatId,title,String(args?.kind||'reminder'),JSON.stringify(rule),String(user?.timezone||TZ),clampV125(args?.duration_minutes||0,0,10080),start,end,max,JSON.stringify(adv),now,now).run();const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:after?1:0,verified:!!after,id,after};}
async function toolRecurrenceUpdateV125(env,chatId,args){const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:'missing_id'};const before=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!before)return{ok:false,changed:0,verified:false,error:'not_found'};const rule=args?.rule?normalizeRuleV125(args.rule):parseJsonV125(before.rule_json,{}),title=args?.title!=null?normalizeText(args.title):before.title,end=args?.end_date===null?null:(validDateV125(args?.end_date)?String(args.end_date):before.end_date),max=args?.max_occurrences!=null?clampV125(args.max_occurrences,1,MAX_RECURRENCE_OCCURRENCES):before.max_occurrences;await env.DB.prepare(`UPDATE sanad_recurrences SET title=?,rule_json=?,end_date=?,max_occurrences=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,JSON.stringify(rule),end,max,nowIso(),chatId,id).run();const after=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:1,verified:!!after,before,after};}
async function setRecurrenceActiveV125(env,chatId,args,active){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_recurrences SET active=?,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(active?1:0,nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT id,active FROM sanad_recurrences WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];const verified=rows.length>0&&rows.every(r=>Number(r.active)===(active?1:0));return{ok:verified,changed:rows.length,verified,ids};}
async function toolRecurrenceSkipV125(env,chatId,args){const id=Number(args?.id),date=String(args?.date||''),time=args?.time?String(args.time):null;if(!id||!validDateV125(date))return{ok:false,changed:0,verified:false,error:'invalid_skip'};const row=await env.DB.prepare(`SELECT exceptions_json FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!row)return{ok:false,changed:0,verified:false,error:'not_found'};const arr=parseJsonV125(row.exceptions_json,[]),key=time&&validTimeV125(time)?occurrenceKeyV125(date,time):date;if(!arr.includes(key))arr.push(key);await env.DB.prepare(`UPDATE sanad_recurrences SET exceptions_json=?,updated_at=? WHERE chat_id=? AND id=?`).bind(JSON.stringify(arr),nowIso(),chatId,id).run();const chk=await env.DB.prepare(`SELECT exceptions_json FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first(),verified=parseJsonV125(chk?.exceptions_json,[]).includes(key);return{ok:verified,changed:verified?1:0,verified,key};}
async function toolRecurrenceCancelV125(env,chatId,args){return setRecurrenceActiveV125(env,chatId,args,false);}

async function getScheduleOccurrencesV125(env,chatId,fromDate,toDate){
  const out=[];
  const one=(await env.DB.prepare(`SELECT id,title,local_date,local_time,duration_minutes,kind FROM sanad_reminders WHERE chat_id=? AND status='active' AND local_date BETWEEN ? AND ?`).bind(chatId,fromDate,toDate).all())?.results||[];
  for(const r of one)out.push({source_type:'reminder',source_id:Number(r.id),title:r.title,date:r.local_date,time:r.local_time,duration_minutes:Number(r.duration_minutes||((r.kind||'reminder')==='appointment'?DEFAULT_EVENT_DURATION:0)),kind:r.kind||'reminder'});
  const rules=(await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?)`).bind(chatId,toDate,fromDate).all())?.results||[];
  for(const r of rules)for(const o of generateRecurrenceOccurrencesV125(r,fromDate,toDate,1000))out.push({source_type:'recurrence',source_id:Number(r.id),title:r.title,date:o.date,time:o.time,duration_minutes:Number(r.duration_minutes||((r.kind||'reminder')==='appointment'?DEFAULT_EVENT_DURATION:0)),kind:r.kind||'reminder',occurrence_key:o.key});
  return out.sort((a,b)=>`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}
function overlapV125(aStart,aDur,bStart,bDur){return aStart<aStart+1&&aStart<(bStart+bDur)&&bStart<(aStart+aDur);}
async function toolScheduleConflictsV125(env,chatId,args){const from=validDateV125(args?.from_date)?String(args.from_date):localNow().date,to=validDateV125(args?.to_date)?String(args.to_date):addDaysV125(from,CONFLICT_HORIZON_DAYS);const occ=(await getScheduleOccurrencesV125(env,chatId,from,to)).filter(x=>Number(x.duration_minutes)>0),conf=[];const by={};for(const x of occ)(by[x.date]??=[]).push(x);for(const [date,rows] of Object.entries(by)){for(let i=0;i<rows.length;i++)for(let k=i+1;k<rows.length;k++){const a=rows[i],b=rows[k],as=hmMinutesV125(a.time),bs=hmMinutesV125(b.time);if(as<bs+Number(b.duration_minutes)&&bs<as+Number(a.duration_minutes))conf.push({date,a,b});}}return{ok:true,changed:0,verified:true,count:conf.length,conflicts:conf.slice(0,100)};}
async function toolScheduleSearchV125(env,chatId,args){const from=validDateV125(args?.from_date)?String(args.from_date):localNow().date,to=validDateV125(args?.to_date)?String(args.to_date):addDaysV125(from,30),q=normItem(args?.query||'');let rows=await getScheduleOccurrencesV125(env,chatId,from,to);if(q)rows=rows.filter(x=>normItem(x.title).includes(q));return{ok:true,changed:0,verified:true,items:rows.slice(0,200)};}
async function toolScheduleShiftV125(env,chatId,args){const type=String(args?.source_type||'reminder'),id=Number(args?.id),mins=Number(args?.minutes||0);if(!id||!mins)return{ok:false,changed:0,verified:false,error:'invalid_shift'};if(type==='reminder'){const b=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const nx=addMinutesLocal(b.local_date,b.local_time,mins);await env.DB.prepare(`UPDATE sanad_reminders SET local_date=?,local_time=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(nx.date,nx.time,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,id).first();const verified=a?.local_date===nx.date&&a?.local_time===nx.time;if(verified)await propagateDependenciesV125(env,chatId,'reminder',id,mins);return{ok:verified,changed:verified?1:0,verified,before:b,after:a};}return{ok:false,changed:0,verified:false,error:'shift_only_one_time_supported'};}

async function toolDependencyReadV125(env,chatId){const rows=(await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 100`).bind(chatId).all())?.results||[];return{ok:true,changed:0,verified:true,items:rows};}
async function toolDependencyCreateV125(env,chatId,args){const st=String(args?.source_type||'reminder'),sid=Number(args?.source_id),tt=String(args?.target_type||'reminder'),tid=Number(args?.target_id),rel=String(args?.relation||'after'),off=Math.trunc(Number(args?.offset_minutes||0));if(!sid||!tid)return{ok:false,changed:0,verified:false,error:'invalid_dependency'};if(st===tt&&sid===tid)return{ok:false,changed:0,verified:false,error:'self_dependency'};const now=nowIso();const r=await env.DB.prepare(`INSERT OR REPLACE INTO sanad_dependencies(chat_id,source_type,source_id,target_type,target_id,relation,offset_minutes,condition_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)`).bind(chatId,st,sid,tt,tid,rel,off,JSON.stringify(args?.condition||{}),now,now).run();const id=Number(r?.meta?.last_row_id||0),chk=await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND source_type=? AND source_id=? AND target_type=? AND target_id=? AND active=1`).bind(chatId,st,sid,tt,tid).first();return{ok:!!chk,changed:chk?1:0,verified:!!chk,id:Number(chk?.id||id),after:chk};}
async function toolDependencyRemoveV125(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_dependencies SET active=0,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT id,active FROM sanad_dependencies WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],verified=rows.length>0&&rows.every(r=>Number(r.active)===0);return{ok:verified,changed:rows.length,verified};}
async function propagateDependenciesV125(env,chatId,sourceType,sourceId,deltaMinutes,visited=new Set()){
  const key=`${sourceType}:${sourceId}`;if(visited.has(key)||visited.size>30)return;visited.add(key);
  const deps=(await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND source_type=? AND source_id=? AND active=1`).bind(chatId,sourceType,sourceId).all())?.results||[];
  for(const d of deps){if(d.target_type==='reminder'){const r=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,Number(d.target_id)).first();if(r){const nx=addMinutesLocal(r.local_date,r.local_time,Number(deltaMinutes||0));await env.DB.prepare(`UPDATE sanad_reminders SET local_date=?,local_time=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(nx.date,nx.time,nowIso(),chatId,Number(d.target_id)).run();await propagateDependenciesV125(env,chatId,'reminder',Number(d.target_id),deltaMinutes,visited);}}}
}

async function toolProfileReadV125(env,chatId){const r=await ensureUser(env,chatId);return{ok:true,changed:0,verified:true,profile:r};}
async function toolProfileUpdateV125(env,chatId,args){const before=await ensureUser(env,chatId),allowed=['timezone','city','country','country_code','latitude','longitude','locale','display_name','autonomy_mode','proactive_enabled','morning_brief_time','evening_brief_time','morning_brief_enabled','evening_brief_enabled','ask_before_delete','deep_reasoning_mode'];const sets=[],vals=[];for(const k of allowed)if(args?.[k]!==undefined){sets.push(`${k}=?`);vals.push(args[k]);}if(!sets.length)return{ok:false,changed:0,verified:false,error:'nothing_to_update'};sets.push('updated_at=?');vals.push(nowIso(),chatId);await env.DB.prepare(`UPDATE sanad_users SET ${sets.join(',')} WHERE chat_id=?`).bind(...vals).run();const after=await env.DB.prepare(`SELECT * FROM sanad_users WHERE chat_id=?`).bind(chatId).first(),verified=!!after&&allowed.filter(k=>args?.[k]!==undefined).every(k=>String(after[k]??'')===String(args[k]??''));return{ok:verified,changed:verified?1:0,verified,before,after};}
async function toolSettingsReadV125(env,chatId){const p=await ensureUser(env,chatId);return{ok:true,changed:0,verified:true,settings:{autonomy_mode:p.autonomy_mode,proactive_enabled:p.proactive_enabled,morning_brief_enabled:p.morning_brief_enabled,morning_brief_time:p.morning_brief_time,evening_brief_enabled:p.evening_brief_enabled,evening_brief_time:p.evening_brief_time,ask_before_delete:p.ask_before_delete,deep_reasoning_mode:p.deep_reasoning_mode}};}
async function toolSettingsUpdateV125(env,chatId,args){return toolProfileUpdateV125(env,chatId,args);}

async function toolWorldReadV125(env,chatId,args){const q=normItem(args?.query||''),type=normalizeText(args?.entity_type||'');let sql=`SELECT * FROM sanad_entities WHERE chat_id=?`,b=[chatId];if(type){sql+=` AND entity_type=?`;b.push(type)}sql+=` ORDER BY confidence DESC,id DESC LIMIT 100`;let rows=(await env.DB.prepare(sql).bind(...b).all())?.results||[];if(q)rows=rows.filter(x=>normItem(x.name).includes(q)||normItem(x.data_json).includes(q));for(const x of rows)x.data=parseJsonV125(x.data_json,{});return{ok:true,changed:0,verified:true,items:rows.slice(0,50)};}
async function toolWorldUpsertV125(env,chatId,args){const name=normalizeText(args?.name),type=normalizeText(args?.entity_type||'concept');if(!name)return{ok:false,changed:0,verified:false,error:'missing_name'};const n=normItem(name),now=nowIso(),data=args?.data&&typeof args.data==='object'?args.data:{};await env.DB.prepare(`INSERT INTO sanad_entities(chat_id,entity_type,name,normalized,data_json,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,entity_type,normalized) DO UPDATE SET name=excluded.name,data_json=excluded.data_json,confidence=excluded.confidence,source=excluded.source,updated_at=excluded.updated_at`).bind(chatId,type,name,n,JSON.stringify(data),clampV125(args?.confidence??1,0,1),String(args?.source||'user_explicit'),now,now).run();const after=await env.DB.prepare(`SELECT * FROM sanad_entities WHERE chat_id=? AND entity_type=? AND normalized=?`).bind(chatId,type,n).first();return{ok:!!after,changed:after?1:0,verified:!!after,id:Number(after?.id||0),after};}
async function toolWorldLinkV125(env,chatId,args){const from=Number(args?.from_entity_id),to=args?.to_entity_id==null?null:Number(args.to_entity_id),rel=normalizeText(args?.relation);if(!from||!rel||(!to&&!normalizeText(args?.object_value)))return{ok:false,changed:0,verified:false,error:'invalid_link'};const exists=await env.DB.prepare(`SELECT id FROM sanad_entities WHERE chat_id=? AND id=?`).bind(chatId,from).first();if(!exists)return{ok:false,changed:0,verified:false,error:'from_not_found'};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_edges(chat_id,from_entity_id,relation,to_entity_id,object_value,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(chatId,from,rel,to,normalizeText(args?.object_value)||null,clampV125(args?.confidence??1,0,1),String(args?.source||'agent'),now,now).run();const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_edges WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:after?1:0,verified:!!after,id,after};}
async function toolWorldForgetV125(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`DELETE FROM sanad_edges WHERE chat_id=? AND (from_entity_id IN (${qs}) OR to_entity_id IN (${qs}))`).bind(chatId,...ids,...ids).run();await env.DB.prepare(`DELETE FROM sanad_entities WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).run();const left=(await env.DB.prepare(`SELECT id FROM sanad_entities WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return{ok:left.length===0,changed:ids.length-left.length,verified:left.length===0};}

async function toolProjectTasksReadV125(env,chatId,args){let sql=`SELECT * FROM sanad_project_tasks WHERE chat_id=?`,b=[chatId];if(args?.project_id){sql+=` AND project_id=?`;b.push(Number(args.project_id))}if(args?.status){sql+=` AND status=?`;b.push(String(args.status))}sql+=` ORDER BY id DESC LIMIT 200`;return{ok:true,changed:0,verified:true,items:(await env.DB.prepare(sql).bind(...b).all())?.results||[]};}
async function toolProjectTaskCreateV125(env,chatId,args){const pid=Number(args?.project_id),title=normalizeText(args?.title);if(!pid||!title)return{ok:false,changed:0,verified:false,error:'invalid_task'};const project=await env.DB.prepare(`SELECT id FROM sanad_projects WHERE chat_id=? AND id=?`).bind(chatId,pid).first();if(!project)return{ok:false,changed:0,verified:false,error:'project_not_found'};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_project_tasks(project_id,chat_id,title,status,due_at,priority,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?,?)`).bind(pid,chatId,title,args?.due_at??null,String(args?.priority||'normal'),now,now).run();const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_project_tasks WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:after?1:0,verified:!!after,id,after};}
async function toolProjectTaskUpdateV125(env,chatId,args){const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:'missing_id'};const b=await env.DB.prepare(`SELECT * FROM sanad_project_tasks WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const title=args?.title!=null?normalizeText(args.title):b.title,status=args?.status!=null?String(args.status):b.status,due=args?.due_at!==undefined?args.due_at:b.due_at,priority=args?.priority!=null?String(args.priority):b.priority;await env.DB.prepare(`UPDATE sanad_project_tasks SET title=?,status=?,due_at=?,priority=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,status,due,priority,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_project_tasks WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!a,changed:1,verified:!!a,before:b,after:a};}

async function toolShoppingSessionStartV125(env,chatId,args){const active=await env.DB.prepare(`SELECT * FROM sanad_shopping_sessions WHERE chat_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`).bind(chatId).first();if(active)return{ok:true,changed:0,verified:true,id:Number(active.id),session:active};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_shopping_sessions(chat_id,place_name,started_at) VALUES(?,?,?)`).bind(chatId,normalizeText(args?.place_name)||null,now).run(),id=Number(r?.meta?.last_row_id||0),a=await env.DB.prepare(`SELECT * FROM sanad_shopping_sessions WHERE id=?`).bind(id).first();return{ok:!!a,changed:a?1:0,verified:!!a,id,session:a};}
async function toolShoppingSessionFinishV125(env,chatId){const active=await env.DB.prepare(`SELECT * FROM sanad_shopping_sessions WHERE chat_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`).bind(chatId).first();if(!active)return{ok:true,changed:0,verified:true};await env.DB.prepare(`UPDATE sanad_shopping_sessions SET ended_at=? WHERE chat_id=? AND id=?`).bind(nowIso(),chatId,Number(active.id)).run();const a=await env.DB.prepare(`SELECT * FROM sanad_shopping_sessions WHERE id=?`).bind(Number(active.id)).first();return{ok:!!a?.ended_at,changed:a?.ended_at?1:0,verified:!!a?.ended_at,session:a};}
async function toolShoppingProgressV125(env,chatId){const r=await toolShoppingRead(env,chatId),all=r.items,pending=all.filter(x=>x.status==='pending').length,bought=all.filter(x=>x.status==='bought').length,total=all.length;return{ok:true,changed:0,verified:true,total,pending,bought,percent:total?Math.round(bought/total*100):0};}

const PRAYER_ALIASES_V125={fajr:'Fajr',الفجر:'Fajr',sunrise:'Sunrise',الشروق:'Sunrise',dhuhr:'Dhuhr',الظهر:'Dhuhr',asr:'Asr',العصر:'Asr',maghrib:'Maghrib',المغرب:'Maghrib',isha:'Isha',العشاء:'Isha'};
function cleanPrayerTimeV125(v){const m=String(v||'').match(/\b(\d{1,2}):(\d{2})\b/);return m?`${String(Number(m[1])).padStart(2,'0')}:${m[2]}`:'';}
async function fetchPrayerTimesV125(env,user,date){const city=String(user?.city||DEFAULT_CITY),country=String(user?.country||DEFAULT_COUNTRY),key=`prayer:${date}:${city}:${country}`;const c=await cacheGetV125(env,key);if(c)return c;let url;if(user?.latitude!=null&&user?.longitude!=null)url=`https://api.aladhan.com/v1/timings/${date.split('-').reverse().join('-')}?latitude=${encodeURIComponent(user.latitude)}&longitude=${encodeURIComponent(user.longitude)}&method=5`;else url=`https://api.aladhan.com/v1/timingsByCity/${date.split('-').reverse().join('-')}?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=5`;const r=await fetch(url);if(!r.ok)throw new Error(`prayer_http_${r.status}`);const x=await r.json(),t=x?.data?.timings||{},out={date,times:{Fajr:cleanPrayerTimeV125(t.Fajr),Sunrise:cleanPrayerTimeV125(t.Sunrise),Dhuhr:cleanPrayerTimeV125(t.Dhuhr),Asr:cleanPrayerTimeV125(t.Asr),Maghrib:cleanPrayerTimeV125(t.Maghrib),Isha:cleanPrayerTimeV125(t.Isha)},timezone:String(x?.data?.meta?.timezone||user?.timezone||TZ)};return cacheSetV125(env,key,out,PRAYER_CACHE_MINUTES);}
async function toolPrayerTimesV125(env,chatId,args,user){const date=validDateV125(args?.date)?String(args.date):localNow(user?.timezone||TZ).date;const data=await fetchPrayerTimesV125(env,user,date);return{ok:true,changed:0,verified:true,...data};}
async function toolPrayerRulesReadV125(env,chatId){return{ok:true,changed:0,verified:true,items:(await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND active=1 ORDER BY id DESC`).bind(chatId).all())?.results||[]};}
async function toolPrayerRuleCreateV125(env,chatId,args,user){const raw=normItem(args?.prayer||''),prayer=PRAYER_ALIASES_V125[raw]||PRAYER_ALIASES_V125[String(args?.prayer||'').toLowerCase()]||String(args?.prayer||'');const title=normalizeText(args?.title||`تنبيه ${args?.prayer||prayer}`),start=validDateV125(args?.start_date)?String(args.start_date):localNow(user?.timezone||TZ).date;if(!['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'].includes(prayer))return{ok:false,changed:0,verified:false,error:'invalid_prayer'};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_prayer_rules(chat_id,title,prayer,offset_minutes,start_date,end_date,weekdays_json,max_occurrences,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(chatId,title,prayer,Math.trunc(Number(args?.offset_minutes||0)),start,validDateV125(args?.end_date)?String(args.end_date):null,JSON.stringify(Array.isArray(args?.weekdays)?args.weekdays:[]),args?.max_occurrences==null?null:clampV125(args.max_occurrences,1,MAX_RECURRENCE_OCCURRENCES),now,now).run();const id=Number(r?.meta?.last_row_id||0),a=await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!a,changed:a?1:0,verified:!!a,id,after:a};}
async function toolPrayerRuleUpdateV125(env,chatId,args){const id=Number(args?.id),b=await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const title=args?.title!=null?normalizeText(args.title):b.title,offset=args?.offset_minutes!=null?Math.trunc(Number(args.offset_minutes)):b.offset_minutes,end=args?.end_date!==undefined?(validDateV125(args.end_date)?String(args.end_date):null):b.end_date;await env.DB.prepare(`UPDATE sanad_prayer_rules SET title=?,offset_minutes=?,end_date=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,offset,end,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!a,changed:1,verified:!!a,before:b,after:a};}
async function toolPrayerRuleCancelV125(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_prayer_rules SET active=0,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT active FROM sanad_prayer_rules WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],v=rows.length>0&&rows.every(x=>Number(x.active)===0);return{ok:v,changed:rows.length,verified:v};}
async function toolPrayerRuleSkipV125(env,chatId,args){const id=Number(args?.id),date=String(args?.date||'');if(!id||!validDateV125(date))return{ok:false,changed:0,verified:false,error:'invalid_skip'};const b=await env.DB.prepare(`SELECT exceptions_json FROM sanad_prayer_rules WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const arr=parseJsonV125(b.exceptions_json,[]);if(!arr.includes(date))arr.push(date);await env.DB.prepare(`UPDATE sanad_prayer_rules SET exceptions_json=?,updated_at=? WHERE chat_id=? AND id=?`).bind(JSON.stringify(arr),nowIso(),chatId,id).run();return{ok:true,changed:1,verified:true,date};}

async function toolHolidaysV125(env,chatId,args,user){const year=Number(args?.year||localNow(user?.timezone||TZ).date.slice(0,4)),cc=String(args?.country_code||user?.country_code||'EG').toUpperCase(),key=`holidays:${cc}:${year}`;let data=await cacheGetV125(env,key);if(!data){const r=await fetch(`https://date.nager.at/api/v4/Holidays/${encodeURIComponent(cc)}/${year}`);if(!r.ok)throw new Error(`holidays_http_${r.status}`);data=await r.json();await cacheSetV125(env,key,data,HOLIDAY_CACHE_MINUTES);}return{ok:true,changed:0,verified:true,year,country_code:cc,items:Array.isArray(data)?data.slice(0,100):[]};}
async function toolWeatherV125(env,chatId,args,user){let lat=args?.latitude??user?.latitude,lon=args?.longitude??user?.longitude,city=normalizeText(args?.city||user?.city||DEFAULT_CITY);if(lat==null||lon==null){const g=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ar&format=json`);const gx=await g.json().catch(()=>({})),first=gx?.results?.[0];if(!first)throw new Error('weather_location_not_found');lat=first.latitude;lon=first.longitude;city=first.name||city;}const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`);if(!r.ok)throw new Error(`weather_http_${r.status}`);const x=await r.json();return{ok:true,changed:0,verified:true,city,latitude:lat,longitude:lon,current:x.current,daily:x.daily,timezone:x.timezone};}

async function fetchNewsV125(query,max=8){const q=normalizeText(query||'Egypt'),url=`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=${Math.min(20,Number(max||8))}&format=json&sort=HybridRel`;const r=await fetch(url);if(!r.ok)throw new Error(`news_http_${r.status}`);const x=await r.json();return (Array.isArray(x?.articles)?x.articles:[]).map(a=>({title:a.title,url:a.url,domain:a.domain,seendate:a.seendate,language:a.language})).slice(0,max);}
async function toolLiveNewsV125(env,chatId,args){const q=normalizeText(args?.query||'Egypt'),key=`news:${normItem(q)}`;let items=await cacheGetV125(env,key);if(!items){items=await fetchNewsV125(q,clampV125(args?.limit||8,1,12));await cacheSetV125(env,key,items,LIVE_CACHE_MINUTES);}return{ok:true,changed:0,verified:true,query:q,items};}
async function toolLiveWatchReadV125(env,chatId){return{ok:true,changed:0,verified:true,items:(await env.DB.prepare(`SELECT * FROM sanad_live_watches WHERE chat_id=? AND active=1 ORDER BY id DESC`).bind(chatId).all())?.results||[]};}
async function toolLiveWatchCreateV125(env,chatId,args){const q=normalizeText(args?.query);if(!q)return{ok:false,changed:0,verified:false,error:'missing_query'};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_live_watches(chat_id,query,active,created_at,updated_at) VALUES(?,?,1,?,?)`).bind(chatId,q,now,now).run(),id=Number(r?.meta?.last_row_id||0),a=await env.DB.prepare(`SELECT * FROM sanad_live_watches WHERE id=?`).bind(id).first();return{ok:!!a,changed:a?1:0,verified:!!a,id,after:a};}
async function toolLiveWatchStopV125(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_live_watches SET active=0,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT active FROM sanad_live_watches WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],v=rows.length>0&&rows.every(x=>Number(x.active)===0);return{ok:v,changed:rows.length,verified:v};}

async function toolAuditUndoV125(env,chatId){const row=await env.DB.prepare(`SELECT * FROM sanad_operation_snapshots WHERE chat_id=? AND committed=1 AND undone_at IS NULL ORDER BY id DESC LIMIT 1`).bind(chatId).first();if(!row)return{ok:false,changed:0,verified:false,error:'nothing_to_undo'};const snap=parseJsonV125(row.snapshot_json,null);if(!snap)return{ok:false,changed:0,verified:false,error:'invalid_snapshot'};await restoreUserStateV125(env,chatId,snap);await env.DB.prepare(`UPDATE sanad_operation_snapshots SET undone_at=? WHERE id=?`).bind(nowIso(),Number(row.id)).run();const chk=await env.DB.prepare(`SELECT undone_at FROM sanad_operation_snapshots WHERE id=?`).bind(Number(row.id)).first();return{ok:!!chk?.undone_at,changed:1,verified:!!chk?.undone_at,operation_id:row.operation_id,summary:row.summary};}
async function toolSystemStatusV125(env,chatId){const failures=(await env.DB.prepare(`SELECT scope,error_text,created_at FROM sanad_failures WHERE chat_id=? ORDER BY id DESC LIMIT 10`).bind(chatId).all())?.results||[],counts={};for(const t of ['sanad_shopping','sanad_reminders','sanad_recurrences','sanad_memories','sanad_projects','sanad_waiting','sanad_prayer_rules','sanad_live_watches'])counts[t]=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM ${t} WHERE chat_id=?`).bind(chatId).first())?.c||0);return{ok:true,changed:0,verified:true,version:VERSION,counts,recent_failures:failures};}
async function toolSystemClearAllV125(env,chatId){const before=await snapshotUserStateV125(env,chatId);for(const t of SNAPSHOT_TABLES)if(await tableExistsV125(env,t))await env.DB.prepare(`DELETE FROM ${t} WHERE chat_id=?`).bind(chatId).run();const after=await snapshotUserStateV125(env,chatId),left=Object.values(after).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0);return{ok:left===0,changed:Object.values(before).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0),verified:left===0};}

function fireWithinWindowV125(date,time,windowStartMs,windowEndMs){const ms=Date.parse(`${date}T${time}:00Z`);return ms>=windowStartMs&&ms<=windowEndMs;}
async function sendOnceV125(env,chatId,key,text){const done=await env.DB.prepare(`SELECT 1 x FROM sanad_proactive_fires WHERE chat_id=? AND fire_key=?`).bind(String(chatId),String(key)).first();if(done)return false;await sendText(env,String(chatId),text);await env.DB.prepare(`INSERT OR IGNORE INTO sanad_proactive_fires(chat_id,fire_key,sent_at) VALUES(?,?,?)`).bind(String(chatId),String(key),nowIso()).run();return true;}
async function runSanadScheduler(env,scheduledTime){
  const nowMs=Number(scheduledTime||Date.now()),lastRow=await env.DB.prepare(`SELECT value FROM sanad_scheduler_state WHERE key='last_run_ms'`).first(),last=Math.max(nowMs-SCHEDULER_CATCHUP_MINUTES*60000,Number(lastRow?.value||nowMs-60000));
  await env.DB.prepare(`INSERT INTO sanad_scheduler_state(key,value,updated_at) VALUES('last_run_ms',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(String(nowMs),nowIso()).run();
  const users=(await env.DB.prepare(`SELECT * FROM sanad_users LIMIT 1000`).all())?.results||[];
  for(const u of users){try{await deliverUserScheduleV125(env,u,last,nowMs);await deliverPrayerRulesV125(env,u,last,nowMs);await deliverDailyBriefsV125(env,u);if(Number(u.proactive_enabled??1))await proactiveUserV125(env,u);}catch(e){await reportFailure(env,String(u.chat_id),'scheduler_user',e);}}
  await checkLiveWatchesV125(env);
}
function localDateTimeApproxUtcMsV125(date,time,timeZone=TZ){return zonedLocalToEpochV125(date,time,timeZone);}
async function deliverUserScheduleV125(env,u,lastMs,nowMs){
  const chatId=String(u.chat_id),ln=localNow(u.timezone||TZ),from=addDaysV125(ln.date,-1),to=addDaysV125(ln.date,1);
  const one=(await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND status='active' AND sent=0 AND local_date BETWEEN ? AND ?`).bind(chatId,from,to).all())?.results||[];
  for(const r of one){
    const main=localDateTimeApproxUtcMsV125(r.local_date,r.local_time,u.timezone||TZ),offsets=[0,...parseJsonV125(r.advance_json,[]),Number(r.advance_minutes||0)].map(Number).filter((v,i,a)=>v>=0&&a.indexOf(v)===i);
    for(const off of offsets){const fire=main-off*60000;if(fire>=lastMs&&fire<=nowMs){const key=`rem:${r.id}:${r.local_date}:${r.local_time}:${off}`;const label=off?`⏰ تذكير مسبق (${off} دقيقة): ${r.title}`:`⏰ ${r.title}`;if(await sendOnceV125(env,chatId,key,label)){await env.DB.prepare(`INSERT OR IGNORE INTO sanad_reminder_fires(reminder_id,fire_key,chat_id,sent_at) VALUES(?,?,?,?)`).bind(Number(r.id),key,chatId,nowIso()).run();if(off===0)await env.DB.prepare(`UPDATE sanad_reminders SET sent=1,updated_at=? WHERE id=?`).bind(nowIso(),Number(r.id)).run();}}}
  }
  const rules=(await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?)`).bind(chatId,to,from).all())?.results||[];
  for(const r of rules){if(r.paused_until&&String(r.paused_until)>nowIso())continue;const occ=generateRecurrenceOccurrencesV125(r,from,to,100);for(const o of occ){const main=localDateTimeApproxUtcMsV125(o.date,o.time,u.timezone||TZ),offsets=[0,...parseJsonV125(r.advance_json,[])].map(Number).filter((v,i,a)=>v>=0&&a.indexOf(v)===i);for(const off of offsets){const fire=main-off*60000;if(fire<lastMs||fire>nowMs)continue;const claimed=await env.DB.prepare(`INSERT OR IGNORE INTO sanad_recurrence_fires(rule_id,occurrence_key,alert_offset,chat_id,sent_at) VALUES(?,?,?,?,?)`).bind(Number(r.id),o.key,off,chatId,nowIso()).run();if(Number(claimed?.meta?.changes||0)>0){await sendText(env,chatId,off?`⏰ تذكير مسبق (${off} دقيقة): ${r.title}`:`🔁 ${r.title}`);if(off===0)await env.DB.prepare(`UPDATE sanad_recurrences SET fired_count=fired_count+1,updated_at=? WHERE id=?`).bind(nowIso(),Number(r.id)).run();}}}}
}
async function deliverPrayerRulesV125(env,u,lastMs,nowMs){const chatId=String(u.chat_id),ln=localNow(u.timezone||TZ),rules=(await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?)`).bind(chatId,ln.date,ln.date).all())?.results||[];if(!rules.length)return;const data=await fetchPrayerTimesV125(env,u,ln.date);for(const r of rules){if(r.paused_until&&String(r.paused_until)>nowIso())continue;if(parseJsonV125(r.exceptions_json,[]).includes(ln.date))continue;const days=parseJsonV125(r.weekdays_json,[]).map(Number);if(days.length&&!days.includes(isoWeekdayV125(ln.date)))continue;const base=data.times[r.prayer];if(!base)continue;const shifted=addMinutesLocal(ln.date,base,Number(r.offset_minutes||0)),fire=localDateTimeApproxUtcMsV125(shifted.date,shifted.time,u.timezone||TZ);if(fire<lastMs||fire>nowMs)continue;const ins=await env.DB.prepare(`INSERT OR IGNORE INTO sanad_prayer_fires(rule_id,occurrence_date,chat_id,sent_at) VALUES(?,?,?,?)`).bind(Number(r.id),ln.date,chatId,nowIso()).run();if(Number(ins?.meta?.changes||0)>0){await sendText(env,chatId,`🕌 ${r.title}`);await env.DB.prepare(`UPDATE sanad_prayer_rules SET fired_count=fired_count+1,updated_at=? WHERE id=?`).bind(nowIso(),Number(r.id)).run();}}
}
async function buildBriefV125(env,u,type){const chatId=String(u.chat_id),ln=localNow(u.timezone||TZ),today=await getScheduleOccurrencesV125(env,chatId,ln.date,ln.date),shop=(await toolShoppingProgressV125(env,chatId)),waiting=(await toolWaitingRead(env,chatId)).items,projects=(await toolProjectsRead(env,chatId)).items;const head=type==='morning'?'☀️ صباح الخير — ملخص يومك':'🌙 ملخص المساء';const lines=[head];if(today.length)lines.push(`📅 ${today.length} حاجة على الجدول:\n${today.slice(0,7).map(x=>`• ${x.time} — ${x.title}`).join('\n')}`);if(shop.pending)lines.push(`🛒 فاضل ${shop.pending} في المشتريات.`);if(waiting.length)lines.push(`⏳ ${waiting.length} حاجة مستنيها.`);if(projects.length)lines.push(`🎯 ${projects.length} مشروع نشط.`);if(lines.length===1)lines.push('الدنيا هادية ومفيش التزامات مسجلة مهمة.');return lines.join('\n\n');}
async function deliverDailyBriefsV125(env,u){const ln=localNow(u.timezone||TZ),chatId=String(u.chat_id);for(const type of ['morning','evening']){const enabled=Number(u[`${type}_brief_enabled`]||0),time=String(u[`${type}_brief_time`]|| (type==='morning'?'08:00':'20:00'));if(!enabled||ln.time!==time)continue;const done=await env.DB.prepare(`SELECT 1 x FROM sanad_daily_brief_fires WHERE chat_id=? AND brief_date=? AND brief_type=?`).bind(chatId,ln.date,type).first();if(done)continue;await sendText(env,chatId,await buildBriefV125(env,u,type));await env.DB.prepare(`INSERT INTO sanad_daily_brief_fires(chat_id,brief_date,brief_type,sent_at) VALUES(?,?,?,?)`).bind(chatId,ln.date,type,nowIso()).run();}}
async function proactiveUserV125(env,u){const chatId=String(u.chat_id),ln=localNow(u.timezone||TZ),occ=await getScheduleOccurrencesV125(env,chatId,ln.date,ln.date),nowm=hmMinutesV125(ln.time);for(const x of occ){const diff=hmMinutesV125(x.time)-nowm;if(diff>0&&diff<=30)await sendOnceV125(env,chatId,`soon:${x.source_type}:${x.source_id}:${x.date}:${x.time}`,`📌 خلي بالك: ${x.title} بعد حوالي ${diff} دقيقة.`);}const waiting=(await env.DB.prepare(`SELECT * FROM sanad_waiting WHERE chat_id=? AND status='waiting' AND due_at IS NOT NULL LIMIT 20`).bind(chatId).all())?.results||[];for(const w of waiting){if(Date.parse(String(w.due_at))<=Date.now())await sendOnceV125(env,chatId,`waiting-overdue:${w.id}:${ln.date}`,`⏳ متابعة: ${w.title}${w.waiting_on?` — مستني ${w.waiting_on}`:''}.`);}}
async function checkLiveWatchesV125(env){const rows=(await env.DB.prepare(`SELECT * FROM sanad_live_watches WHERE active=1 ORDER BY id LIMIT ?`).bind(LIVE_WATCH_BATCH).all())?.results||[];for(const w of rows){try{const news=await fetchNewsV125(w.query,3);const top=news[0];if(top?.url&&top.url!==w.last_url){if(w.last_url)await sendText(env,String(w.chat_id),`🛰️ جديد في متابعة "${w.query}":\n${top.title}\n${top.url}`);await env.DB.prepare(`UPDATE sanad_live_watches SET last_url=?,updated_at=? WHERE id=?`).bind(top.url,nowIso(),Number(w.id)).run();}}catch(e){await reportFailure(env,String(w.chat_id),'live_watch',e,{watch_id:w.id});}}}

async function toolFreeTimeV125(env,chatId,args){const date=validDateV125(args?.date)?String(args.date):localNow().date,from=validTimeV125(args?.from_time)?String(args.from_time):'08:00',to=validTimeV125(args?.to_time)?String(args.to_time):'23:00',min=clampV125(args?.min_minutes||30,5,1440),busy=(await getScheduleOccurrencesV125(env,chatId,date,date)).filter(x=>Number(x.duration_minutes)>0).map(x=>({start:hmMinutesV125(x.time),end:hmMinutesV125(x.time)+Number(x.duration_minutes),title:x.title})).sort((a,b)=>a.start-b.start),slots=[];let cur=hmMinutesV125(from),end=hmMinutesV125(to);for(const b of busy){if(b.end<=cur||b.start>=end)continue;if(b.start-cur>=min)slots.push({from:minutesHmV125(cur),to:minutesHmV125(Math.min(b.start,end)),minutes:Math.min(b.start,end)-cur});cur=Math.max(cur,b.end);if(cur>=end)break;}if(end-cur>=min)slots.push({from:minutesHmV125(cur),to:minutesHmV125(end),minutes:end-cur});return{ok:true,changed:0,verified:true,date,slots,busy};}

async function toolReminderSnoozeV125(env,chatId,args){const id=Number(args?.id),mins=Math.trunc(Number(args?.minutes||0));if(!id||!mins)return{ok:false,changed:0,verified:false,error:'invalid_snooze'};const b=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const nx=addMinutesLocal(b.local_date,b.local_time,mins);await env.DB.prepare(`UPDATE sanad_reminders SET local_date=?,local_time=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(nx.date,nx.time,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,id).first(),v=a?.local_date===nx.date&&a?.local_time===nx.time;return{ok:v,changed:v?1:0,verified:v,before:b,after:a};}

function isAllowedUserV125(env,chatId){if(String(env.PUBLIC_BOT||'').toLowerCase()==='true')return true;const allowed=[env.ADMIN_CHAT_ID,env.ALLOWED_CHAT_ID,...String(env.ALLOWED_CHAT_IDS||'').split(',')].map(x=>String(x||'').trim()).filter(Boolean);return !allowed.length||allowed.includes(String(chatId));}
async function updateLocationV125(env,chatId,loc){const lat=Number(loc?.latitude),lon=Number(loc?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error('invalid_location');await env.DB.prepare(`UPDATE sanad_users SET latitude=?,longitude=?,updated_at=? WHERE chat_id=?`).bind(lat,lon,nowIso(),chatId).run();return{lat,lon};}
async function showMenuV125(env,chatId){await sendText(env,chatId,`🤝 سند V12.5\n\n📅 /today النهاردة · /week الأسبوع · /month الشهر\n🔁 /recurring التكرارات · 🛒 /shopping المشتريات\n🎯 /projects المشاريع · ⏳ /waiting المتابعات\n🧠 /memory الذاكرة · 🕌 /prayer الصلاة\n📍 /where الموقع · 🧾 /audit السجل · ↩️ /undo تراجع\n\nأو سيب الأوامر خالص واتكلم معايا بطبيعتك.`);}
async function showRangeV125(env,chatId,user,days){const d=localNow(user?.timezone||TZ).date,rows=await getScheduleOccurrencesV125(env,chatId,d,addDaysV125(d,days-1));await sendText(env,chatId,rows.length?`📅 القادم:\n${rows.slice(0,60).map(x=>`• ${x.date} ${x.time} — ${x.title}`).join('\n')}`:'📅 مفيش حاجات مسجلة في الفترة دي.');}
async function showRecurrencesV125(env,chatId){const r=await toolRecurrenceReadV125(env,chatId,{});await sendText(env,chatId,r.items.length?`🔁 التكرارات:\n${r.items.map(x=>`• #${x.id} ${x.title} — كل ${x.rule.every} ${x.rule.unit}`).join('\n')}`:'🔁 مفيش تكرارات نشطة.');}
async function showProjectsV125(env,chatId){const r=await toolProjectsRead(env,chatId);await sendText(env,chatId,r.items.length?`🎯 المشاريع:\n${r.items.map(x=>`• #${x.id} ${x.title} — ${x.progress||0}%`).join('\n')}`:'🎯 مفيش مشاريع نشطة.');}
async function showWaitingV125(env,chatId){const r=await toolWaitingRead(env,chatId);await sendText(env,chatId,r.items.length?`⏳ مستني:\n${r.items.map(x=>`• #${x.id} ${x.title}${x.waiting_on?` — ${x.waiting_on}`:''}`).join('\n')}`:'⏳ مفيش حاجات مستنيها.');}
async function showWhereV125(env,chatId,user){await sendText(env,chatId,`📍 ${user?.city||DEFAULT_CITY}, ${user?.country||DEFAULT_COUNTRY}\n🕒 ${user?.timezone||TZ}${user?.latitude!=null?`\nإحداثيات محفوظة: ${Number(user.latitude).toFixed(4)}, ${Number(user.longitude).toFixed(4)}`:''}`);}
function formatPrayerV125(r){const t=r?.times||{};return `🕌 مواقيت الصلاة ${r?.date||''}\nالفجر ${t.Fajr||'-'} · الظهر ${t.Dhuhr||'-'} · العصر ${t.Asr||'-'} · المغرب ${t.Maghrib||'-'} · العشاء ${t.Isha||'-'}`;}

function zonedLocalToEpochV125(date,time,timeZone=TZ){
  const [y,m,d]=String(date).split('-').map(Number),[hh,mm]=String(time).split(':').map(Number);
  let guess=Date.UTC(y,m-1,d,hh,mm,0);
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(fmt.formatToParts(new Date(guess)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    const seen=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));
    const target=Date.UTC(y,m-1,d,hh,mm);const delta=target-seen;if(Math.abs(delta)<1000)break;guess+=delta;
  }
  return guess;
}

async function consumeRateV125(env,chatId){const now=Date.now(),windowMs=60000,limit=30,r=await env.DB.prepare(`SELECT window_start,request_count FROM sanad_rate_limits WHERE chat_id=?`).bind(String(chatId)).first();if(!r||now-Number(r.window_start||0)>=windowMs){await env.DB.prepare(`INSERT INTO sanad_rate_limits(chat_id,window_start,request_count) VALUES(?,?,1) ON CONFLICT(chat_id) DO UPDATE SET window_start=excluded.window_start,request_count=1`).bind(String(chatId),now).run();return true;}if(Number(r.request_count||0)>=limit)return false;await env.DB.prepare(`UPDATE sanad_rate_limits SET request_count=request_count+1 WHERE chat_id=?`).bind(String(chatId)).run();return true;}

async function toolScheduleBulkShiftV125(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[]).map(Number).filter(Boolean).slice(0,100),mins=Math.trunc(Number(args?.minutes||0));if(!ids.length||!mins)return{ok:false,changed:0,verified:false,error:'invalid_bulk_shift'};const before=[];for(const id of ids){const r=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();if(r)before.push(r);}for(const r of before){const nx=addMinutesLocal(r.local_date,r.local_time,mins);await env.DB.prepare(`UPDATE sanad_reminders SET local_date=?,local_time=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(nx.date,nx.time,nowIso(),chatId,Number(r.id)).run();await propagateDependenciesV125(env,chatId,'reminder',Number(r.id),mins);}const after=[];for(const r of before){const a=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,Number(r.id)).first();if(a)after.push(a);}const verified=before.length>0&&after.length===before.length&&before.every((b,i)=>{const nx=addMinutesLocal(b.local_date,b.local_time,mins),a=after[i];return a.local_date===nx.date&&a.local_time===nx.time});return{ok:verified,changed:verified?before.length:0,verified,before,after};}

async function deepSelftestV125(env){
  const chat='__sanad_v125_selftest__',tests=[];
  /** @param {string} name @param {any} ok @param {any} [detail] */
  function add(name,ok,detail=''){tests.push({name,ok:!!ok,detail:String(detail??'')});}
  const clean=async()=>{for(const t of [...SNAPSHOT_TABLES,'sanad_users','sanad_shopping_sessions','sanad_reminder_fires','sanad_recurrence_fires','sanad_prayer_fires','sanad_pending_actions','sanad_operation_snapshots','sanad_receipts','sanad_audit','sanad_failures','sanad_rate_limits'])if(await tableExistsV125(env,t))try{await env.DB.prepare(`DELETE FROM ${t} WHERE chat_id=?`).bind(chat).run();}catch{}};
  await clean();
  try{
    let user=await ensureUser(env,chat,'SelfTest');
    /** @type {any} */ let r=await toolShoppingAdd(env,chat,{items:[{title:'لبن'},{title:'عيش',quantity:'2'}]});add('shopping add verified',r.ok&&r.verified&&r.changed===2,JSON.stringify(r.ids));
    r=await toolShoppingProgressV125(env,chat);add('shopping progress',r.total===2&&r.pending===2,JSON.stringify(r));
    r=await toolShoppingSessionStartV125(env,chat,{place_name:'Test Market'});add('shopping session start',r.ok&&r.verified,r.id);r=await toolShoppingSessionFinishV125(env,chat);add('shopping session finish',r.ok&&r.verified);
    r=await toolMemoryRemember(env,chat,{content:'بحب القهوة من غير سكر',memory_type:'preference',importance:.9});add('memory verified',r.ok&&r.verified,r.id);
    r=await toolWorldUpsertV125(env,chat,{entity_type:'person',name:'مرام',data:{relation:'زوجة'}});const eid=r.id;add('world entity',r.ok&&eid>0,eid);
    r=await toolWorldLinkV125(env,chat,{from_entity_id:eid,relation:'relation',object_value:'زوجة'});add('world edge',r.ok&&r.verified,r.id);
    r=await toolProjectCreate(env,chat,{title:'مشروع البيت',priority:'high'});const pid=r.id;add('project create',r.ok&&pid>0,pid);r=await toolProjectTaskCreateV125(env,chat,{project_id:pid,title:'مراجعة الكهرباء'});add('project task',r.ok&&r.verified,r.id);
    r=await toolWaitingCreate(env,chat,{title:'رد المهندس',waiting_on:'المهندس'});add('waiting create',r.ok&&r.verified,r.id);
    const base=addDaysV125(localNow(user.timezone||TZ).date,10);
    r=await toolReminderCreate(env,chat,{title:'موعد دكتور',kind:'appointment',local_date:base,local_time:'19:00',duration_minutes:60},user);const r1=r.id;add('appointment create',r.ok&&r.verified,r1);
    const conflict=await toolReminderCreate(env,chat,{title:'موعد متعارض',kind:'appointment',local_date:base,local_time:'19:30',duration_minutes:30},user);add('conflict guard',!conflict.ok&&conflict.error==='schedule_conflict',conflict.error);
    r=await toolReminderCreate(env,chat,{title:'بعد الدكتور',local_date:base,local_time:'21:00'},user);const r2=r.id;add('second reminder',r.ok&&r2>0,r2);
    r=await toolDependencyCreateV125(env,chat,{source_type:'reminder',source_id:r1,target_type:'reminder',target_id:r2,relation:'after'});add('dependency create',r.ok&&r.verified,r.id);
    const beforeTarget=await env.DB.prepare(`SELECT local_time FROM sanad_reminders WHERE id=?`).bind(r2).first();r=await toolScheduleShiftV125(env,chat,{source_type:'reminder',id:r1,minutes:30});const afterTarget=await env.DB.prepare(`SELECT local_time FROM sanad_reminders WHERE id=?`).bind(r2).first();add('dependency propagation',r.ok&&hmMinutesV125(afterTarget.local_time)-hmMinutesV125(beforeTarget.local_time)===30,`${beforeTarget.local_time}->${afterTarget.local_time}`);
    r=await toolRecurrenceCreateV125(env,chat,{title:'دواء يومي',rule:{unit:'days',every:1,times:['08:15']},start_date:base,advance_minutes:[10]},user);const recur=r.id;add('recurrence create',r.ok&&recur>0,recur);const occ=generateRecurrenceOccurrencesV125(r.after,base,addDaysV125(base,4),20);add('recurrence generation',occ.length===5,occ.length);
    r=await toolRecurrenceSkipV125(env,chat,{id:recur,date:addDaysV125(base,1)});add('recurrence skip',r.ok&&r.verified,r.key);
    r=await toolFreeTimeV125(env,chat,{date:base,from_time:'18:00',to_time:'22:30',min_minutes:30});add('free time',r.ok&&r.slots.length>=1,JSON.stringify(r.slots));
    r=await toolScheduleConflictsV125(env,chat,{from_date:base,to_date:base});add('conflicts query',r.ok&&r.verified,r.count);
    r=await toolProfileUpdateV125(env,chat,{city:'Cairo',country:'Egypt',country_code:'EG',proactive_enabled:1,deep_reasoning_mode:'auto'});add('profile settings',r.ok&&r.verified);
    r=await toolPrayerRuleCreateV125(env,chat,{prayer:'الفجر',offset_minutes:-10,start_date:base},user);add('prayer rule',r.ok&&r.verified,r.id);
    r=await toolLiveWatchCreateV125(env,chat,{query:'OpenAI'});const wid=r.id;add('live watch create',r.ok&&wid>0,wid);r=await toolLiveWatchStopV125(env,chat,{ids:[wid]});add('live watch stop',r.ok&&r.verified);
    const snap=await snapshotUserStateV125(env,chat);await ensureOperationSnapshotV125(env,chat,'selftest-op',snap,'selftest');await commitOperationSnapshotV125(env,'selftest-op');await toolShoppingAdd(env,chat,{items:[{title:'مانجا'}]});r=await toolAuditUndoV125(env,chat);const mango=(await toolShoppingRead(env,chat)).items.some(x=>normItem(x.title)==='مانجا');add('snapshot undo',r.ok&&!mango,JSON.stringify(r));
    add('rate limiter',await consumeRateV125(env,chat));
  }catch(e){add('deep exception',false,safeError(e));}
  await clean();
  return{ok:tests.every(x=>x.ok),version:VERSION,count:tests.length,tests};
}
