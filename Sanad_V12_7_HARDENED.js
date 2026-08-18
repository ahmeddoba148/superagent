/* Sanad V12.7 — Full-Life single-brain personal operating agent for Cloudflare Workers + D1 + Telegram.
   Design: Understand -> Plan -> Act -> Observe -> Verify -> Repair -> Reply.
   No success claim is emitted for mutations unless state verification succeeds.
*/

const VERSION = "12.7.0";
const NAME = "سند — Sanad V12.7 Correctness Hardened";
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
    if (request.method === "GET" && url.pathname === "/diagnostics") return diagnosticsV126(request, env);
    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/setup") return setup(request, env);
    if (request.method === "GET" && url.pathname === "/selftest") { if (url.searchParams.get("v127") === "1") { if(!env.SETUP_KEY||!secureEq(adminKey(request),env.SETUP_KEY))return j({ok:false,error:"Unauthorized"},401); await ensureSchema(env); return j(await deepSelftestV127(env)); } return selftest(request, env); }
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

async function ensureSchemaV125Base(env, force = false) {
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
async function drainInboxV126BeforeHardening(env, chatId, origin = "") {
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
async function recoverPendingInboxV126BeforeHardening(env) {
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
    if (text === "/tomorrow") return showTomorrowV126(env,chatId,user);
    if (text === "/list") return showAllScheduleV126(env,chatId,user);
    if (text === "/week") return showRangeV125(env,chatId,user,7);
    if (text === "/month") return showRangeV125(env,chatId,user,31);
    if (text === "/recurring") return showRecurrencesV125(env,chatId);
    if (text === "/projects") return showProjectsV125(env,chatId);
    if (text === "/waiting") return showWaitingV125(env,chatId);
    if (text === "/inbox") return showLifeInboxV126(env,chatId);
    if (text === "/settings") return showSettingsV126(env,chatId);
    if (text === "/clear" || text === "/data") return showDataPanelV126(env,chatId);
    if (text === "/where") return showWhereV125(env,chatId,user);
    if (text === "/memory") return showMemory(env,chatId);
    if (text === "/audit") return showAudit(env,chatId);
    if (text === "/undo") {const r=await toolAuditUndoV125(env,chatId);return sendText(env,chatId,r.ok?"↩️ رجعت آخر عملية قابلة للتراجع بنجاح.":"مفيش عملية قابلة للتراجع حاليًا.");}
    if (text === "/prayer") return showPrayerPanelV126(env,chatId,user);
    if (text === "/live") return showLiveRealityV126(env,chatId,user);
    if (text === "/status") {const r=await toolSystemStatusV125(env,chatId);return sendText(env,chatId,`🤝 سند ${VERSION} شغال. مواعيد: ${r.counts.sanad_reminders} · تكرارات: ${r.counts.sanad_recurrences} · مشتريات: ${r.counts.sanad_shopping} · ذاكرة: ${r.counts.sanad_memories}`);}

    const fastReply=fastCasualReplyV126(text);if(fastReply){await saveMsg(env,chatId,"user",text,{fast_path:true});await sendText(env,chatId,fastReply);await saveMsg(env,chatId,"assistant",fastReply,{fast_path:true});return;}
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

async function buildContextV125Base(env, chatId, user, userText) {
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
  return `أنت "سند" Sanad V12.7، مدير حياة شخصي Agent متعدد الأدوات. تتصرف كطقم سكرتارية واحد بعقل موحد.
هدفك فهم المقصد الحقيقي من الكلام الطبيعي المصري، لا انتظار كلمات سحرية.
أنت لا تدّعي تنفيذ شيء. أي تغيير لازم يتم من خلال tool ثم verification حقيقي.
خطتك قد تحتوي عدة أدوات بالترتيب. لا تطلب توضيحًا إلا لو لا يمكن اتخاذ قرار آمن ومعقول.
إذا كانت خطوة لاحقة تحتاج ID أو قيمة من نتيجة خطوة سابقة، استخدم مرجعًا نصيًا بالشكل "$step:N.id" حيث N رقم الخطوة السابقة. مثال: إنشاء مشروع ثم مهمة داخله = projects.create ثم project_tasks.create مع project_id="$step:1.id".
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


function digitsAsciiV125(value) {
  const ar="٠١٢٣٤٥٦٧٨٩",fa="۰۱۲۳۴۵۶۷۸۹";
  return String(value||"").replace(/[٠-٩]/g,c=>String(ar.indexOf(c))).replace(/[۰-۹]/g,c=>String(fa.indexOf(c)));
}
function clockValueV125(hourRaw,minuteRaw,modifier,daypart){
  let h=Number(hourRaw),m=minuteRaw==null||minuteRaw===""?0:Number(minuteRaw);
  const mod=normalizeText(modifier||"").replace(/\s+/g,"");
  if(/نص|نصف/.test(mod))m=30;
  else if(/وربع|والربع/.test(mod))m=15;
  else if(/إلاربع|الاربع/.test(mod)){h-=1;m=45;if(h<0)h=23;}
  if(!Number.isInteger(h)||!Number.isInteger(m)||h<0||h>23||m<0||m>59)return null;
  const p=normalizeText(daypart||"").toLowerCase();
  const pm=/(?:^م$|مساء|المساء|بالليل|ليل|الظهر|ظهر|العصر)/.test(p),am=/(?:^ص$|صباح|الصبح|الصباح|الفجر)/.test(p);
  if(pm&&h<12)h+=12;
  if(am&&h===12)h=0;
  if(h>23)return null;
  return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
}
function extractExplicitTimesV125(text){
  const t=digitsAsciiV125(normalizeText(text));
  const found=[];
  const add=(h,m,mod,part)=>{const v=clockValueV125(h,m,mod,part);if(v&&!found.includes(v))found.push(v);};
  const daypartPattern='ص|م|صباحا|صباحًا|الصبح|الصباح|مساء|مساءً|المساء|بالليل|ليلا|ليلًا|الظهر|ظهرا|ظهرًا|العصر';
  const cue=/(?:الساعة|الساعه|ساعة|ساعه)\s*(\d{1,2})(?:\s*[:：٫.]\s*(\d{1,2}))?(?:\s*(ونص|ونصف|والنصف|وربع|والربع|إلا\s*ربع|الا\s*ربع))?/g;
  for(const m of t.matchAll(cue)){
    const end=(m.index||0)+m[0].length,after=t.slice(end,end+32),part=(after.match(new RegExp('^\\s*('+daypartPattern+')(?=$|[^\\p{L}\\d])','u'))||[])[1]||'';
    add(m[1],m[2],m[3],part);
  }
  const part=/(?:^|[^\d])(\d{1,2})(?:\s*[:：٫.]\s*(\d{1,2}))?\s*(ص|م|صباحا|صباحًا|الصبح|الصباح|مساء|مساءً|المساء|بالليل|ليلا|ليلًا|الظهر|ظهرا|ظهرًا|العصر)(?=$|[^\p{L}\d])/gu;
  for(const m of t.matchAll(part))add(m[1],m[2],"",m[3]);
  const clock24=/(?:^|[^\d])([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?!\d)/g;
  for(const m of t.matchAll(clock24)){
    const end=(m.index||0)+m[0].length,after=t.slice(end,end+32);
    if(new RegExp('^\\s*('+daypartPattern+')(?=$|[^\\p{L}\\d])','u').test(after))continue;
    add(m[1],m[2],"","");
  }
  return found;
}
function explicitDateV125(text){
  const t=digitsAsciiV125(normalizeText(text)).toLowerCase();
  const months={"يناير":1,"فبراير":2,"مارس":3,"أبريل":4,"ابريل":4,"مايو":5,"يونيو":6,"يوليو":7,"أغسطس":8,"اغسطس":8,"سبتمبر":9,"أكتوبر":10,"اكتوبر":10,"نوفمبر":11,"ديسمبر":12};
  let m=t.match(/(?:يوم\s+)?([0-3]?\d)\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+(\d{4})/);
  let d,mo,y;
  if(m){d=Number(m[1]);mo=months[m[2]];y=Number(m[3]);}
  else{m=t.match(/(?:يوم\s+)?([0-3]?\d)[\/-]([01]?\d)[\/-](\d{4})/);if(!m)return null;d=Number(m[1]);mo=Number(m[2]);y=Number(m[3]);}
  const probe=new Date(Date.UTC(y,mo-1,d));
  if(probe.getUTCFullYear()!==y||probe.getUTCMonth()!==mo-1||probe.getUTCDate()!==d)return null;
  return String(y).padStart(4,"0")+"-"+String(mo).padStart(2,"0")+"-"+String(d).padStart(2,"0");
}
function groundExplicitTemporalFactsV125(text,steps){
  const times=extractExplicitTimesV125(text),date=explicitDateV125(text);
  return (Array.isArray(steps)?steps:[]).map(step=>{
    const tool=String(step?.tool||""),raw=step?.args&&typeof step.args==="object"&&!Array.isArray(step.args)?step.args:{},args={...raw};
    if(tool==="recurrence.create"){
      if(times.length){const rule=args.rule&&typeof args.rule==="object"&&!Array.isArray(args.rule)?{...args.rule}:{};rule.times=[...times];args.rule=rule;}
      if(date)args.start_date=date;
    }
    if(tool==="reminders.create"){
      if(times.length===1)args.local_time=times[0];
      if(date)args.local_date=date;
    }
    return {...step,args};
  });
}
function explicitProjectTaskHintV125(text){
  const t=normalizeText(text);
  if(!/(?:مهمة|مهمه)/u.test(t))return null;
  let m=t.match(/(?:مهمة|مهمه)\s*(?:اسمها|اسمها\s*:|بعنوان|عنوانها)?\s*([^،,.؛]+?)(?=$|\s+(?:وبعد|وبعدين|وكمان|وخلي|وحط|وضيف|وحدد|واعتمد)\b)/u);
  if(!m)m=t.match(/(?:مهمة|مهمه)\s*(?:اسمها|بعنوان|عنوانها)?\s*(.+)$/u);
  const title=normalizeText(m?.[1]||"").replace(/^(?:اسمها|بعنوان)\s+/u,"").trim();
  return title&&title.length<=180?title:null;
}


function explicitMinuteCountV125(text){
  const t=digitsAsciiV125(normalizeText(text)).toLowerCase();
  const m=t.match(/(?:ب)?(\d{1,3}|خمس|خمسه|خمسة|عشر|عشرة|عشره|ربع|خمستاشر|خمسة عشر|خمس عشرة|عشرين|عشرون|تلت|ثلث|نص|نصف|تلاتين|ثلاثين|اربعين|أربعين|خمسه واربعين|خمسة واربعين|خمسة وأربعين)\s*(?:دقيقه|دقيقة|دقايق|دقائق|د)?/u);
  if(!m)return null;
  if(/^\d+$/.test(m[1]))return Math.min(180,Math.max(0,Number(m[1])));
  const w=normalizeText(m[1]).replace(/أ/g,'ا');
  const map={خمس:5,خمسه:5,خمسة:5,عشر:10,عشرة:10,عشره:10,ربع:15,خمستاشر:15,'خمسة عشر':15,'خمس عشرة':15,عشرين:20,عشرون:20,تلت:20,ثلث:20,نص:30,نصف:30,تلاتين:30,ثلاثين:30,اربعين:40,'خمسه واربعين':45,'خمسة واربعين':45,'خمسة وأربعين':45};
  return Number(map[w]??map[m[1]]??0)||null;
}
function explicitPrayerRuleHintV125(text){
  const t=normalizeText(text).toLowerCase();
  const prayers=[
    {name:'Fajr',re:/(?:الفجر|\bفجر\b)/u},
    {name:'Dhuhr',re:/(?:الظهر|\bظهر\b)/u},
    {name:'Asr',re:/(?:العصر|\bعصر\b)/u},
    {name:'Maghrib',re:/(?:المغرب|\bمغرب\b)/u},
    {name:'Isha',re:/(?:العشاء|\bعشاء\b)/u}
  ];
  const hit=prayers.find(x=>x.re.test(t));
  if(!hit)return null;
  const minutes=explicitMinuteCountV125(t);
  let offset=0;
  if(/قبل/u.test(t))offset=-(minutes??0);else if(/بعد/u.test(t))offset=minutes??0;
  return {prayer:hit.name,offset_minutes:offset};
}
function explicitBriefHintV125(text){
  const t=normalizeText(text).toLowerCase(),times=extractExplicitTimesV125(t),time=times[0]||null;
  if(/(?:ملخص|الملخص).*(?:الصباحي|الصباح)|(?:الصباحي|الصباح).*(?:ملخص|الملخص)/u.test(t))return {morning_brief_enabled:1,...(time?{morning_brief_time:time}:{})};
  if(/(?:ملخص|الملخص).*(?:المسائي|المساء)|(?:المسائي|المساء).*(?:ملخص|الملخص)/u.test(t))return {evening_brief_enabled:1,...(time?{evening_brief_time:time}:{})};
  return null;
}
function groundExplicitLifeFactsV125(text,steps){
  const prayer=explicitPrayerRuleHintV125(text),brief=explicitBriefHintV125(text),task=explicitProjectTaskHintV125(text);
  const out=(Array.isArray(steps)?steps:[]).map(s=>({...(s||{}),args:s?.args&&typeof s.args==='object'&&!Array.isArray(s.args)?{...s.args}:{}}));
  if(prayer){
    const i=out.findIndex(s=>String(s?.tool||'')==='prayer.rules.create');
    if(i>=0)out[i]={...out[i],args:{...out[i].args,...prayer}};
  }
  if(brief){
    const i=out.findIndex(s=>String(s?.tool||'')==='settings.update');
    if(i>=0)out[i]={...out[i],args:{...out[i].args,...brief}};
  }
  if(task){
    const pi=out.findIndex(s=>String(s?.tool||'')==='projects.create');
    const ti=out.findIndex(s=>String(s?.tool||'')==='project_tasks.create');
    if(pi>=0&&ti>=0&&!out[ti]?.args?.project_id)out[ti]={...out[ti],args:{...out[ti].args,project_id:'$step:'+(pi+1)+'.id'}};
  }
  return out;
}
function augmentExplicitLifeStepsV125Base(text,steps){
  let out=groundExplicitLifeFactsV125(text,steps);
  const prayer=explicitPrayerRuleHintV125(text),brief=explicitBriefHintV125(text),task=explicitProjectTaskHintV125(text);
  if(prayer&&!out.some(s=>String(s?.tool||'')==='prayer.rules.create'))out.push({tool:'prayer.rules.create',args:prayer});
  if(brief&&!out.some(s=>String(s?.tool||'')==='settings.update'))out.push({tool:'settings.update',args:brief});
  if(task){
    const pi=out.findIndex(s=>String(s?.tool||'')==='projects.create');
    if(pi>=0&&!out.some(s=>String(s?.tool||'')==='project_tasks.create'))out.push({tool:'project_tasks.create',args:{project_id:'$step:'+(pi+1)+'.id',title:task}});
  }
  return out.slice(0,MAX_AGENT_STEPS);
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
  steps=augmentExplicitLifeStepsV125(text,steps);
  if(!steps.length)return normalizeText(plan?.reply||"أنا معاك.");
  const complex=steps.length>=DEEP_PLAN_STEP_THRESHOLD||steps.some(s=>TOOL_SPECS[String(s?.tool||"")]?.risky)||String(user?.deep_reasoning_mode||"auto")==="on";
  if(complex&&!forcedSteps&&Date.now()<deadline-2500){
    try{const critic=await callBrainJson(env,`أنت مراجع خطط سند V12.7. راجع الخطة التالية مقابل طلب المستخدم والحالة. أصلح فقط الأخطاء: الأدوات الناقصة، IDs الخاطئة، الترتيب، أو خطوة قد تسبب false-success. لو خطوة تعتمد على نتيجة خطوة قبلها استخدم $step:N.field مثل $step:1.id، وتأكد أن كل جزء صريح من طلب المستخدم له خطوة تنفيذ فعلية. لا تضف خطوات بلا داع. أرجع JSON فقط {"steps":[...]}.\nطلب: ${text}\nالخطة: ${JSON.stringify(steps)}\nالحالة: ${JSON.stringify(context.state).slice(0,14000)}\nالأدوات: ${JSON.stringify(TOOL_SPECS)}`,text,deadline);if(Array.isArray(critic?.steps)&&critic.steps.length)steps=critic.steps.slice(0,MAX_AGENT_STEPS);}catch(e){await reportFailure(env,chatId,"critic",e,{operationId,text:normalizeText(text).slice(0,300)});}
  }
  steps=groundExplicitLifeFactsV125(text,groundExplicitTemporalFactsV125(text,steps));
  const risky=steps.filter(s=>TOOL_SPECS[String(s?.tool||"")]?.risky);
  if(risky.length&&!forcedSteps&&!looksExplicitlyConfirmed(text)){
    await savePendingActionV125(env,chatId,text,steps);
    return `الطلب ده فيه عملية حساسة (${risky.map(x=>x.tool).join("، ")}). أكدلي بـ «أيوه» وأنا أنفذ الخطة كلها كعملية واحدة قابلة للتراجع.`;
  }
  const hasMutation=steps.some(s=>TOOL_SPECS[String(s?.tool||"")]?.mutation);let before=null;
  if(hasMutation){const fresh=await snapshotUserStateV125(env,chatId,steps);before=await ensureOperationSnapshotV125(env,chatId,operationId,fresh,normalizeText(plan?.goal||text).slice(0,500));}
  const observations=[];
  const stepResults=[];
  for(let i=0;i<steps.length;i++){
    const s=steps[i],tool=String(s?.tool||"");
    if(!TOOL_SPECS[tool]){observations.push({step:i+1,tool,ok:false,error:"unknown_tool"});continue;}
    const args=resolveStepRefsV125(s?.args||{},stepResults);
    const result=await executeTool(env,{chatId,operationId,stepKey:`${i+1}:${tool}`,tool,args,user});
    const obs={step:i+1,tool,...result};observations.push(obs);stepResults.push(result);
  }
  if(hasMutation){
    const successfulProject=observations.slice().reverse().find(x=>x?.tool==="projects.create"&&x?.ok&&Number(x?.id)>0);
    const hasProjectTask=observations.some(x=>x?.tool==="project_tasks.create"&&x?.ok);
    const explicitTask=explicitProjectTaskHintV125(text);
    if(successfulProject&&!hasProjectTask&&explicitTask){
      const tool="project_tasks.create",args={project_id:Number(successfulProject.id),title:explicitTask};
      const result=await executeTool(env,{chatId,operationId,stepKey:"coverage:project_task",tool,args,user});
      observations.push({step:observations.length+1,tool,coverage:true,args,...result});stepResults.push(result);
    }
    if(Date.now()<deadline-2600){
      try{
        const completionPrompt=["أنت Goal Completion Gate لسند V12.7. اكتشف فقط أي جزء صريح من طلب المستخدم لم يتم تنفيذه بعد.","لا تعيد أي خطوة نجحت ولا تضف تحسينات من عندك. لو مكتمل أرجع JSON {\"complete\":true,\"steps\":[]} ولو ناقص أرجع الأدوات الناقصة فقط.","استخدم $step:N.field لو خطوة تعتمد على نتيجة خطوة سابقة، وراجع الطلبات متعددة المجالات والعلاقات.","طلب المستخدم: "+text,"الخطة الأصلية: "+JSON.stringify(steps).slice(0,12000),"النتائج المنفذة: "+JSON.stringify(observations).slice(0,18000),"الأدوات: "+JSON.stringify(TOOL_SPECS)].join("\n");
        const completion=await callBrainJson(env,completionPrompt,text,deadline);
        const missing=groundExplicitLifeFactsV125(text,groundExplicitTemporalFactsV125(text,Array.isArray(completion?.steps)?completion.steps.slice(0,MAX_REPAIR_STEPS):[]));
        for(const [j,s] of missing.entries()){
          const tool=String(s?.tool||"");if(!TOOL_SPECS[tool]||TOOL_SPECS[tool].risky&&!forcedSteps&&!looksExplicitlyConfirmed(text))continue;
          let args=resolveStepRefsV125(s?.args||{},stepResults);
          if(tool==="project_tasks.create"&&!Number(args?.project_id)){const p=observations.slice().reverse().find(x=>x?.tool==="projects.create"&&x?.ok&&Number(x?.id)>0);if(p)args={...args,project_id:Number(p.id)};}
          const result=await executeTool(env,{chatId,operationId,stepKey:"completion:"+(j+1)+":"+tool,tool,args,user});
          observations.push({step:observations.length+1,tool,completion:true,args,...result});stepResults.push(result);
        }
      }catch(e){const unsafe=observations.some(x=>TOOL_SPECS[x.tool]?.mutation&&(!x.ok||x.verified!==true));if(unsafe)await reportFailure(env,chatId,"goal_completion",e,{operationId,text:normalizeText(text).slice(0,300)});}
    }
  }
  let failed=observations.filter(x=>!x.ok);
  if(failed.length&&Date.now()<deadline-1800){
    try{
      const repair=await callBrainJson(env,`أنت سند في Repair Loop. لا تعيد أي خطوة نجحت. أصلح الفشل باستخدام الأدوات فقط، واستعمل IDs من النتائج. أرجع JSON فقط {"steps":[...]}.\nطلب المستخدم: ${text}\nالنتائج: ${JSON.stringify(observations).slice(0,18000)}\nالأدوات: ${JSON.stringify(TOOL_SPECS)}`,text,deadline);
      const groundedRepairSteps=groundExplicitLifeFactsV125(text,groundExplicitTemporalFactsV125(text,Array.isArray(repair?.steps)?repair.steps.slice(0,MAX_REPAIR_STEPS):[]));
      for(const [i,s] of groundedRepairSteps.entries()){
        const tool=String(s?.tool||"");if(!TOOL_SPECS[tool]||TOOL_SPECS[tool].risky&&!forcedSteps&&!looksExplicitlyConfirmed(text))continue;
        const args=resolveStepRefsV125(s?.args||{},stepResults),result=await executeTool(env,{chatId,operationId,stepKey:`repair:${i+1}:${tool}`,tool,args,user});observations.push({step:`repair-${i+1}`,tool,...result});stepResults.push(result);
      }
    }catch(e){await reportFailure(env,chatId,"repair",e,{operationId,text:normalizeText(text).slice(0,300)});}
  }
  const badMutations=observations.filter(x=>TOOL_SPECS[x.tool]?.mutation&&(!x.ok||x.verified!==true));
  const finalFailures=observations.filter(x=>!x.ok);
  if(hasMutation&&(badMutations.length||finalFailures.length)){
    let restored;
    try{restored=await restoreUserStateVerifiedV127(env,chatId,before,true);}
    catch(e){const incident=await reportFailure(env,chatId,'atomic_rollback_restore',e,{operationId});return `⚠️ التنفيذ فشل، وكمان استرجاع الحالة السابقة نفسه فشل. مش هقولك إن التغييرات رجعت. رقم التتبع: ${incident}`; }
    if(!restored?.verified){const incident=await reportFailure(env,chatId,'atomic_rollback_verify',new Error((restored?.failures||[]).join('|')),{operationId});return `⚠️ التنفيذ فشل، ومحاولة الاسترجاع لم تنجح في التحقق الكامل. مش هعتبر الحالة رجعت. رقم التتبع: ${incident}`; }
    await discardOperationSnapshotV125(env,operationId);
    await env.DB.prepare(`INSERT INTO sanad_audit(operation_id,chat_id,tool,args_json,result_json,verified,created_at) VALUES(?,?,?,?,?,?,?)`).bind(operationId,chatId,'system.atomic_rollback','{}',JSON.stringify({reason:'failed_or_unverified',bad:badMutations.map(x=>({tool:x.tool,error:x.error})),restore_verified:true}),1,nowIso()).run();
    return `الخطة ما اكتملتش بشكل يمكن إثباته، فرجّعت التغييرات واتأكدت إن الحالة السابقة رجعت فعلًا.${badMutations.length?` السبب: ${badMutations.map(x=>`${x.tool}: ${x.error||'verification_failed'}`).join(' | ')}`:''}`;
  }
  if(hasMutation)await commitOperationSnapshotV125(env,operationId);
  const composer=`أنت سند V12.7. اكتب رد مصري طبيعي، مختصر ومفيد، بناءً فقط على observations. أي mutation هنا تم التحقق منه بالفعل. اذكر النتيجة المهمة لا تفاصيل النظام. لو المستخدم طلب أكتر من حاجة لخّصهم بوضوح.\nطلب: ${text}\nالنتائج: ${JSON.stringify(observations).slice(0,20000)}`;
  try{const out=await callBrainText(env,composer,deadline);if(out)return out;}catch(e){await reportFailure(env,chatId,"composer",e,{operationId});}
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
function fallbackComposeV126BeforeHardening(obs){
  const muts=obs.filter(x=>TOOL_SPECS[x.tool]?.mutation);
  const reads=obs.filter(x=>!TOOL_SPECS[x.tool]?.mutation&&x.ok);
  if(muts.length)return `✅ تم تنفيذ ${muts.length} خطوة واتأكدت من الحالة الفعلية بعد التنفيذ.`;
  if(reads.length)return `تمام، راجعت الحالة الحالية.`;
  return "تمام.";
}

async function executeToolV126BeforeHardening(env,{chatId,operationId,stepKey,tool,args,user}) {
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

async function dispatchToolV125Base(env,chatId,tool,args,user){
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

async function toolShoppingReadV125Base(env,chatId){
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
async function toolShoppingUpdateV125Base(env,chatId,args){
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
async function toolReminderCreateV125Base(env,chatId,args,user){
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
async function toolReminderUpdateV125Base(env,chatId,args){
  const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:"missing_id"};
  const before=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();if(!before)return{ok:false,changed:0,verified:false,error:"not_found"};
  const title=args.title!=null?normalizeText(args.title):before.title,date=args.local_date||before.local_date,time=args.local_time||before.local_time,dur=args.duration_minutes!=null?Number(args.duration_minutes):Number(before.duration_minutes||0);
  await env.DB.prepare(`UPDATE sanad_reminders SET title=?,local_date=?,local_time=?,duration_minutes=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(title,date,time,dur,nowIso(),chatId,id).run();
  const after=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,id).first();
  const verified=!!after&&after.title===title&&after.local_date===date&&after.local_time===time;
  return{ok:verified,changed:verified?1:0,verified,before,after};
}
async function toolReminderCancelV126BeforeHardening(env,chatId,args){
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
async function toolMemoryForgetV126BeforeHardening(env,chatId,args){
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
async function callModelsV125Base(env,messages,deadline,opts={}){
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
async function sendTextV125Base(env,chatId,text,reply_markup){
  const chunks=splitTelegram(String(text||""));
  for(const c of chunks)await telegramApi(env,"sendMessage",{chat_id:chatId,text:c,...(reply_markup?{reply_markup}:{})});
}
function splitTelegram(s){if(s.length<=3900)return[s];const out=[];while(s.length){out.push(s.slice(0,3900));s=s.slice(3900)}return out}

async function transcribeVoiceV125Base(env,voice){
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

async function showShoppingV125Base(env,chatId){
  const r=await toolShoppingRead(env,chatId),p=r.items.filter(x=>x.status==="pending");
  if(!p.length){await sendText(env,chatId,"🛒 قائمة المشتريات فاضية.");return;}
  const kb={inline_keyboard:p.slice(0,20).map(x=>[{text:`☐ ${String(x.title).slice(0,35)}`,callback_data:`s125:shop:toggle:${x.id}`}])};
  await sendText(env,chatId,`🛒 المشتريات (${p.length}):\n${p.map(x=>`• ${x.title}${x.quantity?` — ${x.quantity}`:""}`).join("\n")}`,kb);
}
async function showToday(env,chatId,user){const d=localNow(user?.timezone||TZ).date,r=await toolRemindersRead(env,chatId,{from_date:d,to_date:d});await sendText(env,chatId,r.items.length?`📅 النهاردة:\n${r.items.map(x=>`• ${x.local_time} — ${x.title}`).join("\n")}`:"📅 مفيش مواعيد مسجلة النهاردة.");}
async function showMemory(env,chatId){const rows=(await env.DB.prepare(`SELECT memory_type,content FROM sanad_memories WHERE chat_id=? ORDER BY importance DESC,id DESC LIMIT 30`).bind(chatId).all())?.results||[];await sendText(env,chatId,rows.length?`🧠 فاكر عنك:\n${rows.map(x=>`• ${x.content}`).join("\n")}`:"🧠 لسه مفيش ذكريات محفوظة.");}
async function showAudit(env,chatId){const r=await toolAuditRead(env,chatId,{limit:10});await sendText(env,chatId,r.items.length?`🧾 آخر العمليات:\n${r.items.map(x=>`• ${x.tool} — ${x.verified?"✅":"⚠️"}`).join("\n")}`:"🧾 مفيش عمليات لسه.");}
async function handleCallbackV125Base(env,q){
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
    {command:"today",description:"مواعيد النهاردة"},{command:"tomorrow",description:"مواعيد بكرة"},{command:"week",description:"جدول الأسبوع"},{command:"month",description:"جدول الشهر"},{command:"list",description:"كل المواعيد القادمة"},{command:"recurring",description:"التكرارات"},
    {command:"shopping",description:"قائمة المشتريات"},{command:"projects",description:"المشاريع"},{command:"waiting",description:"الحاجات اللي مستنيها"},{command:"inbox",description:"صندوق الوارد"},{command:"settings",description:"إعدادات سند"},{command:"clear",description:"إدارة البيانات والمسح"},
    {command:"memory",description:"ذاكرة سند"},{command:"prayer",description:"مواقيت الصلاة"},{command:"where",description:"موقعي وتوقيتي"},
    {command:"audit",description:"سجل التنفيذ"},{command:"undo",description:"تراجع عن آخر عملية"},{command:"live",description:"المتابعة الحية"},{command:"status",description:"حالة سند"}
  ]});
  return j({ok:true,service:NAME,version:VERSION,architecture:"single-brain-full-life-agent",tools:Object.keys(TOOL_SPECS).length,webhook,telegram:x.ok,models:MODEL_CHAIN.map(m=>m.id),legacy_v11_migration:true});
}
async function healthV125Base(env){
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
  add("version",VERSION==="12.7.0",VERSION);
  add("models",MODEL_CHAIN.length===3,MODEL_CHAIN.map(x=>x.id).join(","));
  add("full-life-tools",Object.keys(TOOL_SPECS).length>=60,String(Object.keys(TOOL_SPECS).length));
  add("mutation-verification",Object.values(TOOL_SPECS).filter(x=>x.mutation).length>=35);
  add("no-success-without-proof",fallbackCompose([{tool:"shopping.add",ok:true,verified:true,changed:1}]).includes("✅"));
  add("risky-guard",TOOL_SPECS["shopping.clear"].risky===true&&TOOL_SPECS["memory.forget"].risky===true&&TOOL_SPECS["system.clear_all"].risky===true);
  add("recurrence-engine",generateRecurrenceOccurrencesV125({rule_json:JSON.stringify({unit:"days",every:1,times:["08:00"]}),start_date:"2026-08-17",end_date:null,max_occurrences:null,fired_count:0,exceptions_json:"[]"},"2026-08-17","2026-08-19",10).length===3);
  add("cairo-timezone-conversion",new Date(zonedLocalToEpochV125("2026-08-17","19:00","Africa/Cairo")).toISOString()==="2026-08-17T16:00:00.000Z");
  add("atomic-snapshots",SNAPSHOT_TABLES.length>=10,String(SNAPSHOT_TABLES.length));
  add("normalizer",normItem("  لبن! ")==="لبن");
  add("time",/^\d{4}-\d{2}-\d{2}$/.test(localNow().date));
  return j({ok:tests.every(x=>x.ok),version:VERSION,tests});
}

/* ======================== SANAD V12.7 FULL-LIFE PACK ======================== */
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
    for(const [legacy,_,fn] of simpleMaps)if(await tableExistsV125(env,legacy)){const rows=(await env.DB.prepare(`SELECT * FROM ${legacy} LIMIT 10000`).all())?.results||[];for(const r of rows)try{await fn(r)}catch(e){await reportFailure(env,String(r?.chat_id||""),"legacy_migration_row",e,{table:legacy});throw e;}}
    if(await tableExistsV125(env,"life_entities")){
      const rows=(await env.DB.prepare(`SELECT * FROM life_entities LIMIT 10000`).all())?.results||[];
      for(const r of rows)await env.DB.prepare(`INSERT OR IGNORE INTO sanad_entities(chat_id,entity_type,name,normalized,data_json,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.entity_type||"concept"),String(r.name),String(r.normalized_name||normItem(r.name)),String(r.data_json||"{}"),Number(r.confidence??1),String(r.source||"v11_migration"),String(r.created_at||now),String(r.updated_at||now)).run();
    }
  }catch(e){await reportFailure(env,null,"legacy_migration",e);throw e;}
  await env.DB.prepare(`INSERT INTO sanad_meta(key,value,updated_at) VALUES('legacy_v11_migrated','1',?) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at`).bind(nowIso()).run();
}

async function snapshotUserStateV125Base(env,chatId){
  const data={};
  for(const table of SNAPSHOT_TABLES){if(!(await tableExistsV125(env,table)))continue;data[table]=(await env.DB.prepare(`SELECT * FROM ${table} WHERE chat_id=? ORDER BY id`).bind(String(chatId)).all())?.results||[];}
  return data;
}
async function restoreUserStateV125Base(env,chatId,snap){
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

function normalizeRuleV125Base(raw){
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
function generateRecurrenceOccurrencesV125Base(row,fromDate,toDate,limit=500){
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
async function toolRecurrenceUpdateV125Base(env,chatId,args){const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:'missing_id'};const before=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!before)return{ok:false,changed:0,verified:false,error:'not_found'};const rule=args?.rule?normalizeRuleV125(args.rule):parseJsonV125(before.rule_json,{}),title=args?.title!=null?normalizeText(args.title):before.title,end=args?.end_date===null?null:(validDateV125(args?.end_date)?String(args.end_date):before.end_date),max=args?.max_occurrences!=null?clampV125(args.max_occurrences,1,MAX_RECURRENCE_OCCURRENCES):before.max_occurrences;await env.DB.prepare(`UPDATE sanad_recurrences SET title=?,rule_json=?,end_date=?,max_occurrences=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,JSON.stringify(rule),end,max,nowIso(),chatId,id).run();const after=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:1,verified:!!after,before,after};}
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
async function toolScheduleShiftV125Base(env,chatId,args){const type=String(args?.source_type||'reminder'),id=Number(args?.id),mins=Number(args?.minutes||0);if(!id||!mins)return{ok:false,changed:0,verified:false,error:'invalid_shift'};if(type==='reminder'){const b=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const nx=addMinutesLocal(b.local_date,b.local_time,mins);await env.DB.prepare(`UPDATE sanad_reminders SET local_date=?,local_time=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(nx.date,nx.time,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,id).first();const verified=a?.local_date===nx.date&&a?.local_time===nx.time;if(verified)await propagateDependenciesV125(env,chatId,'reminder',id,mins);return{ok:verified,changed:verified?1:0,verified,before:b,after:a};}return{ok:false,changed:0,verified:false,error:'shift_only_one_time_supported'};}

async function toolDependencyReadV125(env,chatId){const rows=(await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 100`).bind(chatId).all())?.results||[];return{ok:true,changed:0,verified:true,items:rows};}
async function toolDependencyCreateV125Base(env,chatId,args){const st=String(args?.source_type||'reminder'),sid=Number(args?.source_id),tt=String(args?.target_type||'reminder'),tid=Number(args?.target_id),rel=String(args?.relation||'after'),off=Math.trunc(Number(args?.offset_minutes||0));if(!sid||!tid)return{ok:false,changed:0,verified:false,error:'invalid_dependency'};if(st===tt&&sid===tid)return{ok:false,changed:0,verified:false,error:'self_dependency'};const now=nowIso();const r=await env.DB.prepare(`INSERT OR REPLACE INTO sanad_dependencies(chat_id,source_type,source_id,target_type,target_id,relation,offset_minutes,condition_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)`).bind(chatId,st,sid,tt,tid,rel,off,JSON.stringify(args?.condition||{}),now,now).run();const id=Number(r?.meta?.last_row_id||0),chk=await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND source_type=? AND source_id=? AND target_type=? AND target_id=? AND active=1`).bind(chatId,st,sid,tt,tid).first();return{ok:!!chk,changed:chk?1:0,verified:!!chk,id:Number(chk?.id||id),after:chk};}
async function toolDependencyRemoveV125(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_dependencies SET active=0,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT id,active FROM sanad_dependencies WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],verified=rows.length>0&&rows.every(r=>Number(r.active)===0);return{ok:verified,changed:rows.length,verified};}
async function propagateDependenciesV125Base(env,chatId,sourceType,sourceId,deltaMinutes,visited=new Set()){
  const key=`${sourceType}:${sourceId}`;if(visited.has(key)||visited.size>30)return;visited.add(key);
  const deps=(await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND source_type=? AND source_id=? AND active=1`).bind(chatId,sourceType,sourceId).all())?.results||[];
  for(const d of deps){if(d.target_type==='reminder'){const r=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,Number(d.target_id)).first();if(r){const nx=addMinutesLocal(r.local_date,r.local_time,Number(deltaMinutes||0));await env.DB.prepare(`UPDATE sanad_reminders SET local_date=?,local_time=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(nx.date,nx.time,nowIso(),chatId,Number(d.target_id)).run();await propagateDependenciesV125(env,chatId,'reminder',Number(d.target_id),deltaMinutes,visited);}}}
}

async function toolProfileReadV125(env,chatId){const r=await ensureUser(env,chatId);return{ok:true,changed:0,verified:true,profile:r};}
async function toolProfileUpdateV126BeforeHardening(env,chatId,args){const before=await ensureUser(env,chatId),allowed=['timezone','city','country','country_code','latitude','longitude','locale','display_name','autonomy_mode','proactive_enabled','morning_brief_time','evening_brief_time','morning_brief_enabled','evening_brief_enabled','ask_before_delete','deep_reasoning_mode'];const sets=[],vals=[];for(const k of allowed)if(args?.[k]!==undefined){sets.push(`${k}=?`);vals.push(args[k]);}if(!sets.length)return{ok:false,changed:0,verified:false,error:'nothing_to_update'};sets.push('updated_at=?');vals.push(nowIso(),chatId);await env.DB.prepare(`UPDATE sanad_users SET ${sets.join(',')} WHERE chat_id=?`).bind(...vals).run();const after=await env.DB.prepare(`SELECT * FROM sanad_users WHERE chat_id=?`).bind(chatId).first(),verified=!!after&&allowed.filter(k=>args?.[k]!==undefined).every(k=>String(after[k]??'')===String(args[k]??''));return{ok:verified,changed:verified?1:0,verified,before,after};}
async function toolSettingsReadV125(env,chatId){const p=await ensureUser(env,chatId);return{ok:true,changed:0,verified:true,settings:{autonomy_mode:p.autonomy_mode,proactive_enabled:p.proactive_enabled,morning_brief_enabled:p.morning_brief_enabled,morning_brief_time:p.morning_brief_time,evening_brief_enabled:p.evening_brief_enabled,evening_brief_time:p.evening_brief_time,ask_before_delete:p.ask_before_delete,deep_reasoning_mode:p.deep_reasoning_mode}};}
async function toolSettingsUpdateV126BeforeHardening(env,chatId,args){return toolProfileUpdateV125(env,chatId,args);}

async function toolWorldReadV125(env,chatId,args){const q=normItem(args?.query||''),type=normalizeText(args?.entity_type||'');let sql=`SELECT * FROM sanad_entities WHERE chat_id=?`,b=[chatId];if(type){sql+=` AND entity_type=?`;b.push(type)}sql+=` ORDER BY confidence DESC,id DESC LIMIT 100`;let rows=(await env.DB.prepare(sql).bind(...b).all())?.results||[];if(q)rows=rows.filter(x=>normItem(x.name).includes(q)||normItem(x.data_json).includes(q));for(const x of rows)x.data=parseJsonV125(x.data_json,{});return{ok:true,changed:0,verified:true,items:rows.slice(0,50)};}
async function toolWorldUpsertV125Base(env,chatId,args){const name=normalizeText(args?.name),type=normalizeText(args?.entity_type||'concept');if(!name)return{ok:false,changed:0,verified:false,error:'missing_name'};const n=normItem(name),now=nowIso(),data=args?.data&&typeof args.data==='object'?args.data:{};await env.DB.prepare(`INSERT INTO sanad_entities(chat_id,entity_type,name,normalized,data_json,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,entity_type,normalized) DO UPDATE SET name=excluded.name,data_json=excluded.data_json,confidence=excluded.confidence,source=excluded.source,updated_at=excluded.updated_at`).bind(chatId,type,name,n,JSON.stringify(data),clampV125(args?.confidence??1,0,1),String(args?.source||'user_explicit'),now,now).run();const after=await env.DB.prepare(`SELECT * FROM sanad_entities WHERE chat_id=? AND entity_type=? AND normalized=?`).bind(chatId,type,n).first();return{ok:!!after,changed:after?1:0,verified:!!after,id:Number(after?.id||0),after};}
async function toolWorldLinkV125Base(env,chatId,args){const from=Number(args?.from_entity_id),to=args?.to_entity_id==null?null:Number(args.to_entity_id),rel=normalizeText(args?.relation);if(!from||!rel||(!to&&!normalizeText(args?.object_value)))return{ok:false,changed:0,verified:false,error:'invalid_link'};const exists=await env.DB.prepare(`SELECT id FROM sanad_entities WHERE chat_id=? AND id=?`).bind(chatId,from).first();if(!exists)return{ok:false,changed:0,verified:false,error:'from_not_found'};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_edges(chat_id,from_entity_id,relation,to_entity_id,object_value,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(chatId,from,rel,to,normalizeText(args?.object_value)||null,clampV125(args?.confidence??1,0,1),String(args?.source||'agent'),now,now).run();const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_edges WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:after?1:0,verified:!!after,id,after};}
async function toolWorldForgetV125(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`DELETE FROM sanad_edges WHERE chat_id=? AND (from_entity_id IN (${qs}) OR to_entity_id IN (${qs}))`).bind(chatId,...ids,...ids).run();await env.DB.prepare(`DELETE FROM sanad_entities WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).run();const left=(await env.DB.prepare(`SELECT id FROM sanad_entities WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return{ok:left.length===0,changed:ids.length-left.length,verified:left.length===0};}

async function toolProjectTasksReadV125(env,chatId,args){let sql=`SELECT * FROM sanad_project_tasks WHERE chat_id=?`,b=[chatId];if(args?.project_id){sql+=` AND project_id=?`;b.push(Number(args.project_id))}if(args?.status){sql+=` AND status=?`;b.push(String(args.status))}sql+=` ORDER BY id DESC LIMIT 200`;return{ok:true,changed:0,verified:true,items:(await env.DB.prepare(sql).bind(...b).all())?.results||[]};}
async function toolProjectTaskCreateV125(env,chatId,args){const pid=Number(args?.project_id),title=normalizeText(args?.title);if(!pid||!title)return{ok:false,changed:0,verified:false,error:'invalid_task'};const project=await env.DB.prepare(`SELECT id FROM sanad_projects WHERE chat_id=? AND id=?`).bind(chatId,pid).first();if(!project)return{ok:false,changed:0,verified:false,error:'project_not_found'};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_project_tasks(project_id,chat_id,title,status,due_at,priority,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?,?)`).bind(pid,chatId,title,args?.due_at??null,String(args?.priority||'normal'),now,now).run();const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_project_tasks WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:after?1:0,verified:!!after,id,after};}
async function toolProjectTaskUpdateV126BeforeHardening(env,chatId,args){const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:'missing_id'};const b=await env.DB.prepare(`SELECT * FROM sanad_project_tasks WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const title=args?.title!=null?normalizeText(args.title):b.title,status=args?.status!=null?String(args.status):b.status,due=args?.due_at!==undefined?args.due_at:b.due_at,priority=args?.priority!=null?String(args.priority):b.priority;await env.DB.prepare(`UPDATE sanad_project_tasks SET title=?,status=?,due_at=?,priority=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,status,due,priority,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_project_tasks WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!a,changed:1,verified:!!a,before:b,after:a};}

async function toolShoppingSessionStartV125(env,chatId,args){const active=await env.DB.prepare(`SELECT * FROM sanad_shopping_sessions WHERE chat_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`).bind(chatId).first();if(active)return{ok:true,changed:0,verified:true,id:Number(active.id),session:active};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_shopping_sessions(chat_id,place_name,started_at) VALUES(?,?,?)`).bind(chatId,normalizeText(args?.place_name)||null,now).run(),id=Number(r?.meta?.last_row_id||0),a=await env.DB.prepare(`SELECT * FROM sanad_shopping_sessions WHERE id=?`).bind(id).first();return{ok:!!a,changed:a?1:0,verified:!!a,id,session:a};}
async function toolShoppingSessionFinishV125(env,chatId){const active=await env.DB.prepare(`SELECT * FROM sanad_shopping_sessions WHERE chat_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`).bind(chatId).first();if(!active)return{ok:true,changed:0,verified:true};await env.DB.prepare(`UPDATE sanad_shopping_sessions SET ended_at=? WHERE chat_id=? AND id=?`).bind(nowIso(),chatId,Number(active.id)).run();const a=await env.DB.prepare(`SELECT * FROM sanad_shopping_sessions WHERE id=?`).bind(Number(active.id)).first();return{ok:!!a?.ended_at,changed:a?.ended_at?1:0,verified:!!a?.ended_at,session:a};}
async function toolShoppingProgressV125Base(env,chatId){const r=await toolShoppingRead(env,chatId),all=r.items,pending=all.filter(x=>x.status==='pending').length,bought=all.filter(x=>x.status==='bought').length,total=all.length;return{ok:true,changed:0,verified:true,total,pending,bought,percent:total?Math.round(bought/total*100):0};}

const PRAYER_ALIASES_V125={fajr:'Fajr',الفجر:'Fajr',sunrise:'Sunrise',الشروق:'Sunrise',dhuhr:'Dhuhr',الظهر:'Dhuhr',asr:'Asr',العصر:'Asr',maghrib:'Maghrib',المغرب:'Maghrib',isha:'Isha',العشاء:'Isha'};
function cleanPrayerTimeV125(v){const m=String(v||'').match(/\b(\d{1,2}):(\d{2})\b/);return m?`${String(Number(m[1])).padStart(2,'0')}:${m[2]}`:'';}
async function fetchPrayerTimesV125Base(env,user,date){const city=String(user?.city||DEFAULT_CITY),country=String(user?.country||DEFAULT_COUNTRY),key=`prayer:${date}:${city}:${country}`;const c=await cacheGetV125(env,key);if(c)return c;let url;if(user?.latitude!=null&&user?.longitude!=null)url=`https://api.aladhan.com/v1/timings/${date.split('-').reverse().join('-')}?latitude=${encodeURIComponent(user.latitude)}&longitude=${encodeURIComponent(user.longitude)}&method=5`;else url=`https://api.aladhan.com/v1/timingsByCity/${date.split('-').reverse().join('-')}?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=5`;const r=await fetch(url);if(!r.ok)throw new Error(`prayer_http_${r.status}`);const x=await r.json(),t=x?.data?.timings||{},out={date,times:{Fajr:cleanPrayerTimeV125(t.Fajr),Sunrise:cleanPrayerTimeV125(t.Sunrise),Dhuhr:cleanPrayerTimeV125(t.Dhuhr),Asr:cleanPrayerTimeV125(t.Asr),Maghrib:cleanPrayerTimeV125(t.Maghrib),Isha:cleanPrayerTimeV125(t.Isha)},timezone:String(x?.data?.meta?.timezone||user?.timezone||TZ)};return cacheSetV125(env,key,out,PRAYER_CACHE_MINUTES);}
async function toolPrayerTimesV125(env,chatId,args,user){const date=validDateV125(args?.date)?String(args.date):localNow(user?.timezone||TZ).date;const data=await fetchPrayerTimesV125(env,user,date);return{ok:true,changed:0,verified:true,...data};}
async function toolPrayerRulesReadV125(env,chatId){return{ok:true,changed:0,verified:true,items:(await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND active=1 ORDER BY id DESC`).bind(chatId).all())?.results||[]};}
async function toolPrayerRuleCreateV125(env,chatId,args,user){const raw=normItem(args?.prayer||''),prayer=PRAYER_ALIASES_V125[raw]||PRAYER_ALIASES_V125[String(args?.prayer||'').toLowerCase()]||String(args?.prayer||'');const title=normalizeText(args?.title||`تنبيه ${args?.prayer||prayer}`),start=validDateV125(args?.start_date)?String(args.start_date):localNow(user?.timezone||TZ).date;if(!['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'].includes(prayer))return{ok:false,changed:0,verified:false,error:'invalid_prayer'};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_prayer_rules(chat_id,title,prayer,offset_minutes,start_date,end_date,weekdays_json,max_occurrences,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(chatId,title,prayer,Math.trunc(Number(args?.offset_minutes||0)),start,validDateV125(args?.end_date)?String(args.end_date):null,JSON.stringify(Array.isArray(args?.weekdays)?args.weekdays:[]),args?.max_occurrences==null?null:clampV125(args.max_occurrences,1,MAX_RECURRENCE_OCCURRENCES),now,now).run();const id=Number(r?.meta?.last_row_id||0),a=await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!a,changed:a?1:0,verified:!!a,id,after:a};}
async function toolPrayerRuleUpdateV125(env,chatId,args){const id=Number(args?.id),b=await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const title=args?.title!=null?normalizeText(args.title):b.title,offset=args?.offset_minutes!=null?Math.trunc(Number(args.offset_minutes)):b.offset_minutes,end=args?.end_date!==undefined?(validDateV125(args.end_date)?String(args.end_date):null):b.end_date;await env.DB.prepare(`UPDATE sanad_prayer_rules SET title=?,offset_minutes=?,end_date=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,offset,end,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!a,changed:1,verified:!!a,before:b,after:a};}
async function toolPrayerRuleCancelV125(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_prayer_rules SET active=0,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT active FROM sanad_prayer_rules WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],v=rows.length>0&&rows.every(x=>Number(x.active)===0);return{ok:v,changed:rows.length,verified:v};}
async function toolPrayerRuleSkipV125(env,chatId,args){const id=Number(args?.id),date=String(args?.date||'');if(!id||!validDateV125(date))return{ok:false,changed:0,verified:false,error:'invalid_skip'};const b=await env.DB.prepare(`SELECT exceptions_json FROM sanad_prayer_rules WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const arr=parseJsonV125(b.exceptions_json,[]);if(!arr.includes(date))arr.push(date);await env.DB.prepare(`UPDATE sanad_prayer_rules SET exceptions_json=?,updated_at=? WHERE chat_id=? AND id=?`).bind(JSON.stringify(arr),nowIso(),chatId,id).run();return{ok:true,changed:1,verified:true,date};}

async function toolHolidaysV125Base(env,chatId,args,user){const year=Number(args?.year||localNow(user?.timezone||TZ).date.slice(0,4)),cc=String(args?.country_code||user?.country_code||'EG').toUpperCase(),key=`holidays:${cc}:${year}`;let data=await cacheGetV125(env,key);if(!data){const r=await fetch(`https://date.nager.at/api/v4/Holidays/${encodeURIComponent(cc)}/${year}`);if(!r.ok)throw new Error(`holidays_http_${r.status}`);data=await r.json();await cacheSetV125(env,key,data,HOLIDAY_CACHE_MINUTES);}return{ok:true,changed:0,verified:true,year,country_code:cc,items:Array.isArray(data)?data.slice(0,100):[]};}
async function toolWeatherV125Base(env,chatId,args,user){let lat=args?.latitude??user?.latitude,lon=args?.longitude??user?.longitude,city=normalizeText(args?.city||user?.city||DEFAULT_CITY);if(lat==null||lon==null){const g=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ar&format=json`);const gx=await g.json().catch(()=>({})),first=gx?.results?.[0];if(!first)throw new Error('weather_location_not_found');lat=first.latitude;lon=first.longitude;city=first.name||city;}const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`);if(!r.ok)throw new Error(`weather_http_${r.status}`);const x=await r.json();return{ok:true,changed:0,verified:true,city,latitude:lat,longitude:lon,current:x.current,daily:x.daily,timezone:x.timezone};}

async function fetchNewsV125Base(query,max=8){const q=normalizeText(query||'Egypt'),url=`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=${Math.min(20,Number(max||8))}&format=json&sort=HybridRel`;const r=await fetch(url);if(!r.ok)throw new Error(`news_http_${r.status}`);const x=await r.json();return (Array.isArray(x?.articles)?x.articles:[]).map(a=>({title:a.title,url:a.url,domain:a.domain,seendate:a.seendate,language:a.language})).slice(0,max);}
async function toolLiveNewsV125Base(env,chatId,args){const q=normalizeText(args?.query||'Egypt'),key=`news:${normItem(q)}`;let items=await cacheGetV125(env,key);if(!items){items=await fetchNewsV125(q,clampV125(args?.limit||8,1,12));await cacheSetV125(env,key,items,LIVE_CACHE_MINUTES);}return{ok:true,changed:0,verified:true,query:q,items};}
async function toolLiveWatchReadV125(env,chatId){return{ok:true,changed:0,verified:true,items:(await env.DB.prepare(`SELECT * FROM sanad_live_watches WHERE chat_id=? AND active=1 ORDER BY id DESC`).bind(chatId).all())?.results||[]};}
async function toolLiveWatchCreateV125(env,chatId,args){const q=normalizeText(args?.query);if(!q)return{ok:false,changed:0,verified:false,error:'missing_query'};const now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_live_watches(chat_id,query,active,created_at,updated_at) VALUES(?,?,1,?,?)`).bind(chatId,q,now,now).run(),id=Number(r?.meta?.last_row_id||0),a=await env.DB.prepare(`SELECT * FROM sanad_live_watches WHERE id=?`).bind(id).first();return{ok:!!a,changed:a?1:0,verified:!!a,id,after:a};}
async function toolLiveWatchStopV125(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_live_watches SET active=0,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT active FROM sanad_live_watches WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],v=rows.length>0&&rows.every(x=>Number(x.active)===0);return{ok:v,changed:rows.length,verified:v};}

async function toolAuditUndoV126BeforeHardening(env,chatId){const row=await env.DB.prepare(`SELECT * FROM sanad_operation_snapshots WHERE chat_id=? AND committed=1 AND undone_at IS NULL ORDER BY id DESC LIMIT 1`).bind(chatId).first();if(!row)return{ok:false,changed:0,verified:false,error:'nothing_to_undo'};const snap=parseJsonV125(row.snapshot_json,null);if(!snap)return{ok:false,changed:0,verified:false,error:'invalid_snapshot'};await restoreUserStateV125(env,chatId,snap);await env.DB.prepare(`UPDATE sanad_operation_snapshots SET undone_at=? WHERE id=?`).bind(nowIso(),Number(row.id)).run();const chk=await env.DB.prepare(`SELECT undone_at FROM sanad_operation_snapshots WHERE id=?`).bind(Number(row.id)).first();return{ok:!!chk?.undone_at,changed:1,verified:!!chk?.undone_at,operation_id:row.operation_id,summary:row.summary};}
async function toolSystemStatusV125(env,chatId){const failures=(await env.DB.prepare(`SELECT scope,error_text,created_at FROM sanad_failures WHERE chat_id=? ORDER BY id DESC LIMIT 10`).bind(chatId).all())?.results||[],counts={};for(const t of ['sanad_shopping','sanad_reminders','sanad_recurrences','sanad_memories','sanad_projects','sanad_waiting','sanad_prayer_rules','sanad_live_watches'])counts[t]=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM ${t} WHERE chat_id=?`).bind(chatId).first())?.c||0);return{ok:true,changed:0,verified:true,version:VERSION,counts,recent_failures:failures};}
async function toolSystemClearAllV125Base(env,chatId){const before=await snapshotUserStateV125(env,chatId);for(const t of SNAPSHOT_TABLES)if(await tableExistsV125(env,t))await env.DB.prepare(`DELETE FROM ${t} WHERE chat_id=?`).bind(chatId).run();const after=await snapshotUserStateV125(env,chatId),left=Object.values(after).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0);return{ok:left===0,changed:Object.values(before).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0),verified:left===0};}

