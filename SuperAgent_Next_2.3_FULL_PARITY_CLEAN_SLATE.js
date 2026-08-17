/*
 * SuperAgent Next 2.3 — FULL CLEAN-SLATE AGENT
 * ------------------------------------------------------------
 * Single-file Cloudflare Worker designed to replace the old Worker code
 * while keeping the same Cloudflare bindings/secrets:
 *   DB, OMNIAI_SERVICE, OMNIAI_API_KEY,
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, ADMIN_CHAT_ID, SETUP_KEY.
 *
 * Architecture:
 * Telegram -> durable D1 inbox -> semantic router -> typed planner ->
 * deterministic executor -> D1 -> post-condition verifier -> reply.
 *
 * Key invariant: model text is NEVER proof that an action succeeded.
 * A success reply is generated only after deterministic verification.
 *
 * Clean-slate tables use the sa2_* prefix; legacy V1–V10.x tables are untouched.
 */

const VERSION = "2.3.0-clean-slate-full-parity";
const DEFAULT_TIMEZONE = "Africa/Cairo";
const ROUTER_TIMEOUTS_MS = [1250, 1650, 2100];
const PLANNER_TIMEOUT_MS = 9000;
const CHAT_TIMEOUT_MS = 8500;
const MAX_HISTORY = 24;
const MAX_PLAN_OPERATIONS = 40;
const MAX_CANDIDATES = 5;
const MAX_SHOPPING_ITEMS = 300;
const PENDING_TTL_MINUTES = 30;
const LEASE_MS = 50000;
const QUEUE_BATCH = 4;
const QUEUE_MAX_ATTEMPTS = 5;
const UNDO_DEPTH = 10;
const DELIVERY_LATE_WINDOW_MS = 6 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// MODEL REGISTRY — exactly 10 fast + 10 complex execution models.
// Router: primary + two fallbacks.
// -----------------------------------------------------------------------------
const ROUTER_MODELS = [
  "gemini::gemini-3.5-flash-lite",
  "groq::openai/gpt-oss-20b",
  "mistral::ministral-8b-latest",
];

const FAST_MODELS = [
  { id:"gemini::gemini-3.5-flash-lite", provider:"gemini", tags:["chat","json","vision","multilingual","fast"], strength:7.9, latency:1 },
  { id:"gemini::gemini-3.5-flash", provider:"gemini", tags:["chat","json","vision","tools","multilingual","fast"], strength:8.6, latency:2 },
  { id:"groq::openai/gpt-oss-20b", provider:"groq", tags:["chat","json","reasoning","tools","fast"], strength:8.5, latency:1 },
  { id:"groq::qwen/qwen3.6-27b", provider:"groq", tags:["chat","json","reasoning","tools","coding","fast"], strength:9.0, latency:1 },
  { id:"mistral::ministral-3b-latest", provider:"mistral", tags:["chat","tools","fast"], strength:6.8, latency:1 },
  { id:"mistral::ministral-8b-latest", provider:"mistral", tags:["chat","tools","json","fast","multilingual"], strength:7.5, latency:1 },
  { id:"mistral::mistral-small-2603", provider:"mistral", tags:["chat","tools","json","fast","multilingual"], strength:8.3, latency:2 },
  { id:"nvidia::deepseek-ai/deepseek-v4-flash", provider:"nvidia", tags:["chat","reasoning","fast"], strength:8.4, latency:2 },
  { id:"nvidia::stepfun-ai/step-3.7-flash", provider:"nvidia", tags:["chat","reasoning","fast"], strength:8.1, latency:2 },
  { id:"nvidia::nvidia/nemotron-3-nano-30b-a3b", provider:"nvidia", tags:["chat","reasoning","fast"], strength:8.1, latency:2 },
];

const COMPLEX_MODELS = [
  { id:"gemini::gemini-3.6-flash", provider:"gemini", tags:["chat","json","vision","tools","reasoning","agentic","long-context","coding"], strength:9.5, latency:2 },
  { id:"gemini::gemini-pro-latest", provider:"gemini", tags:["chat","json","vision","tools","reasoning","agentic","long-context"], strength:9.7, latency:4 },
  { id:"groq::openai/gpt-oss-120b", provider:"groq", tags:["chat","json","reasoning","tools","agentic","coding","fast"], strength:9.5, latency:2 },
  { id:"mistral::mistral-large-latest", provider:"mistral", tags:["chat","tools","reasoning","agentic","coding"], strength:9.2, latency:3 },
  { id:"mistral::mistral-medium-latest", provider:"mistral", tags:["chat","tools","reasoning","agentic"], strength:8.9, latency:3 },
  { id:"mistral::magistral-medium-latest", provider:"mistral", tags:["chat","tools","reasoning"], strength:9.0, latency:4 },
  { id:"nvidia::deepseek-ai/deepseek-v4-pro", provider:"nvidia", tags:["chat","reasoning","agentic","coding"], strength:9.3, latency:3 },
  { id:"nvidia::qwen/qwen3.5-397b-a17b", provider:"nvidia", tags:["chat","reasoning","agentic","coding"], strength:9.4, latency:4 },
  { id:"nvidia::nvidia/nemotron-3-super-120b-a12b", provider:"nvidia", tags:["chat","reasoning","agentic"], strength:9.1, latency:3 },
  { id:"nvidia::nvidia/nemotron-3-ultra-550b-a55b", provider:"nvidia", tags:["chat","reasoning","agentic","last-resort"], strength:9.8, latency:5 },
];
const ALL_MODELS = [...FAST_MODELS, ...COMPLEX_MODELS];

// -----------------------------------------------------------------------------
// SMALL UTILITIES
// -----------------------------------------------------------------------------
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const clamp = (n,a,b) => Math.min(b,Math.max(a,Number(n)||0));
const asArray = v => Array.isArray(v) ? v : [];
const safeJson = (s, fallback=null) => { try { return JSON.parse(String(s)); } catch { return fallback; } };
const compact = (s,n=280) => { s=String(s??"").replace(/\s+/g," ").trim(); return s.length<=n?s:s.slice(0,n-1)+"…"; };
const num = (v,d=null) => { const n=Number(v); return Number.isFinite(n)?n:d; };
const bool = v => !!v;
const str = (v,n=500) => String(v??"").trim().slice(0,n);
const escHtml = s => String(s??"").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

function normalizeArabic(value){
  return String(value||"").normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g,"")
    .replace(/[إأآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه")
    .replace(/ـ/g,"")
    .replace(/\s+/g," ").trim().toLowerCase();
}
function normKey(value){
  return normalizeArabic(value).replace(/[^\p{L}\p{N}\s]/gu,"").replace(/\s+/g," ").trim();
}
function isPlaceholderOnly(value){
  const t=normKey(value); if(!t)return false;
  const stop=new Set([
    "ال","من","في","فى","علي","على","ده","دا","دي","دى","دول","النوع","نوع","الحاجه","الحاجة",
    "واحد","واحده","واحدة","منه","منها","نفسه","نفسها","نفس","اللي","اللى","الى","الذي","التي",
    "قولتلك","قلتلك","عليه","عليها","بتاع","بتاعه","بتاعها","كبير","كبيره","كبيرة","الكبير","الكبيره",
    "الكبيرة","صغير","صغيره","صغيرة","الصغير","الصغيره","الصغيرة","وسط","الوسط","متوسط","اخر","آخر",
    "الاخير","الأخير","الاول","الأول","التاني","الثاني","التالته","الثالث","هنا","هناك"
  ]);
  const xs=t.split(/\s+/).filter(Boolean);
  return xs.length>0 && xs.every(x=>/^\d+(?:[.,]\d+)?$/.test(x)||stop.has(x));
}
function parseLooseJson(text){
  const raw=String(text||"").trim();
  const tries=[raw,raw.replace(/^```json\s*/i,"").replace(/```$/i,"").trim(),raw.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean);
  for(const x of tries){ try { return JSON.parse(x); } catch {} }
  return null;
}
function isDate(v){ return /^\d{4}-\d{2}-\d{2}$/.test(String(v||"")); }
function isTime(v){ return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(v||"")); }
function dateKey(y,m,d){ return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }

function zonedParts(date=new Date(), zone=DEFAULT_TIMEZONE){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",weekday:"short"
  }).formatToParts(date);
  const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const dowMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}:${o.minute}`,second:o.second,dow:dowMap[o.weekday]??0,year:+o.year,month:+o.month,day:+o.day,hour:+o.hour,minute:+o.minute};
}
function localToEpoch(date,time,zone=DEFAULT_TIMEZONE){
  const [y,m,d]=String(date).split("-").map(Number), [hh,mm]=String(time).split(":").map(Number);
  if(!y||!m||!d||!Number.isFinite(hh)||!Number.isFinite(mm)) return NaN;
  let guess=Date.UTC(y,m-1,d,hh,mm,0);
  for(let i=0;i<3;i++){
    const p=zonedParts(new Date(guess),zone);
    const rendered=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,0);
    const wanted=Date.UTC(y,m-1,d,hh,mm,0);
    guess += wanted-rendered;
  }
  return guess;
}
function epochToLocal(epoch,zone=DEFAULT_TIMEZONE){
  const p=zonedParts(new Date(epoch),zone); return {date:p.date,time:p.time,dow:p.dow};
}
function addLocalMinutes(date,time,minutes,zone=DEFAULT_TIMEZONE){
  const e=localToEpoch(date,time,zone); return epochToLocal(e+Number(minutes||0)*60000,zone);
}
function daysBetween(a,b){
  const [ay,am,ad]=a.split("-").map(Number),[by,bm,bd]=b.split("-").map(Number);
  return Math.floor((Date.UTC(by,bm-1,bd)-Date.UTC(ay,am-1,ad))/86400000);
}
function monthsBetween(a,b){
  const [ay,am]=a.split("-").map(Number),[by,bm]=b.split("-").map(Number); return (by-ay)*12+(bm-am);
}
function yearsBetween(a,b){ return Number(b.slice(0,4))-Number(a.slice(0,4)); }

// -----------------------------------------------------------------------------
// D1 SCHEMA — NEW sa2_* TABLES ONLY.
// -----------------------------------------------------------------------------
async function ensureSchema(env){
  const sql=[
`CREATE TABLE IF NOT EXISTS sa2_users(
  chat_id TEXT PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Africa/Cairo', locale TEXT NOT NULL DEFAULT 'ar-EG',
  quiet_start TEXT, quiet_end TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS sa2_conversation(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
`CREATE INDEX IF NOT EXISTS sa2_idx_conv ON sa2_conversation(chat_id,id)`,
`CREATE TABLE IF NOT EXISTS sa2_memories(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(chat_id,key)
)`,
`CREATE TABLE IF NOT EXISTS sa2_shopping_lists(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
  budget REAL, store TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(chat_id,normalized_name)
)`,
`CREATE TABLE IF NOT EXISTS sa2_shopping_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER NOT NULL, chat_id TEXT NOT NULL,
  title TEXT NOT NULL, normalized_title TEXT NOT NULL, quantity_value REAL, quantity_unit TEXT,
  brand TEXT, size TEXT, store TEXT, category TEXT, priority INTEGER NOT NULL DEFAULT 0,
  optional INTEGER NOT NULL DEFAULT 0, notes TEXT, status TEXT NOT NULL DEFAULT 'pending',
  position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE INDEX IF NOT EXISTS sa2_idx_shop ON sa2_shopping_items(chat_id,list_id,status,position,id)`,
`CREATE TABLE IF NOT EXISTS sa2_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, title TEXT NOT NULL,
  local_date TEXT NOT NULL, local_time TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', notes TEXT, location TEXT,
  priority INTEGER NOT NULL DEFAULT 0, alert_offsets_json TEXT NOT NULL DEFAULT '[0]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE INDEX IF NOT EXISTS sa2_idx_events ON sa2_events(chat_id,status,local_date,local_time,id)`,
`CREATE TABLE IF NOT EXISTS sa2_rules(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, title TEXT NOT NULL,
  interval_n INTEGER NOT NULL DEFAULT 1, interval_unit TEXT NOT NULL,
  weekdays_json TEXT NOT NULL DEFAULT '[]', monthdays_json TEXT NOT NULL DEFAULT '[]',
  local_time TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL, end_date TEXT, count_limit INTEGER,
  timezone TEXT NOT NULL, alert_offsets_json TEXT NOT NULL DEFAULT '[0]',
  status TEXT NOT NULL DEFAULT 'active', notes TEXT, location TEXT, priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE INDEX IF NOT EXISTS sa2_idx_rules ON sa2_rules(chat_id,status,start_date,end_date,id)`,
`CREATE TABLE IF NOT EXISTS sa2_rule_exceptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INTEGER NOT NULL, chat_id TEXT NOT NULL,
  local_date TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, UNIQUE(rule_id,local_date)
)`,
`CREATE TABLE IF NOT EXISTS sa2_rule_fires(
  id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INTEGER NOT NULL, chat_id TEXT NOT NULL,
  occurrence_key TEXT NOT NULL, alert_offset INTEGER NOT NULL DEFAULT 0, sent_at TEXT NOT NULL,
  UNIQUE(rule_id,occurrence_key,alert_offset)
)`,
`CREATE TABLE IF NOT EXISTS sa2_event_deliveries(
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, chat_id TEXT NOT NULL,
  alert_offset INTEGER NOT NULL DEFAULT 0, sent_at TEXT NOT NULL,
  UNIQUE(event_id,alert_offset)
)`,
`CREATE TABLE IF NOT EXISTS sa2_dependencies(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, source_event_id INTEGER NOT NULL,
  target_event_id INTEGER NOT NULL, relation TEXT NOT NULL, offset_min INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, UNIQUE(chat_id,source_event_id,target_event_id)
)`,
`CREATE TABLE IF NOT EXISTS sa2_pending(
  chat_id TEXT PRIMARY KEY, kind TEXT NOT NULL, base_text TEXT NOT NULL, question TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}', expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS sa2_undo(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
  description TEXT, consumed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
)`,
`CREATE INDEX IF NOT EXISTS sa2_idx_undo ON sa2_undo(chat_id,consumed,id)`,
`CREATE TABLE IF NOT EXISTS sa2_operation_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, request_id TEXT NOT NULL,
  route_json TEXT, plan_json TEXT, before_json TEXT, after_json TEXT, verification_json TEXT,
  status TEXT NOT NULL, error TEXT, model_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE INDEX IF NOT EXISTS sa2_idx_oplog ON sa2_operation_log(chat_id,id)`,
`CREATE TABLE IF NOT EXISTS sa2_model_stats(
  model_id TEXT PRIMARY KEY, provider TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
  validation_failures INTEGER NOT NULL DEFAULT 0, total_latency_ms INTEGER NOT NULL DEFAULT 0,
  last_latency_ms INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS sa2_telegram_updates(
  update_id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE INDEX IF NOT EXISTS sa2_idx_queue ON sa2_telegram_updates(status,next_retry_at,update_id)`,
`CREATE TABLE IF NOT EXISTS sa2_profiles(
  chat_id TEXT PRIMARY KEY, latitude REAL, longitude REAL, city TEXT, country TEXT, country_code TEXT NOT NULL DEFAULT 'EG',
  updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS sa2_objects(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, object_type TEXT NOT NULL,
  name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  parent_id INTEGER, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE INDEX IF NOT EXISTS sa2_idx_objects ON sa2_objects(chat_id,object_type,status,normalized_name,id)`,
`CREATE TABLE IF NOT EXISTS sa2_prayer_rules(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, title TEXT NOT NULL, prayer TEXT NOT NULL,
  offset_minutes INTEGER NOT NULL DEFAULT 0, start_date TEXT NOT NULL, end_date TEXT,
  weekdays_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE INDEX IF NOT EXISTS sa2_idx_prayer_rules ON sa2_prayer_rules(chat_id,active,start_date,end_date,id)`,
`CREATE TABLE IF NOT EXISTS sa2_prayer_fires(
  id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INTEGER NOT NULL, chat_id TEXT NOT NULL,
  local_date TEXT NOT NULL, sent_at TEXT NOT NULL, UNIQUE(rule_id,local_date)
)`,
`CREATE TABLE IF NOT EXISTS sa2_settings(
  chat_id TEXT PRIMARY KEY, permission_mode TEXT NOT NULL DEFAULT 'safe_auto', proactive_enabled INTEGER NOT NULL DEFAULT 1,
  morning_brief_enabled INTEGER NOT NULL DEFAULT 0, evening_brief_enabled INTEGER NOT NULL DEFAULT 0,
  ask_before_delete INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS sa2_brief_fires(
  chat_id TEXT NOT NULL, local_date TEXT NOT NULL, brief_type TEXT NOT NULL, sent_at TEXT NOT NULL,
  PRIMARY KEY(chat_id,local_date,brief_type)
)`,
`CREATE TABLE IF NOT EXISTS sa2_chat_leases(
  chat_id TEXT PRIMARY KEY, lease_token TEXT NOT NULL, lease_until TEXT NOT NULL, updated_at TEXT NOT NULL
)`
  ];
  for(const q of sql) await env.DB.prepare(q).run();
  // Forward-compatible migration if an earlier clean-slate build was briefly deployed.
  await ensureSa2Column(env,"sa2_profiles","country_code","TEXT NOT NULL DEFAULT 'EG'");
}
async function ensureSa2Column(env,table,column,definition){
  const allowed=new Set(["sa2_profiles","sa2_users","sa2_settings","sa2_objects","sa2_events","sa2_rules","sa2_shopping_items"]);
  if(!allowed.has(table))throw new Error("unsafe_schema_table");
  const rows=(await env.DB.prepare(`PRAGMA table_info(${table})`).all())?.results||[];
  if(!rows.some(r=>String(r.name)===column)){
    try{await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();}
    catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e;}
  }
}
async function ensureUser(env,chatId){
  const t=nowIso();
  await env.DB.prepare(`INSERT OR IGNORE INTO sa2_users(chat_id,created_at,updated_at) VALUES (?,?,?)`).bind(chatId,t,t).run();
  return env.DB.prepare(`SELECT * FROM sa2_users WHERE chat_id=?`).bind(chatId).first();
}

