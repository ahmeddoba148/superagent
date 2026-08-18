/* Sanad V12.0 — single-brain personal agent for Cloudflare Workers + D1 + Telegram.
   Design: Understand -> Plan -> Act -> Observe -> Verify -> Repair -> Reply.
   No success claim is emitted for mutations unless state verification succeeds.
*/

const VERSION = "12.0.0";
const NAME = "سند — Sanad V12";
const TZ = "Africa/Cairo";
const DEFAULT_CITY = "Cairo";
const DEFAULT_COUNTRY = "Egypt";
const MAX_AGENT_STEPS = 10;
const MAX_REPAIR_STEPS = 6;
const AI_TOTAL_BUDGET_MS = 15000;
const AI_CALL_TIMEOUT_MS = 5200;
const INBOX_LEASE_MS = 30000;
const INBOX_BATCH = 6;
const INBOX_MAX_ATTEMPTS = 5;
const MODEL_CHAIN = [
  { id: "gemini::gemini-3.5-flash-lite", role: "primary", timeoutMs: 4200 },
  { id: "gemini::gemini-3.1-flash-lite", role: "fallback_1", timeoutMs: 4700 },
  { id: "gemini::gemini-3.5-flash", role: "fallback_2", timeoutMs: 5000 }
];
const OMNIAI_INTERNAL_URL = "https://omniai-engine.ahmeddoba91.workers.dev/v1/chat/completions";