function fireWithinWindowV125(date,time,windowStartMs,windowEndMs){const ms=Date.parse(`${date}T${time}:00Z`);return ms>=windowStartMs&&ms<=windowEndMs;}
async function sendOnceV125Base(env,chatId,key,text){const done=await env.DB.prepare(`SELECT 1 x FROM sanad_proactive_fires WHERE chat_id=? AND fire_key=?`).bind(String(chatId),String(key)).first();if(done)return false;await sendText(env,String(chatId),text);await env.DB.prepare(`INSERT OR IGNORE INTO sanad_proactive_fires(chat_id,fire_key,sent_at) VALUES(?,?,?)`).bind(String(chatId),String(key),nowIso()).run();return true;}
async function runSanadSchedulerV126BeforeHardening(env,scheduledTime){
  const nowMs=Number(scheduledTime||Date.now()),lastRow=await env.DB.prepare(`SELECT value FROM sanad_scheduler_state WHERE key='last_run_ms'`).first(),last=Math.max(nowMs-SCHEDULER_CATCHUP_MINUTES*60000,Number(lastRow?.value||nowMs-60000));
  await env.DB.prepare(`INSERT INTO sanad_scheduler_state(key,value,updated_at) VALUES('last_run_ms',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(String(nowMs),nowIso()).run();
  const users=(await env.DB.prepare(`SELECT * FROM sanad_users LIMIT 1000`).all())?.results||[];
  for(const u of users){try{await deliverUserScheduleV125(env,u,last,nowMs);await deliverPrayerRulesV125(env,u,last,nowMs);await deliverDailyBriefsV125(env,u);if(Number(u.proactive_enabled??1))await proactiveUserV125(env,u);}catch(e){await reportFailure(env,String(u.chat_id),'scheduler_user',e);}}
  await checkLiveWatchesV125(env);
}
function localDateTimeApproxUtcMsV125(date,time,timeZone=TZ){return zonedLocalToEpochV125(date,time,timeZone);}
async function deliverUserScheduleV126BeforeHardening(env,u,lastMs,nowMs){
  const chatId=String(u.chat_id),ln=localNow(u.timezone||TZ),from=addDaysV125(ln.date,-1),to=addDaysV125(ln.date,1);
  const one=(await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND status='active' AND sent=0 AND local_date BETWEEN ? AND ?`).bind(chatId,from,to).all())?.results||[];
  for(const r of one){
    const main=localDateTimeApproxUtcMsV125(r.local_date,r.local_time,u.timezone||TZ),offsets=[0,...parseJsonV125(r.advance_json,[]),Number(r.advance_minutes||0)].map(Number).filter((v,i,a)=>v>=0&&a.indexOf(v)===i);
    for(const off of offsets){const fire=main-off*60000;if(fire>=lastMs&&fire<=nowMs){const key=`rem:${r.id}:${r.local_date}:${r.local_time}:${off}`;const label=off?`⏰ تذكير مسبق (${off} دقيقة): ${r.title}`:`⏰ ${r.title}`;if(await sendOnceV125(env,chatId,key,label)){await env.DB.prepare(`INSERT OR IGNORE INTO sanad_reminder_fires(reminder_id,fire_key,chat_id,sent_at) VALUES(?,?,?,?)`).bind(Number(r.id),key,chatId,nowIso()).run();if(off===0)await env.DB.prepare(`UPDATE sanad_reminders SET sent=1,updated_at=? WHERE id=?`).bind(nowIso(),Number(r.id)).run();}}}
  }
  const rules=(await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?)`).bind(chatId,to,from).all())?.results||[];
  for(const r of rules){if(r.paused_until&&String(r.paused_until)>nowIso())continue;const occ=generateRecurrenceOccurrencesV125(r,from,to,100);for(const o of occ){const main=localDateTimeApproxUtcMsV125(o.date,o.time,u.timezone||TZ),offsets=[0,...parseJsonV125(r.advance_json,[])].map(Number).filter((v,i,a)=>v>=0&&a.indexOf(v)===i);for(const off of offsets){const fire=main-off*60000;if(fire<lastMs||fire>nowMs)continue;const claimed=await env.DB.prepare(`INSERT OR IGNORE INTO sanad_recurrence_fires(rule_id,occurrence_key,alert_offset,chat_id,sent_at) VALUES(?,?,?,?,?)`).bind(Number(r.id),o.key,off,chatId,nowIso()).run();if(Number(claimed?.meta?.changes||0)>0){await sendText(env,chatId,off?`⏰ تذكير مسبق (${off} دقيقة): ${r.title}`:`🔁 ${r.title}`);if(off===0)await env.DB.prepare(`UPDATE sanad_recurrences SET fired_count=fired_count+1,updated_at=? WHERE id=?`).bind(nowIso(),Number(r.id)).run();}}}}
}
async function deliverPrayerRulesV126BeforeHardening(env,u,lastMs,nowMs){const chatId=String(u.chat_id),ln=localNow(u.timezone||TZ),rules=(await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?)`).bind(chatId,ln.date,ln.date).all())?.results||[];if(!rules.length)return;const data=await fetchPrayerTimesV125(env,u,ln.date);for(const r of rules){if(r.paused_until&&String(r.paused_until)>nowIso())continue;if(parseJsonV125(r.exceptions_json,[]).includes(ln.date))continue;const days=parseJsonV125(r.weekdays_json,[]).map(Number);if(days.length&&!days.includes(isoWeekdayV125(ln.date)))continue;const base=data.times[r.prayer];if(!base)continue;const shifted=addMinutesLocal(ln.date,base,Number(r.offset_minutes||0)),fire=localDateTimeApproxUtcMsV125(shifted.date,shifted.time,u.timezone||TZ);if(fire<lastMs||fire>nowMs)continue;const ins=await env.DB.prepare(`INSERT OR IGNORE INTO sanad_prayer_fires(rule_id,occurrence_date,chat_id,sent_at) VALUES(?,?,?,?)`).bind(Number(r.id),ln.date,chatId,nowIso()).run();if(Number(ins?.meta?.changes||0)>0){await sendText(env,chatId,`🕌 ${r.title}`);await env.DB.prepare(`UPDATE sanad_prayer_rules SET fired_count=fired_count+1,updated_at=? WHERE id=?`).bind(nowIso(),Number(r.id)).run();}}
}
async function buildBriefV125(env,u,type){const chatId=String(u.chat_id),ln=localNow(u.timezone||TZ),today=await getScheduleOccurrencesV125(env,chatId,ln.date,ln.date),shop=(await toolShoppingProgressV125(env,chatId)),waiting=(await toolWaitingRead(env,chatId)).items,projects=(await toolProjectsRead(env,chatId)).items;const head=type==='morning'?'☀️ صباح الخير — ملخص يومك':'🌙 ملخص المساء';const lines=[head];if(today.length)lines.push(`📅 ${today.length} حاجة على الجدول:\n${today.slice(0,7).map(x=>`• ${x.time} — ${x.title}`).join('\n')}`);if(shop.pending)lines.push(`🛒 فاضل ${shop.pending} في المشتريات.`);if(waiting.length)lines.push(`⏳ ${waiting.length} حاجة مستنيها.`);if(projects.length)lines.push(`🎯 ${projects.length} مشروع نشط.`);if(lines.length===1)lines.push('الدنيا هادية ومفيش التزامات مسجلة مهمة.');return lines.join('\n\n');}
async function deliverDailyBriefsV126BeforeHardening(env,u){const ln=localNow(u.timezone||TZ),chatId=String(u.chat_id);for(const type of ['morning','evening']){const enabled=Number(u[`${type}_brief_enabled`]||0),time=String(u[`${type}_brief_time`]|| (type==='morning'?'08:00':'20:00'));if(!enabled||ln.time!==time)continue;const done=await env.DB.prepare(`SELECT 1 x FROM sanad_daily_brief_fires WHERE chat_id=? AND brief_date=? AND brief_type=?`).bind(chatId,ln.date,type).first();if(done)continue;await sendText(env,chatId,await buildBriefV125(env,u,type));await env.DB.prepare(`INSERT INTO sanad_daily_brief_fires(chat_id,brief_date,brief_type,sent_at) VALUES(?,?,?,?)`).bind(chatId,ln.date,type,nowIso()).run();}}
async function proactiveUserV125(env,u){const chatId=String(u.chat_id),ln=localNow(u.timezone||TZ),occ=await getScheduleOccurrencesV125(env,chatId,ln.date,ln.date),nowm=hmMinutesV125(ln.time);for(const x of occ){const diff=hmMinutesV125(x.time)-nowm;if(diff>0&&diff<=30)await sendOnceV125(env,chatId,`soon:${x.source_type}:${x.source_id}:${x.date}:${x.time}`,`📌 خلي بالك: ${x.title} بعد حوالي ${diff} دقيقة.`);}const waiting=(await env.DB.prepare(`SELECT * FROM sanad_waiting WHERE chat_id=? AND status='waiting' AND due_at IS NOT NULL LIMIT 20`).bind(chatId).all())?.results||[];for(const w of waiting){if(Date.parse(String(w.due_at))<=Date.now())await sendOnceV125(env,chatId,`waiting-overdue:${w.id}:${ln.date}`,`⏳ متابعة: ${w.title}${w.waiting_on?` — مستني ${w.waiting_on}`:''}.`);}}
async function checkLiveWatchesV126BeforeHardening(env){const rows=(await env.DB.prepare(`SELECT * FROM sanad_live_watches WHERE active=1 ORDER BY id LIMIT ?`).bind(LIVE_WATCH_BATCH).all())?.results||[];for(const w of rows){try{const news=await fetchNewsV125(w.query,3);const top=news[0];if(top?.url&&top.url!==w.last_url){if(w.last_url)await sendText(env,String(w.chat_id),`🛰️ جديد في متابعة "${w.query}":\n${top.title}\n${top.url}`);await env.DB.prepare(`UPDATE sanad_live_watches SET last_url=?,updated_at=? WHERE id=?`).bind(top.url,nowIso(),Number(w.id)).run();}}catch(e){await reportFailure(env,String(w.chat_id),'live_watch',e,{watch_id:w.id});}}}

