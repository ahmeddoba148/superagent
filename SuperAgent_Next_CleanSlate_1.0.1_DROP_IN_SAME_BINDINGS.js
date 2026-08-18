/*
 DROP-IN COMPATIBILITY BUILD
 This build intentionally uses sa_next_* D1 tables so it can be pasted
 over the existing Worker code while keeping the SAME:
   - Worker
   - DB binding name: DB
   - D1 database
   - OMNIAI_SERVICE binding
   - TELEGRAM_BOT_TOKEN
   - TELEGRAM_WEBHOOK_SECRET
   - OMNIAI_API_KEY
   - ADMIN_CHAT_ID
 Existing V10.x tables/data are left untouched.
*/
/*
 SuperAgent Next — Clean-Slate 1.0.1 DROP-IN
 SINGLE-FILE CLOUDFLARE WORKER BUILD

 Generated from the tested modular source package.
 Upload this file as the Worker JavaScript entry when using the Cloudflare editor.

 Required bindings/secrets still apply:
 - DB: D1 binding
 - OMNIAI_SERVICE: service binding to omniai-engine
 - TELEGRAM_BOT_TOKEN
 - TELEGRAM_WEBHOOK_SECRET
 - OMNIAI_API_KEY
 - ADMIN_CHAT_ID (optional/admin)
 - DEFAULT_TIMEZONE (optional; defaults handled by source)
*/

/* ===== src/config.js ===== */
const VERSION = "1.0.1-drop-in";
const DEFAULT_TIMEZONE = "Africa/Cairo";
const MAX_HISTORY = 18;
const MAX_SHOPPING_ITEMS = 120;
const MAX_PLAN_OPERATIONS = 24;
const ROUTER_AI_TIMEOUTS_MS = [1400, 1700, 2100];
const EXECUTION_TIMEOUT_MS = 8500;
const CHAT_TIMEOUT_MS = 8000;
const PENDING_TTL_MINUTES = 20;
const INBOX_LEASE_MS = 45000;
const INBOX_MAX_ATTEMPTS = 5;
const INBOX_BATCH_SIZE = 3;
const MAX_MODEL_ATTEMPTS = 5;