// -----------------------------------------------------------------------------
// MODEL CLIENT + ADAPTIVE STATS
// -----------------------------------------------------------------------------
function timeoutController(ms){
  const c=new AbortController(); const timer=setTimeout(()=>c.abort(new Error("timeout")),ms);
  return {signal:c.signal,cancel:()=>clearTimeout(timer)};
}
async function recordModel(env,model,{ok,latencyMs,error=null,validationFailure=false}){
  try{
    const provider=String(model).split("::")[0]||"unknown",t=nowIso();
    await env.DB.prepare(`INSERT INTO sa2_model_stats(model_id,provider,attempts,successes,failures,validation_failures,total_latency_ms,last_latency_ms,last_error,updated_at)
      VALUES (?,?,1,?,?,?,?,?,?,?)
      ON CONFLICT(model_id) DO UPDATE SET
      attempts=attempts+1,successes=successes+excluded.successes,failures=failures+excluded.failures,
      validation_failures=validation_failures+excluded.validation_failures,total_latency_ms=total_latency_ms+excluded.total_latency_ms,
      last_latency_ms=excluded.last_latency_ms,last_error=excluded.last_error,updated_at=excluded.updated_at`)
      .bind(model,provider,ok?1:0,ok?0:1,validationFailure?1:0,Math.max(0,Number(latencyMs)||0),Math.max(0,Number(latencyMs)||0),error,t).run();
  }catch{}
}
async function modelStatsMap(env){
  const rows=(await env.DB.prepare(`SELECT * FROM sa2_model_stats`).all())?.results||[];
  return new Map(rows.map(r=>[String(r.model_id),r]));
}
function extractModelText(j){
  return String(j?.choices?.[0]?.message?.content ?? j?.output_text ?? j?.text ?? "").trim();
}
async function callModel(env,{model,messages,temperature=.05,maxTokens=2200,timeoutMs=8000,json=false}){
  if(!env.OMNIAI_SERVICE) throw new Error("OMNIAI_SERVICE missing");
  if(!env.OMNIAI_API_KEY) throw new Error("OMNIAI_API_KEY missing");
  const tc=timeoutController(timeoutMs),started=Date.now(); let ok=false,error=null;
  try{
    const body={model,messages,temperature,max_tokens:maxTokens,stream:false};
    if(json)body.response_format={type:"json_object"};
    const req=new Request(env.OMNIAI_INTERNAL_URL||"https://omniai-engine.internal/v1/chat/completions",{
      method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${env.OMNIAI_API_KEY}`},
      body:JSON.stringify(body),signal:tc.signal
    });
    const res=await env.OMNIAI_SERVICE.fetch(req),raw=await res.text(); let j=null; try{j=JSON.parse(raw)}catch{}
    if(!res.ok)throw new Error(j?.error?.message||`model_http_${res.status}`);
    const content=extractModelText(j); if(!content)throw new Error("empty_model_response");
    ok=true; return {model,content,latencyMs:Date.now()-started,raw:j};
  }catch(e){ error=String(e?.message||e); throw e; }
  finally{ tc.cancel(); await recordModel(env,model,{ok,latencyMs:Date.now()-started,error,validationFailure:false}); }
}

// -----------------------------------------------------------------------------
// SEMANTIC ROUTER — length is never a deciding signal.
// Local pass only short-circuits obvious casual chat; everything ambiguous gets AI routing.
// -----------------------------------------------------------------------------
function countMatches(t,re){ return (t.match(re)||[]).length; }
function localSignals(input){
  const raw=String(input?.text||""),n=normalizeArabic(raw),lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),words=n.split(/\s+/).filter(Boolean);
  const refs=countMatches(` ${n} `,/(?:^|\s)(?:ده|دي|دول|اللي|اللى|نفسه|نفسها|منه|منها|الكبير|الصغير|الاول|التاني|اخر\s+واحد|قولتلك|قلتلك|قبل\s+كده)(?=\s|$)/g);
  const temporal=countMatches(n,/(?:الساعه|بكره|غدا|النهارده|بعد\s+\d+|قبل\s+\d+|كل\s+(?:دقيقه|ساعة|ساعه|يوم|اسبوع|شهر|سنه)|صباح|مساء|ظهر|عصر|ليل)/g);
  const mutations=countMatches(n,/(?:ضيف|زود|حط|سجل|شيل|احذف|امسح|غير|بدل|خلي|انقل|الغ|اشتري|هات|جيب|فكرني|ذكرني|نبهني|اوقف|كمل|اجل|سنووز)/g);
  const compound=countMatches(n,/(?:وبعدين|بعدها|قبلها|كمان|وبعد|وقبل|لكن|بدل|ثم|وفي\s+نفس\s+الوقت)/g);
  const destructive=countMatches(n,/(?:امسح\s+كل|احذف\s+كل|الغ\s+كل|شيل\s+كل)/g);
  const code=/```|function\s+\w+|const\s+\w+|SELECT\s+.+FROM|Traceback|TypeError|ReferenceError/i.test(raw);
  const listLike=lines.length>=4&&lines.slice(1).every(x=>x.length<=120);
  const stateWords=/(?:مشتريات|طلبات\s+(?:البيت|المنزل)|الهايبر|السوبر\s*ماركت|موعد|ميعاد|تذكير|جدول|فاضي|فاضيه|سنووز|اجل|انقل|قائمه|ذاكره|فاكر)/.test(n);
  const liveInfo=/(?:احدث|آخر\s+اخبار|دلوقتي\s+سعر|سعر\s+اليوم|طقس|نتيجه\s+ماتش|بورصه|سهم)/.test(n);
  let complexity=Math.min(3,refs)*2 + Math.min(4,compound)*1.4 + Math.min(3,temporal)*.8 + destructive*2.8 + (code?1.8:0) + (liveInfo?1:0);
  if(listLike&&refs===0&&compound<=1)complexity-=1.2;
  if(words.length>250)complexity+=.25; // intentionally tiny
  const obviousChat=!stateWords&&!mutations&&!temporal&&!refs&&!code&&!liveInfo&&words.length<=45;
  return {obviousChat,complexity:Number(complexity.toFixed(2)),signals:{refs,temporal,mutations,compound,destructive,code,listLike,stateWords,liveInfo,words:words.length,lines:lines.length}};
}
const ROUTE_TASKS=new Set(["chat","shopping","schedule","memory","coding","vision","research","document","mixed","other"]);
function validateRoute(v){
  if(!v||typeof v!=="object")return null;
  if(!["easy","complex"].includes(v.route)||!ROUTE_TASKS.has(v.task))return null;
  return {route:v.route,task:v.task,risk:["low","medium","high"].includes(v.risk)?v.risk:"medium",needs_context:!!v.needs_context,needs_tools:!!v.needs_tools,needs_reasoning:!!v.needs_reasoning,confidence:clamp(v.confidence,0,1),reason:str(v.reason,180)};
}
function routerPrompt(text,local){
  return `أنت Router فقط، ممنوع تنفيذ طلب المستخدم. صنّف حسب المعنى لا طول الرسالة.\nJSON فقط:\n{"route":"easy|complex","task":"chat|shopping|schedule|memory|coding|vision|research|document|mixed|other","risk":"low|medium|high","needs_context":true,"needs_tools":true,"needs_reasoning":true,"confidence":0.0,"reason":"قصير"}\n\nقواعد حاسمة:\n- رسالة طويلة وتافهة/قائمة واضحة يمكن أن تكون easy.\n- رسالة قصيرة قد تكون complex لو تعتمد على سياق أو فيها عدة تغييرات أو تعارض/حذف/علاقات.\n- افهم طلبات البيت والهايبر والمشتريات بالمعنى، لا بالكلمات فقط.\n- فرّق بين «افتكر وإحنا بنشتري نجيب لبن» (shopping) وبين «فكرني بكرة 5 أجيب لبن» (schedule).\n- تعديل شيء سابق أو «اللي قولتلك عليه» يحتاج context.\n- لو الطلب مختلط shopping+schedule فـ task=mixed.\nإشارات محلية غير حاسمة:${JSON.stringify(local)}\nرسالة المستخدم:${JSON.stringify(text)}`;
}
async function aiRoute(env,text,local){
  const errors=[];
  for(let i=0;i<ROUTER_MODELS.length;i++){
    const model=ROUTER_MODELS[i];
    try{
      const r=await callModel(env,{model,messages:[{role:"system",content:"Return one valid compact JSON object only."},{role:"user",content:routerPrompt(text,local)}],temperature:0,maxTokens:220,timeoutMs:ROUTER_TIMEOUTS_MS[i],json:true});
      const v=validateRoute(parseLooseJson(r.content)); if(v)return {...v,routerModel:model,routerLatencyMs:r.latencyMs,routerErrors:errors};
      errors.push({model,error:"invalid_router_json"});
    }catch(e){ errors.push({model,error:compact(e?.message||e,140)}); }
  }
  return {route:"complex",task:"other",risk:"medium",needs_context:true,needs_tools:true,needs_reasoning:true,confidence:.25,reason:"router models unavailable; conservative escalation",routerModel:"conservative-fallback",routerLatencyMs:null,routerErrors:errors};
}
function wantedTags(task){
  switch(task){
    case"coding":return["coding","reasoning","tools"];
    case"vision":return["vision","reasoning"];
    case"research":return["tools","reasoning","long-context"];
    case"document":return["long-context","reasoning","json"];
    case"shopping":case"schedule":case"memory":case"mixed":return["json","tools","reasoning","agentic"];
    default:return["chat","multilingual"];
  }
}
async function rankModels(env,pool,decision){
  const stats=await modelStatsMap(env),wanted=wantedTags(decision.task);
  return [...pool].map(m=>{
    const s=stats.get(m.id),attempts=Number(s?.attempts||0),fails=Number(s?.failures||0),avg=attempts?Number(s?.total_latency_ms||0)/attempts:0,reliability=attempts?1-fails/attempts:.93;
    const tags=wanted.reduce((a,t)=>a+(m.tags.includes(t)?1:0),0);
    return {m,score:tags*2.2+m.strength*.25+(6-m.latency)*(decision.route==="easy"?.45:.12)+reliability*2.4-Math.min(2,avg/4500)};
  }).sort((a,b)=>b.score-a.score).map(x=>x.m);
}
function providerDiverse(xs,count){
  const out=[],seen=new Set();
  for(const m of xs){ if(!seen.has(m.provider)){out.push(m);seen.add(m.provider);if(out.length>=count)return out;} }
  for(const m of xs){ if(!out.some(x=>x.id===m.id))out.push(m); if(out.length>=count)break; }
  return out;
}
async function routeRequest(env,{text,attachments=[]}){
  const local=localSignals({text,attachments});
  let d;
  if(local.obviousChat){
    d={route:"easy",task:"chat",risk:"low",needs_context:false,needs_tools:false,needs_reasoning:false,confidence:.99,reason:"obvious casual chat",routerModel:"local-fast-path",routerLatencyMs:0,routerErrors:[]};
  }else d=await aiRoute(env,text,local);
  if(d.risk==="high")d.route="complex";
  const primary=d.route==="easy"?FAST_MODELS:COMPLEX_MODELS;
  const ranked=await rankModels(env,primary,d);
  let candidates=providerDiverse(ranked,3);
  const rescue=await rankModels(env,d.route==="easy"?COMPLEX_MODELS:primary,{...d,route:"complex"});
  for(const m of rescue){ if(!candidates.some(x=>x.id===m.id))candidates.push(m); if(candidates.length>=MAX_CANDIDATES)break; }
  return {...d,local,candidates};
}

// -----------------------------------------------------------------------------
// CONVERSATION + MEMORY
// -----------------------------------------------------------------------------
async function saveMessage(env,chatId,role,content){
  await env.DB.prepare(`INSERT INTO sa2_conversation(chat_id,role,content,created_at) VALUES (?,?,?,?)`).bind(chatId,role,String(content||"").slice(0,14000),nowIso()).run();
}
async function recentConversation(env,chatId,limit=MAX_HISTORY){
  const rows=(await env.DB.prepare(`SELECT role,content,created_at FROM sa2_conversation WHERE chat_id=? ORDER BY id DESC LIMIT ?`).bind(chatId,limit).all())?.results||[];
  return rows.reverse();
}
async function listMemories(env,chatId){ return (await env.DB.prepare(`SELECT key,value,confidence FROM sa2_memories WHERE chat_id=? ORDER BY updated_at DESC LIMIT 100`).bind(chatId).all())?.results||[]; }
async function setMemory(env,chatId,key,value,confidence=1){
  const t=nowIso();
  await env.DB.prepare(`INSERT INTO sa2_memories(chat_id,key,value,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value,confidence=excluded.confidence,updated_at=excluded.updated_at`).bind(chatId,key,value,confidence,t,t).run();
}
async function deleteMemory(env,chatId,key){ await env.DB.prepare(`DELETE FROM sa2_memories WHERE chat_id=? AND key=?`).bind(chatId,key).run(); }

// -----------------------------------------------------------------------------
// SHOPPING DOMAIN
// -----------------------------------------------------------------------------
async function defaultList(env,chatId,create=true){
  const nk=normKey("مشتريات"); let row=await env.DB.prepare(`SELECT * FROM sa2_shopping_lists WHERE chat_id=? AND normalized_name=?`).bind(chatId,nk).first();
  if(!row&&create){ const t=nowIso();const r=await env.DB.prepare(`INSERT INTO sa2_shopping_lists(chat_id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?)`).bind(chatId,"مشتريات",nk,t,t).run();row=await env.DB.prepare(`SELECT * FROM sa2_shopping_lists WHERE id=?`).bind(Number(r.meta.last_row_id)).first(); }
  return row||null;
}
async function shoppingItems(env,chatId,{includeDone=false}={}){
  const l=await defaultList(env,chatId,false); if(!l)return[];
  const where=includeDone?"status!='deleted'":"status='pending'";
  return (await env.DB.prepare(`SELECT * FROM sa2_shopping_items WHERE chat_id=? AND list_id=? AND ${where} ORDER BY priority DESC,position,id`).bind(chatId,l.id).all())?.results||[];
}
async function resolveShopping(env,chatId,target,{many=false}={}){
  const rows=await shoppingItems(env,chatId,{includeDone:true});
  if(target?.id){const hit=rows.filter(r=>Number(r.id)===Number(target.id));return hit;}
  const q=normKey(target?.query||""); if(!q)return target?.all?rows:[];
  const exact=rows.filter(r=>normKey(r.title)===q); if(exact.length)return exact;
  const partial=rows.filter(r=>normKey(r.title).includes(q)||q.includes(normKey(r.title)));
  return many?partial:partial;
}
function cleanShoppingInput(x){
  const title=str(x?.title,180); if(!title||isPlaceholderOnly(title))return null;
  const q=x?.quantity_value==null?null:num(x.quantity_value,null); if(x?.quantity_value!=null&&q==null)return null;
  return {title,quantity_value:q,quantity_unit:str(x?.quantity_unit,50)||null,brand:str(x?.brand,100)||null,size:str(x?.size,100)||null,store:str(x?.store,120)||null,category:str(x?.category,100)||null,priority:Math.trunc(clamp(x?.priority??0,0,5)),optional:bool(x?.optional),notes:str(x?.notes,600)||null};
}
async function addShoppingItem(env,chatId,x){
  const item=cleanShoppingInput(x); if(!item)throw new Error("invalid_shopping_item");
  const l=await defaultList(env,chatId,true),t=nowIso(),nk=normKey(item.title);
  const ex=await env.DB.prepare(`SELECT * FROM sa2_shopping_items WHERE chat_id=? AND list_id=? AND normalized_title=? AND status!='deleted' ORDER BY id DESC LIMIT 1`).bind(chatId,l.id,nk).first();
  if(ex){
    await env.DB.prepare(`UPDATE sa2_shopping_items SET quantity_value=?,quantity_unit=?,brand=?,size=?,store=?,category=?,priority=?,optional=?,notes=?,status='pending',updated_at=? WHERE id=?`).bind(item.quantity_value??ex.quantity_value,item.quantity_unit??ex.quantity_unit,item.brand??ex.brand,item.size??ex.size,item.store??ex.store,item.category??ex.category,item.priority??ex.priority,item.optional?1:ex.optional,item.notes??ex.notes,t,ex.id).run();return Number(ex.id);
  }
  const p=Number((await env.DB.prepare(`SELECT COALESCE(MAX(position),0)+1 p FROM sa2_shopping_items WHERE chat_id=? AND list_id=?`).bind(chatId,l.id).first())?.p||1);
  const r=await env.DB.prepare(`INSERT INTO sa2_shopping_items(list_id,chat_id,title,normalized_title,quantity_value,quantity_unit,brand,size,store,category,priority,optional,notes,status,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`).bind(l.id,chatId,item.title,nk,item.quantity_value,item.quantity_unit,item.brand,item.size,item.store,item.category,item.priority,item.optional?1:0,item.notes,p,t,t).run();
  return Number(r.meta.last_row_id);
}
async function updateShoppingItem(env,chatId,id,patch){
  const r=await env.DB.prepare(`SELECT * FROM sa2_shopping_items WHERE id=? AND chat_id=? AND status!='deleted'`).bind(id,chatId).first(); if(!r)throw new Error("shopping_target_missing");
  let q=r.quantity_value;if(patch.quantity_value!=null)q=num(patch.quantity_value,q);if(patch.quantity_delta!=null)q=Number(q||0)+Number(patch.quantity_delta);
  if(q!=null&&q<0)throw new Error("negative_quantity");
  const title=patch.title!=null?str(patch.title,180):r.title; if(!title||isPlaceholderOnly(title))throw new Error("invalid_shopping_title");
  await env.DB.prepare(`UPDATE sa2_shopping_items SET title=?,normalized_title=?,quantity_value=?,quantity_unit=?,brand=?,size=?,store=?,category=?,priority=?,optional=?,notes=?,updated_at=? WHERE id=? AND chat_id=?`).bind(title,normKey(title),q,patch.quantity_unit??r.quantity_unit,patch.brand??r.brand,patch.size??r.size,patch.store??r.store,patch.category??r.category,patch.priority!=null?Math.trunc(clamp(patch.priority,0,5)):r.priority,patch.optional!=null?(patch.optional?1:0):r.optional,patch.notes??r.notes,nowIso(),id,chatId).run();
}
async function removeShoppingItem(env,chatId,id){ await env.DB.prepare(`UPDATE sa2_shopping_items SET status='deleted',updated_at=? WHERE id=? AND chat_id=?`).bind(nowIso(),id,chatId).run(); }
async function setShoppingStatus(env,chatId,id,status){ await env.DB.prepare(`UPDATE sa2_shopping_items SET status=?,updated_at=? WHERE id=? AND chat_id=?`).bind(status,nowIso(),id,chatId).run(); }
async function clearShopping(env,chatId){ const l=await defaultList(env,chatId,false);if(l)await env.DB.prepare(`UPDATE sa2_shopping_items SET status='deleted',updated_at=? WHERE chat_id=? AND list_id=? AND status!='deleted'`).bind(nowIso(),chatId,l.id).run(); }

// -----------------------------------------------------------------------------
// SCHEDULE DOMAIN
// -----------------------------------------------------------------------------
function cleanEvent(r){return{id:Number(r.id),title:r.title,date:r.local_date,time:r.local_time,duration_min:Number(r.duration_min||0),timezone:r.timezone,status:r.status,notes:r.notes,location:r.location,priority:Number(r.priority||0),alert_offsets:safeJson(r.alert_offsets_json,[0])};}
function cleanRule(r){return{id:Number(r.id),title:r.title,interval_n:Number(r.interval_n||1),interval_unit:r.interval_unit,weekdays:safeJson(r.weekdays_json,[]),monthdays:safeJson(r.monthdays_json,[]),time:r.local_time,duration_min:Number(r.duration_min||0),start_date:r.start_date,end_date:r.end_date,count_limit:r.count_limit==null?null:Number(r.count_limit),timezone:r.timezone,status:r.status,alert_offsets:safeJson(r.alert_offsets_json,[0]),notes:r.notes,location:r.location,priority:Number(r.priority||0)};}
async function listEvents(env,chatId,{includeCompleted=false,fromDate=null,toDate=null}={}){
  let q=`SELECT * FROM sa2_events WHERE chat_id=? AND status ${includeCompleted?"!='deleted'":"='active'"}`;const binds=[chatId];
  if(fromDate){q+=` AND local_date>=?`;binds.push(fromDate);}if(toDate){q+=` AND local_date<=?`;binds.push(toDate);}q+=` ORDER BY local_date,local_time,id LIMIT 500`;
  return ((await env.DB.prepare(q).bind(...binds).all())?.results||[]).map(cleanEvent);
}
async function listRules(env,chatId,{activeOnly=true}={}){
  const q=`SELECT * FROM sa2_rules WHERE chat_id=? ${activeOnly?"AND status='active'":"AND status!='deleted'"} ORDER BY id LIMIT 300`;
  return ((await env.DB.prepare(q).bind(chatId).all())?.results||[]).map(cleanRule);
}
async function ruleExceptions(env,chatId){return (await env.DB.prepare(`SELECT rule_id,local_date,reason FROM sa2_rule_exceptions WHERE chat_id=?`).bind(chatId).all())?.results||[];}
async function resolveEvent(env,chatId,target,{many=false}={}){
  let rows=await listEvents(env,chatId,{includeCompleted:true});
  if(target?.id)return rows.filter(r=>r.id===Number(target.id));
  if(target?.date)rows=rows.filter(r=>r.date===target.date);
  if(target?.status)rows=rows.filter(r=>r.status===target.status);
  const q=normKey(target?.query||"");
  if(q){const ex=rows.filter(r=>normKey(r.title)===q);if(ex.length)return ex;rows=rows.filter(r=>normKey(r.title).includes(q)||q.includes(normKey(r.title)));}
  if(target?.all)return rows;
  return rows;
}
async function resolveRule(env,chatId,target){
  let rows=await listRules(env,chatId,{activeOnly:false}); if(target?.id)return rows.filter(r=>r.id===Number(target.id));
  const q=normKey(target?.query||"");if(q){const ex=rows.filter(r=>normKey(r.title)===q);if(ex.length)return ex;rows=rows.filter(r=>normKey(r.title).includes(q)||q.includes(normKey(r.title)));}
  return target?.all?rows:rows;
}
function eventInterval(e){const start=localToEpoch(e.date,e.time,e.timezone),end=start+Math.max(1,Number(e.duration_min||0))*60000;return{start,end};}
function overlap(a,b){return a.start<b.end&&b.start<a.end;}
async function conflictsFor(env,chatId,candidate,excludeId=null){
  const rows=await listEvents(env,chatId,{fromDate:candidate.date,toDate:candidate.date});const ci=eventInterval(candidate);
  return rows.filter(e=>e.id!==Number(excludeId||0)&&overlap(ci,eventInterval(e)));
}
function ruleMatchesOccurrence(rule,date,time){
  if(rule.status!=="active"||date<rule.start_date||(rule.end_date&&date>rule.end_date)||time!==rule.time)return false;
  const n=Math.max(1,Number(rule.interval_n||1)),unit=rule.interval_unit;
  if(unit==="minute"||unit==="hour"){
    const start=localToEpoch(rule.start_date,rule.time,rule.timezone),cur=localToEpoch(date,time,rule.timezone),diff=Math.floor((cur-start)/60000);if(diff<0)return false;return diff%(unit==="hour"?n*60:n)===0;
  }
  if(unit==="day")return daysBetween(rule.start_date,date)>=0&&daysBetween(rule.start_date,date)%n===0;
  if(unit==="week"){
    const dd=daysBetween(rule.start_date,date);if(dd<0||Math.floor(dd/7)%n!==0)return false;
    const dow=zonedParts(new Date(localToEpoch(date,time,rule.timezone)),rule.timezone).dow;
    const w=asArray(rule.weekdays).map(Number);return w.length?w.includes(dow):dow===zonedParts(new Date(localToEpoch(rule.start_date,rule.time,rule.timezone)),rule.timezone).dow;
  }
  if(unit==="month"){
    const md=monthsBetween(rule.start_date,date);if(md<0||md%n!==0)return false;const day=Number(date.slice(8,10)),set=asArray(rule.monthdays).map(Number);return set.length?set.includes(day):day===Number(rule.start_date.slice(8,10));
  }
  if(unit==="year"){
    const yd=yearsBetween(rule.start_date,date);if(yd<0||yd%n!==0)return false;return date.slice(5)===rule.start_date.slice(5);
  }
  return false;
}
async function ruleOccurs(env,chatId,rule,date,time){
  if(!ruleMatchesOccurrence(rule,date,time))return false;
  const ex=await env.DB.prepare(`SELECT 1 FROM sa2_rule_exceptions WHERE chat_id=? AND rule_id=? AND local_date=?`).bind(chatId,rule.id,date).first(); if(ex)return false;
  if(rule.count_limit!=null){const c=Number((await env.DB.prepare(`SELECT COUNT(DISTINCT occurrence_key) c FROM sa2_rule_fires WHERE chat_id=? AND rule_id=? AND alert_offset=0`).bind(chatId,rule.id).first())?.c||0);if(c>=rule.count_limit)return false;}
  return true;
}
async function freeSlots(env,chatId,{date,start_time="08:00",end_time="23:00",duration_min=30,timezone=DEFAULT_TIMEZONE,limit=8}){
  if(!isDate(date)||!isTime(start_time)||!isTime(end_time))throw new Error("invalid_free_slot_range");
  const dayStart=localToEpoch(date,start_time,timezone),dayEnd=localToEpoch(date,end_time,timezone),dur=Math.max(5,Number(duration_min||30))*60000;
  const busy=[];
  for(const e of await listEvents(env,chatId,{fromDate:date,toDate:date}))busy.push(eventInterval(e));
  const rules=await listRules(env,chatId);for(const r of rules){if(await ruleOccurs(env,chatId,r,date,r.time)){const s=localToEpoch(date,r.time,r.timezone),e=s+Math.max(1,r.duration_min||1)*60000;busy.push({start:s,end:e});}}
  busy.sort((a,b)=>a.start-b.start);const merged=[];for(const b of busy){if(!merged.length||b.start>merged.at(-1).end)merged.push({...b});else merged.at(-1).end=Math.max(merged.at(-1).end,b.end);}
  const out=[];let cur=dayStart;for(const b of merged){if(b.end<=cur)continue;if(b.start-cur>=dur)out.push({date,time:epochToLocal(cur,timezone).time,end_time:epochToLocal(Math.min(b.start,cur+dur),timezone).time});cur=Math.max(cur,b.end);if(out.length>=limit)break;}if(out.length<limit&&dayEnd-cur>=dur)out.push({date,time:epochToLocal(cur,timezone).time,end_time:epochToLocal(cur+dur,timezone).time});return out;
}
async function scheduleDayBusy(env,chatId,date,timezone=DEFAULT_TIMEZONE){
  if((await listEvents(env,chatId,{fromDate:date,toDate:date})).length)return true;
  for(const r of await listRules(env,chatId))if(await ruleOccurs(env,chatId,r,date,r.time))return true;
  return false;
}
async function findFreePeriod(env,chatId,{days=1,start_date,horizon_days=180,timezone=DEFAULT_TIMEZONE}){
  days=Math.max(1,Math.min(30,Math.trunc(Number(days)||1)));
  horizon_days=Math.max(days,Math.min(365,Math.trunc(Number(horizon_days)||180)));
  if(!isDate(start_date))throw new Error("invalid_free_period_start");
  let streak=0,streakStart=null;
  const startEpoch=localToEpoch(start_date,"12:00",timezone);
  for(let i=0;i<horizon_days;i++){
    const d=epochToLocal(startEpoch+i*86400000,timezone).date;
    if(await scheduleDayBusy(env,chatId,d,timezone)){streak=0;streakStart=null;continue;}
    if(!streakStart)streakStart=d;
    streak++;
    if(streak>=days){
      const end=epochToLocal(localToEpoch(streakStart,"12:00",timezone)+(days-1)*86400000,timezone).date;
      return {start_date:streakStart,end_date:end,days};
    }
  }
  return null;
}
async function searchSchedule(env,chatId,{query=null,date=null,from_date=null,to_date=null}={}){
  let events=await listEvents(env,chatId,{includeCompleted:true,fromDate:date||from_date,toDate:date||to_date});
  let rules=await listRules(env,chatId,{activeOnly:false});
  const q=normKey(query||"");
  if(q){
    events=events.filter(x=>normKey(x.title).includes(q)||q.includes(normKey(x.title)));
    rules=rules.filter(x=>normKey(x.title).includes(q)||q.includes(normKey(x.title)));
  }
  return {events,rules};
}

async function createEvent(env,chatId,x,{allowConflict=false}={}){
  if(!str(x.title)||!isDate(x.date)||!isTime(x.time))throw new Error("invalid_event");
  const event={title:str(x.title,220),date:x.date,time:x.time,duration_min:Math.max(0,Math.trunc(num(x.duration_min,0))),timezone:str(x.timezone,80)||DEFAULT_TIMEZONE,notes:str(x.notes,800)||null,location:str(x.location,200)||null,priority:Math.trunc(clamp(x.priority??0,0,5)),alert_offsets:asArray(x.alert_offsets).length?asArray(x.alert_offsets).map(v=>Math.max(0,Math.trunc(Number(v)||0))).slice(0,8):[0]};
  const conflicts=await conflictsFor(env,chatId,event);if(conflicts.length&&!allowConflict){const slots=await freeSlots(env,chatId,{date:event.date,duration_min:Math.max(15,event.duration_min||30),timezone:event.timezone,limit:3});throw new ClarificationNeeded(`الوقت ده متعارض مع ${conflicts.map(x=>`«${x.title}» ${x.time}`).join("، ")}.${slots.length?` أقرب أوقات فاضية: ${slots.map(s=>s.time).join("، ")}.`:""} تحب أنقله لأنهي وقت؟`,{kind:"conflict",event,conflicts,slots});}
  const t=nowIso();const r=await env.DB.prepare(`INSERT INTO sa2_events(chat_id,title,local_date,local_time,duration_min,timezone,status,notes,location,priority,alert_offsets_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',?,?,?,?,?,?)`).bind(chatId,event.title,event.date,event.time,event.duration_min,event.timezone,event.notes,event.location,event.priority,JSON.stringify(event.alert_offsets),t,t).run();return Number(r.meta.last_row_id);
}
async function updateEvent(env,chatId,id,patch,{allowConflict=false,cascade=true}={}){
  const old=(await resolveEvent(env,chatId,{id}))[0];if(!old)throw new Error("event_target_missing");
  const e={...old,title:patch.title!=null?str(patch.title,220):old.title,date:patch.date??old.date,time:patch.time??old.time,duration_min:patch.duration_min!=null?Math.max(0,Math.trunc(Number(patch.duration_min))):old.duration_min,timezone:patch.timezone??old.timezone,notes:patch.notes??old.notes,location:patch.location??old.location,priority:patch.priority!=null?Math.trunc(clamp(patch.priority,0,5)):old.priority,alert_offsets:patch.alert_offsets??old.alert_offsets};
  if(!isDate(e.date)||!isTime(e.time))throw new Error("invalid_event_update");
  const conflicts=await conflictsFor(env,chatId,e,id);if(conflicts.length&&!allowConflict){const slots=await freeSlots(env,chatId,{date:e.date,duration_min:Math.max(15,e.duration_min||30),timezone:e.timezone,limit:3});throw new ClarificationNeeded(`التعديل هيعمل تعارض مع ${conflicts.map(x=>`«${x.title}» ${x.time}`).join("، ")}.${slots.length?` متاح: ${slots.map(s=>s.time).join("، ")}.`:""} تختار إيه؟`,{kind:"conflict",event:e,conflicts,slots});}
  await env.DB.prepare(`UPDATE sa2_events SET title=?,local_date=?,local_time=?,duration_min=?,timezone=?,notes=?,location=?,priority=?,alert_offsets_json=?,updated_at=? WHERE id=? AND chat_id=?`).bind(e.title,e.date,e.time,e.duration_min,e.timezone,e.notes,e.location,e.priority,JSON.stringify(e.alert_offsets),nowIso(),id,chatId).run();
  if(cascade&&(old.date!==e.date||old.time!==e.time||old.duration_min!==e.duration_min))await cascadeDependencies(env,chatId,id,new Set());
}
async function deleteEvent(env,chatId,id){await env.DB.prepare(`UPDATE sa2_events SET status='deleted',updated_at=? WHERE id=? AND chat_id=?`).bind(nowIso(),id,chatId).run();}
async function completeEvent(env,chatId,id){await env.DB.prepare(`UPDATE sa2_events SET status='completed',updated_at=? WHERE id=? AND chat_id=?`).bind(nowIso(),id,chatId).run();}
async function snoozeEvent(env,chatId,id,minutes,timezone=DEFAULT_TIMEZONE){const e=(await resolveEvent(env,chatId,{id}))[0];if(!e)throw new Error("event_target_missing");const z=zonedParts(new Date(),timezone),n=addLocalMinutes(z.date,z.time,Math.max(1,Number(minutes||10)),timezone);await updateEvent(env,chatId,id,{date:n.date,time:n.time},{allowConflict:true,cascade:true});await env.DB.prepare(`DELETE FROM sa2_event_deliveries WHERE event_id=?`).bind(id).run();}

async function createRule(env,chatId,x){
  const unit=["minute","hour","day","week","month","year"].includes(x.interval_unit)?x.interval_unit:null,n=Math.max(1,Math.trunc(num(x.interval_n,1)));
  if(!str(x.title)||!unit||!isDate(x.start_date)||!isTime(x.time)||(x.end_date&&!isDate(x.end_date)))throw new Error("invalid_rule");
  const t=nowIso();const r=await env.DB.prepare(`INSERT INTO sa2_rules(chat_id,title,interval_n,interval_unit,weekdays_json,monthdays_json,local_time,duration_min,start_date,end_date,count_limit,timezone,alert_offsets_json,status,notes,location,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?)`).bind(chatId,str(x.title,220),n,unit,JSON.stringify(asArray(x.weekdays).map(Number).filter(v=>v>=0&&v<=6)),JSON.stringify(asArray(x.monthdays).map(Number).filter(v=>v>=1&&v<=31)),x.time,Math.max(0,Math.trunc(num(x.duration_min,0))),x.start_date,x.end_date||null,x.count_limit==null?null:Math.max(1,Math.trunc(Number(x.count_limit))),str(x.timezone,80)||DEFAULT_TIMEZONE,JSON.stringify(asArray(x.alert_offsets).length?asArray(x.alert_offsets).map(v=>Math.max(0,Math.trunc(Number(v)||0))).slice(0,8):[0]),str(x.notes,800)||null,str(x.location,200)||null,Math.trunc(clamp(x.priority??0,0,5)),t,t).run();return Number(r.meta.last_row_id);
}
async function updateRule(env,chatId,id,patch){
  const old=(await resolveRule(env,chatId,{id}))[0];if(!old)throw new Error("rule_target_missing");
  const x={...old,...patch};if(!["minute","hour","day","week","month","year"].includes(x.interval_unit)||!isDate(x.start_date)||!isTime(x.time)||(x.end_date&&!isDate(x.end_date)))throw new Error("invalid_rule_update");
  await env.DB.prepare(`UPDATE sa2_rules SET title=?,interval_n=?,interval_unit=?,weekdays_json=?,monthdays_json=?,local_time=?,duration_min=?,start_date=?,end_date=?,count_limit=?,timezone=?,alert_offsets_json=?,notes=?,location=?,priority=?,updated_at=? WHERE id=? AND chat_id=?`).bind(str(x.title,220),Math.max(1,Math.trunc(Number(x.interval_n)||1)),x.interval_unit,JSON.stringify(asArray(x.weekdays)),JSON.stringify(asArray(x.monthdays)),x.time,Math.max(0,Math.trunc(Number(x.duration_min)||0)),x.start_date,x.end_date||null,x.count_limit==null?null:Math.max(1,Math.trunc(Number(x.count_limit))),x.timezone||DEFAULT_TIMEZONE,JSON.stringify(asArray(x.alert_offsets).length?x.alert_offsets:[0]),x.notes||null,x.location||null,Math.trunc(clamp(x.priority??0,0,5)),nowIso(),id,chatId).run();
}
async function setRuleStatus(env,chatId,id,status){await env.DB.prepare(`UPDATE sa2_rules SET status=?,updated_at=? WHERE id=? AND chat_id=?`).bind(status,nowIso(),id,chatId).run();}
async function skipRuleDate(env,chatId,id,date,reason=null){if(!isDate(date))throw new Error("invalid_skip_date");await env.DB.prepare(`INSERT OR IGNORE INTO sa2_rule_exceptions(rule_id,chat_id,local_date,reason,created_at) VALUES (?,?,?,?,?)`).bind(id,chatId,date,str(reason,500)||null,nowIso()).run();}

// -----------------------------------------------------------------------------
// DEPENDENCIES / RELATIONSHIPS BETWEEN EVENTS
// -----------------------------------------------------------------------------
async function dependencyRows(env,chatId){return (await env.DB.prepare(`SELECT * FROM sa2_dependencies WHERE chat_id=? ORDER BY id`).bind(chatId).all())?.results||[];}
async function hasDependencyPath(env,chatId,fromId,toId,seen=new Set()){
  if(fromId===toId)return true;if(seen.has(fromId))return false;seen.add(fromId);
  const rows=(await env.DB.prepare(`SELECT target_event_id FROM sa2_dependencies WHERE chat_id=? AND source_event_id=?`).bind(chatId,fromId).all())?.results||[];
  for(const r of rows)if(await hasDependencyPath(env,chatId,Number(r.target_event_id),toId,seen))return true;return false;
}
async function createDependency(env,chatId,{source_event_id,target_event_id,relation="after_end",offset_min=0}){
  const s=(await resolveEvent(env,chatId,{id:source_event_id}))[0],t=(await resolveEvent(env,chatId,{id:target_event_id}))[0];if(!s||!t||s.id===t.id)throw new Error("invalid_dependency_target");
  if(!["after_start","after_end","before_start"].includes(relation))throw new Error("invalid_dependency_relation");
  if(await hasDependencyPath(env,chatId,t.id,s.id))throw new ClarificationNeeded("العلاقة دي هتعمل دايرة بين المواعيد، فمش هقدر أسجلها. غيّر اتجاه العلاقة.",{kind:"dependency_cycle"});
  await env.DB.prepare(`INSERT OR REPLACE INTO sa2_dependencies(chat_id,source_event_id,target_event_id,relation,offset_min,created_at) VALUES (?,?,?,?,?,?)`).bind(chatId,s.id,t.id,relation,Math.trunc(Number(offset_min)||0),nowIso()).run();await cascadeDependencies(env,chatId,s.id,new Set());
}
async function deleteDependency(env,chatId,id){await env.DB.prepare(`DELETE FROM sa2_dependencies WHERE chat_id=? AND id=?`).bind(chatId,id).run();}
async function cascadeDependencies(env,chatId,sourceId,seen){
  if(seen.has(sourceId))return;seen.add(sourceId);
  const source=(await resolveEvent(env,chatId,{id:sourceId}))[0];if(!source)return;
  const rows=(await env.DB.prepare(`SELECT * FROM sa2_dependencies WHERE chat_id=? AND source_event_id=?`).bind(chatId,sourceId).all())?.results||[];
  const si=eventInterval(source);
  for(const d of rows){
    let epoch;if(d.relation==="after_start")epoch=si.start+Number(d.offset_min||0)*60000;else if(d.relation==="after_end")epoch=si.end+Number(d.offset_min||0)*60000;else epoch=si.start-Number(d.offset_min||0)*60000;
    const target=(await resolveEvent(env,chatId,{id:Number(d.target_event_id)}))[0];if(!target)continue;const z=epochToLocal(epoch,target.timezone);await updateEvent(env,chatId,target.id,{date:z.date,time:z.time},{allowConflict:true,cascade:false});await cascadeDependencies(env,chatId,target.id,seen);
  }
}

// -----------------------------------------------------------------------------
// LIFE OS: location, world model, projects/tasks, waiting, inbox, shopping sessions
// Generic typed objects keep the clean-slate core small without losing capability.
// -----------------------------------------------------------------------------
const LIFE_TYPES=new Set(["project","project_task","waiting","inbox","world_entity","world_edge","live_watch","note","setting","shopping_session"]);
async function getProfile(env,chatId){
  const r=await env.DB.prepare(`SELECT * FROM sa2_profiles WHERE chat_id=?`).bind(chatId).first();
  return r||{chat_id:chatId,latitude:30.0444,longitude:31.2357,city:"Cairo",country:"Egypt",country_code:"EG"};
}
async function setProfileLocation(env,chatId,{latitude,longitude,city=null,country=null,country_code="EG"}){
  const lat=Number(latitude),lon=Number(longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error("invalid_location");
  await env.DB.prepare(`INSERT INTO sa2_profiles(chat_id,latitude,longitude,city,country,country_code,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,city=COALESCE(excluded.city,sa2_profiles.city),country=COALESCE(excluded.country,sa2_profiles.country),country_code=COALESCE(excluded.country_code,sa2_profiles.country_code),updated_at=excluded.updated_at`).bind(chatId,lat,lon,city,country,String(country_code||"EG").toUpperCase(),nowIso()).run();
}
async function listLifeObjects(env,chatId,{type=null,status=null,parent_id=null}={}){
  let q=`SELECT * FROM sa2_objects WHERE chat_id=?`,b=[chatId];if(type){q+=` AND object_type=?`;b.push(type)}if(status){q+=` AND status=?`;b.push(status)}if(parent_id!=null){q+=` AND parent_id=?`;b.push(Number(parent_id))}q+=` ORDER BY id DESC LIMIT 300`;
  return ((await env.DB.prepare(q).bind(...b).all())?.results||[]).map(r=>({...r,id:Number(r.id),parent_id:r.parent_id==null?null:Number(r.parent_id),data:safeJson(r.data_json,{})}));
}
async function resolveLifeObject(env,chatId,target,type=null){
  let rows=await listLifeObjects(env,chatId,{type});if(target?.id)return rows.filter(x=>x.id===Number(target.id));const q=normKey(target?.query||"");if(q){const exact=rows.filter(x=>normKey(x.name)===q);if(exact.length)return exact;rows=rows.filter(x=>normKey(x.name).includes(q)||q.includes(normKey(x.name)));}return target?.all?rows:rows;
}
async function createLifeObject(env,chatId,{type,name,status="active",parent_id=null,data={}}){
  if(!LIFE_TYPES.has(type)||!str(name))throw new Error("invalid_life_object");const t=nowIso();const r=await env.DB.prepare(`INSERT INTO sa2_objects(chat_id,object_type,name,normalized_name,status,parent_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(chatId,type,str(name,240),normKey(name),str(status,40)||"active",parent_id==null?null:Number(parent_id),JSON.stringify(data||{}).slice(0,10000),t,t).run();return Number(r.meta.last_row_id);
}
async function updateLifeObject(env,chatId,id,patch){
  const r=(await resolveLifeObject(env,chatId,{id}))[0];if(!r)throw new Error("life_object_missing");const name=patch.name!=null?str(patch.name,240):r.name,status=patch.status!=null?str(patch.status,40):r.status,parent=patch.parent_id!==undefined?(patch.parent_id==null?null:Number(patch.parent_id)):r.parent_id,data=patch.data?{...r.data,...patch.data}:r.data;await env.DB.prepare(`UPDATE sa2_objects SET name=?,normalized_name=?,status=?,parent_id=?,data_json=?,updated_at=? WHERE id=? AND chat_id=?`).bind(name,normKey(name),status,parent,JSON.stringify(data).slice(0,10000),nowIso(),id,chatId).run();
}
async function deleteLifeObject(env,chatId,id){await env.DB.prepare(`UPDATE sa2_objects SET status='deleted',updated_at=? WHERE id=? AND chat_id=?`).bind(nowIso(),id,chatId).run();}

async function getAgentSettings(env,chatId){
  const t=nowIso();await env.DB.prepare(`INSERT OR IGNORE INTO sa2_settings(chat_id,updated_at) VALUES (?,?)`).bind(chatId,t).run();return env.DB.prepare(`SELECT * FROM sa2_settings WHERE chat_id=?`).bind(chatId).first();
}
async function updateAgentSettings(env,chatId,patch){
  const s=await getAgentSettings(env,chatId),mode=["safe_auto","confirm_all","manual"].includes(patch.permission_mode)?patch.permission_mode:s.permission_mode;
  await env.DB.prepare(`UPDATE sa2_settings SET permission_mode=?,proactive_enabled=?,morning_brief_enabled=?,evening_brief_enabled=?,ask_before_delete=?,updated_at=? WHERE chat_id=?`).bind(mode,patch.proactive_enabled==null?s.proactive_enabled:(patch.proactive_enabled?1:0),patch.morning_brief_enabled==null?s.morning_brief_enabled:(patch.morning_brief_enabled?1:0),patch.evening_brief_enabled==null?s.evening_brief_enabled:(patch.evening_brief_enabled?1:0),patch.ask_before_delete==null?s.ask_before_delete:(patch.ask_before_delete?1:0),nowIso(),chatId).run();
}
function decodeXml(s){return String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");}
async function liveNewsSearch(query,{countryCode="EG",language="ar",limit=6}={}){
  const q=str(query,300);if(!q)return[];const url=`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(countryCode)}&ceid=${encodeURIComponent(countryCode)}:${encodeURIComponent(language)}`;
  try{const r=await fetch(url,{headers:{"user-agent":"SuperAgentNext/2.2"}});if(!r.ok)throw new Error(`news_http_${r.status}`);const xml=await r.text(),items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,limit).map(m=>{const b=m[1],title=decodeXml(b.match(/<title>([\s\S]*?)<\/title>/)?.[1]||""),link=decodeXml(b.match(/<link>([\s\S]*?)<\/link>/)?.[1]||""),pubDate=decodeXml(b.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]||"");return{title:compact(title,260),url:link,pubDate};}).filter(x=>x.title);return items;}catch{return[];}
}
async function publicHolidays(profile,date){
  const year=String(date).slice(0,4),cc=String(profile?.country_code||"EG").toUpperCase();
  try{const r=await fetch(`https://date.nager.at/api/v3/PublicHolidays/${encodeURIComponent(year)}/${encodeURIComponent(cc)}`,{headers:{accept:"application/json"}});if(!r.ok)return[];const j=await r.json();return asArray(j).filter(x=>x.date===date).map(x=>({date:x.date,name:x.localName||x.name,english_name:x.name}));}catch{return[];}
}
async function realityContext(env,chatId,text,date){
  const n=normalizeArabic(text),profile=await getProfile(env,chatId),out={profile};
  if(/(?:الفجر|الشروق|الظهر|العصر|المغرب|العشاء|صلاة|هجري|هجرى)/.test(n)){const pr=await getPrayerTimes(env,chatId,date);out.prayer=pr;out.hijri=pr.hijri||null;}
  if(/(?:اجازه|اجازة|عطله|عطلة|عيد|holiday)/.test(n))out.holidays=await publicHolidays(profile,date);
  if(/(?:اخبار|خبر|احدث|آخر|حاليا|دلوقتي|live)/.test(n))out.news=await liveNewsSearch(text,{countryCode:profile.country_code||"EG",limit:5});
  return out;
}

const PRAYER_MAP={fajr:"Fajr",sunrise:"Sunrise",dhuhr:"Dhuhr",asr:"Asr",maghrib:"Maghrib",isha:"Isha",الفجر:"Fajr",الشروق:"Sunrise",الظهر:"Dhuhr",العصر:"Asr",المغرب:"Maghrib",العشاء:"Isha"};
function canonicalPrayer(x){const n=normalizeArabic(x);return PRAYER_MAP[n]||PRAYER_MAP[String(x||"").toLowerCase()]||null;}
async function getPrayerTimes(env,chatId,date=null){
  const profile=await getProfile(env,chatId),zone=(await ensureUser(env,chatId)).timezone||DEFAULT_TIMEZONE,z=date||zonedParts(new Date(),zone).date;const epoch=Math.floor(localToEpoch(z,"12:00",zone)/1000);
  try{
    const url=`https://api.aladhan.com/v1/timings/${epoch}?latitude=${encodeURIComponent(profile.latitude??30.0444)}&longitude=${encodeURIComponent(profile.longitude??31.2357)}&method=5`;
    const r=await fetch(url,{headers:{accept:"application/json"}});if(!r.ok)throw new Error(`prayer_http_${r.status}`);const j=await r.json();const t=j?.data?.timings||{},h=j?.data?.date?.hijri||null;return{date:z,timezone:zone,location:{latitude:profile.latitude,longitude:profile.longitude,city:profile.city,country:profile.country,country_code:profile.country_code||"EG"},hijri:h?{date:h.date,day:h.day,month:h.month?.ar||h.month?.en,year:h.year,weekday:h.weekday?.ar||h.weekday?.en}:null,Fajr:String(t.Fajr||"").slice(0,5),Sunrise:String(t.Sunrise||"").slice(0,5),Dhuhr:String(t.Dhuhr||"").slice(0,5),Asr:String(t.Asr||"").slice(0,5),Maghrib:String(t.Maghrib||"").slice(0,5),Isha:String(t.Isha||"").slice(0,5)};
  }catch{return{date:z,timezone:zone,location:profile,Fajr:null,Sunrise:null,Dhuhr:null,Asr:null,Maghrib:null,Isha:null};}
}
async function listPrayerRules(env,chatId){return (await env.DB.prepare(`SELECT * FROM sa2_prayer_rules WHERE chat_id=? ORDER BY id`).bind(chatId).all())?.results||[];}
async function createPrayerRule(env,chatId,x){const prayer=canonicalPrayer(x.prayer);if(!prayer||!isDate(x.start_date)||(x.end_date&&!isDate(x.end_date)))throw new Error("invalid_prayer_rule");const t=nowIso();const r=await env.DB.prepare(`INSERT INTO sa2_prayer_rules(chat_id,title,prayer,offset_minutes,start_date,end_date,weekdays_json,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)`).bind(chatId,str(x.title,220),prayer,Math.trunc(Number(x.offset_minutes)||0),x.start_date,x.end_date||null,JSON.stringify(asArray(x.weekdays).map(Number).filter(v=>v>=0&&v<=6)),t,t).run();return Number(r.meta.last_row_id);}
async function deletePrayerRule(env,chatId,id){await env.DB.prepare(`UPDATE sa2_prayer_rules SET active=0,updated_at=? WHERE id=? AND chat_id=?`).bind(nowIso(),id,chatId).run();}
async function resolvePrayerRule(env,chatId,target){let rows=await listPrayerRules(env,chatId);if(target?.id)return rows.filter(r=>Number(r.id)===Number(target.id));const q=normKey(target?.query||"");if(q){const ex=rows.filter(r=>normKey(r.title)===q);if(ex.length)return ex;rows=rows.filter(r=>normKey(r.title).includes(q)||q.includes(normKey(r.title)));}return rows;}

async function transcribeTelegramVoice(env,fileObj){
  const fileId=fileObj?.file_id;if(!fileId)throw new Error("voice_file_missing");const info=await tg(env,"getFile",{file_id:fileId});const path=info?.file_path;if(!path)throw new Error("telegram_file_path_missing");const bin=await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);if(!bin.ok)throw new Error(`telegram_voice_download_${bin.status}`);const blob=await bin.blob();
  if(env.GROQ_API_KEY){const fd=new FormData();fd.append("file",blob,path.split("/").pop()||"voice.ogg");fd.append("model","whisper-large-v3-turbo");fd.append("language","ar");fd.append("response_format","json");const r=await fetch("https://api.groq.com/openai/v1/audio/transcriptions",{method:"POST",headers:{authorization:`Bearer ${env.GROQ_API_KEY}`},body:fd});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.error?.message||`groq_transcribe_${r.status}`);const text=String(j?.text||"").trim();if(text)return text;}
  if(env.VOICE_TRANSCRIBE_URL){const r=await fetch(env.VOICE_TRANSCRIBE_URL,{method:"POST",headers:{authorization:env.VOICE_TRANSCRIBE_TOKEN?`Bearer ${env.VOICE_TRANSCRIBE_TOKEN}`:"", "content-type":blob.type||"audio/ogg"},body:blob});const j=await r.json().catch(()=>null);const text=String(j?.text||j?.transcript||"").trim();if(r.ok&&text)return text;}
  throw new Error("voice_transcription_binding_missing");
}

// -----------------------------------------------------------------------------
// SNAPSHOT / ROLLBACK / UNDO
// -----------------------------------------------------------------------------
async function readState(env,chatId,timezone=DEFAULT_TIMEZONE){
  const [shopping,events,rules,memories,dependencies,exceptions,lists,history,objects,prayerRules,profile,settings]=await Promise.all([
    shoppingItems(env,chatId,{includeDone:true}),listEvents(env,chatId,{includeCompleted:true}),listRules(env,chatId,{activeOnly:false}),listMemories(env,chatId),dependencyRows(env,chatId),ruleExceptions(env,chatId),
    env.DB.prepare(`SELECT * FROM sa2_shopping_lists WHERE chat_id=?`).bind(chatId).all().then(x=>x?.results||[]),recentConversation(env,chatId),listLifeObjects(env,chatId),listPrayerRules(env,chatId),getProfile(env,chatId),getAgentSettings(env,chatId)
  ]);
  return {now:zonedParts(new Date(),timezone),shopping:shopping.map(x=>({...x,id:Number(x.id),list_id:Number(x.list_id)})),events,rules,memories,dependencies,exceptions,lists,history,objects,prayerRules,profile,settings};
}
function domainDigest(s){
  return JSON.stringify({shopping:s.shopping.map(x=>({id:x.id,title:x.title,q:x.quantity_value,u:x.quantity_unit,brand:x.brand,size:x.size,store:x.store,category:x.category,priority:x.priority,optional:x.optional,status:x.status})),events:s.events,rules:s.rules,memories:s.memories,dependencies:s.dependencies,exceptions:s.exceptions,objects:s.objects||[],prayerRules:s.prayerRules||[],profile:s.profile||null,settings:s.settings||null});
}
async function rollbackState(env,chatId,s){
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sa2_shopping_items WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_shopping_lists WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM sa2_events WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_rules WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM sa2_rule_exceptions WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_dependencies WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM sa2_memories WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_event_deliveries WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_rule_fires WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_objects WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_prayer_rules WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_prayer_fires WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_profiles WHERE chat_id=?`).bind(chatId),env.DB.prepare(`DELETE FROM sa2_settings WHERE chat_id=?`).bind(chatId)
  ]);
  for(const l of s.lists||[])await env.DB.prepare(`INSERT INTO sa2_shopping_lists(id,chat_id,name,normalized_name,budget,store,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(l.id,chatId,l.name,l.normalized_name,l.budget,l.store,l.created_at||nowIso(),l.updated_at||nowIso()).run();
  for(const x of s.shopping||[])await env.DB.prepare(`INSERT INTO sa2_shopping_items(id,list_id,chat_id,title,normalized_title,quantity_value,quantity_unit,brand,size,store,category,priority,optional,notes,status,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(x.id,x.list_id,chatId,x.title,x.normalized_title||normKey(x.title),x.quantity_value,x.quantity_unit,x.brand,x.size,x.store,x.category,x.priority||0,x.optional||0,x.notes,x.status||"pending",x.position||0,x.created_at||nowIso(),x.updated_at||nowIso()).run();
  for(const e of s.events||[])await env.DB.prepare(`INSERT INTO sa2_events(id,chat_id,title,local_date,local_time,duration_min,timezone,status,notes,location,priority,alert_offsets_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(e.id,chatId,e.title,e.date,e.time,e.duration_min,e.timezone,e.status,e.notes,e.location,e.priority,JSON.stringify(e.alert_offsets||[0]),nowIso(),nowIso()).run();
  for(const r of s.rules||[])await env.DB.prepare(`INSERT INTO sa2_rules(id,chat_id,title,interval_n,interval_unit,weekdays_json,monthdays_json,local_time,duration_min,start_date,end_date,count_limit,timezone,alert_offsets_json,status,notes,location,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.id,chatId,r.title,r.interval_n,r.interval_unit,JSON.stringify(r.weekdays||[]),JSON.stringify(r.monthdays||[]),r.time,r.duration_min,r.start_date,r.end_date,r.count_limit,r.timezone,JSON.stringify(r.alert_offsets||[0]),r.status,r.notes,r.location,r.priority,nowIso(),nowIso()).run();
  for(const e of s.exceptions||[])await env.DB.prepare(`INSERT INTO sa2_rule_exceptions(rule_id,chat_id,local_date,reason,created_at) VALUES (?,?,?,?,?)`).bind(e.rule_id,chatId,e.local_date,e.reason,nowIso()).run();
  for(const d of s.dependencies||[])await env.DB.prepare(`INSERT INTO sa2_dependencies(id,chat_id,source_event_id,target_event_id,relation,offset_min,created_at) VALUES (?,?,?,?,?,?,?)`).bind(d.id,chatId,d.source_event_id,d.target_event_id,d.relation,d.offset_min,d.created_at||nowIso()).run();
  for(const m of s.memories||[])await env.DB.prepare(`INSERT INTO sa2_memories(chat_id,key,value,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?)`).bind(chatId,m.key,m.value,m.confidence??1,nowIso(),nowIso()).run();
  for(const o of s.objects||[])await env.DB.prepare(`INSERT INTO sa2_objects(id,chat_id,object_type,name,normalized_name,status,parent_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(o.id,chatId,o.object_type,o.name,o.normalized_name||normKey(o.name),o.status,o.parent_id,JSON.stringify(o.data||safeJson(o.data_json,{})),o.created_at||nowIso(),o.updated_at||nowIso()).run();
  for(const r of s.prayerRules||[])await env.DB.prepare(`INSERT INTO sa2_prayer_rules(id,chat_id,title,prayer,offset_minutes,start_date,end_date,weekdays_json,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(r.id,chatId,r.title,r.prayer,r.offset_minutes,r.start_date,r.end_date,r.weekdays_json||'[]',r.active,r.created_at||nowIso(),r.updated_at||nowIso()).run();
  if(s.profile&&s.profile.latitude!=null)await setProfileLocation(env,chatId,s.profile);
  if(s.settings)await updateAgentSettings(env,chatId,s.settings);
}
async function saveUndo(env,chatId,before,description){
  await env.DB.prepare(`INSERT INTO sa2_undo(chat_id,snapshot_json,description,created_at) VALUES (?,?,?,?)`).bind(chatId,JSON.stringify(before),str(description,300)||null,nowIso()).run();
  await env.DB.prepare(`DELETE FROM sa2_undo WHERE chat_id=? AND id NOT IN (SELECT id FROM sa2_undo WHERE chat_id=? ORDER BY id DESC LIMIT ?)`).bind(chatId,chatId,UNDO_DEPTH).run();
}
async function undoLast(env,chatId){
  const r=await env.DB.prepare(`SELECT * FROM sa2_undo WHERE chat_id=? AND consumed=0 ORDER BY id DESC LIMIT 1`).bind(chatId).first();if(!r)throw new ClarificationNeeded("مفيش عملية سابقة متاحة للتراجع عنها.",{kind:"nothing_to_undo"});
  const s=safeJson(r.snapshot_json);if(!s)throw new Error("invalid_undo_snapshot");await rollbackState(env,chatId,s);await env.DB.prepare(`UPDATE sa2_undo SET consumed=1 WHERE id=?`).bind(r.id).run();return s;
}

// -----------------------------------------------------------------------------
// PENDING CLARIFICATIONS
// -----------------------------------------------------------------------------
class ClarificationNeeded extends Error{
  constructor(question,meta={}){super(question);this.name="ClarificationNeeded";this.question=question;this.meta=meta;}
}
async function getPending(env,chatId){const r=await env.DB.prepare(`SELECT * FROM sa2_pending WHERE chat_id=?`).bind(chatId).first();if(!r)return null;if(Date.parse(r.expires_at)<=Date.now()){await clearPending(env,chatId);return null;}return {...r,meta:safeJson(r.meta_json,{})};}
async function savePending(env,chatId,baseText,question,meta={}){const t=nowIso(),exp=new Date(Date.now()+PENDING_TTL_MINUTES*60000).toISOString();await env.DB.prepare(`INSERT INTO sa2_pending(chat_id,kind,base_text,question,meta_json,expires_at,created_at,updated_at) VALUES (?,'clarification',?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET base_text=excluded.base_text,question=excluded.question,meta_json=excluded.meta_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(chatId,baseText,question,JSON.stringify(meta),exp,t,t).run();}
async function clearPending(env,chatId){await env.DB.prepare(`DELETE FROM sa2_pending WHERE chat_id=?`).bind(chatId).run();}

// -----------------------------------------------------------------------------
// TYPED AGENT PLAN SCHEMA
// -----------------------------------------------------------------------------
const OPS=new Set([
  "shopping.add","shopping.remove","shopping.update","shopping.replace","shopping.clear","shopping.list","shopping.done","shopping.reopen",
  "event.create","event.update","event.delete","event.complete","event.snooze","event.list",
  "rule.create","rule.update","rule.delete","rule.pause","rule.resume","rule.skip","rule.list",
  "schedule.free_slots","schedule.free_period","schedule.search","schedule.bulk_shift","schedule.bulk_delete","schedule.bulk_complete",
  "dependency.create","dependency.delete","dependency.list",
  "memory.set","memory.delete","memory.list","undo.last",
  "life.create","life.update","life.delete","life.list","location.set","location.show",
  "prayer.rule.create","prayer.rule.delete","prayer.rule.list","shopping.session.start","shopping.session.end",
  "live.search","live.watch.create","live.watch.delete","live.watch.list","settings.update","settings.show"
]);
function cleanTarget(x){
  const t={id:num(x?.id,null),query:str(x?.query,180)||null,date:isDate(x?.date)?x.date:null,status:str(x?.status,30)||null,all:!!x?.all};
  if(!t.id&&!t.query&&!t.date&&!t.all)return null;return t;
}
function validatePlan(v){
  if(!v||typeof v!=="object")return null;
  if(v.requires_clarification)return {version:2,requires_clarification:true,clarification_question:str(v.clarification_question,600)||"ممكن توضح قصدك؟",confidence:clamp(v.confidence,0,1),operations:[],mutates:false};
  const raw=asArray(v.operations);if(!raw.length||raw.length>MAX_PLAN_OPERATIONS)return null;const operations=[];
  for(const o of raw){
    if(!OPS.has(o?.op))return null;const z={op:o.op};
    if(o.op==="shopping.add"){
      z.items=asArray(o.items).map(cleanShoppingInput);if(!z.items.length||z.items.some(x=>!x))return null;
    }else if(["shopping.remove","shopping.done","shopping.reopen","event.delete","event.complete"].includes(o.op)){
      z.target=cleanTarget(o.target);if(!z.target)return null;
    }else if(o.op==="shopping.update"){
      z.target=cleanTarget(o.target);if(!z.target)return null;z.patch={};for(const k of ["title","quantity_unit","brand","size","store","category","notes"])if(o.patch?.[k]!=null)z.patch[k]=str(o.patch[k],600);for(const k of ["quantity_value","quantity_delta","priority"])if(o.patch?.[k]!=null&&Number.isFinite(Number(o.patch[k])))z.patch[k]=Number(o.patch[k]);if(o.patch?.optional!=null)z.patch.optional=!!o.patch.optional;if(!Object.keys(z.patch).length)return null;
    }else if(o.op==="shopping.replace"){
      z.target=cleanTarget(o.target);z.item=cleanShoppingInput(o.item);if(!z.target||!z.item)return null;
    }else if(o.op==="shopping.clear")z.confirmed=!!o.confirmed;
    else if(o.op==="event.create"){
      z.title=str(o.title,220);z.date=str(o.date,10);z.time=str(o.time,5);z.duration_min=Math.max(0,Math.trunc(num(o.duration_min,0)));z.timezone=str(o.timezone,80)||DEFAULT_TIMEZONE;z.notes=str(o.notes,800)||null;z.location=str(o.location,200)||null;z.priority=Math.trunc(clamp(o.priority??0,0,5));z.alert_offsets=asArray(o.alert_offsets).length?asArray(o.alert_offsets).map(Number).filter(Number.isFinite):[0];z.allow_conflict=!!o.allow_conflict;if(!z.title||!isDate(z.date)||!isTime(z.time))return null;
    }else if(o.op==="event.update"){
      z.target=cleanTarget(o.target);if(!z.target)return null;z.patch={};for(const k of ["title","date","time","timezone","notes","location"])if(o.patch?.[k]!=null)z.patch[k]=str(o.patch[k],800);for(const k of ["duration_min","priority"])if(o.patch?.[k]!=null&&Number.isFinite(Number(o.patch[k])))z.patch[k]=Number(o.patch[k]);if(o.patch?.alert_offsets!=null)z.patch.alert_offsets=asArray(o.patch.alert_offsets).map(Number).filter(Number.isFinite);if(z.patch.date&&!isDate(z.patch.date))return null;if(z.patch.time&&!isTime(z.patch.time))return null;if(!Object.keys(z.patch).length)return null;z.allow_conflict=!!o.allow_conflict;
    }else if(o.op==="event.snooze"){
      z.target=cleanTarget(o.target);z.minutes=Math.max(1,Math.trunc(num(o.minutes,10)));if(!z.target)return null;
    }else if(o.op==="event.list"){
      z.date=isDate(o.date)?o.date:null;z.from_date=isDate(o.from_date)?o.from_date:null;z.to_date=isDate(o.to_date)?o.to_date:null;
    }else if(o.op==="rule.create"){
      z.title=str(o.title,220);z.interval_n=Math.max(1,Math.trunc(num(o.interval_n,1)));z.interval_unit=["minute","hour","day","week","month","year"].includes(o.interval_unit)?o.interval_unit:null;z.weekdays=asArray(o.weekdays).map(Number).filter(x=>x>=0&&x<=6);z.monthdays=asArray(o.monthdays).map(Number).filter(x=>x>=1&&x<=31);z.time=str(o.time,5);z.duration_min=Math.max(0,Math.trunc(num(o.duration_min,0)));z.start_date=str(o.start_date,10);z.end_date=o.end_date?str(o.end_date,10):null;z.count_limit=o.count_limit==null?null:Math.max(1,Math.trunc(Number(o.count_limit)));z.timezone=str(o.timezone,80)||DEFAULT_TIMEZONE;z.alert_offsets=asArray(o.alert_offsets).length?asArray(o.alert_offsets).map(Number).filter(Number.isFinite):[0];z.notes=str(o.notes,800)||null;z.location=str(o.location,200)||null;z.priority=Math.trunc(clamp(o.priority??0,0,5));if(!z.title||!z.interval_unit||!isTime(z.time)||!isDate(z.start_date)||(z.end_date&&!isDate(z.end_date)))return null;
    }else if(o.op==="rule.update"){
      z.target=cleanTarget(o.target);if(!z.target)return null;z.patch={...o.patch};if(!Object.keys(z.patch).length)return null;
    }else if(["rule.delete","rule.pause","rule.resume"].includes(o.op)){
      z.target=cleanTarget(o.target);if(!z.target)return null;
    }else if(o.op==="rule.skip"){
      z.target=cleanTarget(o.target);z.date=str(o.date,10);z.reason=str(o.reason,500)||null;if(!z.target||!isDate(z.date))return null;
    }else if(o.op==="schedule.free_slots"){
      z.date=str(o.date,10);z.start_time=str(o.start_time||"08:00",5);z.end_time=str(o.end_time||"23:00",5);z.duration_min=Math.max(5,Math.trunc(num(o.duration_min,30)));if(!isDate(z.date)||!isTime(z.start_time)||!isTime(z.end_time))return null;
    }else if(o.op==="schedule.free_period"){
      z.days=Math.max(1,Math.min(30,Math.trunc(num(o.days,1))));z.start_date=str(o.start_date,10);z.horizon_days=Math.max(z.days,Math.min(365,Math.trunc(num(o.horizon_days,180))));if(!isDate(z.start_date))return null;
    }else if(o.op==="schedule.search"){
      z.query=str(o.query,240)||null;z.date=isDate(o.date)?o.date:null;z.from_date=isDate(o.from_date)?o.from_date:null;z.to_date=isDate(o.to_date)?o.to_date:null;if(!z.query&&!z.date&&!z.from_date&&!z.to_date)return null;
    }else if(["schedule.bulk_shift","schedule.bulk_delete","schedule.bulk_complete"].includes(o.op)){
      z.target=cleanTarget(o.target);if(!z.target)return null;if(o.op==="schedule.bulk_shift")z.delta_minutes=Math.trunc(num(o.delta_minutes,0));
    }else if(o.op==="dependency.create"){
      z.source=cleanTarget(o.source);z.target=cleanTarget(o.target);z.relation=["after_start","after_end","before_start"].includes(o.relation)?o.relation:"after_end";z.offset_min=Math.trunc(num(o.offset_min,0));if(!z.source||!z.target)return null;
    }else if(o.op==="dependency.delete"){
      z.id=num(o.id,null);if(!z.id)return null;
    }else if(o.op==="life.create"){
      z.type=LIFE_TYPES.has(o.type)?o.type:null;z.name=str(o.name,240);z.status=str(o.status,40)||"active";z.parent_id=num(o.parent_id,null);z.data=(o.data&&typeof o.data==="object")?o.data:{};if(!z.type||!z.name)return null;
    }else if(o.op==="life.update"){
      z.target=cleanTarget(o.target);z.type=o.type&&LIFE_TYPES.has(o.type)?o.type:null;z.patch=(o.patch&&typeof o.patch==="object")?o.patch:{};if(!z.target||!Object.keys(z.patch).length)return null;
    }else if(o.op==="life.delete"){z.target=cleanTarget(o.target);z.type=o.type&&LIFE_TYPES.has(o.type)?o.type:null;if(!z.target)return null;
    }else if(o.op==="life.list"){z.type=o.type&&LIFE_TYPES.has(o.type)?o.type:null;z.status=str(o.status,40)||null;
    }else if(o.op==="location.set"){z.latitude=num(o.latitude,null);z.longitude=num(o.longitude,null);z.city=str(o.city,120)||null;z.country=str(o.country,120)||null;if(z.latitude==null||z.longitude==null)return null;
    }else if(o.op==="prayer.rule.create"){z.title=str(o.title,220);z.prayer=canonicalPrayer(o.prayer);z.offset_minutes=Math.trunc(num(o.offset_minutes,0));z.start_date=str(o.start_date,10);z.end_date=o.end_date?str(o.end_date,10):null;z.weekdays=asArray(o.weekdays).map(Number).filter(v=>v>=0&&v<=6);if(!z.title||!z.prayer||!isDate(z.start_date)||(z.end_date&&!isDate(z.end_date)))return null;
    }else if(o.op==="prayer.rule.delete"){z.target=cleanTarget(o.target);if(!z.target)return null;
    }else if(o.op==="shopping.session.start"){z.place_name=str(o.place_name,180)||null;
    }else if(o.op==="shopping.session.end"){
    }else if(o.op==="live.search"){z.query=str(o.query,300);if(!z.query)return null;
    }else if(o.op==="live.watch.create"){z.query=str(o.query,300);if(!z.query)return null;
    }else if(o.op==="live.watch.delete"){z.target=cleanTarget(o.target);if(!z.target)return null;
    }else if(o.op==="live.watch.list"){
    }else if(o.op==="settings.update"){z.patch=(o.patch&&typeof o.patch==="object")?o.patch:{};if(!Object.keys(z.patch).length)return null;
    }else if(o.op==="settings.show"){
    }else if(o.op==="memory.set"){
      z.key=str(o.key,120);z.value=str(o.value,1200);if(!z.key||!z.value)return null;
    }else if(o.op==="memory.delete"){
      z.key=str(o.key,120);if(!z.key)return null;
    }
    operations.push(z);
  }
  const readOnly=new Set(["shopping.list","event.list","rule.list","schedule.free_slots","schedule.free_period","schedule.search","dependency.list","memory.list","life.list","location.show","prayer.rule.list","live.search","live.watch.list","settings.show"]);
  const mutates=operations.some(o=>!readOnly.has(o.op));
  return {version:2,requires_clarification:false,clarification_question:null,confidence:clamp(v.confidence??.5,0,1),operations,mutates,summary:str(v.summary,400)||null};
}

// -----------------------------------------------------------------------------
// PLANNER PROMPT — old product features are represented as typed operations.
// -----------------------------------------------------------------------------
function plannerPrompt(text,state,route){
  const domain={now:state.now,shopping:state.shopping.map(x=>({id:x.id,title:x.title,quantity_value:x.quantity_value,quantity_unit:x.quantity_unit,brand:x.brand,size:x.size,store:x.store,category:x.category,priority:x.priority,optional:x.optional,status:x.status})),events:state.events,rules:state.rules,dependencies:state.dependencies,memories:state.memories,life_objects:state.objects||[],prayer_rules:state.prayerRules||[],profile:state.profile||null,prayer_today:state.prayer_today||null,reality:state.reality||null,settings:state.settings||null,recent:state.history.slice(-12)};
  return `أنت Planner لوكيل شخصي حقيقي. لا تنفذ ولا تدّعي النجاح. حوّل طلب المستخدم إلى JSON Plan فقط.\nقرار الراوتر:${JSON.stringify({route:route.route,task:route.task,risk:route.risk})}\nالحالة الحقيقية:${JSON.stringify(domain)}\n\nالشكل:\n{"requires_clarification":false,"clarification_question":null,"confidence":0.0,"summary":"قصير","operations":[...]}\n\nالعمليات المسموحة فقط:\nshopping.add {items:[{title,quantity_value,quantity_unit,brand,size,store,category,priority,optional,notes}]}\nshopping.remove {target:{id?,query?,all?}}\nshopping.update {target:{id?,query?},patch:{title?,quantity_value?,quantity_delta?,quantity_unit?,brand?,size?,store?,category?,priority?,optional?,notes?}}\nshopping.replace {target:{id?,query?},item:{...}}\nshopping.clear {confirmed:true|false}\nshopping.list\nshopping.done / shopping.reopen {target:{...}}\n\nevent.create {title,date:YYYY-MM-DD,time:HH:mm,duration_min,timezone,notes,location,priority,alert_offsets:[minutes before],allow_conflict:false}\nevent.update {target:{id?,query?,date?},patch:{title?,date?,time?,duration_min?,timezone?,notes?,location?,priority?,alert_offsets?},allow_conflict:false}\nevent.delete / event.complete {target:{id?,query?,date?,all?}}\nevent.snooze {target:{id?,query?},minutes}\nevent.list {date?,from_date?,to_date?}\n\nrule.create {title,interval_n,interval_unit:minute|hour|day|week|month|year,weekdays:[0=Sun..6=Sat],monthdays:[1..31],time,duration_min,start_date,end_date?,count_limit?,timezone,alert_offsets,notes,location,priority}\nrule.update {target:{id?,query?},patch:{...}}\nrule.delete / rule.pause / rule.resume {target:{...}}\nrule.skip {target:{...},date,reason?}\nrule.list\n\nschedule.free_slots {date,start_time,end_time,duration_min}\nschedule.free_period {days,start_date,horizon_days}\nschedule.search {query?,date?,from_date?,to_date?}\nschedule.bulk_shift {target:{query?,date?,all?},delta_minutes}\nschedule.bulk_delete / schedule.bulk_complete {target:{query?,date?,all?}}\n\ndependency.create {source:{id?,query?},target:{id?,query?},relation:after_start|after_end|before_start,offset_min}\ndependency.delete {id}\ndependency.list\n\nmemory.set {key,value}\nmemory.delete {key}\nmemory.list\nundo.last\n\nقواعد إلزامية:\n1) افهم المصري والسياق بالمعنى؛ لا تبني قرارك على كلمات محفوظة.\n2) الرسالة الطويلة لا تعني صعوبة.\n3) لو المرجع «ده/النوع الكبير/اللي قولتلك عليه» غير محسوم من الحالة: requires_clarification=true. ممنوع اختراع اسم أو ID.\n4) قائمة مشتريات متعددة الأسطر: كل صنف لازم يظهر مستقل داخل items، ولا تختصر أي صنف.\n5) «طلبات البيت/حاجات الهايبر/وإحنا بنشتري هات...» تعتبر shopping لو مفيش وقت تنبيه محدد.\n6) «فكرني بكرة 5...» schedule. الوقت النسبي لازم يتحول لتاريخ/وقت مطلق اعتمادًا على now.\n7) لو المستخدم قال «قبل الموعد بساعة» حط alert_offsets:[60]. ممكن أكتر من تنبيه.\n8) التكرار بالدقائق/الساعات/الأيام/الأسابيع/الشهور/السنين يستخدم rule.create.\n9) الإيقاف/الاستكمال لتكرار = rule.pause/resume. تخطي تاريخ واحد = rule.skip.\n10) Snooze = event.snooze.\n11) «حرّك كل مواعيد بكرة ساعتين» = schedule.bulk_shift.\n11.1) «عاوز 5 أيام فاضيين» = schedule.free_period، والبحث النصي في الجدول = schedule.search.\n12) «بعد الدكتور بساعتين اعمل...» ممكن event.create + dependency.create لو العلاقة دائمة؛ لو مجرد حساب مرة واحدة يكفي event.create بالوقت المحسوب.\n13) قبل إنشاء/تحريك موعد لا تفرض allow_conflict=true إلا لو المستخدم صرّح إنه موافق على التعارض. المنفذ سيتحقق.\n14) حذف شامل لا تؤكده إلا لو المستخدم قال صراحة الكل/كل القائمة/كل مواعيد اليوم.\n15) لو الطلب فيه عدة تغييرات، أخرجها كلها بالترتيب في نفس الخطة.\n16) المشاريع والمهام المنتظرة وصندوق الوارد ونموذج العالم تُحفظ كـ life objects بالأنواع الموضحة.
17) لو الطلب متعلق بموعد صلاة متكرر استخدم prayer.rule.*؛ ولو صلاة اليوم فقط استخدم prayer_today من الحالة لحساب event.create.
18) جلسة التسوق الفعلية start/end تستخدم shopping.session.*.
19) طلب أخبار/معلومة حديثة يستخدم live.search، وطلب «تابعلي/راقبلي» يستخدم live.watch.create.
20) إعدادات الوكيل تستخدم settings.*.
21) ممنوع success text. أنت تقترح خطة فقط.\n\nرسالة المستخدم:${JSON.stringify(text)}`;
}
async function planWithModel(env,model,text,state,route){
  const r=await callModel(env,{model,messages:[{role:"system",content:"Return exactly one valid AgentPlan JSON object. No Markdown."},{role:"user",content:plannerPrompt(text,state,route)}],temperature:0,maxTokens:3800,timeoutMs:PLANNER_TIMEOUT_MS,json:true});
  const p=validatePlan(parseLooseJson(r.content));if(!p){await recordModel(env,model,{ok:false,latencyMs:r.latencyMs,error:"plan_validation_failed",validationFailure:true});throw new Error("plan_validation_failed");}return p;
}

// -----------------------------------------------------------------------------
// EXECUTOR — deterministic writes only.
// -----------------------------------------------------------------------------
function exactlyOne(rows,label){if(rows.length===1)return rows[0];if(!rows.length)throw new ClarificationNeeded(`ملقتش ${label} المقصود بشكل مؤكد. تحددهولي بالاسم أو الوقت؟`,{kind:"target_missing"});throw new ClarificationNeeded(`لقيت أكتر من ${label} ينطبق عليه كلامك. تحددهولي أكتر؟`,{kind:"target_ambiguous",matches:rows.slice(0,8)});}
async function executePlan(env,chatId,plan,user){
  const effects=[],readResults={};
  for(const op of plan.operations){
    if(op.op==="shopping.add"){
      const ids=[];for(const x of op.items)ids.push(await addShoppingItem(env,chatId,x));effects.push({op:op.op,ids,expected:op.items});
    }else if(op.op==="shopping.remove"){
      const rows=await resolveShopping(env,chatId,op.target,{many:op.target.all});if(op.target.all){for(const r of rows)await removeShoppingItem(env,chatId,r.id);effects.push({op:op.op,ids:rows.map(r=>Number(r.id))});}else{const r=exactlyOne(rows,"صنف المشتريات");await removeShoppingItem(env,chatId,r.id);effects.push({op:op.op,ids:[Number(r.id)]});}
    }else if(op.op==="shopping.update"){
      const r=exactlyOne(await resolveShopping(env,chatId,op.target),"صنف المشتريات");await updateShoppingItem(env,chatId,r.id,op.patch);effects.push({op:op.op,id:Number(r.id),patch:op.patch});
    }else if(op.op==="shopping.replace"){
      const r=exactlyOne(await resolveShopping(env,chatId,op.target),"صنف المشتريات");await removeShoppingItem(env,chatId,r.id);const id=await addShoppingItem(env,chatId,op.item);effects.push({op:op.op,removedId:Number(r.id),addedId:id,item:op.item});
    }else if(op.op==="shopping.clear"){
      if(!op.confirmed)throw new ClarificationNeeded("تقصد أمسح قائمة المشتريات كلها؟ أكّدلي الحذف الشامل.",{kind:"confirm_clear_shopping"});await clearShopping(env,chatId);effects.push({op:op.op});
    }else if(op.op==="shopping.list"){
      readResults.shopping=await shoppingItems(env,chatId,{includeDone:true});effects.push({op:op.op,readOnly:true});
    }else if(op.op==="shopping.done"||op.op==="shopping.reopen"){
      const rows=await resolveShopping(env,chatId,op.target,{many:op.target.all});if(!op.target.all&&rows.length!==1)exactlyOne(rows,"صنف المشتريات");for(const r of rows)await setShoppingStatus(env,chatId,r.id,op.op==="shopping.done"?"done":"pending");effects.push({op:op.op,ids:rows.map(r=>Number(r.id)),status:op.op==="shopping.done"?"done":"pending"});
    }else if(op.op==="event.create"){
      const id=await createEvent(env,chatId,op,{allowConflict:op.allow_conflict});effects.push({op:op.op,id,expected:op});
    }else if(op.op==="event.update"){
      const r=exactlyOne(await resolveEvent(env,chatId,op.target),"موعد");await updateEvent(env,chatId,r.id,op.patch,{allowConflict:op.allow_conflict,cascade:true});effects.push({op:op.op,id:r.id,patch:op.patch});
    }else if(op.op==="event.delete"||op.op==="event.complete"){
      const rows=await resolveEvent(env,chatId,op.target,{many:op.target.all});if(!op.target.all&&rows.length!==1)exactlyOne(rows,"موعد");for(const r of rows)await (op.op==="event.delete"?deleteEvent(env,chatId,r.id):completeEvent(env,chatId,r.id));effects.push({op:op.op,ids:rows.map(r=>r.id)});
    }else if(op.op==="event.snooze"){
      const r=exactlyOne(await resolveEvent(env,chatId,op.target),"موعد");await snoozeEvent(env,chatId,r.id,op.minutes,user.timezone);effects.push({op:op.op,id:r.id,minutes:op.minutes});
    }else if(op.op==="event.list"){
      const date=op.date||null;readResults.events=await listEvents(env,chatId,{fromDate:date||op.from_date,toDate:date||op.to_date});effects.push({op:op.op,readOnly:true});
    }else if(op.op==="rule.create"){
      const id=await createRule(env,chatId,op);effects.push({op:op.op,id,expected:op});
    }else if(op.op==="rule.update"){
      const r=exactlyOne(await resolveRule(env,chatId,op.target),"تكرار");await updateRule(env,chatId,r.id,op.patch);effects.push({op:op.op,id:r.id,patch:op.patch});
    }else if(["rule.delete","rule.pause","rule.resume"].includes(op.op)){
      const rows=await resolveRule(env,chatId,op.target);if(!op.target.all&&rows.length!==1)exactlyOne(rows,"تكرار");const status=op.op==="rule.delete"?"deleted":op.op==="rule.pause"?"paused":"active";for(const r of rows)await setRuleStatus(env,chatId,r.id,status);effects.push({op:op.op,ids:rows.map(r=>r.id),status});
    }else if(op.op==="rule.skip"){
      const r=exactlyOne(await resolveRule(env,chatId,op.target),"تكرار");await skipRuleDate(env,chatId,r.id,op.date,op.reason);effects.push({op:op.op,id:r.id,date:op.date});
    }else if(op.op==="rule.list"){
      readResults.rules=await listRules(env,chatId,{activeOnly:false});effects.push({op:op.op,readOnly:true});
    }else if(op.op==="schedule.free_slots"){
      readResults.freeSlots=await freeSlots(env,chatId,{...op,timezone:user.timezone,limit:10});effects.push({op:op.op,readOnly:true});
    }else if(op.op==="schedule.free_period"){
      readResults.freePeriod=await findFreePeriod(env,chatId,{...op,timezone:user.timezone});effects.push({op:op.op,readOnly:true});
    }else if(op.op==="schedule.search"){
      readResults.scheduleSearch=await searchSchedule(env,chatId,op);effects.push({op:op.op,readOnly:true});
    }else if(op.op==="schedule.bulk_shift"){
      const rows=await resolveEvent(env,chatId,op.target,{many:true});if(!rows.length)throw new ClarificationNeeded("ملقتش مواعيد تنطبق على طلب التحريك.",{kind:"bulk_empty"});for(const r of rows){const n=addLocalMinutes(r.date,r.time,op.delta_minutes,r.timezone);await updateEvent(env,chatId,r.id,{date:n.date,time:n.time},{allowConflict:true,cascade:true});}effects.push({op:op.op,ids:rows.map(r=>r.id),delta_minutes:op.delta_minutes});
    }else if(op.op==="schedule.bulk_delete"||op.op==="schedule.bulk_complete"){
      const rows=await resolveEvent(env,chatId,op.target,{many:true});if(!rows.length)throw new ClarificationNeeded("ملقتش مواعيد تنطبق على الطلب الجماعي.",{kind:"bulk_empty"});for(const r of rows)await(op.op==="schedule.bulk_delete"?deleteEvent(env,chatId,r.id):completeEvent(env,chatId,r.id));effects.push({op:op.op,ids:rows.map(r=>r.id)});
    }else if(op.op==="dependency.create"){
      const s=exactlyOne(await resolveEvent(env,chatId,op.source),"موعد المصدر"),t=exactlyOne(await resolveEvent(env,chatId,op.target),"الموعد التابع");await createDependency(env,chatId,{source_event_id:s.id,target_event_id:t.id,relation:op.relation,offset_min:op.offset_min});effects.push({op:op.op,source:s.id,target:t.id,relation:op.relation,offset_min:op.offset_min});
    }else if(op.op==="dependency.delete"){
      await deleteDependency(env,chatId,op.id);effects.push({op:op.op,id:op.id});
    }else if(op.op==="dependency.list"){
      readResults.dependencies=await dependencyRows(env,chatId);effects.push({op:op.op,readOnly:true});
    }else if(op.op==="life.create"){
      const id=await createLifeObject(env,chatId,op);effects.push({op:op.op,id,type:op.type,name:op.name});
    }else if(op.op==="life.update"){
      const r=exactlyOne(await resolveLifeObject(env,chatId,op.target,op.type),"عنصر");await updateLifeObject(env,chatId,r.id,op.patch);effects.push({op:op.op,id:r.id});
    }else if(op.op==="life.delete"){
      const rows=await resolveLifeObject(env,chatId,op.target,op.type);if(!op.target.all&&rows.length!==1)exactlyOne(rows,"عنصر");for(const r of rows)await deleteLifeObject(env,chatId,r.id);effects.push({op:op.op,ids:rows.map(r=>r.id)});
    }else if(op.op==="life.list"){
      readResults.life=await listLifeObjects(env,chatId,{type:op.type,status:op.status});effects.push({op:op.op,readOnly:true});
    }else if(op.op==="location.set"){
      await setProfileLocation(env,chatId,op);effects.push({op:op.op,latitude:op.latitude,longitude:op.longitude});
    }else if(op.op==="location.show"){
      readResults.profile=await getProfile(env,chatId);effects.push({op:op.op,readOnly:true});
    }else if(op.op==="prayer.rule.create"){
      const id=await createPrayerRule(env,chatId,op);effects.push({op:op.op,id});
    }else if(op.op==="prayer.rule.delete"){
      const r=exactlyOne(await resolvePrayerRule(env,chatId,op.target),"قاعدة صلاة");await deletePrayerRule(env,chatId,r.id);effects.push({op:op.op,id:Number(r.id)});
    }else if(op.op==="prayer.rule.list"){
      readResults.prayerRules=await listPrayerRules(env,chatId);effects.push({op:op.op,readOnly:true});
    }else if(op.op==="shopping.session.start"){
      const active=(await listLifeObjects(env,chatId,{type:"shopping_session",status:"active"}))[0];if(active)await updateLifeObject(env,chatId,active.id,{status:"ended",data:{ended_at:nowIso()}});const id=await createLifeObject(env,chatId,{type:"shopping_session",name:op.place_name||"جلسة تسوق",data:{place_name:op.place_name||null,started_at:nowIso()}});effects.push({op:op.op,id});
    }else if(op.op==="shopping.session.end"){
      const active=(await listLifeObjects(env,chatId,{type:"shopping_session",status:"active"}))[0];if(!active)throw new ClarificationNeeded("مفيش جلسة تسوق مفتوحة دلوقتي.",{kind:"no_shopping_session"});await updateLifeObject(env,chatId,active.id,{status:"ended",data:{ended_at:nowIso()}});effects.push({op:op.op,id:active.id});
    }else if(op.op==="live.search"){
      const profile=await getProfile(env,chatId);readResults.news=await liveNewsSearch(op.query,{countryCode:profile.country_code||"EG",limit:8});effects.push({op:op.op,readOnly:true});
    }else if(op.op==="live.watch.create"){
      const news=await liveNewsSearch(op.query,{countryCode:(await getProfile(env,chatId)).country_code||"EG",limit:1});const id=await createLifeObject(env,chatId,{type:"live_watch",name:op.query,data:{query:op.query,last_url:news[0]?.url||null,last_title:news[0]?.title||null}});effects.push({op:op.op,id});
    }else if(op.op==="live.watch.delete"){
      const r=exactlyOne(await resolveLifeObject(env,chatId,op.target,"live_watch"),"متابعة");await deleteLifeObject(env,chatId,r.id);effects.push({op:op.op,ids:[r.id]});
    }else if(op.op==="live.watch.list"){
      readResults.watches=await listLifeObjects(env,chatId,{type:"live_watch",status:"active"});effects.push({op:op.op,readOnly:true});
    }else if(op.op==="settings.update"){
      await updateAgentSettings(env,chatId,op.patch);effects.push({op:op.op});
    }else if(op.op==="settings.show"){
      readResults.settings=await getAgentSettings(env,chatId);effects.push({op:op.op,readOnly:true});
    }else if(op.op==="memory.set"){
      await setMemory(env,chatId,op.key,op.value,1);effects.push({op:op.op,key:op.key,value:op.value});
    }else if(op.op==="memory.delete"){
      await deleteMemory(env,chatId,op.key);effects.push({op:op.op,key:op.key});
    }else if(op.op==="memory.list"){
      readResults.memories=await listMemories(env,chatId);effects.push({op:op.op,readOnly:true});
    }else if(op.op==="undo.last"){
      const restored=await undoLast(env,chatId);effects.push({op:op.op,restoredDigest:domainDigest(restored)});
    }
  }
  return {effects,readResults};
}

// -----------------------------------------------------------------------------
// VERIFIER — proves post-conditions before any success reply.
// -----------------------------------------------------------------------------
function same(a,b){return String(a??"")===String(b??"");}
function verifyExecution(before,after,effects){
  const checks=[];
  for(const e of effects){
    if(e.readOnly){checks.push({op:e.op,ok:true});continue;}
    if(e.op==="shopping.add"){
      for(const x of e.expected){const hit=after.shopping.find(r=>r.status!=="deleted"&&normKey(r.title)===normKey(x.title));checks.push({op:e.op,item:x.title,ok:!!hit,reason:hit?null:"missing_item"});}
    }else if(e.op==="shopping.remove")for(const id of e.ids)checks.push({op:e.op,id,ok:!after.shopping.some(r=>r.id===id&&r.status!=="deleted")});
    else if(e.op==="shopping.update"){
      const r=after.shopping.find(x=>x.id===e.id);let ok=!!r;if(r)for(const[k,v]of Object.entries(e.patch)){if(k==="quantity_delta")continue;if(!same(r[k],v))ok=false;}checks.push({op:e.op,ok,reason:ok?null:"shopping_patch_mismatch"});
    }else if(e.op==="shopping.replace")checks.push({op:e.op,ok:!after.shopping.some(x=>x.id===e.removedId&&x.status!=="deleted")&&after.shopping.some(x=>x.status!=="deleted"&&normKey(x.title)===normKey(e.item.title)),reason:"replace_mismatch"});
    else if(e.op==="shopping.clear")checks.push({op:e.op,ok:after.shopping.every(x=>x.status==="deleted")});
    else if(e.op==="shopping.done"||e.op==="shopping.reopen")for(const id of e.ids){const r=after.shopping.find(x=>x.id===id);checks.push({op:e.op,id,ok:!!r&&r.status===e.status});}
    else if(e.op==="event.create"){
      const r=after.events.find(x=>x.id===e.id);checks.push({op:e.op,ok:!!r&&same(r.title,e.expected.title)&&same(r.date,e.expected.date)&&same(r.time,e.expected.time),reason:r?"event_field_mismatch":"event_missing"});
    }else if(e.op==="event.update"){
      const r=after.events.find(x=>x.id===e.id);let ok=!!r;if(r)for(const[k,v]of Object.entries(e.patch)){const key=k==="duration_min"?"duration_min":k;if(!same(r[key],v))ok=false;}checks.push({op:e.op,ok,reason:ok?null:"event_patch_mismatch"});
    }else if(e.op==="event.delete")for(const id of e.ids){const r=after.events.find(x=>x.id===id);checks.push({op:e.op,id,ok:!r||r.status==="deleted"});}
    else if(e.op==="event.complete")for(const id of e.ids){const r=after.events.find(x=>x.id===id);checks.push({op:e.op,id,ok:!!r&&r.status==="completed"});}
    else if(e.op==="event.snooze"){const b=before.events.find(x=>x.id===e.id),a=after.events.find(x=>x.id===e.id);checks.push({op:e.op,ok:!!a&&!!b&&(a.date!==b.date||a.time!==b.time)});}
    else if(e.op==="rule.create")checks.push({op:e.op,ok:after.rules.some(x=>x.id===e.id)});
    else if(e.op==="rule.update")checks.push({op:e.op,ok:after.rules.some(x=>x.id===e.id)});
    else if(["rule.delete","rule.pause","rule.resume"].includes(e.op))for(const id of e.ids){const r=after.rules.find(x=>x.id===id);checks.push({op:e.op,id,ok:!!r&&r.status===e.status});}
    else if(e.op==="rule.skip")checks.push({op:e.op,ok:after.exceptions.some(x=>Number(x.rule_id)===e.id&&x.local_date===e.date)});
    else if(e.op==="schedule.bulk_shift")for(const id of e.ids){const b=before.events.find(x=>x.id===id),a=after.events.find(x=>x.id===id);checks.push({op:e.op,id,ok:!!b&&!!a&&(b.date!==a.date||b.time!==a.time)});}
    else if(e.op==="schedule.bulk_delete")for(const id of e.ids){const a=after.events.find(x=>x.id===id);checks.push({op:e.op,id,ok:!a||a.status==="deleted"});}
    else if(e.op==="schedule.bulk_complete")for(const id of e.ids){const a=after.events.find(x=>x.id===id);checks.push({op:e.op,id,ok:!!a&&a.status==="completed"});}
    else if(e.op==="dependency.create")checks.push({op:e.op,ok:after.dependencies.some(x=>Number(x.source_event_id)===e.source&&Number(x.target_event_id)===e.target)});
    else if(e.op==="dependency.delete")checks.push({op:e.op,ok:!after.dependencies.some(x=>Number(x.id)===e.id)});
    else if(e.op==="life.create")checks.push({op:e.op,ok:(after.objects||[]).some(x=>x.id===e.id&&x.status!=="deleted")});
    else if(e.op==="life.update")checks.push({op:e.op,ok:(after.objects||[]).some(x=>x.id===e.id)});
    else if(e.op==="life.delete")for(const id of e.ids)checks.push({op:e.op,id,ok:!(after.objects||[]).some(x=>x.id===id&&x.status!=="deleted")});
    else if(e.op==="location.set")checks.push({op:e.op,ok:Number(after.profile?.latitude)===Number(e.latitude)&&Number(after.profile?.longitude)===Number(e.longitude)});
    else if(e.op==="prayer.rule.create")checks.push({op:e.op,ok:(after.prayerRules||[]).some(x=>Number(x.id)===e.id&&Number(x.active)===1)});
    else if(e.op==="prayer.rule.delete")checks.push({op:e.op,ok:(after.prayerRules||[]).some(x=>Number(x.id)===e.id&&Number(x.active)===0)});
    else if(e.op==="shopping.session.start")checks.push({op:e.op,ok:(after.objects||[]).some(x=>x.id===e.id&&x.object_type==="shopping_session"&&x.status==="active")});
    else if(e.op==="shopping.session.end")checks.push({op:e.op,ok:(after.objects||[]).some(x=>x.id===e.id&&x.status==="ended")});
    else if(e.op==="live.watch.create")checks.push({op:e.op,ok:(after.objects||[]).some(x=>x.id===e.id&&x.object_type==="live_watch"&&x.status==="active")});
    else if(e.op==="live.watch.delete")for(const id of e.ids)checks.push({op:e.op,ok:!(after.objects||[]).some(x=>x.id===id&&x.status!=="deleted")});
    else if(e.op==="settings.update")checks.push({op:e.op,ok:true});
    else if(e.op==="memory.set")checks.push({op:e.op,ok:after.memories.some(x=>x.key===e.key&&x.value===e.value)});
    else if(e.op==="memory.delete")checks.push({op:e.op,ok:!after.memories.some(x=>x.key===e.key)});
    else if(e.op==="undo.last")checks.push({op:e.op,ok:domainDigest(after)===e.restoredDigest});
  }
  return {ok:checks.every(x=>x.ok),checks};
}

// -----------------------------------------------------------------------------
// DETERMINISTIC REPLY GENERATOR
// -----------------------------------------------------------------------------
function fmtShopping(rows){
  const visible=rows.filter(x=>x.status!=="deleted");if(!visible.length)return"🛒 قائمة المشتريات فاضية.";
  return `🛒 المشتريات (${visible.length})\n${visible.map(x=>`${x.status==="done"?"✅":"▫️"} ${x.quantity_value!=null?`${x.quantity_value}${x.quantity_unit?` ${x.quantity_unit}`:""} × `:""}${x.title}${x.brand?` — ${x.brand}`:""}${x.size?` (${x.size})`:""}${x.store?` @ ${x.store}`:""}`).join("\n")}`;
}
function fmtEvents(rows){
  const a=rows.filter(x=>x.status==="active");if(!a.length)return"⏰ مفيش مواعيد/تذكيرات نشطة في الفترة دي.";
  return `⏰ المواعيد (${a.length})\n${a.map(x=>`• ${x.date} ${x.time}${x.duration_min?` (${x.duration_min}د)`:""} — ${x.title}`).join("\n")}`;
}
function fmtRules(rows){
  const a=rows.filter(x=>x.status!=="deleted");if(!a.length)return"🔁 مفيش تكرارات محفوظة.";
  return `🔁 التكرارات (${a.length})\n${a.map(x=>`• ${x.status==="paused"?"⏸️":"▶️"} ${x.title} — كل ${x.interval_n} ${x.interval_unit} @ ${x.time}`).join("\n")}`;
}
function successReply(plan,after,reads){
  const out=[];
  for(const op of plan.operations){
    if(op.op==="shopping.add")out.push(`🛒 ضفت ${op.items.length}: ${op.items.map(x=>x.title).join("، ")}`);
    else if(op.op==="shopping.remove")out.push("🛒 شلت المطلوب من المشتريات.");
    else if(op.op==="shopping.update")out.push("🛒 عدلت الصنف المطلوب.");
    else if(op.op==="shopping.replace")out.push(`🛒 استبدلت الصنف بـ ${op.item.title}.`);
    else if(op.op==="shopping.clear")out.push("🛒 مسحت قائمة المشتريات كلها.");
    else if(op.op==="shopping.list")out.push(fmtShopping(reads.shopping??after.shopping));
    else if(op.op==="shopping.done")out.push("✅ علمت الصنف/الأصناف كمشتراة.");
    else if(op.op==="shopping.reopen")out.push("↩️ رجعت الصنف/الأصناف للقائمة.");
    else if(op.op==="event.create")out.push(`⏰ سجلت «${op.title}» — ${op.date} ${op.time}${op.duration_min?` لمدة ${op.duration_min} دقيقة`:""}.`);
    else if(op.op==="event.update")out.push("⏰ عدلت الموعد المطلوب.");
    else if(op.op==="event.delete")out.push("🗑️ حذفت الموعد/المواعيد المطلوبة.");
    else if(op.op==="event.complete")out.push("✅ علّمت الموعد/المواعيد كمكتملة.");
    else if(op.op==="event.snooze")out.push(`😴 أجلت التذكير ${op.minutes} دقيقة.`);
    else if(op.op==="event.list")out.push(fmtEvents(reads.events??after.events));
    else if(op.op==="rule.create")out.push(`🔁 سجلت التكرار «${op.title}».`);
    else if(op.op==="rule.update")out.push("🔁 عدلت التكرار.");
    else if(op.op==="rule.delete")out.push("🗑️ حذفت التكرار.");
    else if(op.op==="rule.pause")out.push("⏸️ وقفت التكرار.");
    else if(op.op==="rule.resume")out.push("▶️ استكملت التكرار.");
    else if(op.op==="rule.skip")out.push(`⏭️ هتخطى التكرار يوم ${op.date}.`);
    else if(op.op==="rule.list")out.push(fmtRules(reads.rules??after.rules));
    else if(op.op==="schedule.free_slots")out.push((reads.freeSlots||[]).length?`🟢 الأوقات الفاضية يوم ${op.date}:\n${reads.freeSlots.map(x=>`• ${x.time} → ${x.end_time}`).join("\n")}`:"مفيش فترة فاضية بالمواصفات دي.");
    else if(op.op==="schedule.free_period")out.push(reads.freePeriod?`🏖️ أقرب فترة فاضية ${reads.freePeriod.days} أيام: ${reads.freePeriod.start_date} → ${reads.freePeriod.end_date}`:"مش لاقي فترة فاضية بالمواصفات دي في النطاق المطلوب.");
    else if(op.op==="schedule.search"){const s=reads.scheduleSearch||{events:[],rules:[]};out.push((s.events.length||s.rules.length)?`🔎 النتائج:\n${s.events.map(x=>`• ${x.date} ${x.time} — ${x.title}`).concat(s.rules.map(x=>`• 🔁 ${x.title} — ${x.time}`)).join("\n")}`:"🔎 ملقتش حاجة مطابقة في الجدول.");}
    else if(op.op==="schedule.bulk_shift")out.push(`↔️ حرّكت المواعيد المطلوبة ${Math.abs(op.delta_minutes)} دقيقة ${op.delta_minutes>=0?"لقدام":"لورا"}.`);
    else if(op.op==="schedule.bulk_delete")out.push("🗑️ حذفت مجموعة المواعيد المطلوبة.");
    else if(op.op==="schedule.bulk_complete")out.push("✅ علّمت مجموعة المواعيد كمكتملة.");
    else if(op.op==="dependency.create")out.push("🔗 ربطت الموعدين، وأي تحريك للمصدر هيحرّك الموعد التابع تلقائيًا.");
    else if(op.op==="dependency.delete")out.push("🔓 فكيت العلاقة بين المواعيد.");
    else if(op.op==="dependency.list")out.push((reads.dependencies||[]).length?`🔗 عندك ${(reads.dependencies||[]).length} علاقة بين المواعيد.`:"🔗 مفيش علاقات بين المواعيد.");
    else if(op.op==="life.create")out.push(`✅ سجلت ${op.type}: ${op.name}.`);
    else if(op.op==="life.update")out.push("✅ عدلت العنصر المطلوب.");
    else if(op.op==="life.delete")out.push("🗑️ حذفت/أغلقت العنصر المطلوب.");
    else if(op.op==="life.list")out.push((reads.life||[]).length?`📋 ${reads.life.map(x=>`• [${x.object_type}] ${x.name} — ${x.status}`).join("\n")}`:"📋 مفيش عناصر مطابقة.");
    else if(op.op==="location.set")out.push("📍 حفظت موقعك.");
    else if(op.op==="location.show"){const p=reads.profile||after.profile;out.push(`📍 موقعك: ${p?.city||"غير محدد"}${p?.country?`، ${p.country}`:""} (${p?.latitude??"?"}, ${p?.longitude??"?"})`);}
    else if(op.op==="prayer.rule.create")out.push(`🕌 سجلت تذكير مرتبط بصلاة ${op.prayer}.`);
    else if(op.op==="prayer.rule.delete")out.push("🕌 أوقفت تذكير الصلاة.");
    else if(op.op==="prayer.rule.list")out.push((reads.prayerRules||[]).length?`🕌 تذكيرات الصلاة:\n${reads.prayerRules.map(x=>`• ${x.title} — ${x.prayer} ${Number(x.offset_minutes)>=0?"+":""}${x.offset_minutes}د ${Number(x.active)?"▶️":"⏸️"}`).join("\n")}`:"🕌 مفيش تذكيرات صلاة.");
    else if(op.op==="shopping.session.start")out.push("🛒 بدأت وضع التسوق.");
    else if(op.op==="shopping.session.end")out.push("✅ أنهيت وضع التسوق.");
    else if(op.op==="live.search")out.push((reads.news||[]).length?`📰 أحدث النتائج:\n${reads.news.map(x=>`• ${x.title}`).join("\n")}`:"📰 ملقتش نتائج حديثة دلوقتي.");
    else if(op.op==="live.watch.create")out.push(`👀 بدأت أتابع: ${op.query}.`);
    else if(op.op==="live.watch.delete")out.push("👀 أوقفت المتابعة المطلوبة.");
    else if(op.op==="live.watch.list")out.push((reads.watches||[]).length?`👀 المتابعات:\n${reads.watches.map(x=>`• ${x.name}`).join("\n")}`:"👀 مفيش متابعات نشطة.");
    else if(op.op==="settings.update")out.push("⚙️ حدثت إعدادات الوكيل.");
    else if(op.op==="settings.show"){const x=reads.settings||after.settings;out.push(`⚙️ الوضع: ${x?.permission_mode||"safe_auto"} · proactive ${Number(x?.proactive_enabled)?"on":"off"} · morning ${Number(x?.morning_brief_enabled)?"on":"off"} · evening ${Number(x?.evening_brief_enabled)?"on":"off"}`);}
    else if(op.op==="memory.set")out.push("🧠 حفظت المعلومة.");
    else if(op.op==="memory.delete")out.push("🧠 نسيت المعلومة المطلوبة.");
    else if(op.op==="memory.list")out.push((reads.memories||[]).length?`🧠 المحفوظ:\n${reads.memories.map(x=>`• ${x.key}: ${x.value}`).join("\n")}`:"🧠 مفيش معلومات محفوظة.");
    else if(op.op==="undo.last")out.push("↩️ رجعت آخر عملية قابلة للتراجع.");
  }
  return out.filter(Boolean).join("\n\n")||"✅ تم التنفيذ والتحقق من النتيجة.";
}

// -----------------------------------------------------------------------------
// CHAT FALLBACK — conversation only, never state mutation.
// -----------------------------------------------------------------------------
async function answerChat(env,candidates,text,state){
  const sys="أنت SuperAgent، مساعد شخصي عملي ذكي. اتكلم بالمصري الطبيعي حسب أسلوب المستخدم. اختصر من غير ما تبقى آلي. ممنوع تدّعي إنك غيرت مشتريات أو مواعيد أو بيانات؛ أي تنفيذ لازم يمر من الـAgent executor.";
  const messages=[{role:"system",content:sys},...state.history.slice(-14).map(x=>({role:x.role,content:compact(x.content,3000)})),{role:"user",content:text}];
  const errs=[];for(const m of candidates){try{return {reply:(await callModel(env,{model:m.id,messages,temperature:.45,maxTokens:1800,timeoutMs:CHAT_TIMEOUT_MS})).content,model:m.id};}catch(e){errs.push({model:m.id,error:compact(e?.message||e,120)});}}throw new Error(`chat_all_models_failed:${JSON.stringify(errs)}`);
}

// -----------------------------------------------------------------------------
// OPERATION LOG + CORE AGENT LOOP
// -----------------------------------------------------------------------------
async function logOperation(env,chatId,d){const t=nowIso();await env.DB.prepare(`INSERT INTO sa2_operation_log(chat_id,request_id,route_json,plan_json,before_json,after_json,verification_json,status,error,model_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(chatId,d.requestId,JSON.stringify(d.route||null),JSON.stringify(d.plan||null),JSON.stringify(d.before||null),JSON.stringify(d.after||null),JSON.stringify(d.verification||null),d.status,d.error||null,d.model||null,t,t).run();}
function explicitConfirmation(text){
  const n=normKey(text);
  return /^(?:ايوه|ايوة|اه|نعم|تمام|ماشي|موافق|اكد|اكدت|نفذ|نفذها|نفذهم|اعملها|اعملهم|كمل|go|confirm)(?:\s|$)/.test(n);
}
function explicitCancellation(text){
  const n=normKey(text);
  return /^(?:لا|لأ|الغ|الغي|الغي|الغيه|الغها|الغهم|الغاء|cancel|بلاش|مش عاوز)(?:\s|$)/.test(n);
}
function destructivePlan(plan){
  const destructive=new Set(["shopping.clear","event.delete","schedule.bulk_delete","rule.delete","life.delete","memory.delete","prayer.rule.delete","live.watch.delete"]);
  return asArray(plan?.operations).some(o=>destructive.has(o.op));
}
async function permissionGate(env,chatId,plan,currentText,effectiveText){
  if(!plan?.mutates)return null;
  const s=await getAgentSettings(env,chatId),confirmed=explicitConfirmation(currentText);
  const needsAll=["confirm_all","manual"].includes(String(s.permission_mode||"safe_auto"));
  const needsDelete=Number(s.ask_before_delete||0)===1&&destructivePlan(plan);
  if((needsAll||needsDelete)&&!confirmed){
    const label=needsAll?"التنفيذ ده هيغيّر بياناتك":"العملية دي فيها حذف";
    const question=`${label}. لو موافق اكتب «نفذ»، ولو لأ اكتب «إلغاء».`;
    await savePending(env,chatId,effectiveText,question,{kind:"permission_confirmation"});
    return `⚠️ ${question}`;
  }
  return null;
}

async function processUserText(env,chatId,text){
  const user=await ensureUser(env,chatId),pending=await getPending(env,chatId);
  if(pending&&pending.meta?.kind==="permission_confirmation"&&explicitCancellation(text)){await clearPending(env,chatId);await saveMessage(env,chatId,"user",text);const reply="✅ تمام، ألغيت التنفيذ ومغيّرتش أي بيانات.";await saveMessage(env,chatId,"assistant",reply);return{reply,cancelled:true};}
  const effective=pending?`${pending.base_text}\n\nتوضيح المستخدم: ${text}`:text;if(pending)await clearPending(env,chatId);
  await saveMessage(env,chatId,"user",text);
  const route=await routeRequest(env,{text:effective}),before=await readState(env,chatId,user.timezone);
  if(/(?:الفجر|الشروق|الظهر|العصر|المغرب|العشاء|صلاة)/.test(normalizeArabic(effective)))before.prayer_today=await getPrayerTimes(env,chatId,before.now.date);
  if(/(?:اخبار|خبر|احدث|آخر|حاليا|دلوقتي|اجازه|اجازة|عطله|عطلة|عيد|هجري|هجرى|صلاة|الفجر|الظهر|العصر|المغرب|العشاء)/.test(normalizeArabic(effective)))before.reality=await realityContext(env,chatId,effective,before.now.date);
  if(route.task==="chat"&&!route.needs_tools&&!route.needs_context){const a=await answerChat(env,route.candidates,effective,before);await saveMessage(env,chatId,"assistant",a.reply);return{reply:a.reply,route,model:a.model};}
  const requestId=uid(),errors=[];
  for(const candidate of route.candidates){
    let currentBefore=await readState(env,chatId,user.timezone),plan=null;if(/(?:الفجر|الشروق|الظهر|العصر|المغرب|العشاء|صلاة)/.test(normalizeArabic(effective)))currentBefore.prayer_today=before.prayer_today||await getPrayerTimes(env,chatId,currentBefore.now.date);currentBefore.reality=before.reality||null;
    try{
      plan=await planWithModel(env,candidate.id,effective,currentBefore,route);
      if(plan.requires_clarification){await savePending(env,chatId,effective,plan.clarification_question,{route});const reply=`❓ ${plan.clarification_question}`;await saveMessage(env,chatId,"assistant",reply);await logOperation(env,chatId,{requestId,route,plan,before:currentBefore,status:"clarification",model:candidate.id});return{reply,route,model:candidate.id};}
      const gate=await permissionGate(env,chatId,plan,text,effective);if(gate){await saveMessage(env,chatId,"assistant",gate);await logOperation(env,chatId,{requestId,route,plan,before:currentBefore,status:"awaiting_confirmation",model:candidate.id});return{reply:gate,route,model:candidate.id};}
      let result;
      try{result=await executePlan(env,chatId,plan,user);}catch(e){
        if(e instanceof ClarificationNeeded){await rollbackState(env,chatId,currentBefore);await savePending(env,chatId,effective,e.question,e.meta);const reply=`❓ ${e.question}`;await saveMessage(env,chatId,"assistant",reply);await logOperation(env,chatId,{requestId,route,plan,before:currentBefore,status:"clarification",error:e.message,model:candidate.id});return{reply,route,model:candidate.id};}
        throw e;
      }
      const after=await readState(env,chatId,user.timezone),verification=verifyExecution(currentBefore,after,result.effects);
      if(!verification.ok){await rollbackState(env,chatId,currentBefore);errors.push({model:candidate.id,error:"postcondition_failed",verification});await logOperation(env,chatId,{requestId,route,plan,before:currentBefore,after,verification,status:"rolled_back",error:"postcondition_failed",model:candidate.id});continue;}
      if(plan.mutates&&!plan.operations.some(o=>o.op==="undo.last"))await saveUndo(env,chatId,currentBefore,plan.summary||effective.slice(0,200));
      const reply=successReply(plan,after,result.readResults);await saveMessage(env,chatId,"assistant",reply);await logOperation(env,chatId,{requestId,route,plan,before:currentBefore,after,verification,status:"verified_success",model:candidate.id});return{reply,route,model:candidate.id,verification};
    }catch(e){try{await rollbackState(env,chatId,currentBefore);}catch{}errors.push({model:candidate.id,error:compact(e?.message||e,180)});await logOperation(env,chatId,{requestId,route,plan,before:currentBefore,status:"attempt_failed",error:String(e?.message||e),model:candidate.id});}
  }
  const reply="⚠️ مقدرتش أنفذ الطلب بأمان بعد تجربة أكتر من موديل، فمغيّرتش أي بيانات. ابعتهولي بصياغة مختلفة أو وضّح الجزء الغامض.";await saveMessage(env,chatId,"assistant",reply);return{reply,route,error:"all_attempts_failed",errors};
}

// -----------------------------------------------------------------------------
// TELEGRAM API
// -----------------------------------------------------------------------------
async function tg(env,method,payload={}){const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const j=await r.json().catch(()=>null);if(!r.ok||!j?.ok)throw new Error(j?.description||`telegram_${r.status}`);return j.result;}
async function sendText(env,chatId,text,reply_markup=null){const p={chat_id:chatId,text:String(text||"").slice(0,4096),disable_web_page_preview:true};if(reply_markup)p.reply_markup=reply_markup;return tg(env,"sendMessage",p);}
async function answerCb(env,id,text="تم"){try{await tg(env,"answerCallbackQuery",{callback_query_id:id,text,show_alert:false});}catch{}}
function mainMenuKeyboard(){
  return {inline_keyboard:[
    [{text:"📍 النهاردة",callback_data:"panel:today"},{text:"🗓️ 7 أيام",callback_data:"panel:week"}],
    [{text:"📅 كل المواعيد",callback_data:"panel:list"},{text:"🔁 التكرارات",callback_data:"panel:recurring"}],
    [{text:"🛒 المشتريات",callback_data:"panel:shopping"},{text:"🧠 الذاكرة",callback_data:"panel:memory"}],
    [{text:"🌍 الحالة الحالية",callback_data:"panel:live"},{text:"↩️ تراجع",callback_data:"panel:undo"}]
  ]};
}
async function panelReply(env,chatId,panel){
  if(panel==="today")return (await processUserText(env,chatId,"وريني مواعيد النهارده")).reply;
  if(panel==="week")return (await processUserText(env,chatId,"وريني جدولي للسبع أيام الجايين")).reply;
  if(panel==="list")return (await processUserText(env,chatId,"وريني كل المواعيد والتذكيرات النشطة")).reply;
  if(panel==="recurring")return (await processUserText(env,chatId,"وريني كل التكرارات وتذكيرات الصلاة")).reply;
  if(panel==="shopping")return (await processUserText(env,chatId,"وريني قائمة المشتريات الحالية")).reply;
  if(panel==="memory")return (await processUserText(env,chatId,"وريني كل المعلومات اللي فاكرها عني ونموذج العالم")).reply;
  if(panel==="undo")return (await processUserText(env,chatId,"ارجع آخر عملية نفذتها")).reply;
  if(panel==="live"){const p=await getProfile(env,chatId),u=await ensureUser(env,chatId),n=zonedParts(new Date(),u.timezone),pr=await getPrayerTimes(env,chatId,n.date),ev=await listEvents(env,chatId,{fromDate:n.date,toDate:n.date}),hol=await publicHolidays(p,n.date);return `🌍 الحالة الحالية\n📍 ${p.city||"موقعك"}${p.country?`، ${p.country}`:""}\n🕒 ${n.date} ${n.time}${pr.hijri?` · هجري ${pr.hijri.date}`:""}\n${hol.length?`🎉 ${hol.map(x=>x.name).join("، ")}\n`:""}🕌 الفجر ${pr.Fajr||"—"} · الظهر ${pr.Dhuhr||"—"} · العصر ${pr.Asr||"—"} · المغرب ${pr.Maghrib||"—"} · العشاء ${pr.Isha||"—"}\n${fmtEvents(ev)}`;}
  return "الأمر غير معروف.";
}

function eventKeyboard(eventId){return{inline_keyboard:[[{text:"😴 10 د",callback_data:`snz:${eventId}:10`},{text:"😴 30 د",callback_data:`snz:${eventId}:30`},{text:"✅ تم",callback_data:`done:${eventId}`}]]};}
function ruleKeyboard(ruleId,date){return{inline_keyboard:[[{text:"⏭️ تخطي النهارده",callback_data:`rskip:${ruleId}:${date}`}]]};}

// -----------------------------------------------------------------------------
// DURABLE TELEGRAM QUEUE
// -----------------------------------------------------------------------------
async function persistUpdate(env,u){const id=Number(u?.update_id),chatId=String(u?.message?.chat?.id||u?.callback_query?.message?.chat?.id||"");if(!Number.isFinite(id)||!chatId)return;const t=nowIso();await env.DB.prepare(`INSERT OR IGNORE INTO sa2_telegram_updates(update_id,chat_id,payload_json,status,attempts,created_at,updated_at) VALUES (?,?,?,'pending',0,?,?)`).bind(id,chatId,JSON.stringify(u),t,t).run();}
async function acquireLease(env,chatId){const t=nowIso(),token=uid(),until=new Date(Date.now()+LEASE_MS).toISOString();const cur=await env.DB.prepare(`SELECT * FROM sa2_chat_leases WHERE chat_id=?`).bind(chatId).first();if(cur&&Date.parse(cur.lease_until)>Date.now())return null;await env.DB.prepare(`INSERT INTO sa2_chat_leases(chat_id,lease_token,lease_until,updated_at) VALUES (?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,updated_at=excluded.updated_at`).bind(chatId,token,until,t).run();return token;}
async function releaseLease(env,chatId,token){await env.DB.prepare(`DELETE FROM sa2_chat_leases WHERE chat_id=? AND lease_token=?`).bind(chatId,token).run();}
async function directCallback(env,u){
  const cb=u.callback_query,chatId=String(cb?.message?.chat?.id||""),data=String(cb?.data||"");if(!chatId)return;
  const user=await ensureUser(env,chatId),before=await readState(env,chatId,user.timezone);
  try{
    if(data.startsWith("panel:")){const panel=data.slice(6),reply=await panelReply(env,chatId,panel);await answerCb(env,cb.id,"تم");await sendText(env,chatId,reply,panel==="live"?null:mainMenuKeyboard());return;}
    if(data.startsWith("snz:")){const[,id,m]=data.split(":");await snoozeEvent(env,chatId,Number(id),Number(m),user.timezone);const after=await readState(env,chatId,user.timezone);await saveUndo(env,chatId,before,`snooze ${id}`);await answerCb(env,cb.id,`اتأجل ${m} دقيقة`);await sendText(env,chatId,`😴 أجلت التذكير ${m} دقيقة.`);return;}
    if(data.startsWith("done:")){const[,id]=data.split(":");await completeEvent(env,chatId,Number(id));await saveUndo(env,chatId,before,`complete ${id}`);await answerCb(env,cb.id,"تمام ✅");return;}
    if(data.startsWith("rskip:")){const[,id,date]=data.split(":");await skipRuleDate(env,chatId,Number(id),date,"Telegram skip button");await saveUndo(env,chatId,before,`skip rule ${id}`);await answerCb(env,cb.id,"هتتخطى النهارده ⏭️");return;}
    await answerCb(env,cb.id,"الأمر غير معروف");
  }catch(e){await rollbackState(env,chatId,before);await answerCb(env,cb.id,"حصل خطأ");}
}
function isAdmin(env,chatId){return !!env.ADMIN_CHAT_ID&&String(chatId)===String(env.ADMIN_CHAT_ID);}
async function adminModels(env){const rows=(await env.DB.prepare(`SELECT * FROM sa2_model_stats ORDER BY attempts DESC`).all())?.results||[];return rows.length?`📊 Model stats\n${rows.slice(0,20).map(r=>{const a=Number(r.attempts||0),s=Number(r.successes||0),avg=a?Math.round(Number(r.total_latency_ms||0)/a):0;return`• ${r.model_id}: ${a?Math.round(s/a*100):0}% · ${avg}ms · ${a} tries`;}).join("\n")}`:"📊 لسه مفيش بيانات كفاية.";}
async function diagnostics(env){const queue=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM sa2_telegram_updates WHERE status IN ('pending','retry','processing')`).first())?.c||0),fails=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM sa2_operation_log WHERE status IN ('attempt_failed','rolled_back') AND created_at>=?`).bind(new Date(Date.now()-3600000).toISOString()).first())?.c||0);return{ok:true,version:VERSION,queue,recent_failed_attempts_1h:fails,routerModels:ROUTER_MODELS,fastModels:FAST_MODELS.length,complexModels:COMPLEX_MODELS.length};}
async function handleUpdate(env,row){
  const u=safeJson(row.payload_json,{});if(u.callback_query){await directCallback(env,u);return;}
  const m=u.message;if(!m)return;const chatId=String(m.chat?.id||"");if(!chatId)return;
  if(String(env.PUBLIC_MODE||"true").toLowerCase()==="false"&&!isAdmin(env,chatId)){await sendText(env,chatId,"⛔ البوت غير متاح للعامة حاليًا.");return;}
  if(m.location){await setProfileLocation(env,chatId,{latitude:m.location.latitude,longitude:m.location.longitude});await sendText(env,chatId,"📍 حفظت موقعك الحالي.");return;}
  let text=String(m.text||"").trim();if(!text&&(m.voice||m.audio)){await tg(env,"sendChatAction",{chat_id:chatId,action:"typing"});text=await transcribeTelegramVoice(env,m.voice||m.audio);if(!text)throw new Error("empty_voice_transcription");}
  if(!text)return;let reply=null;
  if(text==="/start")reply="👋 أهلاً بيك في SuperAgent Next 2.3\n\nمساعد شخصي فعلي: مواعيد وتذكيرات وتكرار ومشتريات ومشاريع وذاكرة وسياق — والتنفيذ مايتأكدش غير بعد التحقق.";
  else if(text==="/menu")reply="🎛️ SuperAgent Next — اختار القسم:";
  else if(text==="/shopping")reply=(await processUserText(env,chatId,"وريني قائمة المشتريات الحالية")).reply;
  else if(text==="/reminders"||text==="/list")reply=(await processUserText(env,chatId,"وريني كل المواعيد والتذكيرات النشطة")).reply;
  else if(text==="/today")reply=(await processUserText(env,chatId,"وريني مواعيد النهارده")).reply;
  else if(text==="/tomorrow")reply=(await processUserText(env,chatId,"وريني مواعيد بكرة")).reply;
  else if(text==="/week")reply=(await processUserText(env,chatId,"وريني جدولي للسبع أيام الجايين")).reply;
  else if(text==="/month")reply=(await processUserText(env,chatId,"وريني مواعيد الشهر الحالي")).reply;
  else if(text==="/recurring")reply=(await processUserText(env,chatId,"وريني كل التكرارات وتذكيرات الصلاة")).reply;
  else if(text==="/where"){const p=await getProfile(env,chatId),u2=await ensureUser(env,chatId),n=zonedParts(new Date(),u2.timezone);reply=`📍 ${p.city||"موقع محفوظ"}${p.country?`، ${p.country}`:""}\n🕒 ${n.date} ${n.time} — ${u2.timezone}`;}
  else if(text==="/memory")reply=(await processUserText(env,chatId,"وريني كل المعلومات اللي فاكرها عني ونموذج العالم")).reply;
  else if(text==="/audit"){const rows=(await env.DB.prepare(`SELECT status,model_id,created_at,error FROM sa2_operation_log WHERE chat_id=? ORDER BY id DESC LIMIT 12`).bind(chatId).all())?.results||[];reply=rows.length?`📜 آخر العمليات\n${rows.map(x=>`• ${x.created_at} — ${x.status}${x.model_id?` — ${x.model_id}`:""}${x.error?` — ${compact(x.error,70)}`:""}`).join("\n")}`:"📜 مفيش عمليات لسه.";}
  else if(text==="/live"){const p=await getProfile(env,chatId),u2=await ensureUser(env,chatId),n=zonedParts(new Date(),u2.timezone),pr=await getPrayerTimes(env,chatId,n.date),ev=await listEvents(env,chatId,{fromDate:n.date,toDate:n.date}),hol=await publicHolidays(p,n.date);reply=`🌍 الحالة الحالية\n📍 ${p.city||"موقعك"}${p.country?`، ${p.country}`:""}\n🕒 ${n.date} ${n.time}${pr.hijri?` · هجري ${pr.hijri.date}`:""}\n${hol.length?`🎉 ${hol.map(x=>x.name).join("، ")}\n`:""}🕌 الفجر ${pr.Fajr||"—"} · الظهر ${pr.Dhuhr||"—"} · العصر ${pr.Asr||"—"} · المغرب ${pr.Maghrib||"—"} · العشاء ${pr.Isha||"—"}\n${fmtEvents(ev)}`;}
  else if(text==="/undo")reply=(await processUserText(env,chatId,"ارجع آخر عملية نفذتها")).reply;
  else if(text==="/models"&&isAdmin(env,chatId))reply=await adminModels(env);
  else if(text==="/health"&&isAdmin(env,chatId))reply=`🩺 ${JSON.stringify(await diagnostics(env))}`;
  else reply=(await processUserText(env,chatId,text)).reply;
  if(reply)await sendText(env,chatId,reply,text==="/menu"?mainMenuKeyboard():null);
}
async function drainChat(env,chatId){
  const token=await acquireLease(env,chatId);if(!token)return;
  try{
    for(let i=0;i<QUEUE_BATCH;i++){
      const row=await env.DB.prepare(`SELECT * FROM sa2_telegram_updates WHERE chat_id=? AND status IN ('pending','retry') AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY update_id LIMIT 1`).bind(chatId,nowIso()).first();if(!row)break;
      await env.DB.prepare(`UPDATE sa2_telegram_updates SET status='processing',attempts=attempts+1,updated_at=? WHERE update_id=?`).bind(nowIso(),row.update_id).run();
      try{await handleUpdate(env,row);await env.DB.prepare(`UPDATE sa2_telegram_updates SET status='done',updated_at=? WHERE update_id=?`).bind(nowIso(),row.update_id).run();}
      catch(e){const attempts=Number(row.attempts||0)+1,status=attempts>=QUEUE_MAX_ATTEMPTS?"failed":"retry",next=new Date(Date.now()+Math.min(60000,2**attempts*1000)).toISOString();await env.DB.prepare(`UPDATE sa2_telegram_updates SET status=?,next_retry_at=?,updated_at=? WHERE update_id=?`).bind(status,next,nowIso(),row.update_id).run();if(status==="failed")try{await sendText(env,chatId,"⚠️ حصل عطل تقني، والرسالة دي ما اتنفذتش. ابعتها تاني.");}catch{}}
    }
  }finally{await releaseLease(env,chatId,token);}
}
async function drainPending(env){const rows=(await env.DB.prepare(`SELECT DISTINCT chat_id FROM sa2_telegram_updates WHERE status IN ('pending','retry') AND (next_retry_at IS NULL OR next_retry_at<=?) LIMIT 30`).bind(nowIso()).all())?.results||[];for(const r of rows)await drainChat(env,String(r.chat_id));}

// -----------------------------------------------------------------------------
// CRON DELIVERY — one-off + flexible recurrence + pre-alerts.
// -----------------------------------------------------------------------------
async function deliverOneOff(env,user){
  const rows=await listEvents(env,user.chat_id,{includeCompleted:false});const now=Date.now();
  for(const e of rows){
    const occurrence=localToEpoch(e.date,e.time,e.timezone);if(!Number.isFinite(occurrence))continue;
    for(const offset of asArray(e.alert_offsets).length?e.alert_offsets:[0]){
      const due=occurrence-Number(offset||0)*60000;if(now<due||now-due>DELIVERY_LATE_WINDOW_MS)continue;
      const seen=await env.DB.prepare(`SELECT 1 FROM sa2_event_deliveries WHERE event_id=? AND alert_offset=?`).bind(e.id,Number(offset||0)).first();if(seen)continue;
      const text=offset>0?`⏰ فاضل ${offset} دقيقة على: ${e.title}`:`⏰ ${e.title}`;
      try{await sendText(env,user.chat_id,text,eventKeyboard(e.id));await env.DB.prepare(`INSERT OR IGNORE INTO sa2_event_deliveries(event_id,chat_id,alert_offset,sent_at) VALUES (?,?,?,?)`).bind(e.id,user.chat_id,Number(offset||0),nowIso()).run();}catch{}
    }
  }
}
async function deliverRules(env,user){
  const rules=await listRules(env,user.chat_id),now=Date.now();
  for(const r of rules){
    for(const offset of asArray(r.alert_offsets).length?r.alert_offsets:[0]){
      const probe=epochToLocal(now+Number(offset||0)*60000,r.timezone);
      if(!(await ruleOccurs(env,user.chat_id,r,probe.date,probe.time)))continue;
      const key=`${probe.date}T${probe.time}`;const seen=await env.DB.prepare(`SELECT 1 FROM sa2_rule_fires WHERE rule_id=? AND occurrence_key=? AND alert_offset=?`).bind(r.id,key,Number(offset||0)).first();if(seen)continue;
      const text=offset>0?`🔁 فاضل ${offset} دقيقة على: ${r.title}`:`🔁 ${r.title}`;
      try{await sendText(env,user.chat_id,text,ruleKeyboard(r.id,probe.date));await env.DB.prepare(`INSERT OR IGNORE INTO sa2_rule_fires(rule_id,chat_id,occurrence_key,alert_offset,sent_at) VALUES (?,?,?,?,?)`).bind(r.id,user.chat_id,key,Number(offset||0),nowIso()).run();}catch{}
    }
  }
}
async function deliverPrayerRules(env,user){
  const now=zonedParts(new Date(),user.timezone||DEFAULT_TIMEZONE),rules=(await env.DB.prepare(`SELECT * FROM sa2_prayer_rules WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?)`).bind(user.chat_id,now.date,now.date).all())?.results||[];if(!rules.length)return;const times=await getPrayerTimes(env,user.chat_id,now.date);
  for(const r of rules){const weekdays=safeJson(r.weekdays_json,[]).map(Number);if(weekdays.length&&!weekdays.includes(now.dow))continue;const pt=times[r.prayer];if(!isTime(pt))continue;const fire=addLocalMinutes(now.date,pt,Number(r.offset_minutes||0),user.timezone||DEFAULT_TIMEZONE);if(fire.date!==now.date||fire.time!==now.time)continue;const seen=await env.DB.prepare(`SELECT 1 FROM sa2_prayer_fires WHERE rule_id=? AND local_date=?`).bind(r.id,now.date).first();if(seen)continue;try{await sendText(env,user.chat_id,`🕌 ${r.title}`);await env.DB.prepare(`INSERT OR IGNORE INTO sa2_prayer_fires(rule_id,chat_id,local_date,sent_at) VALUES (?,?,?,?)`).bind(r.id,user.chat_id,now.date,nowIso()).run();}catch{}
  }
}
async function deliverLiveWatches(env,user){
  const settings=await getAgentSettings(env,user.chat_id);if(!Number(settings.proactive_enabled))return;const watches=await listLifeObjects(env,user.chat_id,{type:"live_watch",status:"active"}),profile=await getProfile(env,user.chat_id);
  for(const w of watches.slice(0,8)){const q=w.data?.query||w.name,news=await liveNewsSearch(q,{countryCode:profile.country_code||"EG",limit:1});const top=news[0];if(!top?.url||top.url===w.data?.last_url)continue;try{await sendText(env,user.chat_id,`📰 جديد في «${q}»:\n${top.title}`);await updateLifeObject(env,user.chat_id,w.id,{data:{last_url:top.url,last_title:top.title,last_seen_at:nowIso()}});}catch{}}
}
async function deliverBriefs(env,user){
  const settings=await getAgentSettings(env,user.chat_id),now=zonedParts(new Date(),user.timezone||DEFAULT_TIMEZONE);for(const [type,hour,enabled] of [["morning","08:00",settings.morning_brief_enabled],["evening","20:00",settings.evening_brief_enabled]]){if(!Number(enabled)||now.time!==hour)continue;const seen=await env.DB.prepare(`SELECT 1 FROM sa2_brief_fires WHERE chat_id=? AND local_date=? AND brief_type=?`).bind(user.chat_id,now.date,type).first();if(seen)continue;const events=await listEvents(env,user.chat_id,{fromDate:now.date,toDate:now.date}),shop=await shoppingItems(env,user.chat_id),waiting=await listLifeObjects(env,user.chat_id,{type:"waiting",status:"active"});const title=type==="morning"?"☀️ ملخص الصبح":"🌙 ملخص المساء";try{await sendText(env,user.chat_id,`${title}\n${fmtEvents(events)}\n\n🛒 ناقص ${shop.length} في المشتريات · ⏳ منتظر ${waiting.length}`);await env.DB.prepare(`INSERT OR IGNORE INTO sa2_brief_fires(chat_id,local_date,brief_type,sent_at) VALUES (?,?,?,?)`).bind(user.chat_id,now.date,type,nowIso()).run();}catch{}}
}
async function deliverDue(env){const users=(await env.DB.prepare(`SELECT chat_id,timezone FROM sa2_users LIMIT 1000`).all())?.results||[];for(const u of users){await deliverOneOff(env,u);await deliverRules(env,u);await deliverPrayerRules(env,u);await deliverLiveWatches(env,u);await deliverBriefs(env,u);}}

// -----------------------------------------------------------------------------
// HTTP WORKER
// -----------------------------------------------------------------------------
function jsonResponse(x,status=200){return new Response(JSON.stringify(x,null,2),{status,headers:{"content-type":"application/json; charset=utf-8"}});}
let schemaPromise=null;async function schema(env){if(!schemaPromise)schemaPromise=ensureSchema(env).catch(e=>{schemaPromise=null;throw e;});return schemaPromise;}

const Worker={
  async fetch(req,env,ctx){
    await schema(env);const u=new URL(req.url);
    if(req.method==="GET"&&u.pathname==="/")return jsonResponse({ok:true,name:"SuperAgent Next",version:VERSION,architecture:"semantic router -> typed planner -> deterministic executor -> verifier -> reply",router:{models:ROUTER_MODELS,fallbacks:2},pools:{fast:FAST_MODELS.map(x=>x.id),complex:COMPLEX_MODELS.map(x=>x.id)},features:["shopping","one-off reminders","advance alerts","flexible recurrence minute/hour/day/week/month/year","conflict detection","free slots","multi-day free periods","schedule search","bulk move/delete/complete","pause/resume recurrence","skip exceptions","snooze","event dependencies","undo","memory","durable Telegram inbox","adaptive model ranking","voice input","user location","prayer-relative rules","projects/tasks/waiting/inbox","world model objects","shopping sessions","audit dashboard","live news search/watch","Hijri date","public holiday context","enforced permission settings","morning/evening briefs","public/private mode"]});
    if(req.method==="GET"&&u.pathname==="/health")return jsonResponse(await diagnostics(env));
    if(req.method==="GET"&&u.pathname==="/setup"){
      if(!env.SETUP_KEY||u.searchParams.get("key")!==env.SETUP_KEY)return jsonResponse({ok:false,error:"unauthorized"},401);
      const webhook=`${u.origin}/telegram`;const result=await tg(env,"setWebhook",{url:webhook,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:["message","callback_query"]});
      await tg(env,"setMyCommands",{commands:[{command:"start",description:"تشغيل SuperAgent"},{command:"menu",description:"لوحة التحكم"},{command:"today",description:"مواعيد النهارده"},{command:"tomorrow",description:"مواعيد بكرة"},{command:"week",description:"جدول 7 أيام"},{command:"month",description:"مواعيد الشهر"},{command:"list",description:"كل المواعيد"},{command:"recurring",description:"التكرارات"},{command:"where",description:"موقعي ووقتي"},{command:"memory",description:"الذاكرة"},{command:"shopping",description:"المشتريات"},{command:"audit",description:"سجل التغييرات"},{command:"undo",description:"تراجع"},{command:"live",description:"الحالة الحالية"}]});
      return jsonResponse({ok:true,version:VERSION,webhook,result});
    }
    if(req.method==="POST"&&u.pathname==="/route"){
      if(!env.SETUP_KEY||req.headers.get("x-setup-key")!==env.SETUP_KEY)return jsonResponse({ok:false,error:"unauthorized"},401);const b=await req.json();return jsonResponse({ok:true,result:await routeRequest(env,{text:String(b.text||"")})});
    }
    if(req.method==="POST"&&u.pathname==="/agent"){
      if(!env.SETUP_KEY||req.headers.get("x-setup-key")!==env.SETUP_KEY)return jsonResponse({ok:false,error:"unauthorized"},401);const b=await req.json();return jsonResponse({ok:true,result:await processUserText(env,String(b.chat_id||"test"),String(b.text||""))});
    }
    if(req.method==="POST"&&u.pathname==="/telegram"){
      const sec=req.headers.get("X-Telegram-Bot-Api-Secret-Token")||"";if(!env.TELEGRAM_WEBHOOK_SECRET||sec!==env.TELEGRAM_WEBHOOK_SECRET)return new Response("unauthorized",{status:401});
      const update=await req.json();await persistUpdate(env,update);const chatId=String(update?.message?.chat?.id||update?.callback_query?.message?.chat?.id||"");if(chatId)ctx.waitUntil(drainChat(env,chatId));return new Response("OK");
    }
    return jsonResponse({ok:false,error:"not_found"},404);
  },
  async scheduled(controller,env,ctx){await schema(env);ctx.waitUntil(Promise.allSettled([deliverDue(env),drainPending(env)]));}
};

export const __test={normalizeArabic,normKey,isPlaceholderOnly,validatePlan,localSignals,ruleMatchesOccurrence,daysBetween,monthsBetween,yearsBetween,canonicalPrayer,explicitConfirmation,explicitCancellation,destructivePlan};
export default Worker;