async function toolFreeTimeV125(env,chatId,args){const date=validDateV125(args?.date)?String(args.date):localNow().date,from=validTimeV125(args?.from_time)?String(args.from_time):'08:00',to=validTimeV125(args?.to_time)?String(args.to_time):'23:00',min=clampV125(args?.min_minutes||30,5,1440),busy=(await getScheduleOccurrencesV125(env,chatId,date,date)).filter(x=>Number(x.duration_minutes)>0).map(x=>({start:hmMinutesV125(x.time),end:hmMinutesV125(x.time)+Number(x.duration_minutes),title:x.title})).sort((a,b)=>a.start-b.start),slots=[];let cur=hmMinutesV125(from),end=hmMinutesV125(to);for(const b of busy){if(b.end<=cur||b.start>=end)continue;if(b.start-cur>=min)slots.push({from:minutesHmV125(cur),to:minutesHmV125(Math.min(b.start,end)),minutes:Math.min(b.start,end)-cur});cur=Math.max(cur,b.end);if(cur>=end)break;}if(end-cur>=min)slots.push({from:minutesHmV125(cur),to:minutesHmV125(end),minutes:end-cur});return{ok:true,changed:0,verified:true,date,slots,busy};}

async function toolReminderSnoozeV125(env,chatId,args){const id=Number(args?.id),mins=Math.trunc(Number(args?.minutes||0));if(!id||!mins)return{ok:false,changed:0,verified:false,error:'invalid_snooze'};const b=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const nx=addMinutesLocal(b.local_date,b.local_time,mins);await env.DB.prepare(`UPDATE sanad_reminders SET local_date=?,local_time=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(nx.date,nx.time,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,id).first(),v=a?.local_date===nx.date&&a?.local_time===nx.time;return{ok:v,changed:v?1:0,verified:v,before:b,after:a};}

function isAllowedUserV125(env,chatId){if(String(env.PUBLIC_BOT||'').toLowerCase()==='true')return true;const allowed=[env.ADMIN_CHAT_ID,env.ALLOWED_CHAT_ID,...String(env.ALLOWED_CHAT_IDS||'').split(',')].map(x=>String(x||'').trim()).filter(Boolean);return !allowed.length||allowed.includes(String(chatId));}
async function updateLocationV126BeforeHardening(env,chatId,loc){const lat=Number(loc?.latitude),lon=Number(loc?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error('invalid_location');await env.DB.prepare(`UPDATE sanad_users SET latitude=?,longitude=?,updated_at=? WHERE chat_id=?`).bind(lat,lon,nowIso(),chatId).run();return{lat,lon};}
async function showMenuV125Base(env,chatId){await sendText(env,chatId,`🤝 سند V12.7\n\n📅 /today النهاردة · /week الأسبوع · /month الشهر\n🔁 /recurring التكرارات · 🛒 /shopping المشتريات\n🎯 /projects المشاريع · ⏳ /waiting المتابعات\n🧠 /memory الذاكرة · 🕌 /prayer الصلاة\n📍 /where الموقع · 🧾 /audit السجل · ↩️ /undo تراجع\n\nأو سيب الأوامر خالص واتكلم معايا بطبيعتك.`);}
async function showRangeV125(env,chatId,user,days){const d=localNow(user?.timezone||TZ).date,rows=await getScheduleOccurrencesV125(env,chatId,d,addDaysV125(d,days-1));await sendText(env,chatId,rows.length?`📅 القادم:\n${rows.slice(0,60).map(x=>`• ${x.date} ${x.time} — ${x.title}`).join('\n')}`:'📅 مفيش حاجات مسجلة في الفترة دي.');}
async function showRecurrencesV125Base(env,chatId){const r=await toolRecurrenceReadV125(env,chatId,{});await sendText(env,chatId,r.items.length?`🔁 التكرارات:\n${r.items.map(x=>`• #${x.id} ${x.title} — كل ${x.rule.every} ${x.rule.unit}`).join('\n')}`:'🔁 مفيش تكرارات نشطة.');}
async function showProjectsV125(env,chatId){const r=await toolProjectsRead(env,chatId);await sendText(env,chatId,r.items.length?`🎯 المشاريع:\n${r.items.map(x=>`• #${x.id} ${x.title} — ${x.progress||0}%`).join('\n')}`:'🎯 مفيش مشاريع نشطة.');}
async function showWaitingV125(env,chatId){const r=await toolWaitingRead(env,chatId);await sendText(env,chatId,r.items.length?`⏳ مستني:\n${r.items.map(x=>`• #${x.id} ${x.title}${x.waiting_on?` — ${x.waiting_on}`:''}`).join('\n')}`:'⏳ مفيش حاجات مستنيها.');}
async function showWhereV125(env,chatId,user){await sendText(env,chatId,`📍 ${user?.city||DEFAULT_CITY}, ${user?.country||DEFAULT_COUNTRY}\n🕒 ${user?.timezone||TZ}${user?.latitude!=null?`\nإحداثيات محفوظة: ${Number(user.latitude).toFixed(4)}, ${Number(user.longitude).toFixed(4)}`:''}`);}
function formatPrayerV125Base(r){const t=r?.times||{};return `🕌 مواقيت الصلاة ${r?.date||''}\nالفجر ${t.Fajr||'-'} · الظهر ${t.Dhuhr||'-'} · العصر ${t.Asr||'-'} · المغرب ${t.Maghrib||'-'} · العشاء ${t.Isha||'-'}`;}

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


/* ================= SANAD V12.7 ULTIMATE PARITY PACK ================= */
const VOICE_TOTAL_BUDGET_MS_V126 = 20000;
const VOICE_FILE_TIMEOUT_MS_V126 = 5000;
const VOICE_STT_TIMEOUT_MS_V126 = 7000;
const EXTERNAL_API_TIMEOUT_MS_V126 = 6500;
const WORLD_MIN_CONFIDENCE_V126 = 0.6;

const SNAPSHOT_TABLES_V126 = [
  'sanad_users','sanad_conversation','sanad_shopping','sanad_shopping_sessions',
  'sanad_reminders','sanad_reminder_fires','sanad_recurrences','sanad_recurrence_fires',
  'sanad_dependencies','sanad_memories','sanad_entities','sanad_edges','sanad_projects',
  'sanad_project_tasks','sanad_waiting','sanad_prayer_rules','sanad_prayer_fires',
  'sanad_live_watches','sanad_life_inbox','sanad_proactive_fires','sanad_daily_brief_fires',
  'sanad_pending_actions'
];
SNAPSHOT_TABLES.splice(0, SNAPSHOT_TABLES.length, ...SNAPSHOT_TABLES_V126);

const CLEAR_USER_TABLES_V126 = [...new Set([
  ...SNAPSHOT_TABLES_V126,'sanad_pending_conflicts','sanad_audit','sanad_failures','sanad_rate_limits','sanad_legacy_id_map'
])];
const LEGACY_CLEAR_TABLES_V126 = [
  'event_dependencies','reminder_fires','schedule_fires','prayer_rule_fires','reminders','schedule_rules','recurring_rules','prayer_rules',
  'conversation_messages','pending_dialogs','pending_conflicts','pending_requests','user_memories','live_watches','life_inbox','project_tasks','projects',
  'waiting_items','daily_brief_fires','agent_settings','user_rate_limits','action_audit','runtime_failures','shopping_sessions','smart_list_items','smart_lists',
  'life_edges','life_entities','user_profiles'
];

Object.assign(TOOL_SPECS, {
  'shopping.query':{mutation:false,args:{query:'pending|bought|unavailable|skipped|important|category|progress|count|all',query_value:'?'}},
  'shopping.mark':{mutation:true,args:{query:'item title or reference',status:'pending|bought|unavailable|skipped'}},
  'inbox.read':{mutation:false,args:{status:'open|closed|all?'}},
  'inbox.add':{mutation:true,args:{text:'string',classified_as:'?'}},
  'inbox.close':{mutation:true,args:{ids:'number[]'}},
  'inbox.classify':{mutation:true,args:{id:'number',classified_as:'string'}},
  'calendar.hijri':{mutation:false,args:{date:'YYYY-MM-DD?'}},
  'live.reality':{mutation:false,args:{}},
  'prayer.rules.pause':{mutation:true,args:{ids:'number[]',until:'date|datetime?'}},
  'prayer.rules.resume':{mutation:true,args:{ids:'number[]'}}
});
TOOL_SPECS['shopping.update'].args.status='pending|bought|unavailable|skipped';
TOOL_SPECS['recurrence.pause'].args={ids:'number[]',until:'YYYY-MM-DD|local datetime|ISO?'};
TOOL_SPECS['recurrence.resume'].args={ids:'number[]'};
TOOL_SPECS['recurrence.update'].args={id:'number',title:'?',rule:'?',start_date:'?',end_date:'?',max_occurrences:'?',duration_minutes:'?',advance_minutes:'number[]?',kind:'?',active:'0|1?',paused_until:'?',exceptions:'string[]?'};
TOOL_SPECS['schedule.shift'].args={source_type:'reminder|recurrence',id:'number',minutes:'number'};
TOOL_SPECS['dependency.create'].args={source_type:'string',source_id:'number',target_type:'string',target_id:'number',relation:'after_start|after_end|before_start',offset_minutes:'number?',realign:'boolean?'};
TOOL_SPECS['world.upsert'].args.source='user_explicit|agent_inferred?';
TOOL_SPECS['world.link'].args.source='user_explicit|agent_inferred?';

let paritySchemaPromiseV126 = null;
async function ensureSchema(env, force = false) {
  await ensureSchemaV125Base(env, force);
  if (force || !paritySchemaPromiseV126) {
    paritySchemaPromiseV126 = (async () => {
      const sql = [
        `CREATE TABLE IF NOT EXISTS sanad_life_inbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',
          classified_as TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sanad_life_inbox ON sanad_life_inbox(chat_id,status,id)`,
        `CREATE TABLE IF NOT EXISTS sanad_pending_conflicts (
          chat_id TEXT PRIMARY KEY,tool TEXT NOT NULL,args_json TEXT NOT NULL,conflicts_json TEXT NOT NULL DEFAULT '[]',
          expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_model_stats (
          model_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,
          total_latency_ms INTEGER NOT NULL DEFAULT 0,last_latency_ms INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sanad_legacy_id_map (
          chat_id TEXT NOT NULL,entity_kind TEXT NOT NULL,legacy_id INTEGER NOT NULL,new_id INTEGER NOT NULL,created_at TEXT NOT NULL,
          PRIMARY KEY(chat_id,entity_kind,legacy_id)
        )`
      ];
      for (const s of sql) await env.DB.prepare(s).run();
      await maybeMigrateLegacyV126Parity(env);
      await env.DB.prepare(`INSERT INTO sanad_meta(key,value,updated_at) VALUES('v126_parity_schema','1',?) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at`).bind(nowIso()).run();
    })().catch(e => { paritySchemaPromiseV126 = null; throw e; });
  }
  return paritySchemaPromiseV126;
}

async function legacyMapPutV126(env,chatId,kind,legacyId,newId){
  if(!legacyId||!newId)return;
  await env.DB.prepare(`INSERT INTO sanad_legacy_id_map(chat_id,entity_kind,legacy_id,new_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(chat_id,entity_kind,legacy_id) DO UPDATE SET new_id=excluded.new_id`).bind(String(chatId),String(kind),Number(legacyId),Number(newId),nowIso()).run();
}
async function legacyMapGetV126(env,chatId,kind,legacyId){
  const r=await env.DB.prepare(`SELECT new_id FROM sanad_legacy_id_map WHERE chat_id=? AND entity_kind=? AND legacy_id=?`).bind(String(chatId),String(kind),Number(legacyId)).first();
  return Number(r?.new_id||0);
}
async function legacyRowsV126(env,table,limit=20000){
  if(!(await tableExistsV125(env,table)))return[];
  return (await env.DB.prepare(`SELECT * FROM ${table} LIMIT ?`).bind(Number(limit)).all())?.results||[];
}
async function maybeMigrateLegacyV126Parity(env){
  const done=await env.DB.prepare(`SELECT value FROM sanad_meta WHERE key='legacy_v11_parity_migrated_126'`).first();
  if(done?.value==='1')return;
  const now=nowIso();

  for(const r of await legacyRowsV126(env,'agent_settings',5000)){
    await ensureUser(env,String(r.chat_id));
    const autonomy=String(r.permission_mode||'safe_auto')==='safe_auto'?'full_safe':String(r.permission_mode||'full_safe');
    await env.DB.prepare(`UPDATE sanad_users SET autonomy_mode=?,proactive_enabled=?,morning_brief_enabled=?,evening_brief_enabled=?,morning_brief_time='08:00',evening_brief_time='21:00',ask_before_delete=?,updated_at=? WHERE chat_id=?`)
      .bind(autonomy,Number(r.proactive_enabled??1),Number(r.morning_brief_enabled??0),Number(r.evening_brief_enabled??0),Number(r.ask_before_delete??1),now,String(r.chat_id)).run();
  }

  for(const r of await legacyRowsV126(env,'smart_list_items',20000)){
    const title=normalizeText(r.title||'');if(!title)continue;
    const st=['pending','bought','unavailable','skipped'].includes(String(r.status))?String(r.status):'pending';
    const row=await env.DB.prepare(`SELECT id FROM sanad_shopping WHERE chat_id=? AND normalized=? ORDER BY id DESC LIMIT 1`).bind(String(r.chat_id),normItem(title)).first();
    if(row)await env.DB.prepare(`UPDATE sanad_shopping SET status=?,quantity=COALESCE(?,quantity),meta_json=COALESCE(NULLIF(?,''),meta_json),updated_at=? WHERE id=?`).bind(st,r.quantity??null,String(r.meta_json||''),now,Number(row.id)).run();
  }

  for(const r of await legacyRowsV126(env,'reminders',20000)){
    let row=await env.DB.prepare(`SELECT id FROM sanad_reminders WHERE chat_id=? AND title=? AND local_date=? AND local_time=? ORDER BY id LIMIT 1`).bind(String(r.chat_id),String(r.title),String(r.local_date),String(r.local_time)).first();
    if(!row){const x=await env.DB.prepare(`INSERT INTO sanad_reminders(chat_id,title,kind,local_date,local_time,timezone,duration_minutes,status,sent,advance_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?,?,?)`).bind(String(r.chat_id),String(r.title),String(r.kind||'reminder'),String(r.local_date),String(r.local_time),String(r.timezone||TZ),Number(r.duration_minutes||0),Number(r.sent||0),String(r.advance_alerts_json||'[]'),String(r.created_at||now),String(r.updated_at||now)).run();row={id:Number(x?.meta?.last_row_id||0)};}
    await legacyMapPutV126(env,r.chat_id,'reminder',r.id,row?.id);
  }

  for(const r of await legacyRowsV126(env,'schedule_rules',10000)){
    const start=String(r.start_at||now).slice(0,10);
    let row=await env.DB.prepare(`SELECT id FROM sanad_recurrences WHERE chat_id=? AND title=? AND start_date=? ORDER BY id LIMIT 1`).bind(String(r.chat_id),String(r.title),start).first();
    if(!row){const x=await env.DB.prepare(`INSERT INTO sanad_recurrences(chat_id,title,kind,rule_json,timezone,duration_minutes,start_date,end_date,max_occurrences,fired_count,active,paused_until,exceptions_json,advance_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.title),String(r.kind||'reminder'),String(r.rule_json||'{}'),String(r.timezone||TZ),Number(r.duration_minutes||0),start,r.end_at?String(r.end_at).slice(0,10):null,r.max_occurrences??null,Number(r.fired_count||0),Number(r.active??1),r.paused_until??null,String(r.exceptions_json||'[]'),String(r.advance_alerts_json||'[]'),String(r.created_at||now),String(r.updated_at||now)).run();row={id:Number(x?.meta?.last_row_id||0)};}
    await legacyMapPutV126(env,r.chat_id,'recurrence',r.id,row?.id);
  }

  for(const r of await legacyRowsV126(env,'projects',10000)){
    let row=await env.DB.prepare(`SELECT id FROM sanad_projects WHERE chat_id=? AND title=? ORDER BY id LIMIT 1`).bind(String(r.chat_id),String(r.title)).first();
    if(!row){const x=await env.DB.prepare(`INSERT INTO sanad_projects(chat_id,title,status,priority,deadline,progress,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.title),String(r.status||'active'),String(r.priority||'normal'),r.deadline??null,Number(r.progress||0),String(parseJsonV125(r.data_json,{}).notes||''),String(r.created_at||now),String(r.updated_at||now)).run();row={id:Number(x?.meta?.last_row_id||0)};}
    await legacyMapPutV126(env,r.chat_id,'project',r.id,row?.id);
  }
  for(const r of await legacyRowsV126(env,'project_tasks',20000)){
    const mapped=await legacyMapGetV126(env,r.chat_id,'project',r.project_id);if(!mapped)continue;
    let row=await env.DB.prepare(`SELECT id,project_id FROM sanad_project_tasks WHERE chat_id=? AND title=? ORDER BY id LIMIT 1`).bind(String(r.chat_id),String(r.title)).first();
    if(row){if(Number(row.project_id)!==mapped)await env.DB.prepare(`UPDATE sanad_project_tasks SET project_id=?,updated_at=? WHERE id=? AND chat_id=?`).bind(mapped,now,Number(row.id),String(r.chat_id)).run();}
    else{const x=await env.DB.prepare(`INSERT INTO sanad_project_tasks(project_id,chat_id,title,status,due_at,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(mapped,String(r.chat_id),String(r.title),String(r.status||'pending'),r.due_at??null,String(r.priority||'normal'),String(r.created_at||now),String(r.updated_at||now)).run();row={id:Number(x?.meta?.last_row_id||0),project_id:mapped};}
    await legacyMapPutV126(env,r.chat_id,'project_task',r.id,row?.id);
  }

  for(const r of await legacyRowsV126(env,'life_entities',10000)){
    const n=String(r.normalized_name||normItem(r.name));
    let row=await env.DB.prepare(`SELECT id FROM sanad_entities WHERE chat_id=? AND entity_type=? AND normalized=?`).bind(String(r.chat_id),String(r.entity_type||'concept'),n).first();
    if(!row){const x=await env.DB.prepare(`INSERT INTO sanad_entities(chat_id,entity_type,name,normalized,data_json,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.entity_type||'concept'),String(r.name),n,String(r.data_json||'{}'),Number(r.confidence??1),String(r.source||'v11_migration'),String(r.created_at||now),String(r.updated_at||now)).run();row={id:Number(x?.meta?.last_row_id||0)};}
    await legacyMapPutV126(env,r.chat_id,'entity',r.id,row?.id);
  }
  for(const r of await legacyRowsV126(env,'life_edges',20000)){
    const from=await legacyMapGetV126(env,r.chat_id,'entity',r.from_entity_id),to=r.to_entity_id==null?null:await legacyMapGetV126(env,r.chat_id,'entity',r.to_entity_id);if(!from||(r.to_entity_id!=null&&!to))continue;
    const exists=await env.DB.prepare(`SELECT id FROM sanad_edges WHERE chat_id=? AND from_entity_id=? AND relation=? AND COALESCE(to_entity_id,0)=? AND COALESCE(object_value,'')=? LIMIT 1`).bind(String(r.chat_id),from,String(r.relation),Number(to||0),String(r.object_value||'')).first();
    if(!exists)await env.DB.prepare(`INSERT INTO sanad_edges(chat_id,from_entity_id,relation,to_entity_id,object_value,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),from,String(r.relation),to||null,r.object_value??null,Number(r.confidence??1),String(r.source||'v11_migration'),String(r.created_at||now),String(r.updated_at||now)).run();
  }

  for(const r of await legacyRowsV126(env,'prayer_rules',10000)){
    let row=await env.DB.prepare(`SELECT id FROM sanad_prayer_rules WHERE chat_id=? AND prayer=? AND title=? AND start_date=? ORDER BY id LIMIT 1`).bind(String(r.chat_id),String(r.prayer),String(r.title),String(r.start_date)).first();
    if(!row){const x=await env.DB.prepare(`INSERT INTO sanad_prayer_rules(chat_id,title,prayer,offset_minutes,start_date,end_date,weekdays_json,max_occurrences,fired_count,active,paused_until,exceptions_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.title),String(r.prayer),Number(r.offset_minutes||0),String(r.start_date),r.end_date??null,String(r.weekdays_json||'[]'),r.max_occurrences??null,Number(r.fired_count||0),Number(r.active??1),r.paused_until??null,String(r.exceptions_json||'[]'),String(r.created_at||now),String(r.updated_at||now)).run();row={id:Number(x?.meta?.last_row_id||0)};}
    await legacyMapPutV126(env,r.chat_id,'prayer_rule',r.id,row?.id);
  }

  for(const r of await legacyRowsV126(env,'event_dependencies',20000)){
    const sk=String(r.source_type||'reminder').includes('rule')?'recurrence':'reminder',tk=String(r.target_type||'reminder').includes('rule')?'recurrence':'reminder';
    const sid=await legacyMapGetV126(env,r.chat_id,sk,r.source_id),tid=await legacyMapGetV126(env,r.chat_id,tk,r.target_id);if(!sid||!tid)continue;
    const rel=['after_start','after_end','before_start'].includes(String(r.relation))?String(r.relation):'after_start';
    await env.DB.prepare(`INSERT OR IGNORE INTO sanad_dependencies(chat_id,source_type,source_id,target_type,target_id,relation,offset_minutes,condition_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(String(r.chat_id),sk,sid,tk,tid,rel,Number(r.offset_minutes||0),String(r.condition_json||'{}'),Number(r.active??1),String(r.created_at||now),String(r.updated_at||now)).run();
  }

  for(const r of await legacyRowsV126(env,'life_inbox',10000)){
    const exists=await env.DB.prepare(`SELECT id FROM sanad_life_inbox WHERE chat_id=? AND text=? AND created_at=? LIMIT 1`).bind(String(r.chat_id),String(r.text),String(r.created_at||'')).first();
    if(!exists)await env.DB.prepare(`INSERT INTO sanad_life_inbox(chat_id,text,status,classified_as,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(String(r.chat_id),String(r.text),String(r.status||'open'),r.classified_as??null,String(r.created_at||now),String(r.updated_at||now)).run();
  }

  for(const r of await legacyRowsV126(env,'reminder_fires',30000)){
    const id=await legacyMapGetV126(env,r.chat_id,'reminder',r.reminder_id);if(id)await env.DB.prepare(`INSERT OR IGNORE INTO sanad_reminder_fires(reminder_id,fire_key,chat_id,sent_at) VALUES(?,?,?,?)`).bind(id,String(r.fire_key),String(r.chat_id),String(r.sent_at||now)).run();
  }
  for(const r of await legacyRowsV126(env,'schedule_fires',30000)){
    const id=await legacyMapGetV126(env,r.chat_id,'recurrence',r.rule_id);if(id)await env.DB.prepare(`INSERT OR IGNORE INTO sanad_recurrence_fires(rule_id,occurrence_key,alert_offset,chat_id,sent_at) VALUES(?,?,?,?,?)`).bind(id,String(r.occurrence_key),Number(r.alert_offset||0),String(r.chat_id),String(r.sent_at||now)).run();
  }
  for(const r of await legacyRowsV126(env,'prayer_rule_fires',30000)){
    const id=await legacyMapGetV126(env,r.chat_id,'prayer_rule',r.rule_id);if(id)await env.DB.prepare(`INSERT OR IGNORE INTO sanad_prayer_fires(rule_id,occurrence_date,chat_id,sent_at) VALUES(?,?,?,?)`).bind(id,String(r.occurrence_date),String(r.chat_id),String(r.sent_at||now)).run();
  }
  for(const r of await legacyRowsV126(env,'daily_brief_fires',10000))await env.DB.prepare(`INSERT OR IGNORE INTO sanad_daily_brief_fires(chat_id,brief_date,brief_type,sent_at) VALUES(?,?,?,?)`).bind(String(r.chat_id),String(r.brief_date),String(r.brief_type),String(r.sent_at||now)).run();

  for(const r of await legacyRowsV126(env,'action_audit',20000)){
    const op=`legacy-audit:${r.id}`;const exists=await env.DB.prepare(`SELECT id FROM sanad_audit WHERE chat_id=? AND operation_id=? LIMIT 1`).bind(String(r.chat_id),op).first();if(exists)continue;
    await env.DB.prepare(`INSERT INTO sanad_audit(operation_id,chat_id,tool,args_json,result_json,verified,created_at) VALUES(?,?,?,?,?,?,?)`).bind(op,String(r.chat_id),`legacy.${String(r.action||'action')}.${String(r.entity_type||'unknown')}`,JSON.stringify({entity_id:r.entity_id,before:parseJsonV125(r.before_json,{})}),JSON.stringify({summary:r.summary,after:parseJsonV125(r.after_json,{}),undo:parseJsonV125(r.undo_json,{}),undone_at:r.undone_at||null}),1,String(r.created_at||now)).run();
  }

  await env.DB.prepare(`INSERT INTO sanad_meta(key,value,updated_at) VALUES('legacy_v11_parity_migrated_126','1',?) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at`).bind(nowIso()).run();
}

async function snapshotUserStateV126BeforeHardening(env,chatId){
  const data={};
  for(const table of SNAPSHOT_TABLES){if(!(await tableExistsV125(env,table)))continue;data[table]=(await env.DB.prepare(`SELECT * FROM ${table} WHERE chat_id=?`).bind(String(chatId)).all())?.results||[];}
  return data;
}
async function restoreUserStateV126BeforeHardening(env,chatId,snap){
  for(const table of SNAPSHOT_TABLES){if(!(table in (snap||{}))||!(await tableExistsV125(env,table)))continue;await env.DB.prepare(`DELETE FROM ${table} WHERE chat_id=?`).bind(String(chatId)).run();const rows=Array.isArray(snap?.[table])?snap[table]:[];for(const row of rows){const cols=Object.keys(row);if(!cols.length)continue;const sql=`INSERT INTO ${table}(${cols.map(sqlQuoteNameV125).join(',')}) VALUES(${cols.map(()=>'?').join(',')})`;await env.DB.prepare(sql).bind(...cols.map(c=>row[c])).run();}}
}

async function toolShoppingRead(env,chatId){const rows=(await env.DB.prepare(`SELECT id,title,quantity,status,meta_json FROM sanad_shopping WHERE chat_id=? AND status IN ('pending','bought','unavailable','skipped') ORDER BY id`).bind(chatId).all())?.results||[];return{ok:true,changed:0,verified:true,items:rows};}
async function toolShoppingUpdate(env,chatId,args){const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:'missing_id'};const before=await env.DB.prepare(`SELECT * FROM sanad_shopping WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!before)return{ok:false,changed:0,verified:false,error:'not_found'};const title=args?.title!=null?normalizeText(args.title):before.title,quantity=args?.quantity!=null?normalizeText(args.quantity):before.quantity,status=['pending','bought','unavailable','skipped'].includes(String(args?.status))?String(args.status):String(before.status);await env.DB.prepare(`UPDATE sanad_shopping SET title=?,normalized=?,quantity=?,status=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,normItem(title),quantity,status,nowIso(),chatId,id).run();const after=await env.DB.prepare(`SELECT * FROM sanad_shopping WHERE chat_id=? AND id=?`).bind(chatId,id).first(),verified=!!after&&String(after.status)===status&&String(after.title)===String(title);return{ok:verified,changed:verified?1:0,verified,before,after};}
async function toolShoppingProgressV125(env,chatId){const r=await toolShoppingRead(env,chatId),all=r.items;const count=s=>all.filter(x=>String(x.status)===s).length,pending=count('pending'),bought=count('bought'),unavailable=count('unavailable'),skipped=count('skipped'),total=all.length;return{ok:true,changed:0,verified:true,total,pending,bought,unavailable,skipped,percent:total?Math.round(bought/total*100):0};}
async function toolShoppingQueryV126(env,chatId,args){const r=await toolShoppingRead(env,chatId),q=String(args?.query||'all'),value=normItem(args?.query_value||'');let items=r.items;if(['pending','bought','unavailable','skipped'].includes(q))items=items.filter(x=>x.status===q);if(q==='important')items=items.filter(x=>['high','important','ضروري','مهم'].includes(String(parseJsonV125(x.meta_json,{}).priority||'').toLowerCase()));if(q==='category'&&value)items=items.filter(x=>normItem(parseJsonV125(x.meta_json,{}).category||'').includes(value));const p=await toolShoppingProgressV125(env,chatId);return{ok:true,changed:0,verified:true,query:q,items,progress:p};}
async function toolShoppingMarkV126(env,chatId,args){const q=normItem(args?.query||''),status=['pending','bought','unavailable','skipped'].includes(String(args?.status))?String(args.status):'';if(!q||!status)return{ok:false,changed:0,verified:false,error:'invalid_mark'};const rows=(await toolShoppingRead(env,chatId)).items,ranked=rows.map(x=>{const n=normItem(x.title);return{x,score:n===q?1000:n.includes(q)||q.includes(n)?700:q.split(/\s+/).filter(Boolean).reduce((s,t)=>s+(n.includes(t)?t.length:0),0)}}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);if(!ranked.length)return{ok:false,changed:0,verified:false,error:'shopping_item_not_found'};const top=ranked[0].score,best=ranked.filter(x=>x.score===top);if(best.length>1)return{ok:false,changed:0,verified:false,error:'shopping_item_ambiguous',candidates:best.map(x=>({id:x.x.id,title:x.x.title}))};return toolShoppingUpdate(env,chatId,{id:Number(best[0].x.id),status});}

async function showShopping(env,chatId){const r=await toolShoppingRead(env,chatId),items=r.items;if(!items.length)return sendText(env,chatId,'🛒 قائمة المشتريات فاضية.');const icon=s=>s==='bought'?'✅':s==='unavailable'?'🚫':s==='skipped'?'⏭️':'⬜';const rows=items.slice(0,70).map(x=>[{text:`${icon(x.status)} ${String(x.title).slice(0,42)}`,callback_data:`s126:shop:toggle:${x.id}`}]);const text=`🛒 المشتريات — ${items.filter(x=>x.status==='bought').length}/${items.length} اتجابوا\n\n${items.map(x=>`${icon(x.status)} ${x.title}${x.quantity?` — ${x.quantity}`:''}`).join('\n')}`;return sendText(env,chatId,text,{inline_keyboard:rows});}

async function toolLifeInboxReadV126(env,chatId,args={}){const status=String(args?.status||'open');let sql=`SELECT * FROM sanad_life_inbox WHERE chat_id=?`,b=[chatId];if(status!=='all'){sql+=` AND status=?`;b.push(status)}sql+=` ORDER BY id DESC LIMIT 100`;const items=(await env.DB.prepare(sql).bind(...b).all())?.results||[];return{ok:true,changed:0,verified:true,items};}
async function toolLifeInboxAddV126(env,chatId,args){const text=normalizeText(args?.text);if(!text)return{ok:false,changed:0,verified:false,error:'empty_inbox_item'};const now=nowIso(),x=await env.DB.prepare(`INSERT INTO sanad_life_inbox(chat_id,text,status,classified_as,created_at,updated_at) VALUES(?,?,'open',?,?,?)`).bind(chatId,text,args?.classified_as||null,now,now).run(),id=Number(x?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_life_inbox WHERE chat_id=? AND id=?`).bind(chatId,id).first();return{ok:!!after,changed:after?1:0,verified:!!after,id,after};}
async function toolLifeInboxCloseV126(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_life_inbox SET status='closed',updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT status FROM sanad_life_inbox WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],verified=rows.length>0&&rows.every(x=>x.status==='closed');return{ok:verified,changed:rows.length,verified};}
async function toolLifeInboxClassifyV126(env,chatId,args){const id=Number(args?.id),value=normalizeText(args?.classified_as);if(!id||!value)return{ok:false,changed:0,verified:false,error:'invalid_classification'};await env.DB.prepare(`UPDATE sanad_life_inbox SET classified_as=?,updated_at=? WHERE chat_id=? AND id=?`).bind(value,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_life_inbox WHERE chat_id=? AND id=?`).bind(chatId,id).first(),v=!!a&&a.classified_as===value;return{ok:v,changed:v?1:0,verified:v,after:a};}
async function showLifeInboxV126(env,chatId){const r=await toolLifeInboxReadV126(env,chatId,{status:'open'});return sendText(env,chatId,r.items.length?`📥 صندوق الوارد:\n${r.items.map(x=>`• #${x.id} ${x.text}${x.classified_as?` — ${x.classified_as}`:''}`).join('\n')}`:'📥 صندوق الوارد فاضي.');}

async function buildContextV126BeforeHardening(env,chatId,user,userText){const c=await buildContextV125Base(env,chatId,user,userText);c.state.shopping=(await toolShoppingRead(env,chatId)).items;c.state.inbox=(await toolLifeInboxReadV126(env,chatId,{status:'open'})).items;c.state.shopping_session=await env.DB.prepare(`SELECT id,place_name,started_at FROM sanad_shopping_sessions WHERE chat_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`).bind(chatId).first();return c;}
function augmentExplicitLifeStepsV126BeforeDeps(text,steps){let out=augmentExplicitLifeStepsV125Base(text,steps);const t=normalizeText(text);const m=t.match(/(?:حط|سجل|ضيف)\s+(?:دي\s+|ده\s+)?(?:في|فى)\s+(?:الانبوكس|الإنبوكس|inbox)\s*[:：-]?\s*(.+)$/iu);if(m?.[1]&&!out.some(x=>x?.tool==='inbox.add'))out.push({tool:'inbox.add',args:{text:normalizeText(m[1])}});return out.slice(0,MAX_AGENT_STEPS);}

function normalizeRuleV125(raw){const base=normalizeRuleV125Base(raw);return{...base,shift_minutes:Math.trunc(Number(raw?.shift_minutes||0))};}
function generateRecurrenceOccurrencesV125(row,fromDate,toDate,limit=500){const raw=parseJsonV125(row?.rule_json,{}),shift=Math.trunc(Number(raw?.shift_minutes||0));if(!shift)return generateRecurrenceOccurrencesV125Base(row,fromDate,toDate,limit);const pad=Math.ceil(Math.abs(shift)/1440)+1,copy={...row,rule_json:JSON.stringify({...raw,shift_minutes:0}),exceptions_json:'[]'},base=generateRecurrenceOccurrencesV125Base(copy,addDaysV125(fromDate,-pad),addDaysV125(toDate,pad),Math.min(MAX_RECURRENCE_OCCURRENCES,Math.max(limit*4,limit+50))),exceptions=new Set(parseJsonV125(row?.exceptions_json,[]).map(String)),out=[];for(const o of base){const x=addMinutesLocal(o.date,o.time,shift),key=occurrenceKeyV125(x.date,x.time);if(x.date<fromDate||x.date>toDate||exceptions.has(x.date)||exceptions.has(key))continue;out.push({date:x.date,time:x.time,key});if(out.length>=limit)break;}return out;}
function pauseUntilIsoV126(value,user){if(value==null||value==='')return new Date(Date.now()+86400000).toISOString();const s=String(value).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(s))return new Date(zonedLocalToEpochV125(s,'23:59',user?.timezone||TZ)).toISOString();const m=s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);if(m&&validTimeV125(m[2]))return new Date(zonedLocalToEpochV125(m[1],m[2],user?.timezone||TZ)).toISOString();const ms=Date.parse(s);return Number.isFinite(ms)?new Date(ms).toISOString():null;}
async function toolRecurrencePauseV126(env,chatId,args,user){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean),until=pauseUntilIsoV126(args?.until,user);if(!ids.length||!until)return{ok:false,changed:0,verified:false,error:'invalid_pause'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_recurrences SET active=1,paused_until=?,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(until,nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT id,active,paused_until FROM sanad_recurrences WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],verified=rows.length>0&&rows.every(x=>Number(x.active)===1&&String(x.paused_until)===until);return{ok:verified,changed:rows.length,verified,until,ids};}
async function toolRecurrenceResumeV126(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_recurrences SET active=1,paused_until=NULL,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT active,paused_until FROM sanad_recurrences WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],v=rows.length>0&&rows.every(x=>Number(x.active)===1&&!x.paused_until);return{ok:v,changed:rows.length,verified:v};}
async function toolRecurrenceUpdateV125(env,chatId,args){const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:'missing_id'};const b=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const rule=args?.rule?normalizeRuleV125({...parseJsonV125(b.rule_json,{}),...args.rule}):normalizeRuleV125(parseJsonV125(b.rule_json,{})),title=args?.title!=null?normalizeText(args.title):b.title,start=validDateV125(args?.start_date)?String(args.start_date):b.start_date,end=args?.end_date===null?null:(validDateV125(args?.end_date)?String(args.end_date):b.end_date),max=args?.max_occurrences===null?null:(args?.max_occurrences!=null?clampV125(args.max_occurrences,1,MAX_RECURRENCE_OCCURRENCES):b.max_occurrences),dur=args?.duration_minutes!=null?clampV125(args.duration_minutes,0,10080):Number(b.duration_minutes||0),kind=args?.kind!=null?String(args.kind):String(b.kind||'reminder'),active=args?.active!=null?Number(args.active?1:0):Number(b.active??1),paused=args?.paused_until!==undefined?(args.paused_until?String(args.paused_until):null):b.paused_until,exceptions=Array.isArray(args?.exceptions)?args.exceptions.map(String):parseJsonV125(b.exceptions_json,[]),adv=args?.advance_minutes!==undefined?(Array.isArray(args.advance_minutes)?args.advance_minutes:[args.advance_minutes]).filter(x=>x!=null).map(x=>clampV125(x,0,MAX_ADVANCE_MINUTES)):parseJsonV125(b.advance_json,[]);await env.DB.prepare(`UPDATE sanad_recurrences SET title=?,rule_json=?,kind=?,duration_minutes=?,start_date=?,end_date=?,max_occurrences=?,active=?,paused_until=?,exceptions_json=?,advance_json=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,JSON.stringify(rule),kind,dur,start,end,max,active,paused,JSON.stringify(exceptions),JSON.stringify(adv),nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first(),v=!!a&&a.title===title&&a.start_date===start&&Number(a.active)===active;return{ok:v,changed:v?1:0,verified:v,before:b,after:a};}
async function toolScheduleShiftV126BeforePropagationGuard(env,chatId,args){const type=String(args?.source_type||'reminder');if(type!=='recurrence')return toolScheduleShiftV125Base(env,chatId,args);const id=Number(args?.id),mins=Math.trunc(Number(args?.minutes||0));if(!id||!mins)return{ok:false,changed:0,verified:false,error:'invalid_shift'};const b=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};const rule=normalizeRuleV125(parseJsonV125(b.rule_json,{})),next={...rule,shift_minutes:Number(rule.shift_minutes||0)+mins};await env.DB.prepare(`UPDATE sanad_recurrences SET rule_json=?,updated_at=? WHERE chat_id=? AND id=?`).bind(JSON.stringify(next),nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first(),v=Number(parseJsonV125(a?.rule_json,{}).shift_minutes||0)===Number(next.shift_minutes);return{ok:v,changed:v?1:0,verified:v,before:b,after:a};}

function dependencyKeyV126(type,id){return`${String(type)}:${Number(id)}`;}
function dependencyCycleV126(rows,candidate){const all=[...(rows||[]),candidate],adj=new Map();for(const d of all){const a=dependencyKeyV126(d.source_type,d.source_id),b=dependencyKeyV126(d.target_type,d.target_id);if(!adj.has(a))adj.set(a,[]);adj.get(a).push(b);}const seen=new Set(),stack=new Set();function dfs(n){if(stack.has(n))return true;if(seen.has(n))return false;seen.add(n);stack.add(n);for(const v of adj.get(n)||[])if(dfs(v))return true;stack.delete(n);return false;}for(const n of adj.keys())if(dfs(n))return true;return false;}
function epochToLocalV126(ms,tz){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz||TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return{date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};}
async function reminderNodeV126(env,chatId,id){return env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,Number(id)).first();}
function dependencyDesiredMsV126(source,relation,offset){const start=zonedLocalToEpochV125(String(source.local_date),String(source.local_time),String(source.timezone||TZ)),off=Number(offset||0)*60000;if(relation==='after_end')return start+Number(source.duration_minutes||0)*60000+off;if(relation==='before_start')return start-off;return start+off;}
async function realignDependencyV126(env,chatId,d){if(d.source_type!=='reminder'||d.target_type!=='reminder')return false;const s=await reminderNodeV126(env,chatId,d.source_id),t=await reminderNodeV126(env,chatId,d.target_id);if(!s||!t)return false;const tz=String(t.timezone||s.timezone||TZ),x=epochToLocalV126(dependencyDesiredMsV126(s,String(d.relation),Number(d.offset_minutes||0)),tz);await env.DB.prepare(`UPDATE sanad_reminders SET local_date=?,local_time=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(x.date,x.time,nowIso(),chatId,Number(d.target_id)).run();const a=await reminderNodeV126(env,chatId,d.target_id);return !!a&&a.local_date===x.date&&a.local_time===x.time;}
async function toolDependencyCreateV126BeforeHardening(env,chatId,args){const st=String(args?.source_type||'reminder'),tt=String(args?.target_type||'reminder'),sid=Number(args?.source_id),tid=Number(args?.target_id),rel=String(args?.relation||'after_start')==='after'?'after_start':String(args?.relation||'after_start');if(!sid||!tid||!['after_start','after_end','before_start'].includes(rel))return{ok:false,changed:0,verified:false,error:'invalid_dependency'};if(st===tt&&sid===tid)return{ok:false,changed:0,verified:false,error:'self_dependency'};const current=(await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND active=1`).bind(chatId).all())?.results||[],candidate={source_type:st,source_id:sid,target_type:tt,target_id:tid,relation:rel};if(dependencyCycleV126(current,candidate))return{ok:false,changed:0,verified:false,error:'dependency_cycle'};let off=Number(args?.offset_minutes);const explicit=Number.isFinite(off);if(!explicit&&st==='reminder'&&tt==='reminder'){const s=await reminderNodeV126(env,chatId,sid),t=await reminderNodeV126(env,chatId,tid);if(!s||!t)return{ok:false,changed:0,verified:false,error:'dependency_node_not_found'};const ss=zonedLocalToEpochV125(s.local_date,s.local_time,s.timezone||TZ),ts=zonedLocalToEpochV125(t.local_date,t.local_time,t.timezone||TZ);off=rel==='after_end'?Math.round((ts-(ss+Number(s.duration_minutes||0)*60000))/60000):rel==='before_start'?Math.round((ss-ts)/60000):Math.round((ts-ss)/60000);}if(!Number.isFinite(off))off=0;await env.DB.prepare(`UPDATE sanad_dependencies SET active=0,updated_at=? WHERE chat_id=? AND source_type=? AND source_id=? AND target_type=? AND target_id=?`).bind(nowIso(),chatId,st,sid,tt,tid).run();const now=nowIso(),x=await env.DB.prepare(`INSERT INTO sanad_dependencies(chat_id,source_type,source_id,target_type,target_id,relation,offset_minutes,condition_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)`).bind(chatId,st,sid,tt,tid,rel,Math.trunc(off),JSON.stringify(args?.condition||{}),now,now).run(),id=Number(x?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND id=?`).bind(chatId,id).first();let aligned=true;if(after&&explicit&&args?.realign!==false)aligned=await realignDependencyV126(env,chatId,after);return{ok:!!after&&aligned,changed:after?1:0,verified:!!after&&aligned,id,after,derived_offset:!explicit};}
async function propagateDependenciesV126BeforePropagationGuard(env,chatId,sourceType,sourceId,deltaMinutes,visited=new Set()){const key=dependencyKeyV126(sourceType,sourceId);if(visited.has(key)||visited.size>50)return;visited.add(key);const deps=(await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND source_type=? AND source_id=? AND active=1`).bind(chatId,sourceType,Number(sourceId)).all())?.results||[];for(const d of deps){const ok=await realignDependencyV126(env,chatId,d);if(ok)await propagateDependenciesV125(env,chatId,String(d.target_type),Number(d.target_id),0,visited);}}

async function toolWorldUpsertV126BeforeHardening(env,chatId,args){const confidence=Number(args?.confidence??1),source=String(args?.source||'agent_inferred');if(source!=='user_explicit'&&confidence<WORLD_MIN_CONFIDENCE_V126)return{ok:false,changed:0,verified:false,error:'low_confidence_world_fact'};return toolWorldUpsertV125Base(env,chatId,args);}
async function toolWorldLinkV126BeforeHardening(env,chatId,args){const confidence=Number(args?.confidence??1),source=String(args?.source||'agent_inferred');if(source!=='user_explicit'&&confidence<WORLD_MIN_CONFIDENCE_V126)return{ok:false,changed:0,verified:false,error:'low_confidence_world_link'};return toolWorldLinkV125Base(env,chatId,args);}

async function fetchWithTimeoutV126(url,options={},timeout=EXTERNAL_API_TIMEOUT_MS_V126){const c=new AbortController(),timer=setTimeout(()=>c.abort(),Math.max(250,Number(timeout)));try{return await fetch(url,{...options,signal:c.signal});}finally{clearTimeout(timer);}}
async function cacheGetAnyV126(env,key){const r=await env.DB.prepare(`SELECT value_json FROM sanad_cache WHERE cache_key=?`).bind(key).first();return r?parseJsonV125(r.value_json,null):null;}
async function fetchPrayerTimesV125(env,user,date){const city=String(user?.city||DEFAULT_CITY),country=String(user?.country||DEFAULT_COUNTRY),key=`prayer:${date}:${city}:${country}`,fresh=await cacheGetV125(env,key);if(fresh)return fresh;const stale=await cacheGetAnyV126(env,key);let url;if(user?.latitude!=null&&user?.longitude!=null)url=`https://api.aladhan.com/v1/timings/${date.split('-').reverse().join('-')}?latitude=${encodeURIComponent(user.latitude)}&longitude=${encodeURIComponent(user.longitude)}&method=5`;else url=`https://api.aladhan.com/v1/timingsByCity/${date.split('-').reverse().join('-')}?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=5`;try{const r=await fetchWithTimeoutV126(url,{},EXTERNAL_API_TIMEOUT_MS_V126);if(!r.ok)throw new Error(`prayer_http_${r.status}`);const x=await r.json(),t=x?.data?.timings||{},out={date,times:{Fajr:cleanPrayerTimeV125(t.Fajr),Sunrise:cleanPrayerTimeV125(t.Sunrise),Dhuhr:cleanPrayerTimeV125(t.Dhuhr),Asr:cleanPrayerTimeV125(t.Asr),Maghrib:cleanPrayerTimeV125(t.Maghrib),Isha:cleanPrayerTimeV125(t.Isha)},hijri:x?.data?.date?.hijri||null,timezone:String(x?.data?.meta?.timezone||user?.timezone||TZ)};return cacheSetV125(env,key,out,PRAYER_CACHE_MINUTES);}catch(e){if(stale)return{...stale,stale:true};throw e;}}
function hijriOccasionV126(h){if(!h)return'';const m=Number(h?.month?.number||h?.month||0),d=Number(h?.day||0);if(m===1&&d===1)return'رأس السنة الهجرية';if(m===1&&d===10)return'يوم عاشوراء';if(m===3&&d===12)return'المولد النبوي الشريف ﷺ';if(m===9)return'شهر رمضان المبارك';if(m===10&&d>=1&&d<=3)return'عيد الفطر المبارك';if(m===12&&d===9)return'يوم عرفة';if(m===12&&d>=10&&d<=13)return d===10?'عيد الأضحى المبارك':'أيام التشريق';return'';}
async function toolHijriV126(env,chatId,args,user){const date=validDateV125(args?.date)?String(args.date):localNow(user?.timezone||TZ).date,data=await fetchPrayerTimesV125(env,user,date);return{ok:true,changed:0,verified:true,date,hijri:data.hijri||null,occasion:hijriOccasionV126(data.hijri)};}
function holidayArabicV126(x){const raw=String(x?.name||x?.localName||x?.english||'').trim(),n=raw.toLowerCase();if(/prophet.*birthday|mawlid|milad.*nabi|muhammad.*birthday/.test(n))return'المولد النبوي الشريف ﷺ';if(/eid.*fitr/.test(n))return'عيد الفطر المبارك';if(/eid.*adha/.test(n))return'عيد الأضحى المبارك';if(/islamic.*new.*year|hijri.*new.*year/.test(n))return'رأس السنة الهجرية';if(/revolution.*january|25.*january/.test(n))return'عيد ثورة 25 يناير';if(/sinai.*liberation/.test(n))return'عيد تحرير سيناء';if(/labou?r.*day/.test(n))return'عيد العمال';if(/june.*30/.test(n))return'ذكرى ثورة 30 يونيو';if(/revolution.*july|23.*july/.test(n))return'عيد ثورة 23 يوليو';if(/armed.*forces|october.*6/.test(n))return'عيد القوات المسلحة';return raw||'عطلة رسمية';}
async function toolHolidaysV125(env,chatId,args,user){const year=Number(args?.year||localNow(user?.timezone||TZ).date.slice(0,4)),cc=String(args?.country_code||user?.country_code||'EG').toUpperCase(),key=`holidays:${cc}:${year}`,fresh=await cacheGetV125(env,key);let data=fresh;if(!data){const stale=await cacheGetAnyV126(env,key);try{const r=await fetchWithTimeoutV126(`https://date.nager.at/api/v4/Holidays/${encodeURIComponent(cc)}/${year}`);if(!r.ok)throw new Error(`holidays_http_${r.status}`);data=await r.json();await cacheSetV125(env,key,data,HOLIDAY_CACHE_MINUTES);}catch(e){if(stale)data=stale;else throw e;}}const items=(Array.isArray(data)?data:[]).slice(0,100).map(x=>({...x,name_ar:holidayArabicV126(x)}));return{ok:true,changed:0,verified:true,year,country_code:cc,items};}
async function toolWeatherV125(env,chatId,args,user){let lat=args?.latitude??user?.latitude,lon=args?.longitude??user?.longitude,city=normalizeText(args?.city||user?.city||DEFAULT_CITY);const key=`weather:${normItem(city)}:${lat??''}:${lon??''}`,fresh=await cacheGetV125(env,key);if(fresh)return{ok:true,changed:0,verified:true,...fresh};const stale=await cacheGetAnyV126(env,key);try{if(lat==null||lon==null){const g=await fetchWithTimeoutV126(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ar&format=json`),gx=await g.json().catch(()=>({})),first=gx?.results?.[0];if(!g.ok||!first)throw new Error('weather_location_not_found');lat=first.latitude;lon=first.longitude;city=first.name||city;}const r=await fetchWithTimeoutV126(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`);if(!r.ok)throw new Error(`weather_http_${r.status}`);const x=await r.json(),out={city,latitude:lat,longitude:lon,current:x.current,daily:x.daily,timezone:x.timezone};await cacheSetV125(env,key,out,5);return{ok:true,changed:0,verified:true,...out};}catch(e){if(stale)return{ok:true,changed:0,verified:true,...stale,stale:true};throw e;}}
async function fetchNewsV125(query,max=8){const q=normalizeText(query||'Egypt'),url=`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=${Math.min(20,Number(max||8))}&format=json&sort=HybridRel`,r=await fetchWithTimeoutV126(url);if(!r.ok)throw new Error(`news_http_${r.status}`);const x=await r.json();return(Array.isArray(x?.articles)?x.articles:[]).map(a=>({title:a.title,url:a.url,domain:a.domain,seendate:a.seendate,language:a.language})).slice(0,max);}
async function toolLiveNewsV125(env,chatId,args){const q=normalizeText(args?.query||'Egypt'),key=`news:${normItem(q)}`,fresh=await cacheGetV125(env,key);if(fresh)return{ok:true,changed:0,verified:true,query:q,items:fresh};const stale=await cacheGetAnyV126(env,key);try{const items=await fetchNewsV125(q,clampV125(args?.limit||8,1,12));await cacheSetV125(env,key,items,LIVE_CACHE_MINUTES);return{ok:true,changed:0,verified:true,query:q,items};}catch(e){if(stale)return{ok:true,changed:0,verified:true,query:q,items:stale,stale:true};throw e;}}
async function toolLiveRealityV126(env,chatId,args,user){const ln=localNow(user?.timezone||TZ),prayer=await toolPrayerTimesV125(env,chatId,{date:ln.date},user),hijri={hijri:prayer.hijri||null,occasion:hijriOccasionV126(prayer.hijri)},holidays=await toolHolidaysV125(env,chatId,{year:Number(ln.date.slice(0,4))},user),weather=await toolWeatherV125(env,chatId,{},user),near=holidays.items.filter(x=>String(x.date||'')>=ln.date).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(0,5);return{ok:true,changed:0,verified:true,now:ln,place:{city:user?.city||DEFAULT_CITY,country:user?.country||DEFAULT_COUNTRY,timezone:user?.timezone||TZ},hijri,prayer,holidays:near,weather};}
function formatPrayerV125(r){const t=r?.times||{},h=r?.hijri,htext=h?`\n☪️ ${h.day||''} ${h.month?.ar||h.month?.en||''} ${h.year||''} هـ${hijriOccasionV126(h)?` — ${hijriOccasionV126(h)}`:''}`:'';return`🕌 مواقيت الصلاة ${r?.date||''}${htext}\nالفجر ${t.Fajr||'-'} · الظهر ${t.Dhuhr||'-'} · العصر ${t.Asr||'-'} · المغرب ${t.Maghrib||'-'} · العشاء ${t.Isha||'-'}`;}
async function showLiveRealityV126(env,chatId,user){const r=await toolLiveRealityV126(env,chatId,{},user),w=r.weather?.current||{},h=r.hijri?.hijri,lines=[`🛰️ الواقع الحالي — ${r.now.date} ${r.now.time}`,`📍 ${r.place.city}, ${r.place.country} · ${r.place.timezone}`,h?`☪️ ${h.day||''} ${h.month?.ar||h.month?.en||''} ${h.year||''} هـ${r.hijri.occasion?` — ${r.hijri.occasion}`:''}`:'☪️ التاريخ الهجري غير متاح',`🕌 الفجر ${r.prayer.times?.Fajr||'-'} · الظهر ${r.prayer.times?.Dhuhr||'-'} · العصر ${r.prayer.times?.Asr||'-'} · المغرب ${r.prayer.times?.Maghrib||'-'} · العشاء ${r.prayer.times?.Isha||'-'}`,`🌤️ الحرارة ${w.temperature_2m??'-'}° · المحسوسة ${w.apparent_temperature??'-'}° · الرياح ${w.wind_speed_10m??'-'}`];if(r.holidays.length)lines.push(`🎉 أقرب العطلات: ${r.holidays.map(x=>`${x.date} ${x.name_ar}`).join('؛ ')}`);return sendText(env,chatId,lines.join('\n'));}

async function toolPrayerRulePauseV126(env,chatId,args,user){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean),until=pauseUntilIsoV126(args?.until,user);if(!ids.length||!until)return{ok:false,changed:0,verified:false,error:'invalid_pause'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_prayer_rules SET active=1,paused_until=?,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(until,nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT active,paused_until FROM sanad_prayer_rules WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],v=rows.length>0&&rows.every(x=>Number(x.active)===1&&String(x.paused_until)===until);return{ok:v,changed:rows.length,verified:v,until};}
async function toolPrayerRuleResumeV126(env,chatId,args){const ids=(Array.isArray(args?.ids)?args.ids:[args?.id]).map(Number).filter(Boolean);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_prayer_rules SET active=1,paused_until=NULL,updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT active,paused_until FROM sanad_prayer_rules WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[],v=rows.length>0&&rows.every(x=>Number(x.active)===1&&!x.paused_until);return{ok:v,changed:rows.length,verified:v};}

async function toolReminderCreateV126BeforeHardening(env,chatId,args,user){const r=await toolReminderCreateV125Base(env,chatId,args,user);if(!r.ok&&r.error==='schedule_conflict'){const now=nowIso(),exp=new Date(Date.now()+CONFIRM_TTL_MINUTES*60000).toISOString();await env.DB.prepare(`INSERT INTO sanad_pending_conflicts(chat_id,tool,args_json,conflicts_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET tool=excluded.tool,args_json=excluded.args_json,conflicts_json=excluded.conflicts_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(chatId,'reminders.create',JSON.stringify(args),JSON.stringify(r.conflicts||[]),exp,now,now).run();}else if(r.ok)await env.DB.prepare(`DELETE FROM sanad_pending_conflicts WHERE chat_id=?`).bind(chatId).run();return r;}

async function sendTextV126BeforeCiMute(env,chatId,text,reply_markup){if(!reply_markup){const pending=await env.DB.prepare(`SELECT 1 x FROM sanad_pending_actions WHERE chat_id=? AND expires_at>?`).bind(String(chatId),nowIso()).first();if(pending)reply_markup={inline_keyboard:[[{text:'✅ نفّذ',callback_data:'s126:confirm:yes'},{text:'❌ إلغاء',callback_data:'s126:confirm:no'}]]};else{const c=await env.DB.prepare(`SELECT 1 x FROM sanad_pending_conflicts WHERE chat_id=? AND expires_at>?`).bind(String(chatId),nowIso()).first();if(c&&/schedule_conflict|تعارض|الخطة ما اكتملتش/u.test(String(text)))reply_markup={inline_keyboard:[[{text:'⚠️ نفّذ رغم التعارض',callback_data:'s126:conflict:force'},{text:'❌ إلغاء',callback_data:'s126:conflict:cancel'}]]};}}return sendTextV125Base(env,chatId,text,reply_markup);}
async function sendOnceV126BeforeHardening(env,chatId,key,text){let kb=null;const m=String(key).match(/^rem:(\d+):/);if(m)kb={inline_keyboard:[[{text:'✅ تم',callback_data:`s126:rem:done:${m[1]}`},{text:'⏰ +10 د',callback_data:`s126:rem:snooze:${m[1]}:10`},{text:'🕐 +1 س',callback_data:`s126:rem:snooze:${m[1]}:60`}]]};const done=await env.DB.prepare(`SELECT 1 x FROM sanad_proactive_fires WHERE chat_id=? AND fire_key=?`).bind(String(chatId),String(key)).first();if(done)return false;await sendText(env,String(chatId),text,kb);await env.DB.prepare(`INSERT OR IGNORE INTO sanad_proactive_fires(chat_id,fire_key,sent_at) VALUES(?,?,?)`).bind(String(chatId),String(key),nowIso()).run();return true;}

async function showRecurrencesV125(env,chatId){const r=await toolRecurrenceReadV125(env,chatId,{active_only:false});if(!r.items.length)return sendText(env,chatId,'🔁 مفيش تكرارات.');const rows=[];for(const x of r.items.slice(0,20)){const paused=x.paused_until&&String(x.paused_until)>nowIso(),status=!Number(x.active)?'⏹️':paused?'⏸️':'🟢';rows.push([{text:Number(x.active)?'⏹️ إيقاف':'▶️ تشغيل',callback_data:`s126:rec:toggle:${x.id}`},{text:'⏭️ تخطي',callback_data:`s126:rec:skip:${x.id}`},{text:paused?'▶️ استكمال':'⏸️ يوم',callback_data:paused?`s126:rec:resume:${x.id}`:`s126:rec:pause1d:${x.id}`}]);x._status=status;}return sendText(env,chatId,`🔁 التكرارات:\n${r.items.slice(0,20).map(x=>`${x._status||'🟢'} #${x.id} ${x.title} — كل ${x.rule.every} ${x.rule.unit}`).join('\n')}`,{inline_keyboard:rows});}
async function showPrayerPanelV126(env,chatId,user){const t=await toolPrayerTimesV125(env,chatId,{},user),rules=(await toolPrayerRulesReadV125(env,chatId)).items,rows=[];for(const x of rules.slice(0,15))rows.push([{text:Number(x.active)?'⏹️':'▶️',callback_data:`s126:prayer:toggle:${x.id}`},{text:'⏭️ اليوم',callback_data:`s126:prayer:skip:${x.id}`},{text:'🗑️',callback_data:`s126:prayer:delete:${x.id}`}]);const extra=rules.length?`\n\nقواعد الصلاة:\n${rules.slice(0,15).map(x=>`• #${x.id} ${x.title} (${x.offset_minutes>=0?'+':''}${x.offset_minutes} د)`).join('\n')}`:'';return sendText(env,chatId,formatPrayerV125(t)+extra,rows.length?{inline_keyboard:rows}:undefined);}
async function showSettingsV126BeforeRestoredPanels(env,chatId){const r=await toolSettingsReadV125(env,chatId),s=r.settings;return sendText(env,chatId,`⚙️ إعدادات سند\nالمبادرة: ${Number(s.proactive_enabled)?'شغالة':'مقفولة'}\nملخص الصبح: ${Number(s.morning_brief_enabled)?s.morning_brief_time:'مقفول'}\nملخص المساء: ${Number(s.evening_brief_enabled)?s.evening_brief_time:'مقفول'}\nالتأكيد قبل الحذف: ${Number(s.ask_before_delete)?'نعم':'لا'}\nالتفكير العميق: ${s.deep_reasoning_mode}`,{inline_keyboard:[[{text:'🔔 المبادرة',callback_data:'s126:setting:proactive_enabled'},{text:'☀️ ملخص الصبح',callback_data:'s126:setting:morning_brief_enabled'}],[{text:'🌙 ملخص المساء',callback_data:'s126:setting:evening_brief_enabled'},{text:'🛡️ تأكيد الحذف',callback_data:'s126:setting:ask_before_delete'}]]});}
async function showTomorrowV126(env,chatId,user){const d=addDaysV125(localNow(user?.timezone||TZ).date,1),rows=await getScheduleOccurrencesV125(env,chatId,d,d);return sendText(env,chatId,rows.length?`📅 بكرة:\n${rows.map(x=>`• ${x.time} — ${x.title}`).join('\n')}`:'📅 بكرة فاضي في الجدول.');}
async function showAllScheduleV126(env,chatId,user){const d=localNow(user?.timezone||TZ).date,rows=await getScheduleOccurrencesV125(env,chatId,d,addDaysV125(d,180));return sendText(env,chatId,rows.length?`📅 كل القادم:\n${rows.slice(0,100).map(x=>`• ${x.date} ${x.time} — ${x.title}`).join('\n')}`:'📅 مفيش مواعيد جاية مسجلة.');}

async function handleCallbackV126BeforeRestoredPanels(env,q){const chatId=String(q?.message?.chat?.id??q?.from?.id??'');try{await telegramApi(env,'answerCallbackQuery',{callback_query_id:q.id});}catch{}const data=String(q?.data||'');if(!chatId)return;
  let m=data.match(/^s126:shop:toggle:(\d+)$/);if(m){const row=await env.DB.prepare(`SELECT status FROM sanad_shopping WHERE chat_id=? AND id=?`).bind(chatId,Number(m[1])).first();if(row)await toolShoppingUpdate(env,chatId,{id:Number(m[1]),status:row.status==='bought'?'pending':row.status==='pending'?'bought':'pending'});return showShopping(env,chatId);}
  m=data.match(/^s126:rem:done:(\d+)$/);if(m){await env.DB.prepare(`UPDATE sanad_reminders SET status='done',updated_at=? WHERE chat_id=? AND id=?`).bind(nowIso(),chatId,Number(m[1])).run();return sendText(env,chatId,'✅ تمام، علّمت التذكير تم.');}
  m=data.match(/^s126:rem:snooze:(\d+):(10|60)$/);if(m){const r=await toolReminderSnoozeV125(env,chatId,{id:Number(m[1]),minutes:Number(m[2])});return sendText(env,chatId,r.ok?`⏰ أجلته ${m[2]} دقيقة.`:'مقدرتش أأجل التذكير.');}
  m=data.match(/^s126:rec:toggle:(\d+)$/);if(m){const row=await env.DB.prepare(`SELECT active FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,Number(m[1])).first();if(row)await setRecurrenceActiveV125(env,chatId,{ids:[Number(m[1])]},!Number(row.active));return showRecurrencesV125(env,chatId);}
  m=data.match(/^s126:rec:pause1d:(\d+)$/);if(m){await toolRecurrencePauseV126(env,chatId,{ids:[Number(m[1])],until:new Date(Date.now()+86400000).toISOString()},await ensureUser(env,chatId));return showRecurrencesV125(env,chatId);}
  m=data.match(/^s126:rec:resume:(\d+)$/);if(m){await toolRecurrenceResumeV126(env,chatId,{ids:[Number(m[1])]});return showRecurrencesV125(env,chatId);}
  m=data.match(/^s126:rec:skip:(\d+)$/);if(m){const id=Number(m[1]),u=await ensureUser(env,chatId),ln=localNow(u.timezone||TZ),row=await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND id=?`).bind(chatId,id).first(),occ=row?generateRecurrenceOccurrencesV125(row,ln.date,addDaysV125(ln.date,366),20):[],next=occ.find(x=>`${x.date} ${x.time}`>=`${ln.date} ${ln.time}`);if(next)await toolRecurrenceSkipV125(env,chatId,{id,date:next.date,time:next.time});return showRecurrencesV125(env,chatId);}
  m=data.match(/^s126:prayer:toggle:(\d+)$/);if(m){const row=await env.DB.prepare(`SELECT active FROM sanad_prayer_rules WHERE chat_id=? AND id=?`).bind(chatId,Number(m[1])).first();if(row)await env.DB.prepare(`UPDATE sanad_prayer_rules SET active=?,updated_at=? WHERE chat_id=? AND id=?`).bind(Number(row.active)?0:1,nowIso(),chatId,Number(m[1])).run();return showPrayerPanelV126(env,chatId,await ensureUser(env,chatId));}
  m=data.match(/^s126:prayer:skip:(\d+)$/);if(m){const u=await ensureUser(env,chatId);await toolPrayerRuleSkipV125(env,chatId,{id:Number(m[1]),date:localNow(u.timezone||TZ).date});return showPrayerPanelV126(env,chatId,u);}
  m=data.match(/^s126:prayer:delete:(\d+)$/);if(m){await toolPrayerRuleCancelV125(env,chatId,{ids:[Number(m[1])]});return showPrayerPanelV126(env,chatId,await ensureUser(env,chatId));}
  m=data.match(/^s126:setting:(proactive_enabled|morning_brief_enabled|evening_brief_enabled|ask_before_delete)$/);if(m){const u=await ensureUser(env,chatId),key=m[1],v=Number(u?.[key]||0)?0:1;await toolSettingsUpdateV125(env,chatId,{[key]:v});return showSettingsV126(env,chatId);}
  if(data==='s126:confirm:no'){await clearPendingActionV125(env,chatId);return sendText(env,chatId,'تمام، لغيت العملية.');}
  if(data==='s126:confirm:yes'){const p=await getPendingActionV125(env,chatId);if(!p)return sendText(env,chatId,'التأكيد انتهت صلاحيته.');const answer=await runAgent(env,{chatId,text:'أيوه',user:await ensureUser(env,chatId),operationId:`callback:${chatId}:${q.id}`});return sendText(env,chatId,answer);}
  if(data==='s126:conflict:cancel'){await env.DB.prepare(`DELETE FROM sanad_pending_conflicts WHERE chat_id=?`).bind(chatId).run();return sendText(env,chatId,'تمام، لغيت الموعد المتعارض.');}
  if(data==='s126:conflict:force'){const p=await env.DB.prepare(`SELECT * FROM sanad_pending_conflicts WHERE chat_id=? AND expires_at>?`).bind(chatId,nowIso()).first();if(!p)return sendText(env,chatId,'قرار التعارض انتهت صلاحيته.');const args={...parseJsonV125(p.args_json,{}),allow_conflict:true},result=await executeTool(env,{chatId,operationId:`conflict:${chatId}:${q.id}`,stepKey:'force',tool:'reminders.create',args,user:await ensureUser(env,chatId)});await env.DB.prepare(`DELETE FROM sanad_pending_conflicts WHERE chat_id=?`).bind(chatId).run();return sendText(env,chatId,result.ok?'✅ نفذت الموعد رغم التعارض واتأكدت إنه اتحفظ.':'مقدرتش أنفذ الموعد.');}
  return handleCallbackV125Base(env,q);
}

function fastCasualReplyV126(text){const t=normItem(text);if(/^(?:ازيك|إزيك|عامل ايه|عامل اي|اخبارك|أخبارك)$/u.test(t))return'تمام يا صاحبي 😄 قولّي عاوزني أظبطلك إيه؟';if(/^(?:صباح الخير|صباح الفل|صباح النور)$/u.test(t))return'صباح الفل عليك 🌞';if(/^(?:مساء الخير|مساء الفل|مساء النور)$/u.test(t))return'مساء الفل عليك 🌙';if(/^(?:السلام عليكم|سلام عليكم)$/u.test(t))return'وعليكم السلام ورحمة الله وبركاته ❤️';if(/^(?:شكرا|شكراً|تسلم|حبيبي|تمام شكرا)$/u.test(t))return'حبيبي ❤️';if(/^(?:اهلا|أهلا|هاي|هلا)$/u.test(t))return'أهلاً بيك 👋';return'';}

async function recordModelAttemptV126BeforeHardening(env,id,{ok,latency,error}){try{await env.DB.prepare(`INSERT INTO sanad_model_stats(model_id,attempts,successes,failures,total_latency_ms,last_latency_ms,last_error,updated_at) VALUES(?,1,?,?,?,?,?,?) ON CONFLICT(model_id) DO UPDATE SET attempts=attempts+1,successes=successes+excluded.successes,failures=failures+excluded.failures,total_latency_ms=total_latency_ms+excluded.total_latency_ms,last_latency_ms=excluded.last_latency_ms,last_error=excluded.last_error,updated_at=excluded.updated_at`).bind(id,ok?1:0,ok?0:1,Number(latency||0),Number(latency||0),error?String(error).slice(0,500):null,nowIso()).run();}catch{}}
async function callModels(env,messages,deadline,opts={}){const failures=[];for(const model of MODEL_CHAIN){const remaining=deadline-Date.now();if(remaining<500)break;const timeout=Math.min(AI_CALL_TIMEOUT_MS,model.timeoutMs,remaining),started=Date.now(),c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);try{const body={model:model.id,messages,max_tokens:opts.max_tokens||1200,temperature:opts.json?0.15:0.45,stream:false};if(opts.json)body.response_format={type:'json_object'};const req=new Request(OMNIAI_INTERNAL_URL,{method:'POST',headers:{Authorization:`Bearer ${env.OMNIAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body),signal:c.signal}),r=env.OMNIAI_SERVICE?await env.OMNIAI_SERVICE.fetch(req):await fetch(req),raw=await r.text();let x;try{x=JSON.parse(raw)}catch{x=null}const text=String(x?.choices?.[0]?.message?.content??x?.output_text??x?.text??'').trim(),latency=Date.now()-started;if(r.ok&&text){await recordModelAttemptV126(env,model.id,{ok:true,latency,error:null});return text;}const err=`HTTP ${r.status}`;await recordModelAttemptV126(env,model.id,{ok:false,latency,error:err});failures.push(`${model.id}:${r.status}`);}catch(e){const latency=Date.now()-started;await recordModelAttemptV126(env,model.id,{ok:false,latency,error:safeError(e)});failures.push(`${model.id}:${safeError(e)}`);}finally{clearTimeout(timer)}}throw new Error(`AI unavailable: ${failures.join(' | ')}`);}

async function transcribeVoice(env,voice){const fileId=String(voice?.file_id||'');if(!fileId)throw new Error('voice_file_missing');if(Number(voice?.file_size||0)>VOICE_MAX_BYTES)throw new Error('voice_too_large');const deadline=Date.now()+VOICE_TOTAL_BUDGET_MS_V126,remaining=(cap)=>Math.max(250,Math.min(cap,deadline-Date.now()));const infoRes=await fetchWithTimeoutV126(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file_id:fileId})},remaining(VOICE_FILE_TIMEOUT_MS_V126)),info=await infoRes.json().catch(()=>null),path=info?.result?.file_path;if(!infoRes.ok||!path)throw new Error('voice_path_missing');const fileRes=await fetchWithTimeoutV126(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`,{},remaining(VOICE_FILE_TIMEOUT_MS_V126));if(!fileRes.ok)throw new Error('voice_download_failed');const blob=await fileRes.blob();if(blob.size>VOICE_MAX_BYTES)throw new Error('voice_too_large');const makeForm=model=>{const f=new FormData();f.append('file',blob,'voice.ogg');f.append('model',String(model));f.append('language','ar');f.append('response_format','json');return f;};if(env.OMNIAI_SERVICE&&env.OMNIAI_API_KEY&&Date.now()<deadline-500){const c=new AbortController(),timer=setTimeout(()=>c.abort(),remaining(VOICE_STT_TIMEOUT_MS_V126));try{const req=new Request(OMNIAI_INTERNAL_URL.replace(/\/chat\/completions$/,'/audio/transcriptions'),{method:'POST',headers:{Authorization:`Bearer ${env.OMNIAI_API_KEY}`},body:makeForm(env.VOICE_MODEL||'auto'),signal:c.signal}),rr=await env.OMNIAI_SERVICE.fetch(req),x=await rr.json().catch(()=>null),text=normalizeText(x?.text||x?.transcript||'');if(rr.ok&&text)return text;}catch(e){await reportFailure(env,null,'voice_omniai_fallback',e,{file_id:fileId});}finally{clearTimeout(timer)}}if(env.GROQ_API_KEY&&Date.now()<deadline-300){const rr=await fetchWithTimeoutV126('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`},body:makeForm('whisper-large-v3-turbo')},remaining(VOICE_STT_TIMEOUT_MS_V126)),x=await rr.json().catch(()=>null),text=normalizeText(x?.text||x?.transcript||'');if(rr.ok&&text)return text;}throw new Error(Date.now()>=deadline?'voice_timeout':'voice_transcription_unavailable');}