/* ===== src/db/schema.js ===== */
async function ensureSchema(env){
  const q=[
`CREATE TABLE IF NOT EXISTS sa_next_users(chat_id TEXT PRIMARY KEY,timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',locale TEXT NOT NULL DEFAULT 'ar-EG',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS sa_next_conversation_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL)`,
`CREATE INDEX IF NOT EXISTS sa_next_idx_conv_chat ON sa_next_conversation_messages(chat_id,id)`,
`CREATE TABLE IF NOT EXISTS sa_next_memories(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,confidence REAL NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(chat_id,key))`,
`CREATE TABLE IF NOT EXISTS sa_next_shopping_lists(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,name TEXT NOT NULL,normalized_name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(chat_id,normalized_name))`,
`CREATE TABLE IF NOT EXISTS sa_next_shopping_items(id INTEGER PRIMARY KEY AUTOINCREMENT,list_id INTEGER NOT NULL,chat_id TEXT NOT NULL,title TEXT NOT NULL,normalized_title TEXT NOT NULL,quantity_value REAL,quantity_unit TEXT,brand TEXT,size TEXT,store TEXT,notes TEXT,status TEXT NOT NULL DEFAULT 'pending',position INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
`CREATE INDEX IF NOT EXISTS sa_next_idx_shop_chat_list ON sa_next_shopping_items(chat_id,list_id,status,position,id)`,
`CREATE TABLE IF NOT EXISTS sa_next_reminders(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,title TEXT NOT NULL,local_date TEXT NOT NULL,local_time TEXT NOT NULL,timezone TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
`CREATE INDEX IF NOT EXISTS sa_next_idx_rem_due ON sa_next_reminders(chat_id,status,local_date,local_time)`,
`CREATE TABLE IF NOT EXISTS sa_next_reminder_rules(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,title TEXT NOT NULL,frequency TEXT NOT NULL,weekdays_json TEXT NOT NULL DEFAULT '[]',monthdays_json TEXT NOT NULL DEFAULT '[]',local_time TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT,timezone TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS sa_next_reminder_rule_fires(id INTEGER PRIMARY KEY AUTOINCREMENT,rule_id INTEGER NOT NULL,chat_id TEXT NOT NULL,fire_key TEXT NOT NULL,sent_at TEXT NOT NULL,UNIQUE(rule_id,fire_key))`,
`CREATE TABLE IF NOT EXISTS sa_next_pending_dialogs(chat_id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload_json TEXT NOT NULL,question TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS sa_next_operation_log(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,request_id TEXT NOT NULL,plan_json TEXT,before_json TEXT,after_json TEXT,verification_json TEXT,status TEXT NOT NULL,error TEXT,model_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
`CREATE INDEX IF NOT EXISTS sa_next_idx_oplog_chat ON sa_next_operation_log(chat_id,id)`,
`CREATE TABLE IF NOT EXISTS sa_next_model_stats(model_id TEXT PRIMARY KEY,provider TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,validation_failures INTEGER NOT NULL DEFAULT 0,total_latency_ms INTEGER NOT NULL DEFAULT 0,last_latency_ms INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS sa_next_telegram_updates(update_id INTEGER PRIMARY KEY,chat_id TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_retry_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
`CREATE INDEX IF NOT EXISTS sa_next_idx_tg_queue ON sa_next_telegram_updates(status,next_retry_at,update_id)`,
`CREATE TABLE IF NOT EXISTS sa_next_chat_leases(chat_id TEXT PRIMARY KEY,lease_token TEXT NOT NULL,lease_until TEXT NOT NULL,updated_at TEXT NOT NULL)`
  ];
  for(const sql of q) await env.DB.prepare(sql).run();
}

async function ensureUser(env,chatId){
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO sa_next_users(chat_id,created_at,updated_at) VALUES (?,?,?)`).bind(chatId,now,now).run();
  return env.DB.prepare(`SELECT * FROM sa_next_users WHERE chat_id=?`).bind(chatId).first();
}


/* ===== src/models/registry.js ===== */
// Exactly 20 execution models chosen from the user-provided active catalogue.
// 10 fast/easy + 10 medium/complex. Router has one primary + two fallbacks.

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
  { id:"mistral::ministral-8b-latest", provider:"mistral", tags:["chat","tools","fast","multilingual"], strength:7.5, latency:1 },
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
function getModel(id){ return ALL_MODELS.find(x=>x.id===id)||null; }


/* ===== src/observability/model-stats.js ===== */
async function recordModelAttempt(env,model,{ok,latencyMs,error=null,validationFailure=false}={}){
  if(!env?.DB)return;
  const provider=String(model||"").split("::")[0]||"unknown", now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO sa_next_model_stats(model_id,provider,attempts,successes,failures,validation_failures,total_latency_ms,last_latency_ms,last_error,updated_at)
    VALUES (?,?,1,?,?,?,?,?,?,?)
    ON CONFLICT(model_id) DO UPDATE SET attempts=attempts+1,successes=successes+excluded.successes,failures=failures+excluded.failures,
    validation_failures=validation_failures+excluded.validation_failures,total_latency_ms=total_latency_ms+excluded.total_latency_ms,
    last_latency_ms=excluded.last_latency_ms,last_error=excluded.last_error,updated_at=excluded.updated_at`)
    .bind(model,provider,ok?1:0,ok?0:1,validationFailure?1:0,Math.max(0,Number(latencyMs)||0),Math.max(0,Number(latencyMs)||0),error,now).run();
}

async function getModelStats(env){
  if(!env?.DB)return [];
  return (await env.DB.prepare(`SELECT * FROM sa_next_model_stats ORDER BY attempts DESC, model_id`).all())?.results||[];
}

async function statsMap(env){
  const rows=await getModelStats(env); return new Map(rows.map(r=>[String(r.model_id),r]));
}


/* ===== src/models/client.js ===== */
function timeoutSignal(ms){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(new Error("timeout")),ms);
  return {signal:c.signal,cancel:()=>clearTimeout(timer)};
}

function contentOf(j){
  return String(j?.choices?.[0]?.message?.content ?? j?.output_text ?? j?.text ?? "").trim();
}

async function callModel(env,{model,messages,temperature=0.05,maxTokens=1800,timeoutMs=8000,json=false}){
  if(!env.OMNIAI_SERVICE) throw new Error("OMNIAI_SERVICE missing");
  if(!env.OMNIAI_API_KEY) throw new Error("OMNIAI_API_KEY missing");
  const t=timeoutSignal(timeoutMs), started=Date.now();
  let ok=false, err=null;
  try{
    const body={model,messages,temperature,max_tokens:maxTokens,stream:false};
    if(json) body.response_format={type:"json_object"};
    const req=new Request(env.OMNIAI_INTERNAL_URL||"https://omniai-engine.internal/v1/chat/completions",{
      method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${env.OMNIAI_API_KEY}`},body:JSON.stringify(body),signal:t.signal
    });
    const r=await env.OMNIAI_SERVICE.fetch(req); const raw=await r.text(); let j=null; try{j=JSON.parse(raw)}catch{}
    if(!r.ok) throw new Error(j?.error?.message||`model_http_${r.status}`);
    const content=contentOf(j); if(!content) throw new Error("empty_model_response");
    ok=true;
    return {content,latencyMs:Date.now()-started,raw:j,model};
  }catch(e){ err=String(e?.message||e); throw e; }
  finally{
    t.cancel();
    try{ await recordModelAttempt(env,model,{ok,latencyMs:Date.now()-started,error:err}); }catch{}
  }
}

function parseJsonLoose(text){
  const s=String(text||"").trim();
  const tries=[s,s.replace(/^```json\s*/i,"").replace(/```$/i,"").trim(),s.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean);
  for(const x of tries){try{return JSON.parse(x)}catch{}}
  return null;
}


/* ===== src/utils/text.js ===== */
function normalizeArabic(value){
  return String(value||"").normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g,"")
    .replace(/[إأآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه")
    .replace(/\s+/g," ").trim().toLowerCase();
}
function normKey(value){return normalizeArabic(value).replace(/[^\p{L}\p{N}\s]/gu,"").trim();}
function isPlaceholderOnly(value){
  const t=normKey(value); if(!t)return false;
  const stop=new Set(["ال","من","في","فى","علي","على","ده","دا","دي","دى","دول","النوع","نوع","الحاجه","الحاجة","واحد","واحده","واحدة","منه","منها","نفسه","نفسها","نفس","اللي","اللى","الى","الذي","التي","قولتلك","قلتلك","عليه","عليها","بتاع","بتاعه","بتاعها","كبير","كبيره","كبيرة","الكبير","الكبيره","الكبيرة","صغير","صغيره","صغيرة","الصغير","الصغيره","الصغيرة","وسط","الوسط","متوسط","اخر","آخر","الاخير","الأخير","الاول","الأول","التاني","الثاني","التالته","الثالث"]);
  const xs=t.split(/\s+/).filter(Boolean); return xs.length>0&&xs.every(x=>/^\d+(?:[.,]\d+)?$/.test(x)||stop.has(x));
}
function compact(s,n=240){s=String(s||"").replace(/\s+/g," ").trim();return s.length<=n?s:s.slice(0,n-1)+"…";}


/* ===== src/router/local.js ===== */
function count(t,re){return (t.match(re)||[]).length;}
function localSignals(input){
  const raw=String(input?.text||""),n=normalizeArabic(raw),lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),words=n.split(/\s+/).filter(Boolean);
  const temporal=count(n,/(?:الساعه|بكره|غدا|النهارده|بعد\s+\d+|قبل\s+\d+|كل\s+(?:يوم|اسبوع|شهر)|يوم\s+\d{1,2}|صباح|مساء|ظهر|عصر|ليل)/g);
  const refs=count(` ${n} `,/(?:^|\s)(?:ده|دي|دول|اللي|اللى|نفسه|نفسها|منه|منها|الكبير|الصغير|الاول|التاني|اخر\s+واحد|قولتلك|قلتلك)(?=\s|$)/g);
  const mutate=count(n,/(?:ضيف|زود|حط|سجل|شيل|احذف|امسح|غير|بدل|خلي|انقل|الغ|اشتري|هات|جيب|فكرني|ذكرني|نبهني)/g);
  const destructive=count(n,/(?:امسح\s+كل|احذف\s+كل|الغ\s+كل|شيل\s+كل|حذف\s+نهائي)/g);
  const compound=count(n,/(?:وبعدين|بعدها|قبلها|في\s+نفس\s+الوقت|كمان|وبعد|وقبل|لكن|بدل|ثم)/g);
  const code=/```|function\s+\w+|const\s+\w+|SELECT\s+.+FROM|Traceback|TypeError|ReferenceError/i.test(raw);
  const listLike=lines.length>=4&&lines.slice(1).every(x=>x.length<=100);
  const hasImage=Boolean(input?.hasImage||input?.attachments?.some(a=>/image/i.test(a?.type||"")));
  const hasDocument=Boolean(input?.attachments?.some(a=>/pdf|document|text|sheet|doc/i.test(a?.type||"")));
  const liveInfo=/(?:اخر|احدث|دلوقتي|حاليا|سعر|اخبار|نتيجه|طقس|ماتش|بورصه|سهم)/.test(n);
  const shoppingDomain=/(?:المشتريات|قائمه\s+المشتريات|طلبات\s+(?:البيت|المنزل)|الهايبر|السوبر\s*ماركت|الماركت|واحنا\s+بنشتري|وانا\s+بشتري|بنشتري)/.test(n);
  const scheduleDomain=/(?:تذكير|التذكيرات|مواعيد|ميعاد|موعد|فكرني|ذكرني|نبهني)/.test(n);
  const memoryDomain=/(?:ذاكرتك|الذاكره|فاكر\s+عن|افتكر\s+ان|احفظ\s+ان)/.test(n);
  const stateful=shoppingDomain||scheduleDomain||memoryDomain;
  let score=Math.min(3,refs)*1.9+Math.min(3,compound)*1.5+Math.min(3,temporal)*.9+Math.min(4,mutate)*.5+destructive*2.7+(code?1.8:0)+(hasDocument?1.5:0)+(liveInfo?1.1:0)+(words.length>220?.3:0);
  if(listLike&&refs===0&&compound<=1&&destructive===0)score-=1.4;
  const easyChat=mutate===0&&refs===0&&temporal===0&&!code&&!hasImage&&!hasDocument&&!liveInfo&&!stateful&&words.length<=45;
  const route=destructive>0||score>=4.3?"complex":"easy"; const confidence=easyChat?.98:score>=6?.94:score<=1.2?.91:.58;
  let task="other";
  if(code)task="coding";else if(hasImage)task="vision";else if(hasDocument)task="document";else if(liveInfo)task="research";
  else if(shoppingDomain&&scheduleDomain&&temporal)task="mixed";
  else if(shoppingDomain)task="shopping";
  else if(scheduleDomain)task="schedule";
  else if(memoryDomain)task="memory";
  else if(temporal&&mutate)task="schedule";else if(mutate)task="state_edit";else if(easyChat)task="chat";
  return {route,task,confidence,score:Number(score.toFixed(2)),signals:{temporal,refs,mutate,destructive,compound,code,listLike,hasImage,hasDocument,liveInfo,shoppingDomain,scheduleDomain,memoryDomain,stateful,words:words.length,lines:lines.length}};
}


/* ===== src/router/index.js ===== */
const TASKS=new Set(["chat","shopping","schedule","state_edit","analysis","coding","vision","research","document","memory","mixed","other"]);
function valid(v){if(!v||!["easy","complex"].includes(v.route)||!TASKS.has(v.task))return null;return{route:v.route,task:v.task,risk:["low","medium","high"].includes(v.risk)?v.risk:"medium",needs_context:!!v.needs_context,needs_tools:!!v.needs_tools,needs_reasoning:!!v.needs_reasoning,confidence:Math.max(0,Math.min(1,Number(v.confidence)||0)),reason:String(v.reason||"").slice(0,160)}};
function prompt(input,local){return `أنت راوتر تصنيف فقط. لا تنفذ الطلب. افهم المعنى لا طول الرسالة.\nJSON فقط: {"route":"easy|complex","task":"chat|shopping|schedule|state_edit|analysis|coding|vision|research|document|memory|mixed|other","risk":"low|medium|high","needs_context":true,"needs_tools":true,"needs_reasoning":true,"confidence":0.0,"reason":"قصير"}\nقواعد: الرسالة الطويلة البسيطة easy. الرسالة القصيرة المعتمدة على سياق/عدة عمليات/تعارض/حذف حساس complex. قوائم المشتريات الطويلة الواضحة ليست complex لمجرد الطول. لو فيها مرجع مثل اللي قولتلك عليه فغالبًا needs_context.\nإشارات محلية:${JSON.stringify(local)}\nرسالة المستخدم:${JSON.stringify(String(input.text||""))}`}
async function aiRoute(env,input,local){const errors=[];for(let i=0;i<ROUTER_MODELS.length;i++){const model=ROUTER_MODELS[i];try{const r=await callModel(env,{model,messages:[{role:"system",content:"Return one valid JSON object only."},{role:"user",content:prompt(input,local)}],temperature:0,maxTokens:220,timeoutMs:ROUTER_AI_TIMEOUTS_MS[i],json:true});const v=valid(parseJsonLoose(r.content));if(v)return{...v,routerModel:model,routerLatencyMs:r.latencyMs,errors};errors.push({model,error:"invalid_json"});}catch(e){errors.push({model,error:String(e?.message||e).slice(0,120)})}}return null;}
function wanted(task){switch(task){case"coding":return["coding","reasoning","tools"];case"vision":return["vision","reasoning"];case"research":return["tools","reasoning","long-context"];case"document":return["long-context","reasoning","json"];case"shopping":case"schedule":case"state_edit":case"mixed":return["json","tools","reasoning","agentic"];default:return["chat","multilingual"]}}
async function rank(env,pool,d){const st=await statsMap(env);const w=wanted(d.task);return[...pool].map(m=>{const s=st.get(m.id);const attempts=Number(s?.attempts||0),fail=Number(s?.failures||0),avg=attempts?Number(s?.total_latency_ms||0)/attempts:0;const reliability=attempts?1-fail/attempts:.92;const tag=w.reduce((a,t)=>a+(m.tags.includes(t)?1:0),0);return{m,score:tag*2.2+m.strength*.25+(6-m.latency)*(d.route==="easy"?.45:.12)+reliability*2-Math.min(2,avg/5000)}}).sort((a,b)=>b.score-a.score).map(x=>x.m)}
function diverse(xs,count){const out=[],p=new Set();for(const m of xs)if(!p.has(m.provider)){out.push(m);p.add(m.provider);if(out.length>=count)return out}for(const m of xs){if(!out.some(x=>x.id===m.id))out.push(m);if(out.length>=count)break}return out}
async function routeRequest(env,input){const local=localSignals(input);let d;if(local.confidence>=.88)d={route:local.route,task:local.task,risk:local.signals.destructive?"high":local.signals.mutate?"medium":"low",needs_context:local.signals.refs>0,needs_tools:local.signals.mutate>0||local.signals.liveInfo||local.signals.stateful,needs_reasoning:local.route==="complex",confidence:local.confidence,reason:"local-semantic",routerModel:"local",routerLatencyMs:0,errors:[]};else d=await aiRoute(env,input,local)||{route:local.route,task:local.task,risk:local.signals.destructive?"high":"medium",needs_context:local.signals.refs>0,needs_tools:local.signals.mutate>0||local.signals.liveInfo||local.signals.stateful,needs_reasoning:local.route==="complex",confidence:.4,reason:"local-after-router-failure",routerModel:"local-fallback",routerLatencyMs:null,errors:[]};if(d.risk==="high"&&d.needs_tools){d.route="complex";d.needs_reasoning=true}const primaryPool=d.route==="easy"?FAST_MODELS:COMPLEX_MODELS;const ranked=await rank(env,primaryPool,d);let candidates=diverse(ranked,3);if(d.route==="easy"){const rescue=diverse(await rank(env,COMPLEX_MODELS,{...d,route:"complex"}),2);for(const x of rescue)if(!candidates.some(c=>c.id===x.id))candidates.push(x)}else{const extra=diverse(ranked.slice(3),2);for(const x of extra)if(!candidates.some(c=>c.id===x.id))candidates.push(x)}return{...d,local,candidates:candidates.slice(0,5)}}


/* ===== src/domain/shopping.js ===== */
async function defaultList(env,chatId,create=true){
  const n=normKey("مشتريات"); let row=await env.DB.prepare(`SELECT * FROM sa_next_shopping_lists WHERE chat_id=? AND normalized_name=? LIMIT 1`).bind(chatId,n).first();
  if(!row&&create){const now=new Date().toISOString();const r=await env.DB.prepare(`INSERT INTO sa_next_shopping_lists(chat_id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?)`).bind(chatId,"مشتريات",n,now,now).run();row=await env.DB.prepare(`SELECT * FROM sa_next_shopping_lists WHERE id=?`).bind(Number(r.meta.last_row_id)).first();}
  return row||null;
}
async function listItems(env,chatId){
  const list=await defaultList(env,chatId,false); if(!list)return [];
  return (await env.DB.prepare(`SELECT * FROM sa_next_shopping_items WHERE chat_id=? AND list_id=? AND status!='deleted' ORDER BY position,id`).bind(chatId,list.id).all())?.results||[];
}
async function resolveShoppingTarget(env,chatId,query){
  const q=normKey(query), rows=await listItems(env,chatId); if(!q)return [];
  const exact=rows.filter(r=>normKey(r.title)===q); if(exact.length)return exact;
  return rows.filter(r=>{const n=normKey(r.title);return n.includes(q)||q.includes(n)});
}
async function addShopping(env,chatId,item){
  const list=await defaultList(env,chatId,true), now=new Date().toISOString(), n=normKey(item.title);
  const existing=await env.DB.prepare(`SELECT * FROM sa_next_shopping_items WHERE chat_id=? AND list_id=? AND normalized_title=? AND status!='deleted' ORDER BY id DESC LIMIT 1`).bind(chatId,list.id,n).first();
  if(existing){
    const q=item.quantity_value==null?existing.quantity_value:item.quantity_value;
    await env.DB.prepare(`UPDATE sa_next_shopping_items SET quantity_value=?,quantity_unit=?,brand=?,size=?,store=?,notes=?,status='pending',updated_at=? WHERE id=? AND chat_id=?`).bind(q,item.quantity_unit??existing.quantity_unit,item.brand??existing.brand,item.size??existing.size,item.store??existing.store,item.notes??existing.notes,now,existing.id,chatId).run();
    return Number(existing.id);
  }
  const pos=Number((await env.DB.prepare(`SELECT COALESCE(MAX(position),0)+1 p FROM sa_next_shopping_items WHERE chat_id=? AND list_id=?`).bind(chatId,list.id).first())?.p||1);
  const r=await env.DB.prepare(`INSERT INTO sa_next_shopping_items(list_id,chat_id,title,normalized_title,quantity_value,quantity_unit,brand,size,store,notes,status,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`).bind(list.id,chatId,item.title,n,item.quantity_value??null,item.quantity_unit??null,item.brand??null,item.size??null,item.store??null,item.notes??null,pos,now,now).run();
  return Number(r.meta.last_row_id);
}
async function updateShopping(env,chatId,id,patch){
  const row=await env.DB.prepare(`SELECT * FROM sa_next_shopping_items WHERE id=? AND chat_id=? AND status!='deleted'`).bind(id,chatId).first(); if(!row)throw new Error("shopping_target_missing");
  let q=row.quantity_value;
  if(patch.quantity_value!=null)q=Number(patch.quantity_value);
  if(patch.quantity_delta!=null)q=Number(q||0)+Number(patch.quantity_delta);
  const title=patch.title??row.title, now=new Date().toISOString();
  await env.DB.prepare(`UPDATE sa_next_shopping_items SET title=?,normalized_title=?,quantity_value=?,quantity_unit=?,brand=?,size=?,store=?,notes=?,updated_at=? WHERE id=? AND chat_id=?`).bind(title,normKey(title),q,patch.quantity_unit??row.quantity_unit,patch.brand??row.brand,patch.size??row.size,patch.store??row.store,patch.notes??row.notes,now,id,chatId).run();
}
async function removeShopping(env,chatId,id){await env.DB.prepare(`UPDATE sa_next_shopping_items SET status='deleted',updated_at=? WHERE id=? AND chat_id=?`).bind(new Date().toISOString(),id,chatId).run();}
async function clearShopping(env,chatId){const list=await defaultList(env,chatId,false);if(list)await env.DB.prepare(`UPDATE sa_next_shopping_items SET status='deleted',updated_at=? WHERE chat_id=? AND list_id=? AND status!='deleted'`).bind(new Date().toISOString(),chatId,list.id).run();}


/* ===== src/utils/time.js ===== */
function nowInZone(zone="Africa/Cairo", date=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}:${o.minute}`,second:o.second,isoMinute:`${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`};
}
function isDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||""));}
function isTime(v){return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(v||""));}
function addMinutes(date,time,minutes){
  const d=new Date(`${date}T${time}:00Z`); d.setUTCMinutes(d.getUTCMinutes()+Number(minutes||0));
  return {date:d.toISOString().slice(0,10),time:d.toISOString().slice(11,16)};
}


/* ===== src/domain/reminders.js ===== */
async function listReminders(env,chatId){return (await env.DB.prepare(`SELECT * FROM sa_next_reminders WHERE chat_id=? AND status='pending' ORDER BY local_date,local_time,id LIMIT 200`).bind(chatId).all())?.results||[];}
async function resolveReminderTarget(env,chatId,query){
  const q=String(query||"").trim().toLowerCase(), rows=await listReminders(env,chatId); if(!q)return [];
  const exact=rows.filter(r=>String(r.title).toLowerCase()===q); if(exact.length)return exact;
  return rows.filter(r=>String(r.title).toLowerCase().includes(q)||q.includes(String(r.title).toLowerCase()));
}
async function createReminder(env,chatId,x){
  if(!isDate(x.date)||!isTime(x.time))throw new Error("invalid_reminder_datetime"); const now=new Date().toISOString();
  const r=await env.DB.prepare(`INSERT INTO sa_next_reminders(chat_id,title,local_date,local_time,timezone,status,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?)`).bind(chatId,x.title,x.date,x.time,x.timezone||"Africa/Cairo",now,now).run();return Number(r.meta.last_row_id);
}
async function updateReminder(env,chatId,id,p){
  const r=await env.DB.prepare(`SELECT * FROM sa_next_reminders WHERE id=? AND chat_id=? AND status='pending'`).bind(id,chatId).first();if(!r)throw new Error("reminder_target_missing");
  const date=p.date??r.local_date,time=p.time??r.local_time;if(!isDate(date)||!isTime(time))throw new Error("invalid_reminder_datetime");
  await env.DB.prepare(`UPDATE sa_next_reminders SET title=?,local_date=?,local_time=?,timezone=?,updated_at=? WHERE id=? AND chat_id=?`).bind(p.title??r.title,date,time,p.timezone??r.timezone,new Date().toISOString(),id,chatId).run();
}
async function deleteReminder(env,chatId,id){await env.DB.prepare(`UPDATE sa_next_reminders SET status='cancelled',updated_at=? WHERE id=? AND chat_id=?`).bind(new Date().toISOString(),id,chatId).run();}
async function createRule(env,chatId,x){
  if(!["daily","weekly","monthly"].includes(x.frequency)||!isDate(x.start_date)||!isTime(x.time))throw new Error("invalid_rule");
  const now=new Date().toISOString();const r=await env.DB.prepare(`INSERT INTO sa_next_reminder_rules(chat_id,title,frequency,weekdays_json,monthdays_json,local_time,start_date,end_date,timezone,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`).bind(chatId,x.title,x.frequency,JSON.stringify(x.weekdays||[]),JSON.stringify(x.monthdays||[]),x.time,x.start_date,x.end_date||null,x.timezone||"Africa/Cairo",now,now).run();return Number(r.meta.last_row_id);
}
async function listRules(env,chatId){return (await env.DB.prepare(`SELECT * FROM sa_next_reminder_rules WHERE chat_id=? AND active=1 ORDER BY id`).bind(chatId).all())?.results||[];}


/* ===== src/domain/state.js ===== */
async function recentConversation(env,chatId,limit=MAX_HISTORY){
  const rows=(await env.DB.prepare(`SELECT role,content,created_at FROM sa_next_conversation_messages WHERE chat_id=? ORDER BY id DESC LIMIT ?`).bind(chatId,limit).all())?.results||[];
  return rows.reverse();
}
async function saveMessage(env,chatId,role,content){
  await env.DB.prepare(`INSERT INTO sa_next_conversation_messages(chat_id,role,content,created_at) VALUES (?,?,?,?)`).bind(chatId,role,String(content||"").slice(0,12000),new Date().toISOString()).run();
}
async function getMemories(env,chatId){return (await env.DB.prepare(`SELECT key,value,confidence FROM sa_next_memories WHERE chat_id=? ORDER BY updated_at DESC LIMIT 80`).bind(chatId).all())?.results||[];}
async function upsertMemory(env,chatId,key,value,confidence=1){
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO sa_next_memories(chat_id,key,value,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value,confidence=excluded.confidence,updated_at=excluded.updated_at`).bind(chatId,key,value,confidence,now,now).run();
}


/* ===== src/agent/snapshot.js ===== */
async function readAgentState(env,chatId,timezone="Africa/Cairo"){
  const [shopping,reminders,rules,memories,history]=await Promise.all([listItems(env,chatId),listReminders(env,chatId),listRules(env,chatId),getMemories(env,chatId),recentConversation(env,chatId)]);
  return{now:nowInZone(timezone),shopping:shopping.map(cleanShop),reminders:reminders.map(cleanRem),rules:rules.map(cleanRule),memories,history};
}
function cleanShop(x){return{id:Number(x.id),title:x.title,quantity_value:x.quantity_value,quantity_unit:x.quantity_unit,brand:x.brand,size:x.size,store:x.store,notes:x.notes,status:x.status}}
function cleanRem(x){return{id:Number(x.id),title:x.title,date:x.local_date,time:x.local_time,timezone:x.timezone,status:x.status}}
function cleanRule(x){return{id:Number(x.id),title:x.title,frequency:x.frequency,weekdays:JSON.parse(x.weekdays_json||"[]"),monthdays:JSON.parse(x.monthdays_json||"[]"),time:x.local_time,start_date:x.start_date,end_date:x.end_date,timezone:x.timezone}}
function stateDigest(s){return JSON.stringify({shopping:s.shopping,reminders:s.reminders,rules:s.rules,memories:s.memories});}


/* ===== src/agent/schema.js ===== */
const OPS=new Set(["shopping.add","shopping.remove","shopping.update","shopping.replace","shopping.clear","shopping.list","reminder.create","reminder.update","reminder.delete","reminder.list","reminder.rule.create","reminder.rule.list","memory.set","memory.list"]);
function str(x,n=240){return String(x??"").trim().slice(0,n)}
function item(x){const title=str(x?.title,180);if(!title||isPlaceholderOnly(title))return null;const q=x?.quantity_value==null?null:Number(x.quantity_value);if(q!=null&&!Number.isFinite(q))return null;return{title,quantity_value:q,quantity_unit:str(x?.quantity_unit,50)||null,brand:str(x?.brand,100)||null,size:str(x?.size,100)||null,store:str(x?.store,120)||null,notes:str(x?.notes,500)||null}}
function target(x){const query=str(x?.query,180);const id=Number(x?.id||0)||null;return{id,query:query||null}}
function validatePlan(v){
  if(!v||typeof v!=="object")return null;
  if(v.requires_clarification)return{version:1,requires_clarification:true,clarification_question:str(v.clarification_question,500)||"ممكن توضح قصدك؟",confidence:Number(v.confidence)||0,operations:[]};
  const raw=Array.isArray(v.operations)?v.operations:[];if(raw.length>MAX_PLAN_OPERATIONS)return null;const operations=[];
  for(const o of raw){if(!OPS.has(o?.op))return null;let z={op:o.op};
    if(o.op==="shopping.add"){const rawItems=Array.isArray(o.items)?o.items:[];z.items=rawItems.map(item);if(!z.items.length||z.items.some(x=>!x))return null;}
    else if(o.op==="shopping.remove"){z.target=target(o.target);if(!z.target.id&&!z.target.query)return null;}
    else if(o.op==="shopping.update"){z.target=target(o.target);if(!z.target.id&&!z.target.query)return null;z.patch={};for(const k of ["title","quantity_unit","brand","size","store","notes"])if(o.patch?.[k]!=null)z.patch[k]=str(o.patch[k],500);for(const k of ["quantity_value","quantity_delta"])if(o.patch?.[k]!=null&&Number.isFinite(Number(o.patch[k])))z.patch[k]=Number(o.patch[k]);if(!Object.keys(z.patch).length)return null;}
    else if(o.op==="shopping.replace"){z.target=target(o.target);z.item=item(o.item);if((!z.target.id&&!z.target.query)||!z.item)return null;}
    else if(o.op==="shopping.clear"){z.confirmed=!!o.confirmed;}
    else if(o.op==="reminder.create"){z.title=str(o.title,220);z.date=str(o.date,10);z.time=str(o.time,5);z.timezone=str(o.timezone,80)||"Africa/Cairo";if(!z.title||!isDate(z.date)||!isTime(z.time))return null;}
    else if(o.op==="reminder.update"){z.target=target(o.target);z.patch={};if(o.patch?.title!=null)z.patch.title=str(o.patch.title,220);if(o.patch?.date!=null){z.patch.date=str(o.patch.date,10);if(!isDate(z.patch.date))return null}if(o.patch?.time!=null){z.patch.time=str(o.patch.time,5);if(!isTime(z.patch.time))return null}if(!z.target.id&&!z.target.query)return null;if(!Object.keys(z.patch).length)return null;}
    else if(o.op==="reminder.delete"){z.target=target(o.target);if(!z.target.id&&!z.target.query)return null;}
    else if(o.op==="reminder.rule.create"){z.title=str(o.title,220);z.frequency=["daily","weekly","monthly"].includes(o.frequency)?o.frequency:null;z.weekdays=(Array.isArray(o.weekdays)?o.weekdays:[]).map(Number).filter(n=>n>=0&&n<=6);z.monthdays=(Array.isArray(o.monthdays)?o.monthdays:[]).map(Number).filter(n=>n>=1&&n<=31);z.time=str(o.time,5);z.start_date=str(o.start_date,10);z.end_date=o.end_date?str(o.end_date,10):null;z.timezone=str(o.timezone,80)||"Africa/Cairo";if(!z.title||!z.frequency||!isTime(z.time)||!isDate(z.start_date)||(z.end_date&&!isDate(z.end_date)))return null;}
    else if(o.op==="memory.set"){z.key=str(o.key,120);z.value=str(o.value,1000);if(!z.key||!z.value)return null;}
    operations.push(z);
  }
  const mutates=operations.some(o=>!["shopping.list","reminder.list","reminder.rule.list","memory.list"].includes(o.op));
  if(!operations.length)return null;
  return{version:1,requires_clarification:false,confidence:Math.max(0,Math.min(1,Number(v.confidence)||.5)),operations,mutates,reply_hint:str(v.reply_hint,500)||null};
}


/* ===== src/agent/planner.js ===== */
function plannerPrompt({text,state,route}){
  return `أنت Planner لوكيل شخصي حقيقي. لا تنفذ ولا تدّعي النجاح. حوّل طلب المستخدم إلى AgentPlan JSON فقط.\n\nالوقت الحالي:${JSON.stringify(state.now)}\nقرار الراوتر:${JSON.stringify({task:route.task,route:route.route,needs_context:route.needs_context})}\nالحالة الحقيقية الحالية:${JSON.stringify({shopping:state.shopping,reminders:state.reminders,rules:state.rules,memories:state.memories,recent:state.history})}\n\nSchema:\n{"requires_clarification":false,"clarification_question":null,"confidence":0.0,"operations":[...],"reply_hint":"اختياري"}\nOperations المسموحة:\nshopping.add {items:[{title,quantity_value,quantity_unit,brand,size,store,notes}]}\nshopping.remove {target:{id?,query?}}\nshopping.update {target:{id?,query?},patch:{title?,quantity_value?,quantity_delta?,quantity_unit?,brand?,size?,store?,notes?}}\nshopping.replace {target:{id?,query?},item:{...}}\nshopping.clear {confirmed:true|false}\nshopping.list\nreminder.create {title,date:YYYY-MM-DD,time:HH:mm,timezone}\nreminder.update {target:{id?,query?},patch:{title?,date?,time?}}\nreminder.delete {target:{id?,query?}}\nreminder.list\nreminder.rule.create {title,frequency:daily|weekly|monthly,weekdays:[0..6],monthdays:[1..31],time,start_date,end_date?,timezone}\nreminder.rule.list\nmemory.set {key,value}\nmemory.list\n\nقواعد صارمة:\n1) افهم المعنى والسياق؛ لا تعتمد على كلمات مفتاحية فقط.\n2) طول الرسالة لا يعني صعوبة.\n3) ممنوع اختراع اسم منتج من وصف مرجعي مثل «الكبير/النوع ده/منه/اللي قولتلك عليه». لو المرجع غير محسوم من الحالة: requires_clarification=true.\n4) لو المستخدم أرسل قائمة مشتريات متعددة الأسطر، كل سطر صنف مستقل ويجب أن يظهر كله في items. لا تختصر القائمة.\n5) «افتكر وإحنا بنشتري نجيب...» بدون وقت تنبيه صريح = مشتريات، لا reminder.\n6) التذكير يحتاج تاريخ/وقت قابلين للحسم. لو ناقص عنصر لازم للتنفيذ اسأل.\n7) التعديلات السياقية يجب أن تستهدف عنصرًا واحدًا واضحًا؛ لو صفر أو أكثر من واحد اسأل.\n8) الحذف الشامل shopping.clear لا يكون confirmed=true إلا لو المستخدم أكد صراحة الحذف الشامل.\n9) ممنوع success text؛ أنت تخطط فقط.\n10) الطلب المختلط ينتج عدة operations بالترتيب.\n\nرسالة المستخدم:${JSON.stringify(text)}`;
}

async function planWithModel(env,{model,text,state,route}){
  const r=await callModel(env,{model,messages:[{role:"system",content:"Return exactly one valid AgentPlan JSON object. No Markdown."},{role:"user",content:plannerPrompt({text,state,route})}],temperature:0,maxTokens:2600,timeoutMs:8500,json:true});
  const parsed=parseJsonLoose(r.content), plan=validatePlan(parsed);
  if(!plan){try{await recordModelAttempt(env,model,{ok:false,latencyMs:r.latencyMs,error:"plan_validation_failed",validationFailure:true})}catch{};throw new Error("plan_validation_failed")}
  return{plan,latencyMs:r.latencyMs};
}


/* ===== src/agent/executor.js ===== */
class ClarificationNeeded extends Error{constructor(question,meta={}){super(question);this.name="ClarificationNeeded";this.question=question;this.meta=meta}}
async function oneShop(env,chatId,t){if(t.id){const x=await env.DB.prepare(`SELECT * FROM sa_next_shopping_items WHERE id=? AND chat_id=? AND status!='deleted'`).bind(t.id,chatId).first();return x?[x]:[]}return resolveShoppingTarget(env,chatId,t.query)}
async function oneRem(env,chatId,t){if(t.id){const x=await env.DB.prepare(`SELECT * FROM sa_next_reminders WHERE id=? AND chat_id=? AND status='pending'`).bind(t.id,chatId).first();return x?[x]:[]}return resolveReminderTarget(env,chatId,t.query)}
function exactlyOne(xs,label){if(xs.length===1)return xs[0];if(!xs.length)throw new ClarificationNeeded(`ملقتش ${label} المقصود بشكل مؤكد. تحددهولي بالاسم؟`);throw new ClarificationNeeded(`لقيت أكتر من ${label} ممكن تقصده. تحددهولي أكتر؟`)}
async function executePlan(env,chatId,plan){
  const effects=[];
  for(const op of plan.operations){
    if(op.op==="shopping.add"){const ids=[];for(const x of op.items)ids.push(await addShopping(env,chatId,x));effects.push({op:op.op,ids,expected:op.items});}
    else if(op.op==="shopping.remove"){const r=exactlyOne(await oneShop(env,chatId,op.target),"صنف المشتريات");await removeShopping(env,chatId,r.id);effects.push({op:op.op,id:Number(r.id),before:r});}
    else if(op.op==="shopping.update"){const r=exactlyOne(await oneShop(env,chatId,op.target),"صنف المشتريات");await updateShopping(env,chatId,r.id,op.patch);effects.push({op:op.op,id:Number(r.id),patch:op.patch});}
    else if(op.op==="shopping.replace"){const r=exactlyOne(await oneShop(env,chatId,op.target),"صنف المشتريات");await removeShopping(env,chatId,r.id);const id=await addShopping(env,chatId,op.item);effects.push({op:op.op,removedId:Number(r.id),addedId:id,item:op.item});}
    else if(op.op==="shopping.clear"){if(!op.confirmed)throw new ClarificationNeeded("تقصد أمسح قائمة المشتريات كلها؟ أكّدلي الحذف الشامل.",{danger:"shopping.clear"});await clearShopping(env,chatId);effects.push({op:op.op});}
    else if(op.op==="shopping.list")effects.push({op:op.op,readOnly:true});
    else if(op.op==="reminder.create"){const id=await createReminder(env,chatId,{title:op.title,date:op.date,time:op.time,timezone:op.timezone});effects.push({op:op.op,id,expected:op});}
    else if(op.op==="reminder.update"){const r=exactlyOne(await oneRem(env,chatId,op.target),"التذكير");await updateReminder(env,chatId,r.id,op.patch);effects.push({op:op.op,id:Number(r.id),patch:op.patch});}
    else if(op.op==="reminder.delete"){const r=exactlyOne(await oneRem(env,chatId,op.target),"التذكير");await deleteReminder(env,chatId,r.id);effects.push({op:op.op,id:Number(r.id)});}
    else if(op.op==="reminder.list")effects.push({op:op.op,readOnly:true});
    else if(op.op==="reminder.rule.create"){const id=await createRule(env,chatId,op);effects.push({op:op.op,id,expected:op});}
    else if(op.op==="reminder.rule.list")effects.push({op:op.op,readOnly:true});
    else if(op.op==="memory.set"){await upsertMemory(env,chatId,op.key,op.value,1);effects.push({op:op.op,key:op.key,value:op.value});}
    else if(op.op==="memory.list")effects.push({op:op.op,readOnly:true});
  }
  return effects;
}


/* ===== src/agent/verifier.js ===== */
function eq(a,b){return String(a??"")===String(b??"")}
function findShop(after,id){return after.shopping.find(x=>Number(x.id)===Number(id))}
function findRem(after,id){return after.reminders.find(x=>Number(x.id)===Number(id))}
function verifyEffects(before,after,effects){
  const checks=[];
  for(const e of effects){
    if(e.op==="shopping.add"){
      for(const x of e.expected){const hit=after.shopping.find(r=>normKey(r.title)===normKey(x.title));checks.push({op:e.op,item:x.title,ok:!!hit,reason:hit?null:"missing_added_item"});}
    }else if(e.op==="shopping.remove")checks.push({op:e.op,ok:!after.shopping.some(x=>Number(x.id)===e.id),reason:after.shopping.some(x=>Number(x.id)===e.id)?"item_not_removed":null});
    else if(e.op==="shopping.update"){const r=findShop(after,e.id);let ok=!!r;if(r)for(const[k,v]of Object.entries(e.patch)){if(k==="quantity_delta")continue;const rk=k==="quantity_value"?"quantity_value":k;if(!eq(r[rk],v))ok=false}checks.push({op:e.op,ok,reason:ok?null:"shopping_patch_mismatch"});}
    else if(e.op==="shopping.replace"){const oldExists=after.shopping.some(x=>Number(x.id)===e.removedId),newExists=after.shopping.some(x=>normKey(x.title)===normKey(e.item.title));checks.push({op:e.op,ok:!oldExists&&newExists,reason:!oldExists&&newExists?null:"replace_mismatch"});}
    else if(e.op==="shopping.clear")checks.push({op:e.op,ok:after.shopping.length===0,reason:after.shopping.length?"shopping_not_empty":null});
    else if(e.op==="shopping.list"||e.op==="reminder.list"||e.op==="reminder.rule.list"||e.op==="memory.list")checks.push({op:e.op,ok:true});
    else if(e.op==="reminder.create"){const r=findRem(after,e.id);checks.push({op:e.op,ok:!!r&&eq(r.title,e.expected.title)&&eq(r.date,e.expected.date)&&eq(r.time,e.expected.time),reason:r?null:"missing_reminder"});}
    else if(e.op==="reminder.update"){const r=findRem(after,e.id);let ok=!!r;if(r){if(e.patch.title!=null&&!eq(r.title,e.patch.title))ok=false;if(e.patch.date!=null&&!eq(r.date,e.patch.date))ok=false;if(e.patch.time!=null&&!eq(r.time,e.patch.time))ok=false}checks.push({op:e.op,ok,reason:ok?null:"reminder_patch_mismatch"});}
    else if(e.op==="reminder.delete")checks.push({op:e.op,ok:!after.reminders.some(x=>Number(x.id)===e.id),reason:after.reminders.some(x=>Number(x.id)===e.id)?"reminder_not_deleted":null});
    else if(e.op==="reminder.rule.create")checks.push({op:e.op,ok:after.rules.some(x=>Number(x.id)===e.id),reason:after.rules.some(x=>Number(x.id)===e.id)?null:"rule_missing"});
    else if(e.op==="memory.set")checks.push({op:e.op,ok:after.memories.some(x=>x.key===e.key&&x.value===e.value),reason:"memory_mismatch"});
  }
  return{ok:checks.every(x=>x.ok),checks};
}

function verifyNoFalseSuccess(expectedCount,actualCount){return Number(actualCount)>=Number(expectedCount)}


/* ===== src/agent/rollback.js ===== */
async function rollbackState(env,chatId,before){
  // Restore user-scoped mutable state exactly from the pre-operation snapshot.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sa_next_shopping_items WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM sa_next_shopping_lists WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM sa_next_reminders WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM sa_next_reminder_rules WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM sa_next_memories WHERE chat_id=?`).bind(chatId)
  ]);
  const now=new Date().toISOString();
  let listId=null;
  if(before.shopping?.length){const r=await env.DB.prepare(`INSERT INTO sa_next_shopping_lists(chat_id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?)`).bind(chatId,"مشتريات","مشتريات",now,now).run();listId=Number(r.meta.last_row_id);let pos=0;for(const x of before.shopping){await env.DB.prepare(`INSERT INTO sa_next_shopping_items(list_id,chat_id,title,normalized_title,quantity_value,quantity_unit,brand,size,store,notes,status,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(listId,chatId,x.title,normKey(x.title),x.quantity_value??null,x.quantity_unit??null,x.brand??null,x.size??null,x.store??null,x.notes??null,x.status||"pending",++pos,now,now).run();}}
  for(const x of before.reminders||[])await env.DB.prepare(`INSERT INTO sa_next_reminders(chat_id,title,local_date,local_time,timezone,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(chatId,x.title,x.date,x.time,x.timezone||"Africa/Cairo",x.status||"pending",now,now).run();
  for(const x of before.rules||[])await env.DB.prepare(`INSERT INTO sa_next_reminder_rules(chat_id,title,frequency,weekdays_json,monthdays_json,local_time,start_date,end_date,timezone,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`).bind(chatId,x.title,x.frequency,JSON.stringify(x.weekdays||[]),JSON.stringify(x.monthdays||[]),x.time,x.start_date,x.end_date||null,x.timezone||"Africa/Cairo",now,now).run();
  for(const x of before.memories||[])await env.DB.prepare(`INSERT INTO sa_next_memories(chat_id,key,value,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?)`).bind(chatId,x.key,x.value,Number(x.confidence||1),now,now).run();
}


/* ===== src/agent/pending.js ===== */
async function savePending(env,chatId,{kind="clarification",payload={},question}){const now=new Date(),exp=new Date(now.getTime()+PENDING_TTL_MINUTES*60000).toISOString();await env.DB.prepare(`INSERT INTO sa_next_pending_dialogs(chat_id,kind,payload_json,question,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET kind=excluded.kind,payload_json=excluded.payload_json,question=excluded.question,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(chatId,kind,JSON.stringify(payload),question,exp,now.toISOString(),now.toISOString()).run();}
async function getPending(env,chatId){const r=await env.DB.prepare(`SELECT * FROM sa_next_pending_dialogs WHERE chat_id=?`).bind(chatId).first();if(!r)return null;if(Date.parse(r.expires_at)<=Date.now()){await clearPending(env,chatId);return null}return{...r,payload:JSON.parse(r.payload_json||"{}")};}
async function clearPending(env,chatId){await env.DB.prepare(`DELETE FROM sa_next_pending_dialogs WHERE chat_id=?`).bind(chatId).run();}


/* ===== src/agent/chat.js ===== */
async function answerChat(env,{candidates,text,state}){
  const messages=[{role:"system",content:"أنت SuperAgent، مساعد شخصي عملي ذكي. اتكلم مصري طبيعي ومختصر. لا تدعي تنفيذ أي تغيير في بيانات المستخدم من المحادثة العامة. لو طلب المستخدم تنفيذ شيء في القوائم/المواعيد يجب أن يمر عبر الـAgent executor وليس نصًا وهميًا."},...state.history.slice(-10).map(x=>({role:x.role,content:compact(x.content,2500)})),{role:"user",content:text}];
  const errors=[];for(const m of candidates){try{const r=await callModel(env,{model:m.id,messages,temperature:.35,maxTokens:1600,timeoutMs:8000});return{content:r.content,model:m.id,errors}}catch(e){errors.push({model:m.id,error:String(e?.message||e)})}}throw new Error(`chat_models_failed:${JSON.stringify(errors).slice(0,500)}`);
}


/* ===== src/agent/respond.js ===== */
function successMessage(plan,after){
  const parts=[];
  for(const op of plan.operations){
    if(op.op==="shopping.add")parts.push(`🛒 ضفت ${op.items.length} للمشتريات: ${op.items.map(x=>x.title).join("، ")}`);
    else if(op.op==="shopping.remove")parts.push("🛒 شلت الصنف المطلوب من المشتريات.");
    else if(op.op==="shopping.update")parts.push("🛒 عدلت صنف المشتريات المطلوب.");
    else if(op.op==="shopping.replace")parts.push(`🛒 تم الاستبدال بـ ${op.item.title}.`);
    else if(op.op==="shopping.clear")parts.push("🛒 مسحت قائمة المشتريات.");
    else if(op.op==="shopping.list")parts.push(formatShopping(after.shopping));
    else if(op.op==="reminder.create")parts.push(`⏰ سجلت: ${op.title} — ${op.date} ${op.time}`);
    else if(op.op==="reminder.update")parts.push("⏰ عدلت التذكير المطلوب.");
    else if(op.op==="reminder.delete")parts.push("⏰ ألغيت التذكير المطلوب.");
    else if(op.op==="reminder.list")parts.push(formatReminders(after.reminders));
    else if(op.op==="reminder.rule.create")parts.push(`🔁 سجلت التذكير المتكرر: ${op.title}.`);
    else if(op.op==="reminder.rule.list")parts.push(`🔁 عندك ${after.rules.length} تذكير متكرر نشط.`);
    else if(op.op==="memory.set")parts.push("🧠 حفظت المعلومة.");
    else if(op.op==="memory.list")parts.push(after.memories.length?`🧠 ${after.memories.map(x=>`${x.key}: ${x.value}`).join("\n")}`:"🧠 مفيش معلومات محفوظة.");
  }
  return parts.filter(Boolean).join("\n\n")||"✅ تم التنفيذ بعد التحقق.";
}
function formatShopping(items){return items.length?`🛒 المشتريات (${items.length})\n${items.map(x=>`• ${x.quantity_value!=null?`${x.quantity_value}${x.quantity_unit?` ${x.quantity_unit}`:""} × `:""}${x.title}`).join("\n")}`:"🛒 قائمة المشتريات فاضية."}
function formatReminders(items){return items.length?`⏰ التذكيرات (${items.length})\n${items.map(x=>`• ${x.date} ${x.time} — ${x.title}`).join("\n")}`:"⏰ مفيش تذكيرات معلقة."}


/* ===== src/agent/agent.js ===== */
function requestId(){return crypto.randomUUID();}
async function logOp(env,chatId,data){const now=new Date().toISOString();await env.DB.prepare(`INSERT INTO sa_next_operation_log(chat_id,request_id,plan_json,before_json,after_json,verification_json,status,error,model_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(chatId,data.requestId,JSON.stringify(data.plan||null),JSON.stringify(data.before||null),JSON.stringify(data.after||null),JSON.stringify(data.verification||null),data.status,data.error||null,data.model||null,now,now).run();}
function mergePendingText(pending,text){if(!pending)return text;return `${pending.payload?.base_text||""}\n\nتوضيح المستخدم: ${text}`.trim();}

async function processUserText(env,chatId,text){
  const user=await ensureUser(env,chatId), pending=await getPending(env,chatId); const effective=mergePendingText(pending,text); if(pending)await clearPending(env,chatId);
  await saveMessage(env,chatId,"user",text);
  const route=await routeRequest(env,{text:effective}); let before=await readAgentState(env,chatId,user.timezone);

  if(route.task==="chat"&&!route.needs_tools&&!route.needs_context){
    const a=await answerChat(env,{candidates:route.candidates,text:effective,state:before}); await saveMessage(env,chatId,"assistant",a.content); return{reply:a.content,route,model:a.model};
  }

  const rid=requestId(), errors=[];
  for(const candidate of route.candidates){
    let plan=null;
    try{
      const p=await planWithModel(env,{model:candidate.id,text:effective,state:before,route});plan=p.plan;
      if(plan.requires_clarification){await savePending(env,chatId,{payload:{base_text:effective},question:plan.clarification_question});const reply=`❓ ${plan.clarification_question}`;await saveMessage(env,chatId,"assistant",reply);await logOp(env,chatId,{requestId:rid,plan,before,status:"clarification",model:candidate.id});return{reply,route,model:candidate.id};}
      let effects;
      try{effects=await executePlan(env,chatId,plan)}catch(e){if(e instanceof ClarificationNeeded){await rollbackState(env,chatId,before);await savePending(env,chatId,{payload:{base_text:effective,...e.meta},question:e.question});const reply=`❓ ${e.question}`;await saveMessage(env,chatId,"assistant",reply);await logOp(env,chatId,{requestId:rid,plan,before,status:"clarification",error:e.message,model:candidate.id});return{reply,route,model:candidate.id}}throw e}
      const after=await readAgentState(env,chatId,user.timezone), verification=verifyEffects(before,after,effects);
      if(!verification.ok){await rollbackState(env,chatId,before);before=await readAgentState(env,chatId,user.timezone);errors.push({model:candidate.id,error:"postcondition_failed",verification});await logOp(env,chatId,{requestId:rid,plan,before,after,verification,status:"rolled_back",error:"postcondition_failed",model:candidate.id});continue}
      const reply=successMessage(plan,after);await saveMessage(env,chatId,"assistant",reply);await logOp(env,chatId,{requestId:rid,plan,before,after,verification,status:"verified_success",model:candidate.id});return{reply,route,model:candidate.id,verification};
    }catch(e){try{await rollbackState(env,chatId,before);before=await readAgentState(env,chatId,user.timezone)}catch{};errors.push({model:candidate.id,error:String(e?.message||e).slice(0,180)});await logOp(env,chatId,{requestId:rid,plan,before,status:"attempt_failed",error:String(e?.message||e),model:candidate.id});}
  }
  const reply="⚠️ مقدرتش أنفذ الطلب بأمان بعد تجربة أكتر من موديل، فمغيّرتش أي بيانات. ابعتهولي بصياغة مختلفة أو وضّح الجزء المقصود.";await saveMessage(env,chatId,"assistant",reply);return{reply,route,error:"all_attempts_failed",errors};
}


/* ===== src/telegram/api.js ===== */
async function tg(env,method,payload={}){const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const j=await r.json().catch(()=>null);if(!r.ok||!j?.ok)throw new Error(j?.description||`telegram_${r.status}`);return j.result}
async function sendText(env,chatId,text){return tg(env,"sendMessage",{chat_id:chatId,text:String(text||"").slice(0,4096),disable_web_page_preview:true})}


/* ===== src/admin.js ===== */
function isAdmin(env,chatId){return !!env.ADMIN_CHAT_ID&&String(chatId)===String(env.ADMIN_CHAT_ID)}
async function modelStatsText(env){const rows=await getModelStats(env);if(!rows.length)return"📊 لسه مفيش بيانات استخدام للموديلات.";return`📊 Model stats\n${rows.slice(0,20).map(r=>{const a=Number(r.attempts||0),s=Number(r.successes||0),avg=a?Math.round(Number(r.total_latency_ms||0)/a):0;return`• ${r.model_id}: ${a?Math.round(s/a*100):0}% · ${avg}ms · ${a} tries`}).join("\n")}`}
async function diagnostics(env){const fail=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM sa_next_operation_log WHERE status IN ('attempt_failed','rolled_back') AND created_at>=?`).bind(new Date(Date.now()-3600000).toISOString()).first())?.c||0);const queue=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM sa_next_telegram_updates WHERE status IN ('pending','retry','processing')`).first())?.c||0);return{ok:true,version:VERSION,recent_failed_attempts_1h:fail,queue};}


/* ===== src/telegram/queue.js ===== */
async function persistUpdate(env,u){const id=Number(u?.update_id);const chatId=String(u?.message?.chat?.id||u?.callback_query?.message?.chat?.id||"");if(!Number.isFinite(id)||!chatId)return;const now=new Date().toISOString();await env.DB.prepare(`INSERT OR IGNORE INTO sa_next_telegram_updates(update_id,chat_id,payload_json,status,attempts,created_at,updated_at) VALUES (?,?,?,'pending',0,?,?)`).bind(id,chatId,JSON.stringify(u),now,now).run();}
async function lease(env,chatId){const token=crypto.randomUUID(),until=new Date(Date.now()+INBOX_LEASE_MS).toISOString(),now=new Date().toISOString();const cur=await env.DB.prepare(`SELECT * FROM sa_next_chat_leases WHERE chat_id=?`).bind(chatId).first();if(cur&&Date.parse(cur.lease_until)>Date.now())return null;await env.DB.prepare(`INSERT INTO sa_next_chat_leases(chat_id,lease_token,lease_until,updated_at) VALUES (?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,updated_at=excluded.updated_at`).bind(chatId,token,until,now).run();return token;}
async function release(env,chatId,token){await env.DB.prepare(`DELETE FROM sa_next_chat_leases WHERE chat_id=? AND lease_token=?`).bind(chatId,token).run();}
async function handle(env,row){const u=JSON.parse(row.payload_json),m=u.message;if(!m?.text)return;const chatId=String(m.chat.id),text=String(m.text||"").trim();if(!text)return;let reply;if(text==="/start")reply="👋 SuperAgent Next شغال. كل تنفيذ بيتحقق منه قبل ما أقولك تم.";else if(text==="/shopping")reply=(await processUserText(env,chatId,"وريني قائمة المشتريات الحالية")).reply;else if(text==="/reminders")reply=(await processUserText(env,chatId,"وريني التذكيرات الحالية")).reply;else if(text==="/models"&&isAdmin(env,chatId))reply=await modelStatsText(env);else if(text==="/health"&&isAdmin(env,chatId))reply=`🩺 ${JSON.stringify(await diagnostics(env))}`;else reply=(await processUserText(env,chatId,text)).reply;await sendText(env,chatId,reply)}
async function drainChat(env,chatId){const token=await lease(env,chatId);if(!token)return;try{for(let n=0;n<INBOX_BATCH_SIZE;n++){const row=await env.DB.prepare(`SELECT * FROM sa_next_telegram_updates WHERE chat_id=? AND status IN ('pending','retry') AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY update_id LIMIT 1`).bind(chatId,new Date().toISOString()).first();if(!row)break;await env.DB.prepare(`UPDATE sa_next_telegram_updates SET status='processing',attempts=attempts+1,updated_at=? WHERE update_id=?`).bind(new Date().toISOString(),row.update_id).run();try{await handle(env,row);await env.DB.prepare(`UPDATE sa_next_telegram_updates SET status='done',updated_at=? WHERE update_id=?`).bind(new Date().toISOString(),row.update_id).run()}catch(e){const a=Number(row.attempts||0)+1,status=a>=INBOX_MAX_ATTEMPTS?'failed':'retry',next=new Date(Date.now()+Math.min(60000,2**a*1000)).toISOString();await env.DB.prepare(`UPDATE sa_next_telegram_updates SET status=?,next_retry_at=?,updated_at=? WHERE update_id=?`).bind(status,next,new Date().toISOString(),row.update_id).run();if(status==='failed')try{await sendText(env,chatId,"⚠️ حصل عطل تقني ومنفذتش الرسالة دي. ابعتها تاني.")}catch{}}}}finally{await release(env,chatId,token)}}
async function drainPending(env){const rows=(await env.DB.prepare(`SELECT DISTINCT chat_id FROM sa_next_telegram_updates WHERE status IN ('pending','retry') AND (next_retry_at IS NULL OR next_retry_at<=?) LIMIT 20`).bind(new Date().toISOString()).all())?.results||[];for(const r of rows)await drainChat(env,String(r.chat_id));}


/* ===== src/telegram/reminder-delivery.js ===== */
async function deliverDue(env){
  const users=(await env.DB.prepare(`SELECT chat_id,timezone FROM sa_next_users LIMIT 500`).all())?.results||[];
  for(const u of users){const now=nowInZone(u.timezone||"Africa/Cairo");const rows=(await env.DB.prepare(`SELECT * FROM sa_next_reminders WHERE chat_id=? AND status='pending' AND local_date=? AND local_time<=? ORDER BY local_time,id LIMIT 20`).bind(u.chat_id,now.date,now.time).all())?.results||[];for(const r of rows){try{await sendText(env,u.chat_id,`⏰ ${r.title}`);await env.DB.prepare(`UPDATE sa_next_reminders SET status='sent',updated_at=? WHERE id=? AND status='pending'`).bind(new Date().toISOString(),r.id).run()}catch{}}
    const rules=(await env.DB.prepare(`SELECT * FROM sa_next_reminder_rules WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?) AND local_time=?`).bind(u.chat_id,now.date,now.date,now.time).all())?.results||[];const dow=new Date(`${now.date}T00:00:00Z`).getUTCDay(),md=Number(now.date.slice(8,10));for(const r of rules){let fire=r.frequency==='daily';if(r.frequency==='weekly')fire=JSON.parse(r.weekdays_json||'[]').map(Number).includes(dow);if(r.frequency==='monthly')fire=JSON.parse(r.monthdays_json||'[]').map(Number).includes(md);if(!fire)continue;const key=now.date;const seen=await env.DB.prepare(`SELECT 1 FROM sa_next_reminder_rule_fires WHERE rule_id=? AND fire_key=?`).bind(r.id,key).first();if(seen)continue;try{await sendText(env,u.chat_id,`🔁 ${r.title}`);await env.DB.prepare(`INSERT OR IGNORE INTO sa_next_reminder_rule_fires(rule_id,chat_id,fire_key,sent_at) VALUES (?,?,?,?)`).bind(r.id,u.chat_id,key,new Date().toISOString()).run()}catch{}}
  }
}


/* ===== src/index.js ===== */
function json(x,s=200){return new Response(JSON.stringify(x,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8"}})}
let schemaPromise=null;async function schema(env){if(!schemaPromise)schemaPromise=ensureSchema(env).catch(e=>{schemaPromise=null;throw e});return schemaPromise}
const __SUPERAGENT_WORKER__ = {
 async fetch(req,env,ctx){const u=new URL(req.url);await schema(env);
  if(req.method==="GET"&&u.pathname==="/")return json({ok:true,name:"SuperAgent Next",version:VERSION,architecture:"clean-slate semantic router + planner + deterministic executor + postcondition verifier",router:{models:ROUTER_MODELS,fallbacks:2},pools:{easy:FAST_MODELS.map(x=>x.id),complex:COMPLEX_MODELS.map(x=>x.id)}});
  if(req.method==="GET"&&u.pathname==="/health")return json(await diagnostics(env));
  if(req.method==="GET"&&u.pathname==="/setup"){if(!env.SETUP_KEY||u.searchParams.get("key")!==env.SETUP_KEY)return json({ok:false,error:"unauthorized"},401);const url=`${u.origin}/telegram`;const r=await tg(env,"setWebhook",{url,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:["message"]});await tg(env,"setMyCommands",{commands:[{command:"start",description:"تشغيل SuperAgent Next"},{command:"shopping",description:"عرض المشتريات"},{command:"reminders",description:"عرض التذكيرات"}]});return json({ok:true,version:VERSION,webhook:url,result:r});}
  if(req.method==="POST"&&u.pathname==="/route"){if(!env.SETUP_KEY||req.headers.get("x-setup-key")!==env.SETUP_KEY)return json({ok:false,error:"unauthorized"},401);const b=await req.json();return json({ok:true,result:await routeRequest(env,b)});}
  if(req.method==="POST"&&u.pathname==="/agent"){if(!env.SETUP_KEY||req.headers.get("x-setup-key")!==env.SETUP_KEY)return json({ok:false,error:"unauthorized"},401);const b=await req.json();return json({ok:true,result:await processUserText(env,String(b.chat_id||"test"),String(b.text||""))});}
  if(req.method==="GET"&&u.pathname==="/models"){if(!env.SETUP_KEY||u.searchParams.get("key")!==env.SETUP_KEY)return json({ok:false,error:"unauthorized"},401);return new Response(await modelStatsText(env),{headers:{"content-type":"text/plain; charset=utf-8"}});}
  if(req.method==="POST"&&u.pathname==="/telegram"){const sec=req.headers.get("X-Telegram-Bot-Api-Secret-Token")||"";if(!env.TELEGRAM_WEBHOOK_SECRET||sec!==env.TELEGRAM_WEBHOOK_SECRET)return new Response("unauthorized",{status:401});const update=await req.json();await persistUpdate(env,update);const chatId=String(update?.message?.chat?.id||"");if(chatId)ctx.waitUntil(drainChat(env,chatId));return new Response("OK");}
  return json({ok:false,error:"not_found"},404);
 },
 async scheduled(controller,env,ctx){await schema(env);ctx.waitUntil(Promise.allSettled([deliverDue(env),drainPending(env)]));}
};


export default __SUPERAGENT_WORKER__;