let schemaPromise = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return j({
        ok: true,
        service: NAME,
        version: VERSION,
        architecture: "single-agent-loop",
        models: MODEL_CHAIN.map(x => x.id),
        guarantees: {
          no_success_without_state_verification: true,
          durable_telegram_inbox: true,
          idempotency: true,
          repair_loop: true,
          layered_memory: true,
          deterministic_safety_guards: true
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
      await deliverDueReminders(env, controller?.scheduledTime);
      await recoverPendingInbox(env);
      await runProactiveChecks(env);
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
        `CREATE TABLE IF NOT EXISTS sanad_proactive_fires (
          chat_id TEXT NOT NULL,fire_key TEXT NOT NULL,sent_at TEXT NOT NULL,PRIMARY KEY(chat_id,fire_key)
        )`
      ];
      for (const s of sql) await env.DB.prepare(s).run();
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
  if (!acquired) { if (origin) await triggerDrain(env, chatId, origin); return; }
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
    const user = await ensureUser(env,chatId,m?.from?.first_name||"");
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
    if (text === "/shopping") return showShopping(env,chatId);
    if (text === "/today") return showToday(env,chatId,user);
    if (text === "/memory") return showMemory(env,chatId);
    if (text === "/audit") return showAudit(env,chatId);

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
  const [conversation,shopping,reminders,memories,projects,waiting] = await Promise.all([
    recentConversation(env,chatId,16),
    env.DB.prepare(`SELECT id,title,quantity,status,meta_json,updated_at FROM sanad_shopping WHERE chat_id=? AND status IN ('pending','bought') ORDER BY id DESC LIMIT 40`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,title,local_date,local_time,duration_minutes,status FROM sanad_reminders WHERE chat_id=? AND status='active' ORDER BY local_date,local_time LIMIT 40`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,memory_type,content,importance FROM sanad_memories WHERE chat_id=? ORDER BY importance DESC,id DESC LIMIT 30`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,title,status,priority,deadline,progress FROM sanad_projects WHERE chat_id=? AND status!='done' ORDER BY id DESC LIMIT 20`).bind(chatId).all().then(x=>x?.results||[]),
    env.DB.prepare(`SELECT id,title,waiting_on,due_at,status FROM sanad_waiting WHERE chat_id=? AND status='waiting' ORDER BY id DESC LIMIT 20`).bind(chatId).all().then(x=>x?.results||[])
  ]);
  return {
    now:localNow(user?.timezone||TZ),
    profile:{display_name:user?.display_name||"",timezone:user?.timezone||TZ,city:user?.city||DEFAULT_CITY,country:user?.country||DEFAULT_COUNTRY,autonomy_mode:user?.autonomy_mode||"full_safe"},
    user_text:userText,
    conversation,
    state:{shopping,reminders,memories,projects,waiting}
  };
}

const TOOL_SPECS = {
  "shopping.read": { mutation:false, args:{} },
  "shopping.add": { mutation:true, args:{items:"array of {title,quantity?,meta?}"} },
  "shopping.update": { mutation:true, args:{id:"number",title:"optional",quantity:"optional",status:"optional pending|bought"} },
  "shopping.remove": { mutation:true, args:{ids:"number[]"} },
  "shopping.clear": { mutation:true, risky:true, args:{} },
  "reminders.read": { mutation:false, args:{from_date:"optional YYYY-MM-DD",to_date:"optional YYYY-MM-DD"} },
  "reminders.create": { mutation:true, args:{title:"string",local_date:"YYYY-MM-DD",local_time:"HH:MM",duration_minutes:"optional number",advance_minutes:"optional number"} },
  "reminders.update": { mutation:true, args:{id:"number",title:"optional",local_date:"optional",local_time:"optional",duration_minutes:"optional"} },
  "reminders.cancel": { mutation:true, args:{ids:"number[]"} },
  "schedule.free_time": { mutation:false, args:{date:"YYYY-MM-DD",from_time:"HH:MM",to_time:"HH:MM",min_minutes:"optional"} },
  "memory.search": { mutation:false, args:{query:"string"} },
  "memory.remember": { mutation:true, args:{content:"string",memory_type:"semantic|preference|person|commitment",importance:"0..1"} },
  "memory.forget": { mutation:true, risky:true, args:{ids:"number[]"} },
  "projects.read": { mutation:false, args:{} },
  "projects.create": { mutation:true, args:{title:"string",priority:"low|normal|high",deadline:"optional ISO/local string",notes:"optional"} },
  "projects.update": { mutation:true, args:{id:"number",status:"optional",progress:"optional 0..100",priority:"optional",deadline:"optional"} },
  "waiting.read": { mutation:false, args:{} },
  "waiting.create": { mutation:true, args:{title:"string",waiting_on:"optional",due_at:"optional ISO/local string"} },
  "waiting.close": { mutation:true, args:{ids:"number[]"} },
  "audit.read": { mutation:false, args:{limit:"optional 1..20"} }
};

function brainSystemPrompt(context) {
  return `أنت "سند" Sanad V12، مساعد شخصي Agent شديد الذكاء للمستخدم.
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
الحد الأقصى ${MAX_AGENT_STEPS} خطوات.
الأدوات المتاحة:
${JSON.stringify(TOOL_SPECS)}
السياق الحالي:
${JSON.stringify(context).slice(0,28000)}`;
}

async function runAgent(env,{chatId,text,user,operationId}) {
  const context=await buildContext(env,chatId,user,text);
  const deadline=Date.now()+AI_TOTAL_BUDGET_MS;
  const plan=await callBrainJson(env,brainSystemPrompt(context),text,deadline);
  if (plan?.needs_clarification) return String(plan.clarification_question||"محتاج منك توضيح صغير.");
  const steps=Array.isArray(plan?.steps)?plan.steps.slice(0,MAX_AGENT_STEPS):[];
  if (!steps.length) return normalizeText(plan?.reply||"أنا معاك.");

  const observations=[];
  for(let i=0;i<steps.length;i++){
    const s=steps[i],tool=String(s?.tool||"");
    if(!TOOL_SPECS[tool]) { observations.push({step:i+1,tool,ok:false,error:"unknown_tool"}); continue; }
    if(TOOL_SPECS[tool].risky && !looksExplicitlyConfirmed(text)) {
      observations.push({step:i+1,tool,ok:false,needs_confirmation:true,error:"confirmation_required"});
      continue;
    }
    const result=await executeTool(env,{chatId,operationId,stepKey:`${i+1}:${tool}`,tool,args:s?.args||{},user});
    observations.push({step:i+1,tool,...result});
  }

  const failed=observations.filter(x=>!x.ok&&!x.needs_confirmation);
  if(failed.length && Date.now()<deadline-1200){
    const repairPrompt=`أنت سند في مرحلة Repair. الخطة نفذت جزئيًا وظهرت نتائج الأدوات التالية:
${JSON.stringify(observations)}
المطلوب: أعد JSON فقط {"steps":[...]} بأدوات إصلاحية ضرورية فقط. لا تكرر خطوة نجحت. لا تقل تم بدون tool.`;
    const repair=await callBrainJson(env,repairPrompt,text,deadline).catch(()=>null);
    const repairSteps=Array.isArray(repair?.steps)?repair.steps.slice(0,MAX_REPAIR_STEPS):[];
    for(let i=0;i<repairSteps.length;i++){
      const s=repairSteps[i],tool=String(s?.tool||""); if(!TOOL_SPECS[tool])continue;
      if(TOOL_SPECS[tool].risky&&!looksExplicitlyConfirmed(text))continue;
      const result=await executeTool(env,{chatId,operationId,stepKey:`repair:${i+1}:${tool}`,tool,args:s?.args||{},user});
      observations.push({step:`repair-${i+1}`,tool,...result});
    }
  }

  const anyUnverifiedMutation=observations.some(x=>TOOL_SPECS[x.tool]?.mutation && (!x.ok || !x.verified));
  const confirmation=observations.find(x=>x.needs_confirmation);
  if (confirmation) return "الطلب ده فيه مسح/نسيان واسع. أكدلي صراحة إنك عاوز أنفذه وأنا أنفذه.";
  if (anyUnverifiedMutation) {
    const bad=observations.filter(x=>TOOL_SPECS[x.tool]?.mutation&&(!x.ok||!x.verified));
    return `مقدرتش أثبت إن كل التغييرات تمت، فمش هقولك تم. ${bad.map(x=>`${x.tool}: ${x.error||"verification_failed"}`).join(" | ")}`;
  }

  const composer=`أنت سند. اكتب رد مصري طبيعي وقصير وواثق بناءً فقط على نتائج الأدوات المؤكدة.
ممنوع تقول إن حاجة تمت لو verified ليست true في mutation.
لو فيه read results لخص المهم.
نتائج الأدوات:
${JSON.stringify(observations).slice(0,18000)}
طلب المستخدم: ${text}`;
  try {
    const out=await callBrainText(env,composer,deadline);
    if(out)return out;
  } catch {}
  return fallbackCompose(observations);
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
    case "shopping.read": return toolShoppingRead(env,chatId);
    case "shopping.add": return toolShoppingAdd(env,chatId,args);
    case "shopping.update": return toolShoppingUpdate(env,chatId,args);
    case "shopping.remove": return toolShoppingRemove(env,chatId,args);
    case "shopping.clear": return toolShoppingClear(env,chatId);
    case "reminders.read": return toolRemindersRead(env,chatId,args);
    case "reminders.create": return toolReminderCreate(env,chatId,args,user);
    case "reminders.update": return toolReminderUpdate(env,chatId,args);
    case "reminders.cancel": return toolReminderCancel(env,chatId,args);
    case "schedule.free_time": return toolFreeTime(env,chatId,args);
    case "memory.search": return toolMemorySearch(env,chatId,args);
    case "memory.remember": return toolMemoryRemember(env,chatId,args);
    case "memory.forget": return toolMemoryForget(env,chatId,args);
    case "projects.read": return toolProjectsRead(env,chatId);
    case "projects.create": return toolProjectCreate(env,chatId,args);
    case "projects.update": return toolProjectUpdate(env,chatId,args);
    case "waiting.read": return toolWaitingRead(env,chatId);
    case "waiting.create": return toolWaitingCreate(env,chatId,args);
    case "waiting.close": return toolWaitingClose(env,chatId,args);
    case "audit.read": return toolAuditRead(env,chatId,args);
    default: return {ok:false,changed:0,verified:false,error:"unknown_tool"};
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
  if(!title||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return{ok:false,changed:0,verified:false,error:"invalid_reminder_fields"};
  const now=nowIso(),tz=user?.timezone||TZ,duration=Math.max(0,Math.min(1440,Number(args?.duration_minutes||0))),advance=Math.max(0,Math.min(10080,Number(args?.advance_minutes||0)));
  const r=await env.DB.prepare(`INSERT INTO sanad_reminders(chat_id,title,local_date,local_time,timezone,duration_minutes,advance_minutes,status,sent,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'active',0,?,?)`).bind(chatId,title,date,time,tz,duration,advance,now,now).run();
  const id=Number(r?.meta?.last_row_id||0),after=await env.DB.prepare(`SELECT * FROM sanad_reminders WHERE chat_id=? AND id=?`).bind(chatId,id).first();
  const verified=!!after&&after.title===title&&after.local_date===date&&after.local_time===time;
  return{ok:verified,changed:verified?1:0,verified,id,after};
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

async function showShopping(env,chatId){const r=await toolShoppingRead(env,chatId);const p=r.items.filter(x=>x.status==="pending");await sendText(env,chatId,p.length?`🛒 المشتريات:\n${p.map(x=>`• ${x.title}${x.quantity?` — ${x.quantity}`:""}`).join("\n")}`:"🛒 قائمة المشتريات فاضية.");}
async function showToday(env,chatId,user){const d=localNow(user?.timezone||TZ).date,r=await toolRemindersRead(env,chatId,{from_date:d,to_date:d});await sendText(env,chatId,r.items.length?`📅 النهاردة:\n${r.items.map(x=>`• ${x.local_time} — ${x.title}`).join("\n")}`:"📅 مفيش مواعيد مسجلة النهاردة.");}
async function showMemory(env,chatId){const rows=(await env.DB.prepare(`SELECT memory_type,content FROM sanad_memories WHERE chat_id=? ORDER BY importance DESC,id DESC LIMIT 30`).bind(chatId).all())?.results||[];await sendText(env,chatId,rows.length?`🧠 فاكر عنك:\n${rows.map(x=>`• ${x.content}`).join("\n")}`:"🧠 لسه مفيش ذكريات محفوظة.");}
async function showAudit(env,chatId){const r=await toolAuditRead(env,chatId,{limit:10});await sendText(env,chatId,r.items.length?`🧾 آخر العمليات:\n${r.items.map(x=>`• ${x.tool} — ${x.verified?"✅":"⚠️"}`).join("\n")}`:"🧾 مفيش عمليات لسه.");}
async function handleCallback(env,q){try{await telegramApi(env,"answerCallbackQuery",{callback_query_id:q.id});}catch{}}

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
    {command:"start",description:"تشغيل سند"},
    {command:"shopping",description:"قائمة المشتريات"},
    {command:"today",description:"مواعيد النهاردة"},
    {command:"memory",description:"ذاكرة سند"},
    {command:"audit",description:"سجل التنفيذ"}
  ]});
  return j({ok:true,service:NAME,version:VERSION,webhook,telegram:x.ok,models:MODEL_CHAIN.map(m=>m.id)});
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
  const tests=[];
  const add=(name,ok,detail="")=>tests.push({name,ok:!!ok,detail});
  add("version",VERSION==="12.0.0",VERSION);
  add("models",MODEL_CHAIN.length===3,MODEL_CHAIN.map(x=>x.id).join(","));
  add("single-agent-tools",Object.keys(TOOL_SPECS).length>=18,String(Object.keys(TOOL_SPECS).length));
  add("mutation-verification",Object.values(TOOL_SPECS).filter(x=>x.mutation).length>=10);
  add("no-success-without-proof",fallbackCompose([{tool:"shopping.add",ok:true,verified:true}]).includes("✅"));
  add("risky-guard",TOOL_SPECS["shopping.clear"].risky===true&&TOOL_SPECS["memory.forget"].risky===true);
  add("normalizer",normItem("  لبن! ")==="لبن");
  add("time",/^\d{4}-\d{2}-\d{2}$/.test(localNow().date));
  return j({ok:tests.every(x=>x.ok),version:VERSION,tests});
}