async function toolSystemClearAllV126BeforeHardening(env,chatId){const before=await snapshotUserStateV125(env,chatId);let changed=0;for(const t of CLEAR_USER_TABLES_V126){if(!(await tableExistsV125(env,t)))continue;const cols=await columnsV125(env,t);if(!cols.some(x=>String(x.name)==='chat_id'))continue;const r=await env.DB.prepare(`DELETE FROM ${t} WHERE chat_id=?`).bind(String(chatId)).run();changed+=Number(r?.meta?.changes||0);}for(const t of LEGACY_CLEAR_TABLES_V126){if(!(await tableExistsV125(env,t)))continue;const cols=await columnsV125(env,t);if(!cols.some(x=>String(x.name)==='chat_id'))continue;await env.DB.prepare(`DELETE FROM ${t} WHERE chat_id=?`).bind(String(chatId)).run();}let left=0;for(const t of SNAPSHOT_TABLES_V126){if(!(await tableExistsV125(env,t)))continue;const n=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM ${t} WHERE chat_id=?`).bind(String(chatId)).first())?.c||0);left+=n;}return{ok:left===0,changed,verified:left===0,before_counts:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,Array.isArray(v)?v.length:0])),remaining:left,preserved_execution_ledgers:['sanad_inbox','sanad_updates','sanad_receipts','sanad_operation_snapshots']};}

async function dispatchToolV126BeforeDeps(env,chatId,tool,args,user){switch(tool){case'shopping.query':return toolShoppingQueryV126(env,chatId,args);case'shopping.mark':return toolShoppingMarkV126(env,chatId,args);case'inbox.read':return toolLifeInboxReadV126(env,chatId,args);case'inbox.add':return toolLifeInboxAddV126(env,chatId,args);case'inbox.close':return toolLifeInboxCloseV126(env,chatId,args);case'inbox.classify':return toolLifeInboxClassifyV126(env,chatId,args);case'calendar.hijri':return toolHijriV126(env,chatId,args,user);case'live.reality':return toolLiveRealityV126(env,chatId,args,user);case'recurrence.pause':return toolRecurrencePauseV126(env,chatId,args,user);case'recurrence.resume':return toolRecurrenceResumeV126(env,chatId,args);case'prayer.rules.pause':return toolPrayerRulePauseV126(env,chatId,args,user);case'prayer.rules.resume':return toolPrayerRuleResumeV126(env,chatId,args);default:return dispatchToolV125Base(env,chatId,tool,args,user);}}

async function diagnosticsV126(request,env){if(!env.SETUP_KEY||!secureEq(adminKey(request),env.SETUP_KEY))return j({ok:false,error:'Unauthorized'},401);await ensureSchema(env);const [models,failures,inbox]=await Promise.all([env.DB.prepare(`SELECT model_id,attempts,successes,failures,last_latency_ms,last_error,updated_at FROM sanad_model_stats ORDER BY model_id`).all().then(x=>x?.results||[]),env.DB.prepare(`SELECT scope,error_text,created_at FROM sanad_failures ORDER BY id DESC LIMIT 30`).all().then(x=>x?.results||[]),env.DB.prepare(`SELECT status,COUNT(*) c FROM sanad_inbox GROUP BY status`).all().then(x=>x?.results||[])]);return j({ok:true,version:VERSION,parity:'ultimate',tools:Object.keys(TOOL_SPECS).length,snapshot_tables:SNAPSHOT_TABLES.length,models,failures,inbox});}
async function health(env){const r=await healthV125Base(env),x=await r.json();return j({...x,version:VERSION,ultimate_parity:true,tools:Object.keys(TOOL_SPECS).length,voice_hardened:true,diagnostics:true,snapshot_tables:SNAPSHOT_TABLES.length},r.status);}


/* ================= SANAD V12.7 PARITY LAYER 2 ================= */
async function toolReminderUpdateV126BeforePropagationGuard(env,chatId,args){
  const r=await toolReminderUpdateV125Base(env,chatId,args);
  if(r?.ok&&r?.verified&&Number(args?.id))await propagateDependenciesV125(env,chatId,'reminder',Number(args.id),0);
  return r;
}

async function showMenuV126BeforeRestoredPanels(env,chatId){
  return sendText(env,chatId,`🤝 سند V12.7 Ultimate Parity\n\n📅 /today النهاردة · /tomorrow بكرة · /week الأسبوع · /month الشهر · /list كل القادم\n🔁 /recurring التكرارات · 🛒 /shopping المشتريات\n🎯 /projects المشاريع · ⏳ /waiting المتابعات · 📥 /inbox صندوق الوارد\n🧠 /memory الذاكرة · 🕌 /prayer الصلاة · 🛰️ /live الواقع الحالي\n📍 /where الموقع · ⚙️ /settings الإعدادات · 🧾 /audit السجل · ↩️ /undo تراجع\n\nأو سيب الأوامر خالص واتكلم معايا بطبيعتك.`);
}


/* ================= SANAD V12.7 PARITY LAYER 3 ================= */
Object.assign(TOOL_SPECS, {
  'dependency.link_by_title':{mutation:true,args:{source_query:'string',target_query:'string',relation:'after_start|after_end|before_start',offset_minutes:'number?',realign:'boolean?'}}
});

function arabicOffsetMinutesV126(value){
  const s=digitsAsciiV125(normalizeText(value||'')).toLowerCase();
  if(!s)return 0;
  if(/نص\s*(?:ساعة|ساعه)/u.test(s))return 30;
  if(/ربع\s*(?:ساعة|ساعه)/u.test(s))return 15;
  if(/(?:تلت|ثلث)\s*(?:ساعة|ساعه)/u.test(s))return 20;
  if(/(?:ساعتين|ساعتان)/u.test(s))return 120;
  let m=s.match(/(\d+)\s*(?:دقيقة|دقيقه|دقايق|دقائق)/u);if(m)return Math.max(0,Math.min(10080,Number(m[1])));
  m=s.match(/(\d+)\s*(?:ساعة|ساعه|ساعات)/u);if(m)return Math.max(0,Math.min(168,Number(m[1])))*60;
  return 0;
}
function splitDependencySourceOffsetV126(value){
  const s=normalizeText(value||'').trim();
  const m=s.match(/^(.*?)(?:\s+ب(?:ـ)?\s*(نص\s*(?:ساعة|ساعه)|ربع\s*(?:ساعة|ساعه)|(?:تلت|ثلث)\s*(?:ساعة|ساعه)|ساعتين|ساعتان|\d+\s*(?:دقيقة|دقيقه|دقايق|دقائق|ساعة|ساعه|ساعات)))\s*$/u);
  if(!m)return{source:s,offset_minutes:0};
  return{source:normalizeText(m[1]),offset_minutes:arabicOffsetMinutesV126(m[2])};
}
function explicitDependencyByTitleV126(text){
  const t=normalizeText(text||'').replace(/^\s+|\s+$/g,'');
  const defs=[
    {relation:'after_end',re:/^(?:خلي|خلّي)\s+(.+?)\s+بعد\s+(?:نهاية|نهايه)\s+(.+)$/u},
    {relation:'after_start',re:/^(?:خلي|خلّي)\s+(.+?)\s+بعد\s+(?:بداية|بدايه)\s+(.+)$/u},
    {relation:'before_start',re:/^(?:خلي|خلّي)\s+(.+?)\s+قبل\s+(?:بداية|بدايه)\s+(.+)$/u}
  ];
  for(const d of defs){
    const m=t.match(d.re);if(!m)continue;
    const target=normalizeText(m[1]),tail=splitDependencySourceOffsetV126(m[2]);
    if(target&&tail.source)return{source_query:tail.source,target_query:target,relation:d.relation,offset_minutes:tail.offset_minutes,realign:true};
  }
  return null;
}
function augmentExplicitLifeStepsV125(text,steps){
  let out=augmentExplicitLifeStepsV126BeforeDeps(text,steps);
  const d=explicitDependencyByTitleV126(text);
  if(d){
    // Explicit relationship wording is authoritative. Never keep a model-generated
    // dependency.create/link_by_title that can silently reverse source and target.
    out=out.filter(x=>x?.tool!=='dependency.create'&&x?.tool!=='dependency.link_by_title');
    const step={tool:'dependency.link_by_title',args:d,why:'explicit schedule dependency'};
    if(out.length<MAX_AGENT_STEPS)out.push(step);
    else {const i=out.findIndex(x=>!TOOL_SPECS[String(x?.tool||'')]?.mutation);if(i>=0)out[i]=step;else out[out.length-1]=step;}
  }
  return out.slice(0,MAX_AGENT_STEPS);
}
function dependencyTitleScoreV126(title,query){
  const a=normItem(title),b=normItem(query);if(!a||!b)return 0;if(a===b)return 1000;if(a.includes(b)||b.includes(a))return 700+Math.min(a.length,b.length);
  const bt=b.split(/\s+/).filter(Boolean),at=new Set(a.split(/\s+/).filter(Boolean)),hits=bt.filter(x=>at.has(x)).length;return hits?Math.round(500*hits/Math.max(1,bt.length)):0;
}
async function resolveDependencyReminderByTitleV126(env,chatId,query){
  const rows=(await env.DB.prepare(`SELECT id,title,local_date,local_time,duration_minutes,timezone FROM sanad_reminders WHERE chat_id=? AND status='active' ORDER BY local_date DESC,local_time DESC,id DESC LIMIT 150`).bind(chatId).all())?.results||[];
  const ranked=rows.map(r=>({r,score:dependencyTitleScoreV126(r.title,query)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||Number(b.r.id)-Number(a.r.id));
  if(!ranked.length)return{ok:false,error:'dependency_node_not_found',query};
  if(ranked.length>1&&ranked[0].score===ranked[1].score&&normItem(ranked[0].r.title)!==normItem(ranked[1].r.title))return{ok:false,error:'dependency_node_ambiguous',query,candidates:ranked.slice(0,5).map(x=>({id:x.r.id,title:x.r.title,score:x.score}))};
  return{ok:true,row:ranked[0].r};
}
async function toolDependencyLinkByTitleV126(env,chatId,args){
  const source=await resolveDependencyReminderByTitleV126(env,chatId,args?.source_query),target=await resolveDependencyReminderByTitleV126(env,chatId,args?.target_query);
  if(!source.ok)return{ok:false,changed:0,verified:false,error:source.error,source};
  if(!target.ok)return{ok:false,changed:0,verified:false,error:target.error,target};
  const result=await toolDependencyCreateV125(env,chatId,{source_type:'reminder',source_id:Number(source.row.id),target_type:'reminder',target_id:Number(target.row.id),relation:String(args?.relation||'after_start'),offset_minutes:Number(args?.offset_minutes||0),realign:args?.realign!==false});
  return{...result,source:{id:source.row.id,title:source.row.title},target:{id:target.row.id,title:target.row.title}};
}
async function dispatchTool(env,chatId,tool,args,user){
  if(tool==='dependency.link_by_title')return toolDependencyLinkByTitleV126(env,chatId,args);
  return dispatchToolV126BeforeDeps(env,chatId,tool,args,user);
}


/* ================= SANAD V12.7 PARITY LAYER 4 ================= */
async function propagateDependenciesV125(env,chatId,sourceType,sourceId,deltaMinutes,visited=new Set()){
  const key=dependencyKeyV126(sourceType,sourceId);
  if(visited.has(key))return{ok:true,changed:0,cycle_cut:true};
  if(visited.size>50)throw new Error('dependency_depth_exceeded');
  visited.add(key);
  const deps=(await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND source_type=? AND source_id=? AND active=1 ORDER BY id`).bind(chatId,String(sourceType),Number(sourceId)).all())?.results||[];
  let changed=0;
  for(const d of deps){
    const ok=await realignDependencyV126(env,chatId,d);
    if(!ok)throw new Error(`dependency_realign_failed:${d.id}`);
    changed++;
    const child=await propagateDependenciesV125(env,chatId,String(d.target_type),Number(d.target_id),0,visited);
    changed+=Number(child?.changed||0);
  }
  return{ok:true,changed};
}

async function toolScheduleShiftV125(env,chatId,args){
  const type=String(args?.source_type||'reminder'),id=Number(args?.id),mins=Math.trunc(Number(args?.minutes||0));
  if(type==='recurrence')return toolScheduleShiftV126BeforePropagationGuard(env,chatId,args);
  if(type!=='reminder'||!id||!mins)return{ok:false,changed:0,verified:false,error:'invalid_shift'};
  const before=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();
  if(!before)return{ok:false,changed:0,verified:false,error:'not_found'};
  const nx=addMinutesLocal(String(before.local_date),String(before.local_time),mins);
  await env.DB.prepare(`UPDATE sanad_reminders SET local_date=?,local_time=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(nx.date,nx.time,nowIso(),chatId,id).run();
  const after=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();
  const verified=!!after&&after.local_date===nx.date&&after.local_time===nx.time;
  if(!verified)return{ok:false,changed:0,verified:false,error:'shift_verification_failed',before,after};
  const propagated=await propagateDependenciesV125(env,chatId,'reminder',id,mins);
  return{ok:true,changed:1+Number(propagated?.changed||0),verified:true,before,after,dependencies_verified:true,dependency_changes:Number(propagated?.changed||0)};
}

async function toolReminderUpdateV126BeforeHardening(env,chatId,args){
  const id=Number(args?.id);
  if(!id)return{ok:false,changed:0,verified:false,error:'missing_id'};
  const before=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();
  if(!before)return{ok:false,changed:0,verified:false,error:'not_found'};
  const result=await toolReminderUpdateV126BeforePropagationGuard(env,chatId,args);
  if(!result?.ok||result?.verified!==true)return result;
  const after=result.after||await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();
  const temporalChanged=!!after&&(String(before.local_date)!==String(after.local_date)||String(before.local_time)!==String(after.local_time)||Number(before.duration_minutes||0)!==Number(after.duration_minutes||0));
  let dependencyChanges=0;
  if(temporalChanged){
    const oldMs=zonedLocalToEpochV125(String(before.local_date),String(before.local_time),String(before.timezone||TZ));
    const newMs=zonedLocalToEpochV125(String(after.local_date),String(after.local_time),String(after.timezone||before.timezone||TZ));
    const delta=Math.round((newMs-oldMs)/60000);
    const propagated=await propagateDependenciesV125(env,chatId,'reminder',id,delta);
    dependencyChanges=Number(propagated?.changed||0);
  }
  return{...result,dependencies_verified:true,dependency_changes:dependencyChanges};
}


/* ================= SANAD V12.7 PARITY LAYER 5 ================= */
async function ciTelegramMutedV126(env){
  try{
    const r=await env.DB.prepare(`SELECT value FROM sanad_meta WHERE key='ci_silent_telegram'`).first();
    return String(r?.value||'')==='1';
  }catch{return false;}
}

async function sendText(env,chatId,text,reply_markup){
  if(await ciTelegramMutedV126(env))return{ok:true,silent:true,ci:true};
  return sendTextV126BeforeCiMute(env,chatId,text,reply_markup);
}


/* ================= SANAD V12.7 RESTORED V11 MENU LAYER 6 ================= */
function mainMenuKeyboardV126(){
  return {inline_keyboard:[
    [{text:'📅 المواعيد',callback_data:'s126:panel:schedule'},{text:'🔁 التكرارات',callback_data:'s126:open:recurring'}],
    [{text:'🛒 المشتريات',callback_data:'s126:open:shopping'},{text:'🎯 المشاريع',callback_data:'s126:open:projects'}],
    [{text:'⏳ المتابعات',callback_data:'s126:open:waiting'},{text:'📥 صندوق الوارد',callback_data:'s126:open:inbox'}],
    [{text:'🧠 الذاكرة',callback_data:'s126:open:memory'},{text:'🕌 الصلاة',callback_data:'s126:open:prayer'}],
    [{text:'🛰️ الواقع الحالي',callback_data:'s126:open:live'},{text:'📍 موقعي',callback_data:'s126:open:where'}],
    [{text:'⚙️ الإعدادات',callback_data:'s126:panel:settings'},{text:'🛡️ إدارة البيانات',callback_data:'s126:panel:data'}],
    [{text:'🧾 سجل التغييرات',callback_data:'s126:open:audit'},{text:'↩️ تراجع',callback_data:'s126:open:undo'}]
  ]};
}
function scheduleMenuKeyboardV126(){
  return {inline_keyboard:[
    [{text:'📆 النهاردة',callback_data:'s126:open:today'},{text:'🌅 بكرة',callback_data:'s126:open:tomorrow'}],
    [{text:'🗓️ الأسبوع',callback_data:'s126:open:week'},{text:'📅 الشهر',callback_data:'s126:open:month'}],
    [{text:'📋 كل القادم',callback_data:'s126:open:list'},{text:'🔁 التكرارات',callback_data:'s126:open:recurring'}],
    [{text:'↩️ القائمة الرئيسية',callback_data:'s126:panel:home'}]
  ]};
}
function dataPanelKeyboardV126(){
  return {inline_keyboard:[
    [{text:'🛒 مسح المشتريات',callback_data:'s126:data:shopping'}],
    [{text:'🧹 مسح سياق المحادثة',callback_data:'s126:data:context'}],
    [{text:'🧠 مسح الذاكرة الطويلة',callback_data:'s126:data:memory'}],
    [{text:'🌐 مسح نموذج العالم',callback_data:'s126:data:world'}],
    [{text:'🗑️ مسح المواعيد والتكرارات',callback_data:'s126:data:schedule'}],
    [{text:'🔥 مسح كل بياناتي',callback_data:'s126:data:all'}],
    [{text:'↩️ القائمة الرئيسية',callback_data:'s126:panel:home'}]
  ]};
}
function panelBackKeyboardV126(target='home'){
  return {inline_keyboard:[[{text:'↩️ رجوع',callback_data:target==='data'?'s126:panel:data':'s126:panel:home'}]]};
}
async function panelEditOrSendV126(env,chatId,messageId,text,reply_markup){
  if(Number(messageId)>0){
    try{
      const r=await telegramApi(env,'editMessageText',{chat_id:String(chatId),message_id:Number(messageId),text:String(text),reply_markup});
      if(r?.ok)return r;
    }catch{}
  }
  return sendText(env,chatId,text,reply_markup);
}
async function countRowsV126(env,table,chatId,where='1=1'){
  try{
    if(!(await tableExistsV125(env,table)))return 0;
    const cols=await columnsV125(env,table);if(!cols.some(x=>String(x.name)==='chat_id'))return 0;
    return Number((await env.DB.prepare(`SELECT COUNT(*) c FROM ${table} WHERE chat_id=? AND (${where})`).bind(String(chatId)).first())?.c||0);
  }catch{return 0;}
}
async function showMenuV125(env,chatId,messageId=null){
  const user=await ensureUser(env,chatId),ln=localNow(user?.timezone||TZ);
  const [reminders,recurring,shopping,projects,waiting,inbox]=await Promise.all([
    countRowsV126(env,'sanad_reminders',chatId,"status='active'"),
    countRowsV126(env,'sanad_recurrences',chatId,'active=1'),
    countRowsV126(env,'sanad_shopping',chatId,"status IN ('pending','unavailable')"),
    countRowsV126(env,'sanad_projects',chatId,"status!='done'"),
    countRowsV126(env,'sanad_waiting',chatId,"status='waiting'"),
    countRowsV126(env,'sanad_life_inbox',chatId,"status='open'")
  ]);
  const text=`🤝 سند V12.7 Ultimate Parity\n\n📌 حالتك دلوقتي\n📅 ${reminders} موعد · 🔁 ${recurring} تكرار · 🛒 ${shopping} مشتريات\n🎯 ${projects} مشروع · ⏳ ${waiting} متابعة · 📥 ${inbox} في الوارد\n🕒 ${ln.date} — ${ln.time}\n\nاختار القسم اللي عاوزه، أو كلمني بطبيعتك من غير أوامر.`;
  return panelEditOrSendV126(env,chatId,messageId,text,mainMenuKeyboardV126());
}
async function showSchedulePanelV126(env,chatId,messageId=null){
  return panelEditOrSendV126(env,chatId,messageId,'📅 المواعيد والجدول\n\nاختار الفترة اللي عاوز تشوفها أو افتح إدارة التكرارات.',scheduleMenuKeyboardV126());
}
async function showSettingsV126(env,chatId,messageId=null){
  const r=await toolSettingsReadV125(env,chatId),s=r.settings;
  const text=`⚙️ إعدادات سند\n\n🔔 المبادرة: ${Number(s.proactive_enabled)?'شغالة ✅':'مقفولة ⬜'}\n☀️ ملخص الصبح: ${Number(s.morning_brief_enabled)?s.morning_brief_time:'مقفول'}\n🌙 ملخص المساء: ${Number(s.evening_brief_enabled)?s.evening_brief_time:'مقفول'}\n🛡️ التأكيد قبل الحذف: ${Number(s.ask_before_delete)?'نعم':'لا'}\n🧠 التفكير العميق: ${s.deep_reasoning_mode}`;
  return panelEditOrSendV126(env,chatId,messageId,text,{inline_keyboard:[
    [{text:'🔔 المبادرة',callback_data:'s126:setting:proactive_enabled'},{text:'☀️ ملخص الصبح',callback_data:'s126:setting:morning_brief_enabled'}],
    [{text:'🌙 ملخص المساء',callback_data:'s126:setting:evening_brief_enabled'},{text:'🛡️ تأكيد الحذف',callback_data:'s126:setting:ask_before_delete'}],
    [{text:'🗑️ إدارة البيانات والمسح',callback_data:'s126:panel:data'}],
    [{text:'↩️ القائمة الرئيسية',callback_data:'s126:panel:home'}]
  ]});
}
async function showDataPanelV126(env,chatId,messageId=null){
  const [shop,context,memory,entities,edges,reminders,recurrences,prayers]=await Promise.all([
    countRowsV126(env,'sanad_shopping',chatId),countRowsV126(env,'sanad_conversation',chatId),countRowsV126(env,'sanad_memories',chatId),
    countRowsV126(env,'sanad_entities',chatId),countRowsV126(env,'sanad_edges',chatId),countRowsV126(env,'sanad_reminders',chatId),
    countRowsV126(env,'sanad_recurrences',chatId),countRowsV126(env,'sanad_prayer_rules',chatId)
  ]);
  const text=`🛡️ إدارة البيانات الحساسة\n\nالمسح الكبير موجود هنا بس عشان القوائم تفضل نضيفة ومايحصلش حذف بالغلط.\n\n🛒 المشتريات: ${shop}\n🧹 رسائل السياق: ${context}\n🧠 الذاكرة الطويلة: ${memory}\n🌐 نموذج العالم: ${entities} كيان · ${edges} علاقة\n📅 الجدول: ${reminders} موعد · ${recurrences} تكرار · ${prayers} قاعدة صلاة\n\nكل اختيار هيطلب تأكيد قبل التنفيذ. كل المسح الجزئي قابل لـ /undo؛ مسح كل البيانات نهائي.`;
  return panelEditOrSendV126(env,chatId,messageId,text,dataPanelKeyboardV126());
}
function dataConfirmCopyV126(action){
  const map={
    shopping:['🛒 مسح المشتريات','هتمسح كل عناصر قائمة المشتريات وأي جلسة تسوق مفتوحة. باقي بياناتك هتفضل زي ما هي، وتقدر ترجع آخر مسح بـ /undo.'],
    context:['🧹 مسح سياق المحادثة','هتمسح رسائل المحادثة والسياق المؤقت فقط. الذاكرة الطويلة والمواعيد والمشتريات مش هيتأثروا، وتقدر تتراجع بـ /undo.'],
    memory:['🧠 مسح الذاكرة الطويلة','هتمسح كل الذكريات المحفوظة في ذاكرة سند الطويلة. سياق المحادثة والمواعيد مش هيتأثروا، وتقدر تتراجع بـ /undo.'],
    world:['🌐 مسح نموذج العالم','هتمسح الكيانات والعلاقات اللي سند حافظها عن الأشخاص والأماكن والأشياء والعلاقات في عالمك، وتقدر تتراجع بـ /undo.'],
    schedule:['🗑️ مسح المواعيد والتكرارات','هتمسح المواعيد والتكرارات وقواعد الصلاة والروابط الزمنية بينها. المشتريات والذاكرة هيفضلوا، وتقدر تتراجع بـ /undo.'],
    all:['🔥 مسح كل بياناتي','تحذير نهائي: هتمسح بياناتك الشخصية داخل سند: المواعيد والتكرارات والمشتريات والسياق والذاكرة والمشاريع والمتابعات والموقع والإعدادات ونموذج العالم وسجل التراجع. العملية دي نهائية. هنحتفظ فقط بسجلات تشغيل تقنية لازمة لمنع تكرار نفس تحديث تيليجرام.']
  };
  return map[action]||['⚠️ تأكيد المسح','هل أنت متأكد؟'];
}
async function showDataConfirmationV126(env,chatId,messageId,action){
  const [title,desc]=dataConfirmCopyV126(action);
  return panelEditOrSendV126(env,chatId,messageId,`${title}\n\n⚠️ ${desc}\n\nمتأكد؟`,{inline_keyboard:[
    [{text:action==='all'?'🔥 نعم، امسح كل بياناتي':'✅ نعم، امسح',callback_data:`s126:data:confirm:${action}`}],
    [{text:'↩️ إلغاء',callback_data:'s126:panel:data'}]
  ]});
}
async function deleteChatTablesVerifiedV126(env,chatId,tables){
  const details={};let changed=0;
  for(const table of tables){
    if(!(await tableExistsV125(env,table)))continue;
    const cols=await columnsV125(env,table);if(!cols.some(x=>String(x.name)==='chat_id'))continue;
    const before=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM ${table} WHERE chat_id=?`).bind(String(chatId)).first())?.c||0);
    const r=await env.DB.prepare(`DELETE FROM ${table} WHERE chat_id=?`).bind(String(chatId)).run();
    const left=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM ${table} WHERE chat_id=?`).bind(String(chatId)).first())?.c||0);
    if(left!==0)throw new Error(`clear_verify_failed:${table}:${left}`);
    details[table]=before;changed+=Number(r?.meta?.changes||before||0);
  }
  return {ok:true,verified:true,changed,details};
}
async function clearDataSectionV126(env,chatId,action){
  if(action==='shopping')return deleteChatTablesVerifiedV126(env,chatId,['sanad_shopping_sessions','sanad_shopping']);
  if(action==='context')return deleteChatTablesVerifiedV126(env,chatId,['sanad_conversation','sanad_pending_actions','sanad_pending_conflicts']);
  if(action==='memory')return deleteChatTablesVerifiedV126(env,chatId,['sanad_memories']);
  if(action==='world')return deleteChatTablesVerifiedV126(env,chatId,['sanad_edges','sanad_entities']);
  if(action==='schedule')return deleteChatTablesVerifiedV126(env,chatId,['sanad_dependencies','sanad_reminder_fires','sanad_recurrence_fires','sanad_prayer_fires','sanad_reminders','sanad_recurrences','sanad_prayer_rules']);
  if(action==='all'){
    const base=await toolSystemClearAllV125(env,chatId);
    if(!base?.ok||base?.verified!==true)throw new Error(`clear_all_failed:${base?.remaining??'unknown'}`);
    const undo=await deleteChatTablesVerifiedV126(env,chatId,['sanad_operation_snapshots','sanad_receipts']);
    return {ok:true,verified:true,changed:Number(base.changed||0)+Number(undo.changed||0),base,undo};
  }
  return {ok:false,verified:false,changed:0,error:'unknown_clear_action'};
}
function clearSuccessCopyV126(action,r){
  const n=Number(r?.changed||0);
  const map={shopping:`✅ تم مسح المشتريات بالكامل واتأكدت إن القائمة فاضية. (${n} سجل)`,context:`✅ تم مسح سياق المحادثة. الذاكرة الطويلة وباقي بياناتك زي ما هي. (${n} سجل)`,memory:`✅ تم مسح الذاكرة الطويلة بالكامل. (${n} سجل)`,world:`✅ تم مسح نموذج العالم والكيانات والعلاقات. (${n} سجل)`,schedule:`✅ تم مسح المواعيد والتكرارات وقواعد الصلاة والروابط الزمنية. (${n} سجل)`,all:`✅ تم مسح بياناتك الشخصية بالكامل من سند واتأكدت من النتيجة. (${n} سجل)`};
  return map[action]||'✅ تم المسح واتأكدت من النتيجة.';
}
async function verifiedSectionClearWithUndoV126(env,chatId,action,callbackId){
  if(action==='all')return clearDataSectionV126(env,chatId,action);
  const operationId=`panel-clear:${chatId}:${String(callbackId||crypto.randomUUID())}`;
  const snapshot=await snapshotUserStateV125(env,chatId);
  const before=await ensureOperationSnapshotV125(env,chatId,operationId,snapshot,`مسح ${action} من لوحة البيانات`);
  try{
    const r=await clearDataSectionV126(env,chatId,action);
    if(!r?.ok||r?.verified!==true)throw new Error(r?.error||'clear_not_verified');
    await commitOperationSnapshotV125(env,operationId);
    await env.DB.prepare(`INSERT INTO sanad_audit(operation_id,chat_id,tool,args_json,result_json,verified,created_at) VALUES(?,?,?,?,?,?,?)`).bind(operationId,String(chatId),`panel.clear.${action}`,JSON.stringify({action}),JSON.stringify(r).slice(0,15000),1,nowIso()).run();
    return r;
  }catch(e){
    try{await restoreUserStateV125(env,chatId,before);await discardOperationSnapshotV125(env,operationId);}catch(restoreError){await reportFailure(env,chatId,'data_clear_restore',restoreError,{action,operationId});}
    throw e;
  }
}
async function handleCallback(env,q){
  const chatId=String(q?.message?.chat?.id??q?.from?.id??''),messageId=Number(q?.message?.message_id||0),data=String(q?.data||'');
  if(!chatId)return;
  const ours=data.startsWith('s126:panel:')||data.startsWith('s126:open:')||data.startsWith('s126:data:');
  if(!ours)return handleCallbackV126BeforeRestoredPanels(env,q);
  try{await telegramApi(env,'answerCallbackQuery',{callback_query_id:q.id});}catch{}
  if(data==='s126:panel:home')return showMenuV125(env,chatId,messageId);
  if(data==='s126:panel:schedule')return showSchedulePanelV126(env,chatId,messageId);
  if(data==='s126:panel:settings')return showSettingsV126(env,chatId,messageId);
  if(data==='s126:panel:data')return showDataPanelV126(env,chatId,messageId);
  const open=data.match(/^s126:open:(today|tomorrow|week|month|list|recurring|shopping|projects|waiting|inbox|memory|prayer|live|where|audit|undo)$/);
  if(open){
    const user=await ensureUser(env,chatId),name=open[1];
    if(name==='today')return showToday(env,chatId,user);
    if(name==='tomorrow')return showTomorrowV126(env,chatId,user);
    if(name==='week')return showRangeV125(env,chatId,user,7);
    if(name==='month')return showRangeV125(env,chatId,user,31);
    if(name==='list')return showAllScheduleV126(env,chatId,user);
    if(name==='recurring')return showRecurrencesV125(env,chatId);
    if(name==='shopping')return showShopping(env,chatId);
    if(name==='projects')return showProjectsV125(env,chatId);
    if(name==='waiting')return showWaitingV125(env,chatId);
    if(name==='inbox')return showLifeInboxV126(env,chatId);
    if(name==='memory')return showMemory(env,chatId);
    if(name==='prayer')return showPrayerPanelV126(env,chatId,user);
    if(name==='live')return showLiveRealityV126(env,chatId,user);
    if(name==='where')return showWhereV125(env,chatId,user);
    if(name==='audit')return showAudit(env,chatId);
    if(name==='undo'){const r=await toolAuditUndoV125(env,chatId);return sendText(env,chatId,r.ok?'↩️ رجعت آخر عملية قابلة للتراجع بنجاح.':'مفيش عملية قابلة للتراجع حاليًا.',panelBackKeyboardV126());}
  }
  const ask=data.match(/^s126:data:(shopping|context|memory|world|schedule|all)$/);if(ask)return showDataConfirmationV126(env,chatId,messageId,ask[1]);
  const confirm=data.match(/^s126:data:confirm:(shopping|context|memory|world|schedule|all)$/);
  if(confirm){
    const action=confirm[1];
    try{
      const r=await verifiedSectionClearWithUndoV126(env,chatId,action,q?.id);
      if(!r?.ok||r?.verified!==true)throw new Error(r?.error||'clear_not_verified');
      const kb=action==='all'?{inline_keyboard:[[{text:'🤝 بدء من جديد',callback_data:'s126:panel:home'}]]}:panelBackKeyboardV126('data');
      return panelEditOrSendV126(env,chatId,messageId,clearSuccessCopyV126(action,r),kb);
    }catch(e){
      await reportFailure(env,chatId,'data_clear',e,{action});
      return panelEditOrSendV126(env,chatId,messageId,'⚠️ المسح ما اكتملش بشكل يمكن إثباته، فرجعت الحالة القديمة ومش هقولك إنه تم.',panelBackKeyboardV126('data'));
    }
  }
  return handleCallbackV126BeforeRestoredPanels(env,q);
}


/* ================= SANAD V12.7 CORRECTNESS HARDENING ================= */
const V127_SNAPSHOT_MAX_ROWS_PER_TABLE=2500;
const V127_SNAPSHOT_MAX_BYTES=1500000;
const V127_USER_PAGE_SIZE=200;
const V127_USER_PAGES_PER_RUN=20;
const V127_RECOVERY_PAGE_SIZE=50;
const V127_RECOVERY_ROUNDS=12;
const V127_WATCH_PAGE_SIZE=25;
const V127_WATCH_PAGES_PER_RUN=10;
const V127_TRUSTED_WORLD_CONFIDENCE=0.75;

TOOL_SPECS['dependency.create'].args={source_type:'reminder',source_id:'number',target_type:'reminder',target_id:'number',relation:'after_start|after_end|before_start',offset_minutes:'number?',realign:'boolean?'};

function uniqueIdsV127(args){return [...new Set((Array.isArray(args?.ids)?args.ids:(args?.id!=null?[args.id]:[])).map(Number).filter(n=>Number.isInteger(n)&&n>0))];}
async function existingIdsV127(env,table,chatId,ids,extra='1=1'){
  if(!ids.length)return[];const qs=ids.map(()=>'?').join(',');
  return (await env.DB.prepare(`SELECT id FROM ${table} WHERE chat_id=? AND id IN (${qs}) AND (${extra})`).bind(String(chatId),...ids).all())?.results?.map(x=>Number(x.id))||[];
}
const V127_PREFLIGHT_ID_TABLES={
  'shopping.remove':['sanad_shopping','1=1'],'reminders.cancel':['sanad_reminders',"status='active'"],
  'recurrence.pause':['sanad_recurrences','1=1'],'recurrence.resume':['sanad_recurrences','1=1'],'recurrence.cancel':['sanad_recurrences','1=1'],
  'dependency.remove':['sanad_dependencies','active=1'],'memory.forget':['sanad_memories','1=1'],'world.forget':['sanad_entities','1=1'],
  'waiting.close':['sanad_waiting',"status='waiting'"],'prayer.rules.cancel':['sanad_prayer_rules','1=1'],
  'prayer.rules.pause':['sanad_prayer_rules','1=1'],'prayer.rules.resume':['sanad_prayer_rules','1=1'],
  'live.watch.stop':['sanad_live_watches','1=1'],'inbox.close':['sanad_life_inbox','1=1']
};
async function preflightMutationIdsV127(env,chatId,tool,args){
  const spec=V127_PREFLIGHT_ID_TABLES[tool];if(!spec)return null;
  const ids=uniqueIdsV127(args);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};
  const found=await existingIdsV127(env,spec[0],chatId,ids,spec[1]);const set=new Set(found),missing=ids.filter(x=>!set.has(x));
  return missing.length?{ok:false,changed:0,verified:false,error:'ids_not_found',missing,requested:ids}:null;
}

function validTimezoneV127(v){try{new Intl.DateTimeFormat('en-US',{timeZone:String(v)}).format(new Date());return true}catch{return false}}
function bool01V127(v){if(v===true||v===1||v==='1')return 1;if(v===false||v===0||v==='0')return 0;return null}
function sanitizeProfilePatchV127(args){
  const out={};
  if(args?.timezone!==undefined){const v=String(args.timezone);if(!validTimezoneV127(v))return{ok:false,error:'invalid_timezone'};out.timezone=v;}
  if(args?.latitude!==undefined){const v=Number(args.latitude);if(!Number.isFinite(v)||v< -90||v>90)return{ok:false,error:'invalid_latitude'};out.latitude=v;}
  if(args?.longitude!==undefined){const v=Number(args.longitude);if(!Number.isFinite(v)||v< -180||v>180)return{ok:false,error:'invalid_longitude'};out.longitude=v;}
  for(const k of ['morning_brief_time','evening_brief_time'])if(args?.[k]!==undefined){const v=String(args[k]);if(!validTimeV125(v))return{ok:false,error:`invalid_${k}`};out[k]=v;}
  for(const k of ['proactive_enabled','morning_brief_enabled','evening_brief_enabled','ask_before_delete'])if(args?.[k]!==undefined){const v=bool01V127(args[k]);if(v===null)return{ok:false,error:`invalid_${k}`};out[k]=v;}
  if(args?.deep_reasoning_mode!==undefined){const v=String(args.deep_reasoning_mode);if(!['auto','on','off'].includes(v))return{ok:false,error:'invalid_deep_reasoning_mode'};out.deep_reasoning_mode=v;}
  if(args?.autonomy_mode!==undefined){const v=String(args.autonomy_mode);if(!['full_safe','safe_auto','ask','manual'].includes(v))return{ok:false,error:'invalid_autonomy_mode'};out.autonomy_mode=v;}
  if(args?.country_code!==undefined){const v=String(args.country_code).toUpperCase();if(!/^[A-Z]{2}$/.test(v))return{ok:false,error:'invalid_country_code'};out.country_code=v;}
  if(args?.locale!==undefined){const v=String(args.locale);if(!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(v))return{ok:false,error:'invalid_locale'};out.locale=v;}
  for(const k of ['city','country','display_name'])if(args?.[k]!==undefined){const v=normalizeText(args[k]);if(!v||v.length>160)return{ok:false,error:`invalid_${k}`};out[k]=v;}
  return{ok:true,patch:out};
}
async function toolProfileUpdateV125(env,chatId,args){
  const s=sanitizeProfilePatchV127(args);if(!s.ok)return{ok:false,changed:0,verified:false,error:s.error};
  const patch=s.patch,keys=Object.keys(patch);if(!keys.length)return{ok:false,changed:0,verified:false,error:'nothing_to_update'};
  const before=await ensureUser(env,chatId),sets=keys.map(k=>`${k}=?`),vals=keys.map(k=>patch[k]);sets.push('updated_at=?');vals.push(nowIso(),chatId);
  await env.DB.prepare(`UPDATE sanad_users SET ${sets.join(',')} WHERE chat_id=?`).bind(...vals).run();
  const after=await env.DB.prepare(`SELECT * FROM sanad_users WHERE chat_id=?`).bind(chatId).first();
  const verified=!!after&&keys.every(k=>String(after[k]??'')===String(patch[k]??''));
  const changed=verified&&keys.some(k=>String(before?.[k]??'')!==String(after?.[k]??''))?1:0;
  return{ok:verified,changed,verified,before,after,applied:patch};
}
async function toolSettingsUpdateV125(env,chatId,args){return toolProfileUpdateV125(env,chatId,args)}
async function updateLocationV125(env,chatId,loc){
  const lat=Number(loc?.latitude),lon=Number(loc?.longitude);if(!Number.isFinite(lat)||lat< -90||lat>90||!Number.isFinite(lon)||lon< -180||lon>180)throw new Error('invalid_location');
  const r=await toolProfileUpdateV125(env,chatId,{latitude:lat,longitude:lon});if(!r.ok)throw new Error(r.error||'location_update_failed');return{lat,lon};
}

function snapshotTablesForStepsV127(steps){
  const out=new Set();const add=(...xs)=>xs.forEach(x=>out.add(x));
  for(const s of Array.isArray(steps)?steps:[]){const t=String(s?.tool||'');
    if(t.startsWith('shopping.'))add('sanad_shopping','sanad_shopping_sessions');
    else if(t.startsWith('reminders.')||t.startsWith('schedule.'))add('sanad_reminders','sanad_reminder_fires','sanad_dependencies');
    else if(t.startsWith('recurrence.'))add('sanad_recurrences','sanad_recurrence_fires','sanad_dependencies');
    else if(t.startsWith('dependency.'))add('sanad_dependencies','sanad_reminders');
    else if(t.startsWith('memory.'))add('sanad_memories');
    else if(t.startsWith('world.'))add('sanad_entities','sanad_edges');
    else if(t.startsWith('projects.')||t.startsWith('project_tasks.'))add('sanad_projects','sanad_project_tasks');
    else if(t.startsWith('waiting.'))add('sanad_waiting');
    else if(t.startsWith('profile.')||t.startsWith('settings.'))add('sanad_users');
    else if(t.startsWith('prayer.rules.'))add('sanad_prayer_rules','sanad_prayer_fires');
    else if(t.startsWith('live.watch.'))add('sanad_live_watches');
    else if(t.startsWith('inbox.'))add('sanad_life_inbox');
    else if(t==='system.clear_all'||t==='audit.undo')SNAPSHOT_TABLES.forEach(x=>out.add(x));
  }
  return [...out];
}
function canonicalValueV127(v){if(Array.isArray(v))return v.map(canonicalValueV127);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=canonicalValueV127(v[k]);return o;}return v;}
function canonicalRowsV127(rows){return (Array.isArray(rows)?rows:[]).map(x=>JSON.stringify(canonicalValueV127(x))).sort();}
async function snapshotUserStateV125(env,chatId,steps=null){
  const tables=Array.isArray(steps)&&steps.length?snapshotTablesForStepsV127(steps):[...SNAPSHOT_TABLES];const data={};let totalBytes=2;
  for(const table of tables){if(!(await tableExistsV125(env,table)))continue;const cols=await columnsV125(env,table);if(!cols.some(x=>String(x.name)==='chat_id'))continue;
    const count=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM ${table} WHERE chat_id=?`).bind(String(chatId)).first())?.c||0);if(count>V127_SNAPSHOT_MAX_ROWS_PER_TABLE)throw new Error(`snapshot_row_limit:${table}:${count}`);
    const rows=(await env.DB.prepare(`SELECT * FROM ${table} WHERE chat_id=?`).bind(String(chatId)).all())?.results||[];data[table]=rows;totalBytes+=JSON.stringify(rows).length;if(totalBytes>V127_SNAPSHOT_MAX_BYTES)throw new Error(`snapshot_byte_limit:${totalBytes}`);
  }
  return data;
}
async function restoreUserStateV125(env,chatId,snap){
  for(const table of Object.keys(snap||{})){if(!(await tableExistsV125(env,table)))continue;const cols=await columnsV125(env,table);if(!cols.some(x=>String(x.name)==='chat_id'))continue;
    await env.DB.prepare(`DELETE FROM ${table} WHERE chat_id=?`).bind(String(chatId)).run();const rows=Array.isArray(snap?.[table])?snap[table]:[];
    for(const row of rows){const names=Object.keys(row);if(!names.length)continue;const sql=`INSERT INTO ${table}(${names.map(sqlQuoteNameV125).join(',')}) VALUES(${names.map(()=>'?').join(',')})`;await env.DB.prepare(sql).bind(...names.map(k=>row[k])).run();}
  }
  return restoreUserStateVerifiedV127(env,chatId,snap,false);
}
async function restoreUserStateVerifiedV127(env,chatId,snap,performRestore=true){
  if(performRestore)await restoreUserStateV125(env,chatId,snap);
  const failures=[];for(const [table,expected] of Object.entries(snap||{})){if(!(await tableExistsV125(env,table))){failures.push(`${table}:missing_table`);continue;}const actual=(await env.DB.prepare(`SELECT * FROM ${table} WHERE chat_id=?`).bind(String(chatId)).all())?.results||[];if(JSON.stringify(canonicalRowsV127(actual))!==JSON.stringify(canonicalRowsV127(expected)))failures.push(`${table}:mismatch`);}
  return{ok:failures.length===0,verified:failures.length===0,failures};
}

async function toolAuditUndoV125(env,chatId){
  const row=await env.DB.prepare(`SELECT * FROM sanad_operation_snapshots WHERE chat_id=? AND committed=1 AND undone_at IS NULL ORDER BY id DESC LIMIT 1`).bind(chatId).first();if(!row)return{ok:false,changed:0,verified:false,error:'nothing_to_undo'};
  const snap=parseJsonV125(row.snapshot_json,null);if(!snap)return{ok:false,changed:0,verified:false,error:'invalid_snapshot'};
  let restored;try{restored=await restoreUserStateVerifiedV127(env,chatId,snap,true)}catch(e){const incident=await reportFailure(env,chatId,'undo_restore',e,{operation_id:row.operation_id});return{ok:false,changed:0,verified:false,error:'undo_restore_failed',incident};}
  if(!restored.verified){const incident=await reportFailure(env,chatId,'undo_restore_verify',new Error(restored.failures.join('|')),{operation_id:row.operation_id});return{ok:false,changed:0,verified:false,error:'undo_restore_verification_failed',incident,failures:restored.failures};}
  await env.DB.prepare(`UPDATE sanad_operation_snapshots SET undone_at=? WHERE id=?`).bind(nowIso(),Number(row.id)).run();const chk=await env.DB.prepare(`SELECT undone_at FROM sanad_operation_snapshots WHERE id=?`).bind(Number(row.id)).first();
  return{ok:!!chk?.undone_at,changed:chk?.undone_at?1:0,verified:!!chk?.undone_at,operation_id:row.operation_id,summary:row.summary};
}

async function validateReminderDraftV127(env,chatId,draft,user,excludeId=0){
  const title=normalizeText(draft?.title),date=String(draft?.local_date||''),time=String(draft?.local_time||''),tz=String(user?.timezone||draft?.timezone||TZ);
  if(!title||title.length>300||!validDateV125(date)||!validTimeV125(time)||!validTimezoneV127(tz))return{ok:false,error:'invalid_reminder_fields'};
  const kind=['reminder','appointment'].includes(String(draft?.kind))?String(draft.kind):(Number(draft?.duration_minutes||0)>0?'appointment':'reminder');
  const duration=Math.trunc(Number(draft?.duration_minutes??(kind==='appointment'?DEFAULT_EVENT_DURATION:0)));if(!Number.isFinite(duration)||duration<0||duration>10080)return{ok:false,error:'invalid_duration'};
  const ln=localNow(tz);if(!draft?.allow_past&&`${date} ${time}`<`${ln.date} ${ln.time}`)return{ok:false,error:'time_is_in_the_past'};
  const rawAdv=(Array.isArray(draft?.advance_minutes)?draft.advance_minutes:[draft?.advance_minutes]).filter(x=>x!=null).map(Number);if(rawAdv.some(x=>!Number.isFinite(x)||x<0||x>MAX_ADVANCE_MINUTES))return{ok:false,error:'invalid_advance'};const advances=[...new Set(rawAdv.map(Math.trunc))];
  if((kind==='appointment'||duration>0)&&!draft?.allow_conflict){const occ=await getScheduleOccurrencesV125(env,chatId,date,date),start=hmMinutesV125(time),conf=occ.filter(x=>!(x.source_type==='reminder'&&Number(x.source_id)===Number(excludeId))&&start<hmMinutesV125(x.time)+Math.max(1,Number(x.duration_minutes||DEFAULT_EVENT_DURATION))&&hmMinutesV125(x.time)<start+Math.max(1,duration));if(conf.length)return{ok:false,error:'schedule_conflict',conflicts:conf.slice(0,10)};}
  return{ok:true,draft:{...draft,title,local_date:date,local_time:time,timezone:tz,kind,duration_minutes:duration,advance_minutes:advances}};
}
async function toolReminderCreate(env,chatId,args,user){
  const v=await validateReminderDraftV127(env,chatId,args,user,0);if(!v.ok){if(v.error==='schedule_conflict'){const now=nowIso(),exp=new Date(Date.now()+CONFIRM_TTL_MINUTES*60000).toISOString();await env.DB.prepare(`INSERT INTO sanad_pending_conflicts(chat_id,tool,args_json,conflicts_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET tool=excluded.tool,args_json=excluded.args_json,conflicts_json=excluded.conflicts_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(chatId,'reminders.create',JSON.stringify(args),JSON.stringify(v.conflicts||[]),exp,now,now).run();}return{ok:false,changed:0,verified:false,error:v.error,conflicts:v.conflicts||[]};}
  const d=v.draft,now=nowIso(),r=await env.DB.prepare(`INSERT INTO sanad_reminders(chat_id,title,kind,local_date,local_time,timezone,duration_minutes,advance_minutes,advance_json,status,sent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',0,?,?)`).bind(chatId,d.title,d.kind,d.local_date,d.local_time,d.timezone,d.duration_minutes,Number(d.advance_minutes[0]||0),JSON.stringify(d.advance_minutes),now,now).run();
  const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,id).first();const verified=!!after&&after.title===d.title&&after.local_date===d.local_date&&after.local_time===d.local_time&&String(after.kind)===d.kind&&Number(after.duration_minutes)===d.duration_minutes;
  if(verified)await env.DB.prepare(`DELETE FROM sanad_pending_conflicts WHERE chat_id=?`).bind(chatId).run();return{ok:verified,changed:verified?1:0,verified,id,after};
}
async function toolReminderUpdate(env,chatId,args){
  const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:'missing_id'};const before=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();if(!before)return{ok:false,changed:0,verified:false,error:'not_found'};
  const user=await ensureUser(env,chatId),merged={...before,...args,title:args?.title!==undefined?args.title:before.title,local_date:args?.local_date!==undefined?args.local_date:before.local_date,local_time:args?.local_time!==undefined?args.local_time:before.local_time,duration_minutes:args?.duration_minutes!==undefined?args.duration_minutes:before.duration_minutes,kind:args?.kind!==undefined?args.kind:before.kind,advance_minutes:args?.advance_minutes!==undefined?args.advance_minutes:parseJsonV125(before.advance_json,[])};
  const v=await validateReminderDraftV127(env,chatId,merged,user,id);if(!v.ok)return{ok:false,changed:0,verified:false,error:v.error,conflicts:v.conflicts||[]};const d=v.draft;
  await env.DB.prepare(`UPDATE sanad_reminders SET title=?,kind=?,local_date=?,local_time=?,timezone=?,duration_minutes=?,advance_minutes=?,advance_json=?,sent=0,updated_at=? WHERE chat_id=? AND id=?`).bind(d.title,d.kind,d.local_date,d.local_time,d.timezone,d.duration_minutes,Number(d.advance_minutes[0]||0),JSON.stringify(d.advance_minutes),nowIso(),chatId,id).run();
  const after=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=? AND status='active'`).bind(chatId,id).first();const verified=!!after&&after.title===d.title&&after.local_date===d.local_date&&after.local_time===d.local_time&&Number(after.duration_minutes)===d.duration_minutes&&String(after.kind)===d.kind;if(!verified)return{ok:false,changed:0,verified:false,error:'update_verification_failed',before,after};
  const changed=['title','kind','local_date','local_time','duration_minutes','advance_json'].some(k=>String(before[k]??'')!==String(after[k]??''));let dependencyChanges=0;
  const temporalChanged=String(before.local_date)!==String(after.local_date)||String(before.local_time)!==String(after.local_time)||Number(before.duration_minutes||0)!==Number(after.duration_minutes||0);if(temporalChanged){const oldMs=zonedLocalToEpochV125(before.local_date,before.local_time,before.timezone||TZ),newMs=zonedLocalToEpochV125(after.local_date,after.local_time,after.timezone||TZ),delta=Math.round((newMs-oldMs)/60000),p=await propagateDependenciesV125(env,chatId,'reminder',id,delta);dependencyChanges=Number(p?.changed||0);}
  return{ok:true,changed:(changed?1:0)+dependencyChanges,verified:true,before,after,dependencies_verified:true,dependency_changes:dependencyChanges};
}
async function toolReminderCancel(env,chatId,args){
  const ids=uniqueIdsV127(args);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const found=await existingIdsV127(env,'sanad_reminders',chatId,ids,"status='active'"),missing=ids.filter(x=>!new Set(found).has(x));if(missing.length)return{ok:false,changed:0,verified:false,error:'ids_not_found',missing};
  const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`UPDATE sanad_reminders SET status='cancelled',updated_at=? WHERE chat_id=? AND id IN (${qs})`).bind(nowIso(),chatId,...ids).run();const rows=(await env.DB.prepare(`SELECT id,status FROM sanad_reminders WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];const verified=rows.length===ids.length&&rows.every(x=>x.status==='cancelled');return{ok:verified,changed:verified?ids.length:0,verified,items:rows};
}
async function toolMemoryForget(env,chatId,args){
  const ids=uniqueIdsV127(args);if(!ids.length)return{ok:false,changed:0,verified:false,error:'missing_ids'};const found=await existingIdsV127(env,'sanad_memories',chatId,ids),missing=ids.filter(x=>!new Set(found).has(x));if(missing.length)return{ok:false,changed:0,verified:false,error:'ids_not_found',missing};
  const qs=ids.map(()=>'?').join(',');await env.DB.prepare(`DELETE FROM sanad_memories WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).run();const left=(await env.DB.prepare(`SELECT id FROM sanad_memories WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return{ok:left.length===0,changed:left.length===0?ids.length:0,verified:left.length===0};
}

async function toolDependencyCreateV125(env,chatId,args){
  const st=String(args?.source_type||'reminder'),tt=String(args?.target_type||'reminder');if(st!=='reminder'||tt!=='reminder')return{ok:false,changed:0,verified:false,error:'unsupported_dependency_type',supported:'reminder->reminder'};
  return toolDependencyCreateV127Core(env,chatId,{...args,source_type:'reminder',target_type:'reminder'});
}
async function toolDependencyCreateV127Core(env,chatId,args){
  const sid=Number(args?.source_id),tid=Number(args?.target_id),rel=String(args?.relation||'after_start')==='after'?'after_start':String(args?.relation||'after_start');if(!sid||!tid||!['after_start','after_end','before_start'].includes(rel))return{ok:false,changed:0,verified:false,error:'invalid_dependency'};if(sid===tid)return{ok:false,changed:0,verified:false,error:'self_dependency'};
  const [s,t]=await Promise.all([reminderNodeV126(env,chatId,sid),reminderNodeV126(env,chatId,tid)]);if(!s||!t)return{ok:false,changed:0,verified:false,error:'dependency_node_not_found'};
  const current=(await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND active=1`).bind(chatId).all())?.results||[],candidate={source_type:'reminder',source_id:sid,target_type:'reminder',target_id:tid,relation:rel};if(dependencyCycleV126(current,candidate))return{ok:false,changed:0,verified:false,error:'dependency_cycle'};
  let off=Number(args?.offset_minutes),explicit=Number.isFinite(off);if(!explicit){const ss=zonedLocalToEpochV125(s.local_date,s.local_time,s.timezone||TZ),ts=zonedLocalToEpochV125(t.local_date,t.local_time,t.timezone||TZ);off=rel==='after_end'?Math.round((ts-(ss+Number(s.duration_minutes||0)*60000))/60000):rel==='before_start'?Math.round((ss-ts)/60000):Math.round((ts-ss)/60000);}if(!Number.isFinite(off))off=0;
  await env.DB.prepare(`UPDATE sanad_dependencies SET active=0,updated_at=? WHERE chat_id=? AND source_type='reminder' AND source_id=? AND target_type='reminder' AND target_id=?`).bind(nowIso(),chatId,sid,tid).run();const now=nowIso(),x=await env.DB.prepare(`INSERT INTO sanad_dependencies(chat_id,source_type,source_id,target_type,target_id,relation,offset_minutes,condition_json,active,created_at,updated_at) VALUES(?,'reminder',?,'reminder',?,?,?,?,1,?,?)`).bind(chatId,sid,tid,rel,Math.trunc(off),JSON.stringify(args?.condition||{}),now,now).run(),id=Number(x?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND id=?`).bind(chatId,id).first();let aligned=true;if(after&&explicit&&args?.realign!==false)aligned=await realignDependencyV126(env,chatId,after);return{ok:!!after&&aligned,changed:after?1:0,verified:!!after&&aligned,id,after,derived_offset:!explicit};
}

async function toolWorldUpsertV125(env,chatId,args){
  const source=String(args?.source||'agent_inferred'),confidence=args?.confidence==null?(source==='user_explicit'?1:0.5):clampV125(args.confidence,0,1),next={...args,source,confidence};
  const r=await toolWorldUpsertV125Base(env,chatId,next);if(!r.ok)return r;const verified=String(r.after?.source||'')===source&&Math.abs(Number(r.after?.confidence)-confidence)<1e-9;return{...r,ok:verified,verified,changed:verified?Number(r.changed||1):0};
}
async function toolWorldLinkV125(env,chatId,args){
  const source=String(args?.source||'agent_inferred'),confidence=args?.confidence==null?(source==='user_explicit'?1:0.5):clampV125(args.confidence,0,1),next={...args,source,confidence};
  const r=await toolWorldLinkV125Base(env,chatId,next);if(!r.ok)return r;const verified=String(r.after?.source||'')===source&&Math.abs(Number(r.after?.confidence)-confidence)<1e-9;return{...r,ok:verified,verified,changed:verified?Number(r.changed||1):0};
}

async function toolProjectTaskUpdateV125(env,chatId,args){
  const id=Number(args?.id);if(!id)return{ok:false,changed:0,verified:false,error:'missing_id'};const b=await env.DB.prepare(`SELECT * FROM sanad_project_tasks WHERE chat_id=? AND id=?`).bind(chatId,id).first();if(!b)return{ok:false,changed:0,verified:false,error:'not_found'};
  const title=args?.title!=null?normalizeText(args.title):b.title,status=args?.status!=null?String(args.status):b.status,due=args?.due_at!==undefined?args.due_at:b.due_at,priority=args?.priority!=null?String(args.priority):b.priority;if(!title||!['pending','done','cancelled'].includes(String(status))||!['low','normal','high'].includes(String(priority)))return{ok:false,changed:0,verified:false,error:'invalid_task_fields'};
  await env.DB.prepare(`UPDATE sanad_project_tasks SET title=?,status=?,due_at=?,priority=?,updated_at=? WHERE chat_id=? AND id=?`).bind(title,status,due,priority,nowIso(),chatId,id).run();const a=await env.DB.prepare(`SELECT * FROM sanad_project_tasks WHERE chat_id=? AND id=?`).bind(chatId,id).first();const verified=!!a&&String(a.title)===String(title)&&String(a.status)===String(status)&&String(a.due_at??'')===String(due??'')&&String(a.priority)===String(priority),changed=verified&&(['title','status','due_at','priority'].some(k=>String(b[k]??'')!==String(a[k]??'')))?1:0;return{ok:verified,changed,verified,before:b,after:a};
}

function fallbackCompose(obs){
  const muts=(Array.isArray(obs)?obs:[]).filter(x=>TOOL_SPECS[x.tool]?.mutation),failed=muts.filter(x=>x.ok!==true||x.verified!==true),changed=muts.filter(x=>x.ok===true&&x.verified===true&&Number(x.changed)>0),noops=muts.filter(x=>x.ok===true&&x.verified===true&&Number(x.changed||0)===0),reads=(Array.isArray(obs)?obs:[]).filter(x=>!TOOL_SPECS[x.tool]?.mutation&&x.ok===true);
  if(failed.length)return `⚠️ التنفيذ ما اكتملش بشكل مؤكد، ومش هعتبر العملية تمت.`;
  if(changed.length)return `✅ تم تنفيذ ${changed.length} تغيير واتأكدت من الحالة الفعلية بعد التنفيذ.`;
  if(noops.length)return `تمام، راجعت الحالة وكانت بالفعل بالشكل المطلوب؛ مفيش تغيير جديد اتعمل.`;
  if(reads.length)return `تمام، راجعت الحالة الحالية.`;return 'تمام.';
}

async function mutationRowV127(env,table,chatId,id){if(!Number(id))return null;return env.DB.prepare(`SELECT * FROM ${table} WHERE chat_id=? AND id=?`).bind(String(chatId),Number(id)).first()}
function fieldsMatchV127(row,args,keys){return !!row&&keys.filter(k=>args?.[k]!==undefined).every(k=>String(row[k]??'')===String(args[k]??''))}
async function verifyMutationPostconditionV127(env,chatId,tool,args,result){
  if(result?.ok!==true||result?.verified!==true)return false;if(Number(result?.changed||0)===0)return true;
  const ids=uniqueIdsV127(args);
  switch(tool){
    case'shopping.add':{const got=await existingIdsV127(env,'sanad_shopping',chatId,(result.ids||[]).map(Number));return got.length>0&&got.length===(result.ids||[]).length;}
    case'shopping.update':case'shopping.mark':{const id=Number(args?.id||result?.after?.id);const r=await mutationRowV127(env,'sanad_shopping',chatId,id);return fieldsMatchV127(r,args,['title','quantity','status'])||tool==='shopping.mark'&&!!r&&String(r.status)===String(args?.status);}
    case'shopping.remove':return (await existingIdsV127(env,'sanad_shopping',chatId,ids)).length===0;
    case'shopping.clear':return Number((await env.DB.prepare(`SELECT COUNT(*) c FROM sanad_shopping WHERE chat_id=?`).bind(chatId).first())?.c||0)===0;
    case'shopping.session.start':return !!(await mutationRowV127(env,'sanad_shopping_sessions',chatId,result.id));
    case'shopping.session.finish':return !!result?.session?.ended_at;
    case'reminders.create':{const r=await mutationRowV127(env,'sanad_reminders',chatId,result.id);return !!r&&r.status==='active'&&r.title===result.after?.title&&r.local_date===result.after?.local_date&&r.local_time===result.after?.local_time;}
    case'reminders.update':case'reminders.snooze':{const r=await mutationRowV127(env,'sanad_reminders',chatId,args?.id);return !!r&&r.status==='active'&&(tool==='reminders.snooze'?String(r.local_date)===String(result.after?.local_date)&&String(r.local_time)===String(result.after?.local_time):fieldsMatchV127(r,args,['title','local_date','local_time','duration_minutes','kind']));}
    case'reminders.cancel':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,status FROM sanad_reminders WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>x.status==='cancelled');}
    case'recurrence.create':return !!(await mutationRowV127(env,'sanad_recurrences',chatId,result.id));
    case'recurrence.update':{const r=await mutationRowV127(env,'sanad_recurrences',chatId,args.id);return !!r&&fieldsMatchV127(r,args,['title','start_date','end_date','max_occurrences','duration_minutes','kind','active','paused_until']);}
    case'recurrence.pause':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,paused_until FROM sanad_recurrences WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>!!x.paused_until);}
    case'recurrence.resume':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,active,paused_until FROM sanad_recurrences WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>Number(x.active)===1&&!x.paused_until);}
    case'recurrence.cancel':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,active FROM sanad_recurrences WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>Number(x.active)===0);}
    case'recurrence.skip':{const r=await mutationRowV127(env,'sanad_recurrences',chatId,args.id);return !!r&&parseJsonV125(r.exceptions_json,[]).includes(result.key||args.date);}
    case'schedule.shift':case'schedule.bulk_shift':return result?.dependencies_verified!==false&&!!(result.after||result.changed);
    case'dependency.create':case'dependency.link_by_title':return !!(await mutationRowV127(env,'sanad_dependencies',chatId,result.id));
    case'dependency.remove':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,active FROM sanad_dependencies WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>Number(x.active)===0);}
    case'memory.remember':return !!(await mutationRowV127(env,'sanad_memories',chatId,result.id));
    case'memory.forget':return (await existingIdsV127(env,'sanad_memories',chatId,ids)).length===0;
    case'world.upsert':return !!(await mutationRowV127(env,'sanad_entities',chatId,result.id));
    case'world.link':return !!(await mutationRowV127(env,'sanad_edges',chatId,result.id));
    case'world.forget':return (await existingIdsV127(env,'sanad_entities',chatId,ids)).length===0;
    case'projects.create':return !!(await mutationRowV127(env,'sanad_projects',chatId,result.id));
    case'projects.update':{const r=await mutationRowV127(env,'sanad_projects',chatId,args.id);return fieldsMatchV127(r,args,['status','progress','priority','deadline']);}
    case'project_tasks.create':return !!(await mutationRowV127(env,'sanad_project_tasks',chatId,result.id));
    case'project_tasks.update':{const r=await mutationRowV127(env,'sanad_project_tasks',chatId,args.id);return fieldsMatchV127(r,args,['title','status','due_at','priority']);}
    case'waiting.create':return !!(await mutationRowV127(env,'sanad_waiting',chatId,result.id));
    case'waiting.close':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,status FROM sanad_waiting WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>x.status==='done');}
    case'profile.update':case'settings.update':{const r=await env.DB.prepare(`SELECT * FROM sanad_users WHERE chat_id=?`).bind(chatId).first();const s=sanitizeProfilePatchV127(args);return s.ok&&fieldsMatchV127(r,s.patch,Object.keys(s.patch));}
    case'prayer.rules.create':return !!(await mutationRowV127(env,'sanad_prayer_rules',chatId,result.id));
    case'prayer.rules.update':{const r=await mutationRowV127(env,'sanad_prayer_rules',chatId,args.id);return fieldsMatchV127(r,args,['title','offset_minutes','end_date']);}
    case'prayer.rules.cancel':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,active FROM sanad_prayer_rules WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>Number(x.active)===0);}
    case'prayer.rules.pause':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,paused_until FROM sanad_prayer_rules WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>!!x.paused_until);}
    case'prayer.rules.resume':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,active,paused_until FROM sanad_prayer_rules WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>Number(x.active)===1&&!x.paused_until);}
    case'prayer.rules.skip':{const r=await mutationRowV127(env,'sanad_prayer_rules',chatId,args.id);return !!r&&parseJsonV125(r.exceptions_json,[]).includes(args.date);}
    case'live.watch.create':return !!(await mutationRowV127(env,'sanad_live_watches',chatId,result.id));
    case'live.watch.stop':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,active FROM sanad_live_watches WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>Number(x.active)===0);}
    case'inbox.add':return !!(await mutationRowV127(env,'sanad_life_inbox',chatId,result.id));
    case'inbox.close':{const qs=ids.map(()=>'?').join(',');const rows=(await env.DB.prepare(`SELECT id,status FROM sanad_life_inbox WHERE chat_id=? AND id IN (${qs})`).bind(chatId,...ids).all())?.results||[];return rows.length===ids.length&&rows.every(x=>x.status==='closed');}
    case'inbox.classify':{const r=await mutationRowV127(env,'sanad_life_inbox',chatId,args.id);return !!r&&String(r.classified_as)===String(args.classified_as);}
    case'audit.undo':return result.verified===true;
    case'system.clear_all':return result.verified===true&&Number(result.remaining||0)===0;
    default:return false;
  }
}
async function executeToolV127BeforeOperationDedupe(env,{chatId,operationId,stepKey,tool,args,user}){
  const spec=TOOL_SPECS[tool],prior=await env.DB.prepare(`SELECT result_json FROM sanad_receipts WHERE operation_id=? AND step_key=?`).bind(operationId,stepKey).first();
  if(prior){try{const saved=JSON.parse(prior.result_json);if(!spec?.mutation||await verifyMutationPostconditionV127(env,chatId,tool,args,saved))return saved;}catch(e){await reportFailure(env,chatId,'receipt_reverify',e,{operationId,stepKey,tool});}}
  if(spec?.mutation){const pre=await preflightMutationIdsV127(env,chatId,tool,args);if(pre){await env.DB.prepare(`INSERT OR REPLACE INTO sanad_receipts(operation_id,step_key,chat_id,tool,result_json,created_at) VALUES(?,?,?,?,?,?)`).bind(operationId,stepKey,chatId,tool,JSON.stringify(pre),nowIso()).run();return pre;}}
  let result;try{result=await dispatchTool(env,chatId,tool,args,user)}catch(e){result={ok:false,changed:0,verified:false,error:safeError(e),retryable:true};}
  if(spec?.mutation&&result?.ok===true){let verified=false;try{verified=await verifyMutationPostconditionV127(env,chatId,tool,args,result)}catch(e){await reportFailure(env,chatId,'mutation_verify',e,{tool,args});}if(!verified)result={...result,ok:false,verified:false,error:'mutation_postcondition_failed'};else result={...result,verified:true};}
  await env.DB.prepare(`INSERT OR REPLACE INTO sanad_receipts(operation_id,step_key,chat_id,tool,result_json,created_at) VALUES(?,?,?,?,?,?)`).bind(operationId,stepKey,chatId,tool,JSON.stringify(result).slice(0,15000),nowIso()).run();
  await env.DB.prepare(`INSERT INTO sanad_audit(operation_id,chat_id,tool,args_json,result_json,verified,created_at) VALUES(?,?,?,?,?,?,?)`).bind(operationId,chatId,tool,JSON.stringify(args).slice(0,8000),JSON.stringify(result).slice(0,15000),result?.verified?1:0,nowIso()).run();return result;
}

function contextDomainsV127(text){const t=normItem(text),s=new Set();const hit=(d,re)=>{if(re.test(t))s.add(d)};hit('shopping',/(مشتريات|تسوق|سوبر ماركت|سوبرماركت|اشتري|اشترى|هجيب|لبن|عيش)/u);hit('schedule',/(موعد|فكرني|ذكرني|تذكير|النهارده|بكره|بكرة|الأسبوع|الاسبوع|فاضي|جدول|اجتماع)/u);hit('projects',/(مشروع|مهمه|مهمة|تاسك)/u);hit('waiting',/(مستني|متابعة|متابعه|الانبوكس|الإنبوكس|inbox)/u);hit('prayer',/(صلاة|الصلاة|الفجر|الظهر|العصر|المغرب|العشاء)/u);hit('live',/(طقس|جو|أخبار|اخبار|عطلة|اجازة|إجازة|هجري|مباشر)/u);hit('memory',/(فاكر|ذاكرة|الذاكرة|افتكر|انس|انسى|تفضيل)/u);hit('world',/(مين|مراتي|زوجتي|صاحبي|شخص|مكان|علاقة|علاقه)/u);hit('profile',/(موقعي|مكاني|مدينتي|تايم زون|توقيت|اعدادات|إعدادات)/u);if(!s.size){s.add('memory');s.add('world');}return s;}
async function relevantConversationV127(env,chatId,text){const rows=(await env.DB.prepare(`SELECT role,content,created_at FROM sanad_conversation WHERE chat_id=? ORDER BY id DESC LIMIT 30`).bind(chatId).all())?.results||[],q=new Set(normItem(text).split(/\s+/).filter(x=>x.length>2));const chosen=[];for(let i=0;i<rows.length;i++){const r=rows[i],tokens=normItem(r.content).split(/\s+/);if(i<6||tokens.some(x=>q.has(x)))chosen.push(r);if(chosen.length>=12)break;}return chosen.reverse();}
async function buildContext(env,chatId,user,userText){
  const domains=contextDomainsV127(userText),state={shopping:[],reminders:[],recurrences:[],memories:[],entities:[],projects:[],tasks:[],waiting:[],dependencies:[],prayer_rules:[],live_watches:[],inbox:[],shopping_session:null,loaded_domains:[...domains]};
  const jobs=[];
  if(domains.has('shopping'))jobs.push((async()=>{state.shopping=(await toolShoppingRead(env,chatId)).items;state.shopping_session=await env.DB.prepare(`SELECT id,place_name,started_at FROM sanad_shopping_sessions WHERE chat_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`).bind(chatId).first();})());
  if(domains.has('schedule'))jobs.push((async()=>{state.reminders=(await env.DB.prepare(`SELECT id,title,kind,local_date,local_time,duration_minutes,status FROM sanad_reminders WHERE chat_id=? AND status='active' ORDER BY local_date,local_time LIMIT 80`).bind(chatId).all())?.results||[];state.recurrences=(await env.DB.prepare(`SELECT id,title,kind,rule_json,start_date,end_date,active,fired_count FROM sanad_recurrences WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 50`).bind(chatId).all())?.results||[];state.dependencies=(await env.DB.prepare(`SELECT * FROM sanad_dependencies WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 60`).bind(chatId).all())?.results||[];})());
  if(domains.has('projects'))jobs.push((async()=>{state.projects=(await env.DB.prepare(`SELECT id,title,status,priority,deadline,progress FROM sanad_projects WHERE chat_id=? AND status!='done' ORDER BY id DESC LIMIT 40`).bind(chatId).all())?.results||[];state.tasks=(await env.DB.prepare(`SELECT id,project_id,title,status,due_at,priority FROM sanad_project_tasks WHERE chat_id=? AND status!='done' ORDER BY id DESC LIMIT 60`).bind(chatId).all())?.results||[];})());
  if(domains.has('waiting'))jobs.push((async()=>{state.waiting=(await env.DB.prepare(`SELECT * FROM sanad_waiting WHERE chat_id=? AND status='waiting' ORDER BY id DESC LIMIT 40`).bind(chatId).all())?.results||[];state.inbox=(await toolLifeInboxReadV126(env,chatId,{status:'open'})).items;})());
  if(domains.has('prayer'))jobs.push((async()=>{state.prayer_rules=(await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 30`).bind(chatId).all())?.results||[];})());
  if(domains.has('live'))jobs.push((async()=>{state.live_watches=(await env.DB.prepare(`SELECT id,query,last_url FROM sanad_live_watches WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 30`).bind(chatId).all())?.results||[];})());
  if(domains.has('memory')||domains.size<=2)jobs.push((async()=>{state.memories=(await env.DB.prepare(`SELECT id,memory_type,content,importance FROM sanad_memories WHERE chat_id=? ORDER BY importance DESC,id DESC LIMIT 25`).bind(chatId).all())?.results||[];})());
  if(domains.has('world')||domains.size<=2)jobs.push((async()=>{state.entities=(await env.DB.prepare(`SELECT id,entity_type,name,data_json,confidence,source FROM sanad_entities WHERE chat_id=? AND (source='user_explicit' OR confidence>=?) ORDER BY confidence DESC,id DESC LIMIT 25`).bind(chatId,V127_TRUSTED_WORLD_CONFIDENCE).all())?.results||[];})());
  await Promise.all(jobs);const conversation=await relevantConversationV127(env,chatId,userText);return{now:localNow(user?.timezone||TZ),profile:{display_name:user?.display_name||'',timezone:user?.timezone||TZ,city:user?.city||DEFAULT_CITY,country:user?.country||DEFAULT_COUNTRY,country_code:user?.country_code||'EG',latitude:user?.latitude??null,longitude:user?.longitude??null,autonomy_mode:user?.autonomy_mode||'full_safe',proactive_enabled:Number(user?.proactive_enabled??1),deep_reasoning_mode:user?.deep_reasoning_mode||'auto'},user_text:userText,conversation,state};
}

async function recordModelAttemptV126(env,id,{ok,latency,error}){try{await env.DB.prepare(`INSERT INTO sanad_model_stats(model_id,attempts,successes,failures,total_latency_ms,last_latency_ms,last_error,updated_at) VALUES(?,1,?,?,?,?,?,?) ON CONFLICT(model_id) DO UPDATE SET attempts=attempts+1,successes=successes+excluded.successes,failures=failures+excluded.failures,total_latency_ms=total_latency_ms+excluded.total_latency_ms,last_latency_ms=excluded.last_latency_ms,last_error=excluded.last_error,updated_at=excluded.updated_at`).bind(id,ok?1:0,ok?0:1,Number(latency||0),Number(latency||0),error?String(error).slice(0,500):null,nowIso()).run();}catch(e){console.error('model_stats',e);try{await reportFailure(env,null,'model_stats',e,{model_id:id})}catch(inner){console.error('model_stats_failure_log',inner)}}}

async function sendOnceV125(env,chatId,key,text){
  let kb=null;const m=String(key).match(/^rem:(\d+):/);if(m)kb={inline_keyboard:[[{text:'✅ تم',callback_data:`s126:rem:done:${m[1]}`},{text:'⏰ +10 د',callback_data:`s126:rem:snooze:${m[1]}:10`},{text:'🕐 +1 س',callback_data:`s126:rem:snooze:${m[1]}:60`}]]};
  const claim=await env.DB.prepare(`INSERT OR IGNORE INTO sanad_proactive_fires(chat_id,fire_key,sent_at) VALUES(?,?,?)`).bind(String(chatId),String(key),nowIso()).run();if(Number(claim?.meta?.changes||0)===0)return false;
  try{await sendText(env,String(chatId),text,kb);await env.DB.prepare(`UPDATE sanad_proactive_fires SET sent_at=? WHERE chat_id=? AND fire_key=?`).bind(nowIso(),String(chatId),String(key)).run();return true}catch(e){await env.DB.prepare(`DELETE FROM sanad_proactive_fires WHERE chat_id=? AND fire_key=?`).bind(String(chatId),String(key)).run();throw e;}
}

function localAtMsV127(ms,tz){return epochToLocalV126(Number(ms),tz||TZ)}
async function claimRecurrenceFireV127(env,r,o,off,chatId,text){const ins=await env.DB.prepare(`INSERT OR IGNORE INTO sanad_recurrence_fires(rule_id,occurrence_key,alert_offset,chat_id,sent_at) VALUES(?,?,?,?,?)`).bind(Number(r.id),o.key,off,chatId,nowIso()).run();if(Number(ins?.meta?.changes||0)===0)return false;try{await sendText(env,chatId,text);return true}catch(e){await env.DB.prepare(`DELETE FROM sanad_recurrence_fires WHERE rule_id=? AND occurrence_key=? AND alert_offset=?`).bind(Number(r.id),o.key,off).run();throw e}}
async function claimPrayerFireV127(env,r,date,chatId,text){const ins=await env.DB.prepare(`INSERT OR IGNORE INTO sanad_prayer_fires(rule_id,occurrence_date,chat_id,sent_at) VALUES(?,?,?,?)`).bind(Number(r.id),date,chatId,nowIso()).run();if(Number(ins?.meta?.changes||0)===0)return false;try{await sendText(env,chatId,text);return true}catch(e){await env.DB.prepare(`DELETE FROM sanad_prayer_fires WHERE rule_id=? AND occurrence_date=?`).bind(Number(r.id),date).run();throw e}}
async function deliverUserScheduleV125(env,u,lastMs,nowMs){
  const chatId=String(u.chat_id),ln=localAtMsV127(nowMs,u.timezone||TZ),from=addDaysV125(ln.date,-1),to=addDaysV125(ln.date,1),one=(await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND status='active' AND sent=0 AND local_date BETWEEN ? AND ?`).bind(chatId,from,to).all())?.results||[];
  for(const r of one){const main=zonedLocalToEpochV125(r.local_date,r.local_time,u.timezone||TZ),offsets=[0,...parseJsonV125(r.advance_json,[]),Number(r.advance_minutes||0)].map(Number).filter((v,i,a)=>v>=0&&a.indexOf(v)===i);for(const off of offsets){const fire=main-off*60000;if(fire<=lastMs||fire>nowMs)continue;const key=`rem:${r.id}:${r.local_date}:${r.local_time}:${off}`,label=off?`⏰ تذكير مسبق (${off} دقيقة): ${r.title}`:`⏰ ${r.title}`;let delivered=await sendOnceV125(env,chatId,key,label);const claimExists=delivered||!!(await env.DB.prepare(`SELECT 1 x FROM sanad_proactive_fires WHERE chat_id=? AND fire_key=?`).bind(chatId,key).first());if(claimExists){await env.DB.prepare(`INSERT OR IGNORE INTO sanad_reminder_fires(reminder_id,fire_key,chat_id,sent_at) VALUES(?,?,?,?)`).bind(Number(r.id),key,chatId,nowIso()).run();if(off===0)await env.DB.prepare(`UPDATE sanad_reminders SET sent=1,updated_at=? WHERE chat_id=? AND id=?`).bind(nowIso(),chatId,Number(r.id)).run();}}}
  const rules=(await env.DB.prepare(`SELECT * FROM sanad_recurrences WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?)`).bind(chatId,to,from).all())?.results||[];for(const r of rules){if(r.paused_until&&Date.parse(String(r.paused_until))>nowMs)continue;for(const o of generateRecurrenceOccurrencesV125(r,from,to,100)){const main=zonedLocalToEpochV125(o.date,o.time,u.timezone||TZ),offsets=[0,...parseJsonV125(r.advance_json,[])].map(Number).filter((v,i,a)=>v>=0&&a.indexOf(v)===i);for(const off of offsets){const fire=main-off*60000;if(fire<=lastMs||fire>nowMs)continue;const sent=await claimRecurrenceFireV127(env,r,o,off,chatId,off?`⏰ تذكير مسبق (${off} دقيقة): ${r.title}`:`🔁 ${r.title}`);if(sent&&off===0)await env.DB.prepare(`UPDATE sanad_recurrences SET fired_count=fired_count+1,updated_at=? WHERE chat_id=? AND id=?`).bind(nowIso(),chatId,Number(r.id)).run();}}}
}
async function deliverPrayerRulesV125(env,u,lastMs,nowMs){const chatId=String(u.chat_id),ln=localAtMsV127(nowMs,u.timezone||TZ),rules=(await env.DB.prepare(`SELECT * FROM sanad_prayer_rules WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?)`).bind(chatId,ln.date,ln.date).all())?.results||[];if(!rules.length)return;const data=await fetchPrayerTimesV125(env,u,ln.date);for(const r of rules){if(r.paused_until&&Date.parse(String(r.paused_until))>nowMs)continue;if(parseJsonV125(r.exceptions_json,[]).includes(ln.date))continue;const days=parseJsonV125(r.weekdays_json,[]).map(Number);if(days.length&&!days.includes(isoWeekdayV125(ln.date)))continue;const base=data.times[r.prayer];if(!base)continue;const shifted=addMinutesLocal(ln.date,base,Number(r.offset_minutes||0)),fire=zonedLocalToEpochV125(shifted.date,shifted.time,u.timezone||TZ);if(fire<=lastMs||fire>nowMs)continue;const sent=await claimPrayerFireV127(env,r,ln.date,chatId,`🕌 ${r.title}`);if(sent)await env.DB.prepare(`UPDATE sanad_prayer_rules SET fired_count=fired_count+1,updated_at=? WHERE chat_id=? AND id=?`).bind(nowIso(),chatId,Number(r.id)).run();}}
async function deliverDailyBriefsV125(env,u,lastMs=Date.now()-60000,nowMs=Date.now()){const chatId=String(u.chat_id),tz=u.timezone||TZ,start=localAtMsV127(lastMs,tz).date,end=localAtMsV127(nowMs,tz).date;for(const type of ['morning','evening']){const enabled=Number(u[`${type}_brief_enabled`]||0),time=String(u[`${type}_brief_time`]||(type==='morning'?'08:00':'20:00'));if(!enabled||!validTimeV125(time))continue;for(let date=start,guard=0;date<=end&&guard++<4;date=addDaysV125(date,1)){const fire=zonedLocalToEpochV125(date,time,tz);if(fire<=lastMs||fire>nowMs)continue;const claim=await env.DB.prepare(`INSERT OR IGNORE INTO sanad_daily_brief_fires(chat_id,brief_date,brief_type,sent_at) VALUES(?,?,?,?)`).bind(chatId,date,type,nowIso()).run();if(Number(claim?.meta?.changes||0)===0)continue;try{await sendText(env,chatId,await buildBriefV125(env,{...u},type));await env.DB.prepare(`UPDATE sanad_daily_brief_fires SET sent_at=? WHERE chat_id=? AND brief_date=? AND brief_type=?`).bind(nowIso(),chatId,date,type).run();}catch(e){await env.DB.prepare(`DELETE FROM sanad_daily_brief_fires WHERE chat_id=? AND brief_date=? AND brief_type=?`).bind(chatId,date,type).run();throw e;}}}}
async function checkLiveWatchesV125(env){let cursor=Number((await env.DB.prepare(`SELECT value FROM sanad_scheduler_state WHERE key='live_watch_cursor'`).first())?.value||0),processed=0,ok=true;for(let page=0;page<V127_WATCH_PAGES_PER_RUN;page++){const rows=(await env.DB.prepare(`SELECT * FROM sanad_live_watches WHERE active=1 AND id>? ORDER BY id LIMIT ?`).bind(cursor,V127_WATCH_PAGE_SIZE).all())?.results||[];if(!rows.length){cursor=0;await env.DB.prepare(`INSERT INTO sanad_scheduler_state(key,value,updated_at) VALUES('live_watch_cursor','0',?) ON CONFLICT(key) DO UPDATE SET value='0',updated_at=excluded.updated_at`).bind(nowIso()).run();break;}for(const w of rows){cursor=Number(w.id);processed++;try{const news=await fetchNewsV125(w.query,3),top=news[0];if(top?.url&&top.url!==w.last_url){if(w.last_url)await sendText(env,String(w.chat_id),`🛰️ جديد في متابعة "${w.query}":\n${top.title}\n${top.url}`);await env.DB.prepare(`UPDATE sanad_live_watches SET last_url=?,updated_at=? WHERE id=?`).bind(top.url,nowIso(),Number(w.id)).run();}}catch(e){ok=false;await reportFailure(env,String(w.chat_id),'live_watch',e,{watch_id:w.id});}}if(rows.length<V127_WATCH_PAGE_SIZE){cursor=0;break;}}
  await env.DB.prepare(`INSERT INTO sanad_scheduler_state(key,value,updated_at) VALUES('live_watch_cursor',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(String(cursor),nowIso()).run();return{ok,processed,cursor};}
async function runSanadScheduler(env,scheduledTime){
  const nowMs=Number(scheduledTime||Date.now()),lastRow=await env.DB.prepare(`SELECT value FROM sanad_scheduler_state WHERE key='last_run_ms'`).first(),last=Math.max(nowMs-SCHEDULER_CATCHUP_MINUTES*60000,Number(lastRow?.value||nowMs-60000));let cursor=String((await env.DB.prepare(`SELECT value FROM sanad_scheduler_state WHERE key='scheduler_user_cursor'`).first())?.value||''),roundOk=true,complete=false;
  for(let page=0;page<V127_USER_PAGES_PER_RUN;page++){const rows=(await env.DB.prepare(`SELECT * FROM sanad_users WHERE chat_id>? ORDER BY chat_id LIMIT ?`).bind(cursor,V127_USER_PAGE_SIZE).all())?.results||[];if(!rows.length){complete=true;cursor='';break;}for(const u of rows){cursor=String(u.chat_id);try{await deliverUserScheduleV125(env,u,last,nowMs);await deliverPrayerRulesV125(env,u,last,nowMs);await deliverDailyBriefsV125(env,u,last,nowMs);if(Number(u.proactive_enabled??1))await proactiveUserV125(env,u);}catch(e){roundOk=false;await reportFailure(env,String(u.chat_id),'scheduler_user',e,{window_start:last,window_end:nowMs});}}if(rows.length<V127_USER_PAGE_SIZE){complete=true;cursor='';break;}}
  await env.DB.prepare(`INSERT INTO sanad_scheduler_state(key,value,updated_at) VALUES('scheduler_user_cursor',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(cursor,nowIso()).run();const watches=await checkLiveWatchesV125(env);if(!watches.ok)roundOk=false;
  if(complete&&roundOk)await env.DB.prepare(`INSERT INTO sanad_scheduler_state(key,value,updated_at) VALUES('last_run_ms',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(String(nowMs),nowIso()).run();return{ok:complete&&roundOk,complete,roundOk,last,nowMs,cursor};
}

async function drainInbox(env,chatId,origin=''){
  const owner=`lease-${crypto.randomUUID()}`;let acquired=false;for(let i=0;i<16;i++){if(await acquireLease(env,chatId,owner)){acquired=true;break}await sleep(550+Math.floor(Math.random()*100));}if(!acquired){if(origin)await triggerDrain(env,chatId,origin);return;}
  let needsNext=false;try{const row=await nextInbox(env,chatId);if(!row)return;const now=nowIso(),until=new Date(Date.now()+Math.max(INBOX_LEASE_MS,AI_TOTAL_BUDGET_MS+20000)).toISOString(),claimed=await env.DB.prepare(`UPDATE sanad_inbox SET status='processing',attempts=attempts+1,lease_until=?,updated_at=? WHERE update_id=? AND chat_id=? AND (status='pending' OR lease_until IS NULL OR lease_until<=?) RETURNING attempts`).bind(until,now,String(row.update_id),String(chatId),now).first();if(!claimed)return;const attempts=Number(claimed.attempts||1);if(attempts>1)await env.DB.prepare(`DELETE FROM sanad_updates WHERE update_id=? AND status!='done'`).bind(String(row.update_id)).run();try{await processTelegramUpdate(env,JSON.parse(String(row.payload_json||'{}')));await env.DB.prepare(`UPDATE sanad_inbox SET status='done',lease_until=NULL,last_error=NULL,updated_at=? WHERE update_id=?`).bind(nowIso(),String(row.update_id)).run();}catch(e){const terminal=attempts>=INBOX_MAX_ATTEMPTS;await env.DB.prepare(`UPDATE sanad_inbox SET status=?,lease_until=NULL,last_error=?,updated_at=? WHERE update_id=?`).bind(terminal?'failed':'pending',safeError(e),nowIso(),String(row.update_id)).run();await reportFailure(env,chatId,'inbox',e,{update_id:row.update_id,attempts,terminal});}finally{needsNext=!!(await nextInbox(env,chatId));}}finally{await releaseLease(env,chatId,owner).catch(e=>console.error('releaseLease',e));}
  if(needsNext&&origin)await triggerDrain(env,chatId,origin);
}
async function recoverPendingInbox(env){for(let round=0;round<V127_RECOVERY_ROUNDS;round++){const rows=(await env.DB.prepare(`SELECT chat_id,MIN(created_at) first_at FROM sanad_inbox WHERE status='pending' OR (status='processing' AND (lease_until IS NULL OR lease_until<=?)) GROUP BY chat_id ORDER BY first_at,chat_id LIMIT ?`).bind(nowIso(),V127_RECOVERY_PAGE_SIZE).all())?.results||[];if(!rows.length)break;for(const r of rows)await drainInbox(env,String(r.chat_id));if(rows.length<V127_RECOVERY_PAGE_SIZE)break;}}

async function toolSystemClearAllV125(env,chatId){let changed=0;for(const t of CLEAR_USER_TABLES_V126){if(!(await tableExistsV125(env,t)))continue;const cols=await columnsV125(env,t);if(!cols.some(x=>String(x.name)==='chat_id'))continue;const r=await env.DB.prepare(`DELETE FROM ${t} WHERE chat_id=?`).bind(String(chatId)).run();changed+=Number(r?.meta?.changes||0);}for(const t of LEGACY_CLEAR_TABLES_V126){if(!(await tableExistsV125(env,t)))continue;const cols=await columnsV125(env,t);if(!cols.some(x=>String(x.name)==='chat_id'))continue;await env.DB.prepare(`DELETE FROM ${t} WHERE chat_id=?`).bind(String(chatId)).run();}let left=0;for(const t of SNAPSHOT_TABLES_V126){if(!(await tableExistsV125(env,t)))continue;const cols=await columnsV125(env,t);if(!cols.some(x=>String(x.name)==='chat_id'))continue;left+=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM ${t} WHERE chat_id=?`).bind(String(chatId)).first())?.c||0);}return{ok:left===0,changed,verified:left===0,remaining:left,preserved_execution_ledgers:['sanad_inbox','sanad_updates','sanad_receipts','sanad_operation_snapshots']};}


/* V12.7 per-operation semantic mutation dedupe */
function stableJsonV127(value){return JSON.stringify(canonicalValueV127(value));}
function fnv64V127(text){let h=1469598103934665603n;for(const ch of String(text)){h^=BigInt(ch.codePointAt(0)||0);h=BigInt.asUintN(64,h*1099511628211n);}return h.toString(16).padStart(16,'0');}
function mutationFingerprintV127(tool,args){
  if(!TOOL_SPECS[String(tool||'')]?.mutation)return null;
  const t=String(tool),a=args&&typeof args==='object'?args:{};
  if(t==='schedule.shift')return `reminder-shift:${Number(a.id)||0}:${Math.trunc(Number(a.minutes)||0)}`;
  if(t==='schedule.bulk_shift')return `reminder-bulk-shift:${[...(a.ids||[])].map(Number).filter(Boolean).sort((x,y)=>x-y).join(',')}:${Math.trunc(Number(a.minutes)||0)}`;
  return `${t}:${fnv64V127(stableJsonV127(a))}`;
}
async function executeTool(env,{chatId,operationId,stepKey,tool,args,user}){
  const fp=mutationFingerprintV127(tool,args),fpKey=fp?`mutation-fp:${fnv64V127(fp)}`:null;
  if(fpKey){
    const prior=await env.DB.prepare(`SELECT result_json FROM sanad_receipts WHERE operation_id=? AND step_key=?`).bind(operationId,fpKey).first();
    if(prior){
      try{
        const p=JSON.parse(prior.result_json);
        if(p?.ok===true&&p?.verified===true){return{ok:true,changed:0,verified:true,deduplicated:true,original_changed:Number(p.changed||0),fingerprint:fp};}
      }catch(e){await reportFailure(env,chatId,'mutation_dedupe_receipt',e,{operationId,tool,fingerprint:fp});}
    }
  }
  let result=await executeToolV127BeforeOperationDedupe(env,{chatId,operationId,stepKey,tool,args,user});
  if(TOOL_SPECS[String(tool||'')]?.mutation&&result?.ok===true){
    let verified=false;try{verified=await verifyMutationPostconditionV127(env,chatId,tool,args,result)}catch(e){await reportFailure(env,chatId,'mutation_wrapper_verify',e,{operationId,tool,stepKey});}
    if(!verified)result={...result,ok:false,verified:false,error:'mutation_wrapper_postcondition_failed'};
  }
  if(fpKey&&result?.ok===true&&result?.verified===true&&Number(result?.changed||0)>0){
    await env.DB.prepare(`INSERT OR IGNORE INTO sanad_receipts(operation_id,step_key,chat_id,tool,result_json,created_at) VALUES(?,?,?,?,?,?)`).bind(operationId,fpKey,chatId,tool,JSON.stringify(result).slice(0,15000),nowIso()).run();
  }
  return result;
}

async function deepSelftestV127(env){
  const chat='__sanad_v127_selftest__',tests=[];
  /** @param {string} name @param {any} ok @param {any} [detail] */
  const add=(name,ok,detail='')=>tests.push({name,ok:!!ok,detail:String(detail??'')});
  const tables=['sanad_shopping','sanad_shopping_sessions','sanad_reminders','sanad_reminder_fires','sanad_recurrences','sanad_recurrence_fires','sanad_dependencies','sanad_memories','sanad_entities','sanad_edges','sanad_projects','sanad_project_tasks','sanad_waiting','sanad_prayer_rules','sanad_prayer_fires','sanad_live_watches','sanad_life_inbox','sanad_operation_snapshots','sanad_receipts','sanad_audit','sanad_failures','sanad_proactive_fires','sanad_daily_brief_fires','sanad_pending_actions','sanad_pending_conflicts','sanad_users'];
  for(const t of tables)if(await tableExistsV125(env,t))try{await env.DB.prepare(`DELETE FROM ${t} WHERE chat_id=?`).bind(chat).run()}catch(e){add(`cleanup ${t}`,false,safeError(e));}
  try{
    let user=await ensureUser(env,chat,'V127Selftest');
    /** @type {any} */ let r=await toolReminderCancel(env,chat,{ids:[987654321]});add('missing reminder cancel rejected',!r.ok&&r.error==='ids_not_found',JSON.stringify(r));
    r=await toolMemoryForget(env,chat,{ids:[987654321]});add('missing memory forget rejected',!r.ok&&r.error==='ids_not_found',JSON.stringify(r));
    r=await toolProfileUpdateV125(env,chat,{timezone:'Not/A_Timezone'});add('invalid timezone rejected',!r.ok&&r.error==='invalid_timezone',JSON.stringify(r));
    r=await toolProfileUpdateV125(env,chat,{latitude:91});add('invalid latitude rejected',!r.ok&&r.error==='invalid_latitude',JSON.stringify(r));
    r=await toolProfileUpdateV125(env,chat,{morning_brief_time:'25:61'});add('invalid brief time rejected',!r.ok&&String(r.error).includes('morning_brief_time'),JSON.stringify(r));
    r=await toolProjectCreate(env,chat,{title:'اختبار 12.7',priority:'high'});const pid=Number(r.id);add('project fixture',r.ok&&pid>0,pid);
    r=await toolProjectTaskCreateV125(env,chat,{project_id:pid,title:'قبل التعديل'});const tid=Number(r.id);add('task fixture',r.ok&&tid>0,tid);
    r=await toolProjectTaskUpdateV125(env,chat,{id:tid,title:'بعد التعديل',status:'done',priority:'high',due_at:'2026-12-01T10:00:00Z'});add('task exact update verified',r.ok&&r.verified&&r.after?.title==='بعد التعديل'&&r.after?.status==='done'&&r.after?.priority==='high',JSON.stringify(r.after));
    r=await toolDependencyCreateV125(env,chat,{source_type:'project',source_id:1,target_type:'reminder',target_id:1,relation:'after_start'});add('unsupported dependency rejected',!r.ok&&r.error==='unsupported_dependency_type',JSON.stringify(r));
    r=await toolWorldUpsertV125(env,chat,{entity_type:'concept',name:'استنتاج تجريبي',data:{x:1}});add('inferred world default confidence',r.ok&&r.after?.source==='agent_inferred'&&Number(r.after?.confidence)===0.5,JSON.stringify(r.after));
    const snap=await snapshotUserStateV125(env,chat,[{tool:'shopping.add',args:{}}]);add('domain scoped snapshot',Object.keys(snap).every(x=>['sanad_shopping','sanad_shopping_sessions'].includes(x)),Object.keys(snap).join(','));
    add('fallback no-op no false success',!fallbackCompose([{tool:'shopping.add',ok:true,verified:true,changed:0}]).includes('✅'));
    add('fallback verified changed success',fallbackCompose([{tool:'shopping.add',ok:true,verified:true,changed:1}]).includes('✅'));
    add('context shopping routed',contextDomainsV127('ضيف لبن للمشتريات').has('shopping'));
    add('dependency spec closed',TOOL_SPECS['dependency.create']?.args?.source_type==='reminder'&&TOOL_SPECS['dependency.create']?.args?.target_type==='reminder');
    await env.DB.prepare(`INSERT INTO sanad_meta(key,value,updated_at) VALUES('ci_silent_telegram','1',?) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at`).bind(nowIso()).run();
    const key='v127-selftest-sendonce';await env.DB.prepare(`DELETE FROM sanad_proactive_fires WHERE chat_id=? AND fire_key=?`).bind(chat,key).run();const first=await sendOnceV125(env,chat,key,'test'),second=await sendOnceV125(env,chat,key,'test');add('sendOnce atomic single claim',first===true&&second===false,`${first}/${second}`);
    user=await ensureUser(env,chat);r=await toolReminderCreate(env,chat,{title:'اختبار منع التكرار',local_date:'2026-12-15',local_time:'10:00'},user);const rid=Number(r.id);add('dedupe reminder fixture',r.ok&&rid>0,rid);
    const op='v127-dedupe-op';const shiftArgs={source_type:'reminder',id:rid,minutes:30};const sh1=await executeTool(env,{chatId:chat,operationId:op,stepKey:'1:schedule.shift',tool:'schedule.shift',args:shiftArgs,user}),sh2=await executeTool(env,{chatId:chat,operationId:op,stepKey:'completion:1:schedule.shift',tool:'schedule.shift',args:shiftArgs,user});const shifted=await env.DB.prepare(`SELECT local_time FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chat,rid).first();add('duplicate temporal mutation suppressed',sh1.ok&&Number(sh1.changed)>0&&sh2.ok&&sh2.deduplicated===true&&Number(sh2.changed)===0&&shifted?.local_time==='10:30',JSON.stringify({sh1,sh2,shifted}));
    await toolProfileUpdateV125(env,chat,{timezone:'UTC',morning_brief_enabled:1,morning_brief_time:'08:00'});user=await ensureUser(env,chat);const d='2026-08-18',last=Date.parse(`${d}T07:59:00Z`),now=Date.parse(`${d}T08:01:00Z`);await env.DB.prepare(`DELETE FROM sanad_daily_brief_fires WHERE chat_id=? AND brief_date=? AND brief_type='morning'`).bind(chat,d).run();await deliverDailyBriefsV125(env,user,last,now);const brief=await env.DB.prepare(`SELECT 1 x FROM sanad_daily_brief_fires WHERE chat_id=? AND brief_date=? AND brief_type='morning'`).bind(chat,d).first();add('daily brief window not exact minute',!!brief);
  }catch(e){add('selftest exception',false,safeError(e));}
  try{await env.DB.prepare(`INSERT INTO sanad_meta(key,value,updated_at) VALUES('ci_silent_telegram','0',?) ON CONFLICT(key) DO UPDATE SET value='0',updated_at=excluded.updated_at`).bind(nowIso()).run()}catch(e){console.error('v127_selftest_unmute',e)}
  return{ok:tests.every(x=>x.ok),version:VERSION,tests};
}
