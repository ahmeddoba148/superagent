const TIME_ZONE="Africa/Cairo";const PENDING_TTL_MINUTES=30;const CONFLICT_TTL_MINUTES=20;const TOTAL_AI_BUDGET_MS=25000;const AI_RATE_LIMIT_PER_MINUTE=15;const CONVERSATION_MEMORY_LIMIT=24;const CONTEXT_DAYS=365;const CONTEXT_NEAR_LIMIT=160;const CONTEXT_RELEVANT_LIMIT=80;const CONTEXT_RULE_LIMIT=120;const FREE_PERIOD_HORIZON_DAYS=180;const FREE_SLOT_HORIZON_DAYS=60;const CONFLICT_LOOKAHEAD_DAYS=60;const MAX_RULE_OCCURRENCES=5000;const SCHEDULER_MAX_CATCHUP_MINUTES=1440;const MAX_ADVANCE_ALERT_MINUTES=10080;const SHOW_MODEL_USED_TO_ADMIN=false;const LIVE_NEWS_MAX=8;const LIVE_NEWS_TTL_MINUTES=5;const LIVE_WATCH_BATCH_SIZE=8;const PRAYER_CACHE_TTL_MINUTES=720;const HOLIDAY_CACHE_TTL_MINUTES=720;const DEFAULT_COUNTRY_CODE="EG";const DEFAULT_CITY="Cairo";const DEFAULT_COUNTRY="Egypt";const OMNIAI_INTERNAL_URL="https://omniai-engine.ahmeddoba91.workers.dev/v1/chat/completions";const REMINDER_MODELS=[{short:"G3.5-L",name:"Gemini 3.5 Flash-Lite",id:"gemini::gemini-3.5-flash-lite",timeoutMs:4200},{short:"G3.6-F",name:"Gemini 3.6 Flash",id:"gemini::gemini-3.6-flash",timeoutMs:3600},{short:"G3.1-L",name:"Gemini 3.1 Flash-Lite",id:"gemini::gemini-3.1-flash-lite",timeoutMs:3000},{short:"G3.5-F",name:"Gemini 3.5 Flash",id:"gemini::gemini-3.5-flash",timeoutMs:2600},{short:"G2.5-L",name:"Gemini 2.5 Flash-Lite",id:"gemini::gemini-2.5-flash-lite",timeoutMs:2300},{short:"G2.5-F",name:"Gemini 2.5 Flash",id:"gemini::gemini-2.5-flash",timeoutMs:2100},{short:"OSS120",name:"GPT OSS 120B — Groq",id:"groq::openai/gpt-oss-120b",timeoutMs:1900},{short:"Qwen3.6",name:"Qwen 3.6 27B — Groq",id:"groq::qwen/qwen3.6-27b",timeoutMs:1700},{short:"MistralS",name:"Mistral Small 2603",id:"mistral::mistral-small-2603",timeoutMs:1500},{short:"DS-V4F",name:"DeepSeek V4 Flash — NVIDIA",id:"nvidia::deepseek-ai/deepseek-v4-flash",timeoutMs:1500},];

export default{
async fetch(request,env,ctx){
const url=new URL(request.url);
if(request.method==="GET"&&url.pathname==="/"){
return json({ok:true,service:"Super Agent — Universal Secretary",version:"9.2",status:"online",timezone:TIME_ZONE,public_mode:isPublicMode(env),context_memory:true,universal_recurrence:true,safety_grounding:true,live_reality:true,live_world_news:true,prayer_awareness:true,multi_prayer_anchors:true,reference_clock_safety:true,semantic_role_safety:true,hijri_calendar:true,public_holidays:true,per_user_location:true,long_term_memory:true,egyptian_dialect_engine:true,hidden_internal_ids:true,hidden_model_debug:true,deterministic_relationships:true,composite_duration_safe:true,max_occurrence_safe:true,duration_conflicts:true,advance_alerts:true,snooze:true,general_chat:true,multi_user_isolation:true,fallback_models:REMINDER_MODELS.length});
}
if(request.method==="GET"&&url.pathname==="/health"){
return json({ok:true,version:"9.2",now:cairoNow(),db:!!env.DB,omniai_service:!!env.OMNIAI_SERVICE,live_reality:true});
}
if(request.method==="GET"&&url.pathname==="/setup")return setup(request,env);
if(request.method==="POST"&&url.pathname==="/telegram"){
const secret=request.headers.get("X-Telegram-Bot-Api-Secret-Token")||"";
if(!env.TELEGRAM_WEBHOOK_SECRET||secret!==env.TELEGRAM_WEBHOOK_SECRET)return new Response("Unauthorized",{status:401});
let update;
try{update=await request.json();}catch{return new Response("Bad Request",{status:400});}
ctx.waitUntil(handleTelegramUpdate(update,env));
return new Response("OK");
}
return new Response("Not Found",{status:404});
},
async scheduled(controller,env,ctx){
ctx.waitUntil(deliverDueReminders(env,controller?.scheduledTime));
}
};

let SCHEMA_READY_PROMISE=null;
async function ensureSchemaOnce(env,force=false){
if(force||!SCHEMA_READY_PROMISE){
const current=ensureSchema(env);
SCHEMA_READY_PROMISE=current;
try{await current;}catch(e){if(SCHEMA_READY_PROMISE===current)SCHEMA_READY_PROMISE=null;throw e;}
return;
}
return SCHEMA_READY_PROMISE;
}

async function setup(request,env){
const url=new URL(request.url);
const key=url.searchParams.get("key")||"";
const force=url.searchParams.get("force")==="1";
if(!env.SETUP_KEY||key!==env.SETUP_KEY)return json({ok:false,error:"Unauthorized"},401);
const missing=requiredBindings(env);
if(missing.length)return json({ok:false,error:"Missing bindings",missing},500);
await ensureSchemaOnce(env,true);
const webhookUrl=`${url.origin}/telegram`;
const desiredUpdates=["message","callback_query"];
let webhookStatus="updated";
const info=await telegramApi(env,"getWebhookInfo",{});
const current=info.ok?(info.result||{}):{};
const allowed=Array.isArray(current.allowed_updates)?current.allowed_updates:[];
const sameUpdates=allowed.length===desiredUpdates.length&&desiredUpdates.every(x=>allowed.includes(x));
const alreadyReady=!force&&current.url===webhookUrl&&sameUpdates;
if(alreadyReady)webhookStatus="already-ready";
else{
const set=await telegramApiWithRetry(env,"setWebhook",{url:webhookUrl,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:desiredUpdates,drop_pending_updates:false},2);
if(!set.ok)return json({ok:false,error:"setWebhook failed",telegram:set},502);
}
await telegramApiWithRetry(env,"setMyCommands",{commands:[
{command:"start",description:"تشغيل Super Agent"},
{command:"menu",description:"لوحة التحكم"},
{command:"today",description:"مواعيد النهاردة"},
{command:"tomorrow",description:"مواعيد بكرة"},
{command:"week",description:"جدول 7 أيام"},
{command:"month",description:"مواعيد الشهر"},
{command:"list",description:"كل المواعيد القادمة"},
{command:"recurring",description:"إدارة التكرارات"},
{command:"where",description:"موقعي ووقتي الحالي"},
{command:"memory",description:"ذاكرتي المحفوظة"},
{command:"live",description:"ملخص الواقع الحالي"}
]},1);
return json({ok:true,message:"Super Agent V9.2 Semantic Prayer Stability is ready",webhook:webhookUrl,webhook_status:webhookStatus,allowed_updates:desiredUpdates,timezone:TIME_ZONE,public_mode:isPublicMode(env),universal_recurrence:true,safety_grounding:true,live_reality:true,prayer_awareness:true,multi_prayer_anchors:true,reference_clock_safety:true,long_term_memory:true,egyptian_dialect_engine:true,hidden_internal_ids:true,duration_conflicts:true,safe_live_watch_batching:true,schema_cached_per_isolate:true,fallback_models:REMINDER_MODELS.length});
}

async function ensureSchema(env){
await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reminders (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id TEXT NOT NULL,
title TEXT NOT NULL,
kind TEXT NOT NULL DEFAULT 'reminder',
local_date TEXT NOT NULL,
local_time TEXT NOT NULL,
sent INTEGER NOT NULL DEFAULT 0,
cancelled INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL
)`).run();
await ensureColumn(env,"reminders","duration_minutes","INTEGER NOT NULL DEFAULT 0");
await ensureColumn(env,"reminders","advance_alerts_json","TEXT NOT NULL DEFAULT '[]'");
await ensureColumn(env,"reminders","updated_at","TEXT");
await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_reminders_user_due ON reminders(chat_id,cancelled,sent,local_date,local_time)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS recurring_rules (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id TEXT NOT NULL,
title TEXT NOT NULL,
kind TEXT NOT NULL DEFAULT 'reminder',
frequency TEXT NOT NULL,
local_time TEXT NOT NULL,
weekdays_json TEXT NOT NULL DEFAULT '[]',
monthdays_json TEXT NOT NULL DEFAULT '[]',
start_date TEXT NOT NULL,
end_date TEXT,
active INTEGER NOT NULL DEFAULT 1,
last_fired_key TEXT,
created_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS schedule_rules (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id TEXT NOT NULL,
title TEXT NOT NULL,
kind TEXT NOT NULL DEFAULT 'reminder',
rule_json TEXT NOT NULL,
duration_minutes INTEGER NOT NULL DEFAULT 0,
start_at TEXT NOT NULL,
end_at TEXT,
max_occurrences INTEGER,
fired_count INTEGER NOT NULL DEFAULT 0,
active INTEGER NOT NULL DEFAULT 1,
paused_until TEXT,
exceptions_json TEXT NOT NULL DEFAULT '[]',
advance_alerts_json TEXT NOT NULL DEFAULT '[]',
legacy_rule_id INTEGER,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_legacy ON schedule_rules(legacy_rule_id) WHERE legacy_rule_id IS NOT NULL`).run();
await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_schedule_user_active ON schedule_rules(chat_id,active,start_at)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS schedule_fires (
id INTEGER PRIMARY KEY AUTOINCREMENT,
rule_id INTEGER NOT NULL,
chat_id TEXT NOT NULL,
occurrence_key TEXT NOT NULL,
alert_offset INTEGER NOT NULL DEFAULT 0,
sent_at TEXT NOT NULL,
UNIQUE(rule_id,occurrence_key,alert_offset)
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reminder_fires (
id INTEGER PRIMARY KEY AUTOINCREMENT,
reminder_id INTEGER NOT NULL,
chat_id TEXT NOT NULL,
fire_key TEXT NOT NULL,
sent_at TEXT NOT NULL,
UNIQUE(reminder_id,fire_key)
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scheduler_state (
key TEXT PRIMARY KEY,
value TEXT NOT NULL,
updated_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pending_dialogs (
chat_id TEXT PRIMARY KEY,
base_text TEXT NOT NULL,
context_json TEXT NOT NULL DEFAULT '[]',
question TEXT NOT NULL,
question_type TEXT NOT NULL DEFAULT 'generic',
question_meta TEXT NOT NULL DEFAULT '{}',
expires_at TEXT NOT NULL,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pending_conflicts (
chat_id TEXT PRIMARY KEY,
intent_json TEXT NOT NULL,
conflicts_json TEXT NOT NULL DEFAULT '[]',
expires_at TEXT NOT NULL,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS conversation_messages (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id TEXT NOT NULL,
role TEXT NOT NULL,
content TEXT NOT NULL,
created_at TEXT NOT NULL
)`).run();
await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_conversation_user ON conversation_messages(chat_id,id)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS model_stats (
model_id TEXT PRIMARY KEY,
short_name TEXT NOT NULL,
attempts INTEGER NOT NULL DEFAULT 0,
successes INTEGER NOT NULL DEFAULT 0,
failures INTEGER NOT NULL DEFAULT 0,
total_latency_ms INTEGER NOT NULL DEFAULT 0,
last_latency_ms INTEGER NOT NULL DEFAULT 0,
last_error TEXT,
updated_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_rate_limits (
chat_id TEXT PRIMARY KEY,
window_start INTEGER NOT NULL,
request_count INTEGER NOT NULL DEFAULT 0
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pending_requests (
chat_id TEXT PRIMARY KEY,
original_text TEXT NOT NULL,
question TEXT NOT NULL,
expires_at TEXT NOT NULL,
created_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_profiles (
chat_id TEXT PRIMARY KEY,
timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
city TEXT NOT NULL DEFAULT 'Cairo',
country TEXT NOT NULL DEFAULT 'Egypt',
country_code TEXT NOT NULL DEFAULT 'EG',
latitude REAL,
longitude REAL,
locale TEXT NOT NULL DEFAULT 'ar-EG',
debug_mode INTEGER NOT NULL DEFAULT 0,
updated_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_memories (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id TEXT NOT NULL,
memory TEXT NOT NULL,
normalized TEXT NOT NULL,
created_at TEXT NOT NULL,
UNIQUE(chat_id,normalized)
)`).run();
await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_memories_chat ON user_memories(chat_id,id)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS live_cache (
cache_key TEXT PRIMARY KEY,
value_json TEXT NOT NULL,
expires_at TEXT NOT NULL,
updated_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS prayer_rules (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id TEXT NOT NULL,
title TEXT NOT NULL,
prayer TEXT NOT NULL,
offset_minutes INTEGER NOT NULL DEFAULT 0,
start_date TEXT NOT NULL,
end_date TEXT,
weekdays_json TEXT NOT NULL DEFAULT '[]',
max_occurrences INTEGER,
fired_count INTEGER NOT NULL DEFAULT 0,
active INTEGER NOT NULL DEFAULT 1,
paused_until TEXT,
exceptions_json TEXT NOT NULL DEFAULT '[]',
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
)`).run();

await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_prayer_rules_user ON prayer_rules(chat_id,active,start_date)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS prayer_rule_fires (
id INTEGER PRIMARY KEY AUTOINCREMENT,
rule_id INTEGER NOT NULL,
chat_id TEXT NOT NULL,
occurrence_date TEXT NOT NULL,
sent_at TEXT NOT NULL,
UNIQUE(rule_id,occurrence_date)
)`).run();

await env.DB.prepare(`CREATE TABLE IF NOT EXISTS live_watches (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id TEXT NOT NULL,
query_ar TEXT NOT NULL,
query_en TEXT NOT NULL,
last_url TEXT,
active INTEGER NOT NULL DEFAULT 1,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
)`).run();

await ensureColumn(env,"reminders","timezone","TEXT NOT NULL DEFAULT 'Africa/Cairo'");
await ensureColumn(env,"schedule_rules","timezone","TEXT NOT NULL DEFAULT 'Africa/Cairo'");
await migrateLegacyRules(env);
}

async function ensureColumn(env,table,column,definition){
const rows=(await env.DB.prepare(`PRAGMA table_info(${table})`).all())?.results||[];
if(!rows.some(r=>String(r.name)===column)){
try{await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();}
catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e;}
}
}

async function migrateLegacyRules(env){
const rows=(await env.DB.prepare(`SELECT * FROM recurring_rules ORDER BY id`).all())?.results||[];
if(!rows.length)return;
const statements=[];
const now=new Date().toISOString();
for(const r of rows){
const exists=await env.DB.prepare(`SELECT id FROM schedule_rules WHERE legacy_rule_id=? LIMIT 1`).bind(r.id).first();
if(exists)continue;
const frequency=String(r.frequency||"daily");
const rule={mode:"calendar",every:1,unit:frequency==="weekly"?"weeks":frequency==="monthly"?"months":"days",times:[String(r.local_time||"09:00")],weekdays:sanitizeWeekdays(parseJsonArray(r.weekdays_json)),monthdays:sanitizeMonthdays(parseJsonArray(r.monthdays_json)),months:[],ordinal_weekdays:[]};
const startAt=`${r.start_date} 00:00`;
const endAt=r.end_date?`${r.end_date} 23:59`:null;
statements.push(env.DB.prepare(`INSERT OR IGNORE INTO schedule_rules
(chat_id,title,kind,rule_json,duration_minutes,start_at,end_at,max_occurrences,fired_count,active,paused_until,exceptions_json,advance_alerts_json,legacy_rule_id,created_at,updated_at)
VALUES (?,?,?,?,0,?,?,NULL,0,?,NULL,'[]','[]',?,?,?)`).bind(String(r.chat_id),String(r.title),r.kind==="appointment"?"appointment":"reminder",JSON.stringify(rule),startAt,endAt,Number(r.active||0),Number(r.id),String(r.created_at||now),now));
}
if(statements.length)await env.DB.batch(statements);
if(rows.length)await env.DB.prepare(`DELETE FROM recurring_rules`).run();
}

async function handleTelegramUpdate(update,env){
await ensureSchemaOnce(env);
if(update?.callback_query){await handleCallbackQuery(update.callback_query,env);return;}
const message=update?.message||null;
if(!message)return;
const chatId=String(message?.chat?.id??"");
const chatType=String(message?.chat?.type||"");
if(!chatId)return;
if(chatType&&chatType!=="private"){
try{await sendText(env,chatId,"👤 استخدمني في المحادثة الخاصة علشان بياناتك ومواعيدك تفضل خاصة بيك.");}catch{}
return;
}
try{
if(!isPublicMode(env)&&!isAdmin(env,chatId)){
await sendText(env,chatId,"⛔ البوت غير متاح للعامة حاليًا.");
return;
}
await ensureUserProfile(env,chatId);
if(message.location){
await handleUserLocation(env,chatId,message.location);
return;
}
const text=typeof message.text==="string"?message.text.trim():"";

if(text==="/start"){
await clearPendingDialog(env,chatId);
await clearPendingConflict(env,chatId);
await sendText(env,chatId,`👋 أهلاً بيك في Super Agent

🧠 مساعدك الشخصي اللي فاهم يومك وسياقك.
⏰ مواعيد وتذكيرات وتكرارات مرنة وتنبيهات مسبقة.
📅 تعارضات، أوقات فاضية، تعديل وتحريك وإيقاف وتخطي.
🌍 وقت وتاريخ ومناسبات وأخبار عالمية حية عند الحاجة.
🕌 فاهم الصلاة والأذان ورمضان والعيد والتاريخ الهجري.
📍 ابعت موقعك مرة واحدة علشان الوقت والصلاة يبقوا أدق.
💭 يقدر يفتكر المعلومات اللي تطلب منه يحفظها.
🇪🇬 وكلمه مصري براحتك وبأي صياغة طبيعية.

اكتب اللي عايزه بطريقتك وأنا أرتبهولك.`,mainMenuKeyboard(env,chatId));
return;
}

if(!text){
await sendText(env,chatId,"📍 لو دي رسالة موقع ابعتها من زر Location، أو ابعتلي كلامك عادي.",quickMenuKeyboard());
return;
}

await telegramApi(env,"sendChatAction",{chat_id:chatId,action:"typing"});
if(await handleLifeDirectCommands(env,chatId,text))return;

const pendingConflict=await getPendingConflict(env,chatId);
if(pendingConflict){
if(isConflictConfirmReply(text)){
await saveConversationMessage(env,chatId,"user",text);
const savedIntent=parseJsonObject(pendingConflict.intent_json);
await clearPendingConflict(env,chatId);
if(!savedIntent?.action)throw new Error("طلب التعارض القديم غير صالح. ابعت الطلب من جديد.");
await executeIntent(env,chatId,savedIntent,{skipConflictCheck:true});
return;
}
if(isConflictCancelReply(text)){
await saveConversationMessage(env,chatId,"user",text);
await clearPendingConflict(env,chatId);
const answer="✅ تمام، لغيت العملية المتعارضة ومفيش حاجة اتحفظت.";
await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}
await clearPendingConflict(env,chatId);
}

if(await handleDirectCommands(env,chatId,text))return;

const history=await getRecentConversation(env,chatId,CONVERSATION_MEMORY_LIMIT);
await saveConversationMessage(env,chatId,"user",text);

const pending=await getPendingDialog(env,chatId);
if(pending){
if(replyLikelyAnswersPending(pending,text)){
await resolvePendingDialog(env,chatId,pending,text,history);
return;
}
if(looksLikeIndependentNewRequest(text))await clearPendingDialog(env,chatId);
else{
await resolvePendingDialog(env,chatId,pending,text,history);
return;
}
}
await processFreshAgentText(env,chatId,text,history);
}catch(error){
console.error("Telegram update error:",error);
try{
const msg=`⚠️ حصل خطأ: ${safeError(error)}`;
await sendText(env,chatId,msg,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",msg);
}catch(sendError){
console.error("Failed to send error:",sendError);
}
}
}

async function processFreshAgentText(env,chatId,text,history){
const localNeed=analyzeHardAmbiguity(text);
if(localNeed){
await savePendingDialog(env,chatId,{baseText:text,context:[],question:localNeed.question,questionType:localNeed.type,questionMeta:localNeed.meta||{}});
const answer=`❓ ${localNeed.question}`;
await sendText(env,chatId,answer,clarificationKeyboard(localNeed.type));
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}
await enforceAiRateLimit(env,chatId);
const profile=await getUserProfile(env,chatId);
const memories=await getUserMemories(env,chatId,30);
const reality=await buildLiveRealityContext(env,chatId,text,profile);
const fastPrayer=buildOneTimePrayerIntent(text,reality,profile.timezone);
if(fastPrayer){
await executeIntent(env,chatId,fastPrayer);
return;
}
const scheduleContext=await buildScheduleContext(env,chatId,CONTEXT_DAYS,text);
const userPayload=buildAIUserMessage({
baseText:text,
clarifications:[],
history,
scheduleContext,
realityContext:reality.text,
memoryContext:memories.map(x=>x.memory).join("\n")
});
const intent=await parseIntentWithFallback(env,userPayload,{baseText:text,clarifications:[],timezone:profile.timezone});
intent._timezone=profile.timezone;
intent._reality=reality;
applyPrayerGrounding(intent,text,reality);

if(intent.needs_clarification){
const q=classifyClarificationQuestion(intent.question,text);
await savePendingDialog(env,chatId,{baseText:text,context:[],question:intent.question,questionType:q.type,questionMeta:q.meta});
const answer=`❓ ${intent.question}`;
await sendText(env,chatId,answer,clarificationKeyboard(q.type));
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

if(intent.action==="chat"&&needsLiveNews(text))intent.needs_live_data=true;
if(intent.action==="chat"&&intent.needs_live_data){
intent.reply=await answerChatWithLiveData(env,chatId,text,intent,reality,history,memories);
}
await executeIntent(env,chatId,intent);
}

async function resolvePendingDialog(env,chatId,pending,replyText,history){
const oldContext=parseJsonArray(pending.context_json);
const entry=normalizeClarificationReply(pending,replyText);
const newContext=[...oldContext,entry];
await enforceAiRateLimit(env,chatId);
const profile=await getUserProfile(env,chatId);
const memories=await getUserMemories(env,chatId,30);
const reality=await buildLiveRealityContext(env,chatId,pending.base_text,profile);
const scheduleContext=await buildScheduleContext(env,chatId,CONTEXT_DAYS,pending.base_text);
const userPayload=buildAIUserMessage({
baseText:pending.base_text,
clarifications:newContext,
history,
scheduleContext,
realityContext:reality.text,
memoryContext:memories.map(x=>x.memory).join("\n")
});
const intent=await parseIntentWithFallback(env,userPayload,{baseText:pending.base_text,clarifications:newContext,timezone:profile.timezone});
intent._timezone=profile.timezone;
intent._reality=reality;
applyPrayerGrounding(intent,pending.base_text,reality);

if(intent.needs_clarification){
const q=classifyClarificationQuestion(intent.question,pending.base_text);
await savePendingDialog(env,chatId,{baseText:pending.base_text,context:newContext,question:intent.question,questionType:q.type,questionMeta:q.meta});
const answer=`❓ ${intent.question}`;
await sendText(env,chatId,answer,clarificationKeyboard(q.type));
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

await clearPendingDialog(env,chatId);
if(intent.action==="chat"&&needsLiveNews(pending.base_text))intent.needs_live_data=true;
if(intent.action==="chat"&&intent.needs_live_data){
intent.reply=await answerChatWithLiveData(env,chatId,pending.base_text,intent,reality,history,memories);
}
await executeIntent(env,chatId,intent);
}

function mainMenuKeyboard(env,chatId){
const rows=[
[{text:"📍 النهاردة",callback_data:"panel:today"},{text:"🗓️ 7 أيام",callback_data:"panel:week"}],
[{text:"📅 كل مواعيدي",callback_data:"panel:list"},{text:"🗓️ الشهر",callback_data:"panel:month"}],
[{text:"🔁 إدارة التكرارات",callback_data:"panel:recurring"}],
[{text:"🗑️ مسح كل مواعيدي",callback_data:"confirm:clear_all"},{text:"🧹 مسح السياق",callback_data:"confirm:clear_memory"}]
];
return{inline_keyboard:rows};
}

function quickMenuKeyboard(){
return{inline_keyboard:[[
{text:"📅 مواعيدي",callback_data:"panel:list"},
{text:"🎛️ التحكم",callback_data:"panel:home"}
]]};
}

function clarificationKeyboard(type){
const rows=[];
if(type==="meridiem_single"){
rows.push([
{text:"☀️ صباحًا",callback_data:"clarify:period:am"},
{text:"🌙 مساءً",callback_data:"clarify:period:pm"}
]);
}
if(type==="meridiem_multi"){
rows.push([
{text:"☀️ كلهم صباحًا",callback_data:"clarify:period:am"},
{text:"🌙 كلهم مساءً",callback_data:"clarify:period:pm"}
]);
}
rows.push([{text:"❌ إلغاء الطلب",callback_data:"pending:cancel"}]);
return{inline_keyboard:rows};
}

async function showMainPanel(env,chatId,messageId=null){
const profile=await getUserProfile(env,chatId);
const now=zonedNow(profile.timezone);
const one=await env.DB.prepare(`SELECT COUNT(*) AS c FROM reminders WHERE chat_id=? AND cancelled=0 AND sent=0 AND (local_date>? OR (local_date=? AND local_time>=?))`).bind(chatId,now.date,now.date,now.time).first();
const rules=await env.DB.prepare(`SELECT COUNT(*) AS c FROM schedule_rules WHERE chat_id=? AND active=1`).bind(chatId).first();
const prayerRules=await env.DB.prepare(`SELECT COUNT(*) AS c FROM prayer_rules WHERE chat_id=? AND active=1`).bind(chatId).first();
const lines=[
"🎛️ لوحة تحكم Super Agent V9.1",
"",
`📅 المواعيد القادمة: ${Number(one?.c||0)}`,
`🔁 التكرارات النشطة: ${Number(rules?.c||0)+Number(prayerRules?.c||0)}`
];
lines.push("","اختار من الأزرار:");
await editOrSend(env,chatId,messageId,lines.join("\n"),mainMenuKeyboard(env,chatId));
}

async function showModelStatsPanel(env,chatId,messageId=null){
if(!isAdmin(env,chatId))return;
const stats=await getAllModelStats(env);
const byId=new Map(stats.map(r=>[r.model_id,r]));
const lines=REMINDER_MODELS.map((m,i)=>{
const s=byId.get(m.id);
const a=Number(s?.attempts||0);
const ok=Number(s?.successes||0);
const avg=a?`${Math.round(Number(s?.total_latency_ms||0)/a)}ms`:"—";
return`${i+1}) ${m.short} ${ok}/${a} · avg ${avg} · ⏱${(m.timeoutMs/1000).toFixed(1)}s`;
});
await editOrSend(env,chatId,messageId,`🧠 الموديلات — نجاح/وصلها

${lines.join("\n")}

الإحصائيات دي للأدمن فقط.`,{
inline_keyboard:[
[{text:"♻️ تصفير الإحصائيات",callback_data:"confirm:reset_stats"}],
[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]
]
});
}

async function handleDirectCommands(env,chatId,text){
const t=normalizeArabicLoose(text);

if(["/menu","لوحه التحكم"].includes(t)){
await showMainPanel(env,chatId);
return true;
}
if(["/today","مواعيدي النهارده","مواعيد النهارده"].includes(t)){
await sendScheduleList(env,chatId,"today");
return true;
}
if(["/tomorrow","مواعيدي بكره","مواعيد بكره"].includes(t)){
await sendScheduleList(env,chatId,"tomorrow");
return true;
}
if(["/week","جدول الاسبوع"].includes(t)){
await sendScheduleList(env,chatId,"week");
return true;
}
if(["/month","مواعيد الشهر","جدول الشهر"].includes(t)){
await sendScheduleList(env,chatId,"month");
return true;
}
if(["/list","كل مواعيدي","مواعيدي","المواعيد"].includes(t)){
await sendAllSchedule(env,chatId);
return true;
}
if(["/recurring","المواعيد المتكرره","التكرارات"].includes(t)){
await showRecurringRules(env,chatId);
return true;
}
if(["/models","الموديلات","احصائيات الموديلات","اسكور الموديلات"].includes(t)){
if(!isAdmin(env,chatId)){
await sendText(env,chatId,"🔒 الأمر ده للأدمن فقط.",quickMenuKeyboard());
return true;
}
await showModelStatsPanel(env,chatId);
return true;
}

const del=t.match(/^(?:\/delete\s*|احذف(?:\s+رقم)?\s*)(r)?(\d+)$/u);
if(del){
if(del[1])await deleteScheduleRule(env,chatId,Number(del[2]));
else await cancelReminder(env,chatId,Number(del[2]));
return true;
}
return false;
}

async function executeIntent(env,chatId,intent,options={}){
if(intent.action==="create"){
if(!options.skipConflictCheck){
const conflicts=await findCreateConflicts(env,chatId,intent);
if(conflicts.length){
await presentConflictWarning(env,chatId,intent,conflicts);
return;
}
}

const statements=[];
const one=[];
const rules=[];
const nowIso=new Date().toISOString();

for(const item of intent.items){
statements.push(
env.DB.prepare(`INSERT INTO reminders
(chat_id,title,kind,local_date,local_time,sent,cancelled,created_at,duration_minutes,advance_alerts_json,updated_at,timezone)
VALUES (?,?,?,?,?,0,0,?,?,?,?,?)`)
.bind(chatId,item.title,item.kind,item.date,item.time,nowIso,item.duration_minutes,JSON.stringify(item.advance_alerts),nowIso,intent._timezone||TIME_ZONE)
);
}

for(const r of intent.recurring_items){
statements.push(
env.DB.prepare(`INSERT INTO schedule_rules
(chat_id,title,kind,rule_json,duration_minutes,start_at,end_at,max_occurrences,fired_count,active,paused_until,exceptions_json,advance_alerts_json,legacy_rule_id,created_at,updated_at,timezone)
VALUES (?,?,?,?,?,?,?,?,0,1,NULL,?,?,NULL,?,?,?)`)
.bind(chatId,r.title,r.kind,JSON.stringify(r.schedule),r.duration_minutes,r.schedule.start_at,r.schedule.end_at,r.schedule.max_occurrences,JSON.stringify(r.schedule.exceptions||[]),JSON.stringify(r.advance_alerts),nowIso,nowIso,intent._timezone||TIME_ZONE)
);
}

if(!statements.length)throw new Error("مفيش موعد صالح للحفظ.");
const results=await env.DB.batch(statements);

let i=0;
for(const item of intent.items){
one.push({...item,id:results?.[i++]?.meta?.last_row_id??"?"});
}
for(const r of intent.recurring_items){
rules.push({...r,id:results?.[i++]?.meta?.last_row_id??"?"});
}

const lines=[];
for(const x of one){
lines.push(`${x.kind==="appointment"?"📅":"⏰"} ${formatEventWhen(x.date,x.time,x.duration_minutes,x.timezone||intent._timezone||TIME_ZONE)} — ${x.title}${formatAdvanceAlerts(x.advance_alerts)}`);
}
for(const r of rules){
lines.push(`🔁 ${formatUniversalRule(r.schedule)}${r.duration_minutes?` · مدة ${formatMinutes(r.duration_minutes)}`:""} — ${r.title}${formatAdvanceAlerts(r.advance_alerts)}`);
}

const answer=`✅ تم الحفظ:

${lines.join("\n")}${modelFooter(env,chatId,intent)}`;

await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

if(intent.action==="list"){
if((intent.range||"upcoming")==="upcoming")await sendAllSchedule(env,chatId,null,intent);
else await sendScheduleList(env,chatId,intent.range,null,intent);
return;
}

if(intent.action==="find_free_period"){
const days=clamp(Number(intent.duration_days||7),1,30);
const found=await findFreePeriod(env,chatId,days,FREE_PERIOD_HORIZON_DAYS);
let answer=found
?`🏖️ أقرب فترة فاضية لمدة ${days} أيام:
من ${formatArabicDate(found.start)}
لحد ${formatArabicDate(found.end)}

الفترة دي مفيهاش التزامات حاجزة عندك.`
:`مش لاقي فترة فاضية ${days} أيام كاملة خلال الـ${FREE_PERIOD_HORIZON_DAYS} يوم الجايين.`;
answer+=modelFooter(env,chatId,intent);
await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

if(intent.action==="find_free_slot"){
const profile=await getUserProfile(env,chatId);
const userNow=zonedNow(profile.timezone);
const found=await findFreeSlot(env,chatId,{
durationMinutes:clamp(Number(intent.slot_duration_minutes||60),5,1440),
startDate:validDate(intent.slot_start_date)?intent.slot_start_date:userNow.date,
endDate:validDate(intent.slot_end_date)?intent.slot_end_date:addDaysIso(userNow.date,FREE_SLOT_HORIZON_DAYS-1),
dayStart:validTime(intent.day_start)?intent.day_start:"08:00",
dayEnd:validTime(intent.day_end)?intent.day_end:"23:00"
});
let answer=found
?`🟢 أقرب وقت فاضي: ${formatArabicDate(found.date)} من ${formatArabicTime(found.start)} لحد ${formatArabicTime(found.end)}.`
:"مش لاقي فترة فاضية بالمواصفات دي في النطاق المطلوب.";
answer+=modelFooter(env,chatId,intent);
await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

if(intent.action==="delete"){
if(!intent.target_id)throw new Error("محتاج أعرف أنهي موعد تقصد.");
if(intent.target_type==="recurring")await deleteScheduleRule(env,chatId,intent.target_id,intent);
else await cancelReminder(env,chatId,intent.target_id,intent);
return;
}

if(intent.action==="update"){
await updateScheduleItem(env,chatId,intent,options);
return;
}

if(intent.action==="manage_rule"){
await manageScheduleRule(env,chatId,intent);
return;
}

if(intent.action==="search_schedule"){
const answer=await searchScheduleText(env,chatId,intent);
const final=answer+modelFooter(env,chatId,intent);
await sendText(env,chatId,final,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",final);
return;
}

if(intent.action==="bulk_shift"){
const plan=await planBulkShift(env,chatId,intent);

if(!plan.total){
const answer=`ملقتش مواعيد مطابقة أقدر أحرّكها.${modelFooter(env,chatId,intent)}`;
await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

if(!options.skipConflictCheck&&plan.conflicts.length){
await presentConflictWarning(env,chatId,intent,plan.conflicts,{actionLabel:"تحريك المواعيد"});
return;
}

const result=await applyBulkShift(env,chatId,plan);
const direction=intent.shift_minutes<0?"قدمت":"أخرت";
const answer=`✅ ${direction} ${result.changed} موعد بمقدار ${formatMinutes(Math.abs(intent.shift_minutes))}.${result.overrides?` (${result.overrides} استثناء من تكرارات اتحول لموعد مستقل)`:""}${modelFooter(env,chatId,intent)}`;

await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

if(intent.action==="bulk_delete"){
if(!options.confirmed){
await savePendingConflict(env,chatId,intent,[]);
const label=intent.query?`المواعيد المطابقة لـ «${intent.query}»`:"المواعيد في الفترة المطلوبة";
const answer=`⚠️ أنت على وشك حذف ${label}. متأكد؟`;
await sendText(env,chatId,answer,{
inline_keyboard:[
[{text:"✅ نفّذ الحذف",callback_data:"bulk:confirm"}],
[{text:"❌ إلغاء",callback_data:"bulk:cancel"}]
]
});
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

const result=await bulkDeleteSchedule(env,chatId,intent);
const answer=`🗑️ تم الحذف. مواعيد عادية: ${result.oneTime}، تكرارات محذوفة: ${result.rulesDeleted}، استثناءات تكرار: ${result.ruleExceptions}.${modelFooter(env,chatId,intent)}`;
await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

if(intent.action==="clear_all"){
const answer="⚠️ متأكد إنك عايز تمسح كل مواعيدك وكل التكرارات؟";
await sendText(env,chatId,answer,{
inline_keyboard:[
[{text:"✅ امسح كل مواعيدي",callback_data:"do:clear_all_user_schedule"}],
[{text:"↩️ إلغاء",callback_data:"panel:home"}]
]
});
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

const answer=`${String(intent.reply||"معاك 👌").trim()}${modelFooter(env,chatId,intent)}`;
await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
}

async function updateScheduleItem(env,chatId,intent,options={}){
const id=Number(intent.target_id||0);
if(!id)throw new Error("رقم الموعد غير صالح.");

if(intent.target_type==="recurring"){
const current=await env.DB.prepare(`SELECT * FROM schedule_rules WHERE id=? AND chat_id=? LIMIT 1`).bind(id,chatId).first();
if(!current)throw new Error(`مش لاقي التكرار المطلوب.`);

const oldRule=rowToScheduleRule(current);
const patch=intent.recurring_update||{};

const ruleTz=String(current.timezone||intent._timezone||TIME_ZONE);
const next={
title:patch.title!=null?String(patch.title).trim().slice(0,500):current.title,
kind:patch.kind==="appointment"?"appointment":patch.kind==="reminder"?"reminder":current.kind,
duration_minutes:patch.duration_minutes!=null?sanitizeDuration(patch.duration_minutes):Number(current.duration_minutes||0),
advance_alerts:Array.isArray(patch.advance_alerts)?sanitizeAdvanceAlerts(patch.advance_alerts):sanitizeAdvanceAlerts(parseJsonArray(current.advance_alerts_json)),
timezone:ruleTz,
schedule:patch.schedule?normalizeUniversalSchedule(patch.schedule,ruleTz):oldRule.schedule
};

validateScheduleItem(next);

if(!options.skipConflictCheck){
const conflicts=await findRecurringCandidateConflicts(env,chatId,next,{ignoreRecurringId:id});
if(conflicts.length){
await presentConflictWarning(env,chatId,intent,conflicts,{actionLabel:"تعديل الموعد"});
return;
}
}

await env.DB.prepare(`UPDATE schedule_rules
SET title=?,kind=?,rule_json=?,duration_minutes=?,start_at=?,end_at=?,max_occurrences=?,advance_alerts_json=?,updated_at=?
WHERE id=? AND chat_id=?`)
.bind(next.title,next.kind,JSON.stringify(next.schedule),next.duration_minutes,next.schedule.start_at,next.schedule.end_at,next.schedule.max_occurrences,JSON.stringify(next.advance_alerts),new Date().toISOString(),id,chatId)
.run();

const answer=`✅ عدلت التكرار:
${formatUniversalRule(next.schedule)}${next.duration_minutes?` · مدة ${formatMinutes(next.duration_minutes)}`:""} — ${next.title}${modelFooter(env,chatId,intent)}`;

await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

const current=await env.DB.prepare(`SELECT * FROM reminders WHERE id=? AND chat_id=? AND cancelled=0 AND sent=0 LIMIT 1`).bind(id,chatId).first();
if(!current)throw new Error(`مش لاقي الموعد المطلوب أو الموعد خلص بالفعل.`);

const p=intent.one_time_update||{};
const next={
title:p.title!=null?String(p.title).trim().slice(0,500):current.title,
kind:p.kind==="appointment"?"appointment":p.kind==="reminder"?"reminder":current.kind,
date:validDate(p.date)?p.date:current.local_date,
time:validTime(p.time)?p.time:current.local_time,
timezone:String(current.timezone||intent._timezone||TIME_ZONE),
duration_minutes:p.duration_minutes!=null?sanitizeDuration(p.duration_minutes):Number(current.duration_minutes||0),
advance_alerts:Array.isArray(p.advance_alerts)?sanitizeAdvanceAlerts(p.advance_alerts):sanitizeAdvanceAlerts(parseJsonArray(current.advance_alerts_json))
};

if(!next.title||isPastLocal(next.date,next.time,String(current.timezone||intent._timezone||TIME_ZONE))){
throw new Error("التعديل غير صالح أو هيخلي الموعد في الماضي.");
}

if(!options.skipConflictCheck){
const conflicts=await findOneTimeCandidateConflicts(env,chatId,next,{ignoreOneTimeId:id});
if(conflicts.length){
await presentConflictWarning(env,chatId,intent,conflicts,{actionLabel:"تعديل الموعد"});
return;
}
}

await env.DB.prepare(`UPDATE reminders
SET title=?,kind=?,local_date=?,local_time=?,duration_minutes=?,advance_alerts_json=?,updated_at=?
WHERE id=? AND chat_id=?`)
.bind(next.title,next.kind,next.date,next.time,next.duration_minutes,JSON.stringify(next.advance_alerts),new Date().toISOString(),id,chatId)
.run();

const answer=`✅ عدلت الموعد:
${formatEventWhen(next.date,next.time,next.duration_minutes,next.timezone||intent._timezone||TIME_ZONE)} — ${next.title}${modelFooter(env,chatId,intent)}`;

await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
}

async function manageScheduleRule(env,chatId,intent){
const id=Number(intent.target_id||0);
if(!id)throw new Error("محتاج أعرف أنهي تكرار تقصد.");
const row=await env.DB.prepare(`SELECT * FROM schedule_rules WHERE id=? AND chat_id=? LIMIT 1`).bind(id,chatId).first();
if(!row)throw new Error(`مش لاقي التكرار المطلوب.`);
const profile=await getUserProfile(env,chatId);
const tz=String(row.timezone||profile.timezone||TIME_ZONE);
const op=String(intent.manage_operation||"");
let answer="";
if(op==="pause"){
const until=validLocalDateTime(intent.pause_until)?intent.pause_until:addMinutesLocal(localNowString(tz),1440,tz);
await env.DB.prepare(`UPDATE schedule_rules SET paused_until=?,updated_at=? WHERE id=? AND chat_id=?`).bind(until,new Date().toISOString(),id,chatId).run();
answer=`⏸️ وقفت «${row.title}» مؤقتًا لحد ${formatLocalDateTime(until)}.`;
}
else if(op==="resume"){
await env.DB.prepare(`UPDATE schedule_rules SET paused_until=NULL,active=1,updated_at=? WHERE id=? AND chat_id=?`).bind(new Date().toISOString(),id,chatId).run();
answer=`▶️ شغلت «${row.title}» تاني.`;
}
else if(op==="skip_next"){
const next=getNextRuleOccurrence(row,localNowString(tz),MAX_RULE_OCCURRENCES);
if(!next)throw new Error("مفيش تكرار جاي أقدر أتخطاه.");
const ex=[...new Set([...parseJsonArray(row.exceptions_json),next])];
await env.DB.prepare(`UPDATE schedule_rules SET exceptions_json=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(ex),new Date().toISOString(),id,chatId).run();
answer=`⏭️ تمام، تخطيت المرة الجاية من «${row.title}»: ${formatLocalDateTime(next)}.`;
}
else if(op==="add_exception"){
const exValue=String(intent.exception||"").trim();
if(!validDate(exValue)&&!validLocalDateTime(exValue))throw new Error("الاستثناء لازم يكون تاريخ أو تاريخ ووقت واضح.");
const ex=[...new Set([...parseJsonArray(row.exceptions_json),exValue])];
await env.DB.prepare(`UPDATE schedule_rules SET exceptions_json=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(ex),new Date().toISOString(),id,chatId).run();
answer=`🚫 أضفت الاستثناء لـ«${row.title}»: ${exValue}.`;
}
else throw new Error("عملية إدارة التكرار غير معروفة.");
answer+=modelFooter(env,chatId,intent);
await sendText(env,chatId,answer,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",answer);
}

async function handleCallbackQuery(query,env){
const callbackId=String(query?.id||"");
const data=String(query?.data||"");
const chatId=String(query?.message?.chat?.id??query?.from?.id??"");
const messageId=Number(query?.message?.message_id||0);

if(!chatId)return;
if(callbackId)await answerCallback(env,callbackId);

try{
if(!isPublicMode(env)&&!isAdmin(env,chatId)){
await sendText(env,chatId,"⛔ البوت غير متاح للعامة حاليًا.");
return;
}

if(data==="panel:home")return showMainPanel(env,chatId,messageId);
if(data==="panel:list")return sendAllSchedule(env,chatId,messageId);
if(data==="panel:today")return sendScheduleList(env,chatId,"today",messageId);
if(data==="panel:week")return sendScheduleList(env,chatId,"week",messageId);
if(data==="panel:month")return sendScheduleList(env,chatId,"month",messageId);
if(data==="panel:recurring")return showRecurringRules(env,chatId,messageId);

if(data==="panel:models"){
if(!isAdmin(env,chatId))return answerCallback(env,callbackId,"للأدمن فقط",true);
return showModelStatsPanel(env,chatId,messageId);
}

if(data==="conflict:force"){
const pending=await getPendingConflict(env,chatId);
if(!pending)return editOrSend(env,chatId,messageId,"⌛ قرار التعارض انتهت مدته. ابعت الطلب من جديد.",mainMenuKeyboard(env,chatId));

const intent=parseJsonObject(pending.intent_json);
await clearPendingConflict(env,chatId);
if(!intent?.action)throw new Error("بيانات التعارض غير صالحة.");

await editOrSend(env,chatId,messageId,"✅ تمام، وافقت على التنفيذ رغم التعارض.",quickMenuKeyboard());
return executeIntent(env,chatId,intent,{skipConflictCheck:true});
}

if(data==="conflict:cancel"){
await clearPendingConflict(env,chatId);
return editOrSend(env,chatId,messageId,"✅ تم إلغاء العملية المتعارضة.",mainMenuKeyboard(env,chatId));
}

if(data==="bulk:confirm"){
const pending=await getPendingConflict(env,chatId);
if(!pending)return editOrSend(env,chatId,messageId,"⌛ طلب الحذف انتهت مدته. ابعته من جديد.",mainMenuKeyboard(env,chatId));

const intent=parseJsonObject(pending.intent_json);
await clearPendingConflict(env,chatId);

if(intent.action!=="bulk_delete")throw new Error("طلب الحذف المعلّق غير صالح.");

await editOrSend(env,chatId,messageId,"⏳ جاري تنفيذ الحذف...",quickMenuKeyboard());
return executeIntent(env,chatId,intent,{confirmed:true});
}

if(data==="bulk:cancel"){
await clearPendingConflict(env,chatId);
return editOrSend(env,chatId,messageId,"✅ تم إلغاء الحذف.",mainMenuKeyboard(env,chatId));
}

if(data==="confirm:clear_all"){
return editOrSend(env,chatId,messageId,"⚠️ تمسح كل مواعيدك وكل التكرارات؟",{
inline_keyboard:[
[{text:"✅ امسح الكل",callback_data:"do:clear_all_user_schedule"}],
[{text:"↩️ إلغاء",callback_data:"panel:home"}]
]
});
}

if(data==="do:clear_all_user_schedule"){
const res=await env.DB.batch([
env.DB.prepare(`DELETE FROM reminder_fires WHERE chat_id=?`).bind(chatId),
env.DB.prepare(`DELETE FROM schedule_fires WHERE chat_id=?`).bind(chatId),
env.DB.prepare(`DELETE FROM prayer_rule_fires WHERE chat_id=?`).bind(chatId),
env.DB.prepare(`DELETE FROM reminders WHERE chat_id=?`).bind(chatId),
env.DB.prepare(`DELETE FROM schedule_rules WHERE chat_id=?`).bind(chatId),
env.DB.prepare(`DELETE FROM prayer_rules WHERE chat_id=?`).bind(chatId),
env.DB.prepare(`DELETE FROM pending_dialogs WHERE chat_id=?`).bind(chatId),
env.DB.prepare(`DELETE FROM pending_conflicts WHERE chat_id=?`).bind(chatId)
]);
const n=Number(res?.[3]?.meta?.changes||0)+Number(res?.[4]?.meta?.changes||0)+Number(res?.[5]?.meta?.changes||0);
return editOrSend(env,chatId,messageId,`✅ تم مسح كل مواعيدك وكل التكرارات بما فيها التذكيرات المرتبطة بالصلاة.
🗑️ المحذوف: ${n}`,mainMenuKeyboard(env,chatId));
}

if(data==="confirm:clear_memory"){
return editOrSend(env,chatId,messageId,"⚠️ تمسح سياق المحادثة؟ المواعيد نفسها مش هتتمسح.",{
inline_keyboard:[
[{text:"✅ امسح السياق",callback_data:"do:clear_memory"}],
[{text:"↩️ إلغاء",callback_data:"panel:home"}]
]
});
}

if(data==="do:clear_memory"){
await clearConversation(env,chatId);
await clearPendingDialog(env,chatId);
await clearPendingConflict(env,chatId);
return editOrSend(env,chatId,messageId,"✅ تم مسح سياق المحادثة. مواعيدك زي ما هي.",mainMenuKeyboard(env,chatId));
}

if(data==="clarify:period:am"||data==="clarify:period:pm"){
const pending=await getPendingDialog(env,chatId);
if(!pending)return sendText(env,chatId,"مفيش سؤال توضيح معلّق حاليًا.",quickMenuKeyboard());

const multi=pending.question_type==="meridiem_multi";
const pm=data.endsWith(":pm");
const reply=pm?(multi?"كلهم مساء":"مساء"):(multi?"كلهم صباح":"صباح");

const history=await getRecentConversation(env,chatId,CONVERSATION_MEMORY_LIMIT);
await saveConversationMessage(env,chatId,"user",reply);
return resolvePendingDialog(env,chatId,pending,reply,history);
}

if(data==="pending:cancel"){
await clearPendingDialog(env,chatId);
await clearPendingConflict(env,chatId);
return editOrSend(env,chatId,messageId,"✅ تم إلغاء الطلب المعلّق.",mainMenuKeyboard(env,chatId));
}

if(data.startsWith("confirm:delete:one:")){
const id=Number(data.split(":")[3]||0);
if(!id)return;

return editOrSend(env,chatId,messageId,"⚠️ متأكد إنك عايز تمسح الموعد ده؟",{
inline_keyboard:[
[{text:"✅ امسح الموعد",callback_data:`do:delete:one:${id}`}],
[{text:"↩️ رجوع",callback_data:"panel:list"}]
]
});
}

if(data.startsWith("do:delete:one:")){
const id=Number(data.split(":")[3]||0);
if(!id)return;
await env.DB.prepare(`DELETE FROM reminders WHERE id=? AND chat_id=?`).bind(id,chatId).run();
return sendAllSchedule(env,chatId,messageId);
}

if(data.startsWith("confirm:delete:rule:")){
const id=Number(data.split(":")[3]||0);
if(!id)return;

return editOrSend(env,chatId,messageId,"⚠️ متأكد إنك عايز تمسح التكرار ده بالكامل؟",{
inline_keyboard:[
[{text:"✅ امسح التكرار",callback_data:`do:delete:rule:${id}`}],
[{text:"↩️ رجوع",callback_data:"panel:recurring"}]
]
});
}

if(data.startsWith("do:delete:rule:")){
const id=Number(data.split(":")[3]||0);
if(!id)return;
await env.DB.batch([
env.DB.prepare(`DELETE FROM schedule_fires WHERE rule_id=? AND chat_id=?`).bind(id,chatId),
env.DB.prepare(`DELETE FROM schedule_rules WHERE id=? AND chat_id=?`).bind(id,chatId)
]);
return showRecurringRules(env,chatId,messageId);
}

if(data.startsWith("rule:toggle:")){
const id=Number(data.split(":")[2]||0);
await env.DB.prepare(`UPDATE schedule_rules SET active=CASE active WHEN 1 THEN 0 ELSE 1 END,updated_at=? WHERE id=? AND chat_id=?`).bind(new Date().toISOString(),id,chatId).run();
return showRecurringRules(env,chatId,messageId);
}

if(data.startsWith("rule:skip:")){
const id=Number(data.split(":")[2]||0);
const row=await env.DB.prepare(`SELECT * FROM schedule_rules WHERE id=? AND chat_id=? LIMIT 1`).bind(id,chatId).first();
if(!row)return;

const tz=String(row.timezone||(await getUserProfile(env,chatId)).timezone||TIME_ZONE);
const next=getNextRuleOccurrence(row,localNowString(tz),MAX_RULE_OCCURRENCES);
if(!next)return answerCallback(env,callbackId,"مفيش مرة جاية",true);

const ex=[...new Set([...parseJsonArray(row.exceptions_json),next])];

await env.DB.prepare(`UPDATE schedule_rules SET exceptions_json=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(ex),new Date().toISOString(),id,chatId).run();

await answerCallback(env,callbackId,"تم تخطي المرة الجاية ✅",false);
return showRecurringRules(env,chatId,messageId);
}

if(data.startsWith("rule:pause1d:")){
const id=Number(data.split(":")[2]||0);
const row=await env.DB.prepare(`SELECT timezone FROM schedule_rules WHERE id=? AND chat_id=? LIMIT 1`).bind(id,chatId).first();
if(!row)return;
const tz=String(row.timezone||(await getUserProfile(env,chatId)).timezone||TIME_ZONE);
const until=addMinutesLocal(localNowString(tz),1440,tz);
await env.DB.prepare(`UPDATE schedule_rules SET paused_until=?,updated_at=? WHERE id=? AND chat_id=?`).bind(until,new Date().toISOString(),id,chatId).run();
return showRecurringRules(env,chatId,messageId);
}

if(data.startsWith("rule:resume:")){
const id=Number(data.split(":")[2]||0);

await env.DB.prepare(`UPDATE schedule_rules SET paused_until=NULL,active=1,updated_at=? WHERE id=? AND chat_id=?`).bind(new Date().toISOString(),id,chatId).run();

return showRecurringRules(env,chatId,messageId);
}

if(data.startsWith("rem:done:")){
return editOrSend(env,chatId,messageId,"✅ تم تنفيذ التذكير.",quickMenuKeyboard());
}

if(data.startsWith("rem:s10:")||data.startsWith("rem:s60:")){
const p=data.split(":");
const mins=p[1]==="s10"?10:60;
const id=Number(p[2]||0);

const r=await env.DB.prepare(`SELECT * FROM reminders WHERE id=? AND chat_id=? LIMIT 1`).bind(id,chatId).first();
if(!r)return;

const tz=String(r.timezone||(await getUserProfile(env,chatId)).timezone||TIME_ZONE);
const at=addMinutesLocal(localNowString(tz),mins,tz);
const[date,time]=splitLocalDateTime(at);

await insertOneTimeDirect(env,chatId,{
title:r.title,
kind:r.kind,
date,
time,
timezone:tz,
duration_minutes:Number(r.duration_minutes||0),
advance_alerts:[]
});

return editOrSend(env,chatId,messageId,`⏰ تمام، هفكرك تاني بعد ${mins} دقيقة.`,quickMenuKeyboard());
}

if(data.startsWith("occ:done:")){
return editOrSend(env,chatId,messageId,"✅ تم تنفيذ التذكير المتكرر.",quickMenuKeyboard());
}

if(data.startsWith("occ:s10:")||data.startsWith("occ:s60:")){
const p=data.split(":");
const mins=p[1]==="s10"?10:60;
const id=Number(p[2]||0);

const r=await env.DB.prepare(`SELECT * FROM schedule_rules WHERE id=? AND chat_id=? LIMIT 1`).bind(id,chatId).first();
if(!r)return;

const tz=String(r.timezone||(await getUserProfile(env,chatId)).timezone||TIME_ZONE);
const at=addMinutesLocal(localNowString(tz),mins,tz);
const[date,time]=splitLocalDateTime(at);

await insertOneTimeDirect(env,chatId,{
title:r.title,
kind:r.kind,
date,
time,
timezone:tz,
duration_minutes:Number(r.duration_minutes||0),
advance_alerts:[]
});

return editOrSend(env,chatId,messageId,`⏰ تمام، هفكرك تاني بعد ${mins} دقيقة.`,quickMenuKeyboard());
}

if(data.startsWith("prayer:toggle:")){
const id=Number(data.split(":")[2]||0);
await env.DB.prepare(`UPDATE prayer_rules SET active=CASE active WHEN 1 THEN 0 ELSE 1 END,updated_at=? WHERE id=? AND chat_id=?`).bind(new Date().toISOString(),id,chatId).run();
return showRecurringRules(env,chatId,messageId);
}

if(data.startsWith("prayer:delete:")){
const id=Number(data.split(":")[2]||0);
await env.DB.batch([
env.DB.prepare(`DELETE FROM prayer_rule_fires WHERE rule_id=? AND chat_id=?`).bind(id,chatId),
env.DB.prepare(`DELETE FROM prayer_rules WHERE id=? AND chat_id=?`).bind(id,chatId)
]);
return showRecurringRules(env,chatId,messageId);
}

if(data.startsWith("prayer:skip:")){
const id=Number(data.split(":")[2]||0);
const r=await env.DB.prepare(`SELECT * FROM prayer_rules WHERE id=? AND chat_id=? LIMIT 1`).bind(id,chatId).first();
if(!r)return;

const profile=await getUserProfile(env,chatId);
const today=zonedNow(profile.timezone).date;
const next=await nextPrayerRuleDate(r,today);

const ex=[...new Set([...parseJsonArray(r.exceptions_json),next].filter(Boolean))];

await env.DB.prepare(`UPDATE prayer_rules SET exceptions_json=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(ex),new Date().toISOString(),id,chatId).run();

await answerCallback(env,callbackId,"تم تخطي المرة الجاية ✅");
return showRecurringRules(env,chatId,messageId);
}

if(data==="confirm:reset_stats"){
if(!isAdmin(env,chatId))return;

return editOrSend(env,chatId,messageId,"⚠️ تصفّر إحصائيات الموديلات؟",{
inline_keyboard:[
[{text:"✅ صفّر الإحصائيات",callback_data:"do:reset_stats"}],
[{text:"↩️ إلغاء",callback_data:"panel:models"}]
]
});
}

if(data==="do:reset_stats"){
if(!isAdmin(env,chatId))return;

await env.DB.prepare(`DELETE FROM model_stats`).run();

return editOrSend(env,chatId,messageId,"✅ تم تصفير إحصائيات الموديلات.",{
inline_keyboard:[
[{text:"🧠 عرض الموديلات",callback_data:"panel:models"}],
[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]
]
});
}

return showMainPanel(env,chatId,messageId);
}catch(error){
console.error("Callback error:",data,error);
await sendText(env,chatId,`⚠️ حصل خطأ: ${safeError(error)}`,quickMenuKeyboard());
}
}

async function sendScheduleList(env,chatId,range="upcoming",messageId=null,intent=null){
const profile=await getUserProfile(env,chatId);
const now=zonedNow(profile.timezone);
const bounds=rangeBounds(range,now);
const entries=await getScheduleEntries(env,chatId,bounds.start,bounds.end,1000);

const title=
range==="today"?"📍 مواعيد النهاردة":
range==="tomorrow"?"🌅 مواعيد بكرة":
range==="week"?"🗓️ جدول الـ7 أيام الجاية":
range==="month"?"🗓️ جدول الشهر الحالي":
"📅 المواعيد القادمة";

if(!entries.length){
const answer=`${title}

📭 مفيش مواعيد في الفترة دي.`;

await editOrSend(env,chatId,messageId,answer,{
inline_keyboard:[
[{text:"🔁 المتكررة",callback_data:"panel:recurring"}],
[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]
]
});

if(!messageId)await saveConversationMessage(env,chatId,"assistant",answer);
return;
}

const shown=entries.slice(0,15);
const lines=shown.map(e=>
`${e.source==="prayer"?"🕌":e.source==="recurring"?"🔁":e.kind==="appointment"?"📅":"⏰"} ${formatEventWhen(e.date,e.time,e.duration_minutes,e.timezone||TIME_ZONE)} — ${truncateText(e.title,90)}`
);

if(entries.length>shown.length){
lines.push(`… وفي ${entries.length-shown.length} موعد إضافي.`);
}

const kb=[];

for(const e of shown.filter(x=>x.source==="one_time").slice(0,9)){
kb.push([
{text:`🗑️ حذف ${truncateText(e.title,22)}`,callback_data:`confirm:delete:one:${e.id}`}
]);
}

kb.push(
[{text:"🔁 المتكررة",callback_data:"panel:recurring"}],
[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]
);

const answer=`${title}

${lines.join("\n")}`;

await editOrSend(env,chatId,messageId,answer,{inline_keyboard:kb});

if(!messageId){
await saveConversationMessage(env,chatId,"assistant",answer);
}
}

async function sendAllSchedule(env,chatId,messageId=null,intent=null){
const profile=await getUserProfile(env,chatId);
const now=zonedNow(profile.timezone);

const one=(await env.DB.prepare(`
SELECT * FROM reminders
WHERE chat_id=?
AND cancelled=0
AND sent=0
AND (local_date>? OR (local_date=? AND local_time>=?))
ORDER BY local_date,local_time,id
`).bind(chatId,now.date,now.date,now.time).all())?.results||[];

const rules=(await env.DB.prepare(`
SELECT * FROM schedule_rules
WHERE chat_id=?
ORDER BY active DESC,id
`).bind(chatId).all())?.results||[];

const pr=(await env.DB.prepare(`
SELECT * FROM prayer_rules
WHERE chat_id=?
ORDER BY active DESC,id
`).bind(chatId).all())?.results||[];

if(!one.length&&!rules.length&&!pr.length){
await editOrSend(env,chatId,messageId,"📅 كل مواعيدك\n\n📭 مفيش مواعيد أو تكرارات مسجلة.",mainMenuKeyboard(env,chatId));
return;
}

const lines=[
"📅 كل مواعيدك",
"",
`⏰ مواعيد غير متكررة: ${one.length}`
];

for(const r of one){
lines.push(
`${r.kind==="appointment"?"📅":"⏰"} ${formatEventWhen(r.local_date,r.local_time,Number(r.duration_minutes||0),String(r.timezone||TIME_ZONE))} — ${truncateText(r.title,110)}`
);
}

lines.push("",`🔁 التكرارات: ${rules.length+pr.length}`);

for(const r of rules){
const sr=rowToScheduleRule(r);

const status=
!r.active?"⏹️":
r.paused_until&&r.paused_until>localNowString(profile.timezone)?"⏸️":
"🟢";

lines.push(
`${status} ${formatUniversalRule(sr.schedule)}${Number(r.duration_minutes||0)?` · مدة ${formatMinutes(r.duration_minutes)}`:""} — ${truncateText(r.title,110)}`
);
}

for(const r of pr){
lines.push(
`${r.active?"🕌":"⏹️"} ${formatPrayerRule(r)} — ${truncateText(r.title,110)}`
);
}

const kb=[];

for(const r of one.slice(0,8)){
kb.push([
{text:`🗑️ حذف ${truncateText(r.title,22)}`,callback_data:`confirm:delete:one:${r.id}`}
]);
}

kb.push(
[{text:"🔁 إدارة التكرارات",callback_data:"panel:recurring"}],
[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]
);

await editOrSend(env,chatId,messageId,lines.join("\n"),{inline_keyboard:kb});
}

async function showRecurringRules(env,chatId,messageId=null){
const rows=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? ORDER BY active DESC,id`).bind(chatId).all())?.results||[];
const pr=(await env.DB.prepare(`SELECT * FROM prayer_rules WHERE chat_id=? ORDER BY active DESC,id`).bind(chatId).all())?.results||[];

if(!rows.length&&!pr.length){
return editOrSend(env,chatId,messageId,"🔁 مفيش تكرارات عندك حاليًا.",{
inline_keyboard:[
[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]
]
});
}

const lines=[];
const kb=[];

for(const r of rows.slice(0,20)){
const sr=rowToScheduleRule(r);
const paused=r.paused_until&&r.paused_until>localNowString(r.timezone||TIME_ZONE);

lines.push(
`${!r.active?"⏹️":paused?"⏸️":"🟢"} ${formatUniversalRule(sr.schedule)} — ${truncateText(r.title,85)}${paused?` · موقوف لحد ${formatLocalDateTime(r.paused_until)}`:""}`
);

kb.push([
{text:r.active?"⏹️ إيقاف":"▶️ تشغيل",callback_data:`rule:toggle:${r.id}`},
{text:"⏭️ تخطي",callback_data:`rule:skip:${r.id}`},
{text:"🗑️ حذف",callback_data:`confirm:delete:rule:${r.id}`}
]);
}

for(const r of pr.slice(0,10)){
lines.push(
`${r.active?"🕌":"⏹️"} ${formatPrayerRule(r)} — ${truncateText(r.title,85)}`
);

kb.push([
{text:r.active?"⏹️ إيقاف الصلاة":"▶️ تشغيل الصلاة",callback_data:`prayer:toggle:${r.id}`},
{text:"⏭️ تخطي",callback_data:`prayer:skip:${r.id}`},
{text:"🗑️ حذف",callback_data:`prayer:delete:${r.id}`}
]);
}

kb.push([
{text:"↩️ لوحة التحكم",callback_data:"panel:home"}
]);

return editOrSend(
env,
chatId,
messageId,
`🔁 التكرارات

${lines.join("\n")}`,
{inline_keyboard:kb}
);
}

async function getScheduleEntries(env,chatId,startDate,endDate,limit=1000){
const profile=await getUserProfile(env,chatId);const now=zonedNow(profile.timezone);const out=[];
const rangeStartMs=localDateTimeToEpoch(`${startDate} 00:00`,profile.timezone);const rangeEndMs=localDateTimeToEpoch(`${endDate} 23:59`,profile.timezone);const nowMs=Date.now()-60000;
const one=(await env.DB.prepare(`SELECT * FROM reminders WHERE chat_id=? AND cancelled=0 AND sent=0 AND local_date BETWEEN ? AND ? ORDER BY local_date,local_time,id`).bind(chatId,addDaysIso(startDate,-2),addDaysIso(endDate,2)).all())?.results||[];
for(const r of one){const rtz=String(r.timezone||profile.timezone);const ms=localDateTimeToEpoch(`${r.local_date} ${r.local_time}`,rtz);if(ms<rangeStartMs||ms>rangeEndMs||ms<nowMs)continue;const shown=epochToLocalDateTime(ms,profile.timezone);const[date,time]=splitLocalDateTime(shown);out.push({source:"one_time",id:Number(r.id),title:r.title,kind:r.kind,date,time,timezone:profile.timezone,duration_minutes:Number(r.duration_minutes||0)});}
const rules=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? AND active=1 ORDER BY id`).bind(chatId).all())?.results||[];
for(const row of rules){const rtz=String(row.timezone||profile.timezone);const rf=epochToLocalDateTime(rangeStartMs,rtz),rt=epochToLocalDateTime(rangeEndMs,rtz);for(const occ of generateRuleOccurrences(row,rf,rt,Math.max(limit,100))){if(isRuleOccurrenceExcluded(row,occ)||(row.paused_until&&occ<row.paused_until))continue;const ms=localDateTimeToEpoch(occ,rtz);if(ms<rangeStartMs||ms>rangeEndMs||ms<nowMs)continue;const shown=epochToLocalDateTime(ms,profile.timezone);const[date,time]=splitLocalDateTime(shown);out.push({source:"recurring",rule_id:Number(row.id),title:row.title,kind:row.kind,date,time,timezone:profile.timezone,duration_minutes:Number(row.duration_minutes||0),occurrence_key:occ});if(out.length>limit*2)break;}}
const prayerRules=(await env.DB.prepare(`SELECT * FROM prayer_rules WHERE chat_id=? AND active=1 AND start_date<=? AND (end_date IS NULL OR end_date>=?) ORDER BY id`).bind(chatId,endDate,startDate).all())?.results||[];
for(const r of prayerRules){const days=sanitizeWeekdays(parseJsonArray(r.weekdays_json));const exceptions=parseJsonArray(r.exceptions_json);for(const date of enumerateDates(startDate,endDate,400)){if(date<r.start_date||(r.end_date&&date>r.end_date)||exceptions.includes(date)||(days.length&&!days.includes(isoWeekday(date))))continue;let pd;try{pd=await fetchPrayerDay(env,profile,date);}catch{continue;}const pt=pd?.timings?.[r.prayer];if(!validTime(pt))continue;const occ=addMinutesLocal(`${date} ${pt}`,Number(r.offset_minutes||0),profile.timezone);const ms=localDateTimeToEpoch(occ,profile.timezone);if(ms<rangeStartMs||ms>rangeEndMs||ms<nowMs)continue;const[od,ot]=splitLocalDateTime(occ);out.push({source:"prayer",prayer_rule_id:Number(r.id),title:r.title,kind:"reminder",date:od,time:ot,timezone:profile.timezone,duration_minutes:0,occurrence_key:occ});if(out.length>limit*2)break;}if(out.length>limit*2)break;}
out.sort((a,b)=>localDateTimeToEpoch(`${a.date} ${a.time}`,a.timezone||profile.timezone)-localDateTimeToEpoch(`${b.date} ${b.time}`,b.timezone||profile.timezone));return out.slice(0,limit);
}

async function buildScheduleContext(env,chatId,days=365,queryText=""){
const profile=await getUserProfile(env,chatId);
const now=zonedNow(profile.timezone);
const end=addDaysIso(now.date,Math.max(1,days)-1);
const keywords=extractScheduleKeywords(queryText).slice(0,6);

const near=(await env.DB.prepare(`
SELECT * FROM reminders
WHERE chat_id=?
AND cancelled=0
AND sent=0
AND local_date BETWEEN ? AND ?
AND (local_date>? OR (local_date=? AND local_time>=?))
ORDER BY local_date,local_time,id
LIMIT ?
`).bind(
chatId,
now.date,
end,
now.date,
now.date,
now.time,
CONTEXT_NEAR_LIMIT
).all())?.results||[];

let relevant=[];

if(keywords.length){
const clauses=keywords.map(()=>`LOWER(title) LIKE ?`).join(" OR ");

relevant=(await env.DB.prepare(`
SELECT * FROM reminders
WHERE chat_id=?
AND cancelled=0
AND sent=0
AND (local_date>? OR (local_date=? AND local_time>=?))
AND (${clauses})
ORDER BY local_date,local_time,id
LIMIT ?
`).bind(
chatId,
now.date,
now.date,
now.time,
...keywords.map(k=>`%${k.toLowerCase()}%`),
CONTEXT_RELEVANT_LIMIT
).all())?.results||[];
}

const oneMap=new Map();

for(const r of [...relevant,...near]){
oneMap.set(Number(r.id),r);
}

const one=[...oneMap.values()].sort(
(a,b)=>`${a.local_date} ${a.local_time}`.localeCompare(`${b.local_date} ${b.local_time}`)
);

const baseRules=(await env.DB.prepare(`
SELECT * FROM schedule_rules
WHERE chat_id=?
ORDER BY active DESC,id
LIMIT ?
`).bind(chatId,CONTEXT_RULE_LIMIT).all())?.results||[];

let relevantRules=[];

if(keywords.length){
const clauses=keywords.map(()=>`LOWER(title) LIKE ?`).join(" OR ");

relevantRules=(await env.DB.prepare(`
SELECT * FROM schedule_rules
WHERE chat_id=?
AND (${clauses})
ORDER BY active DESC,id
LIMIT ?
`).bind(
chatId,
...keywords.map(k=>`%${k.toLowerCase()}%`),
CONTEXT_RELEVANT_LIMIT
).all())?.results||[];
}

const ruleMap=new Map();

for(const r of [...relevantRules,...baseRules]){
ruleMap.set(Number(r.id),r);
}

const rules=[...ruleMap.values()];

const totalOne=Number(
(await env.DB.prepare(`
SELECT COUNT(*) AS c
FROM reminders
WHERE chat_id=?
AND cancelled=0
AND sent=0
AND (local_date>? OR (local_date=? AND local_time>=?))
`).bind(chatId,now.date,now.date,now.time).first())?.c||0
);

const totalRules=Number(
(await env.DB.prepare(`
SELECT COUNT(*) AS c
FROM schedule_rules
WHERE chat_id=?
`).bind(chatId).first())?.c||0
);

const eventLines=one.map(e=>{
const endAt=addMinutesLocal(
`${e.local_date} ${e.local_time}`,
Number(e.duration_minutes||0),
String(e.timezone||profile.timezone||TIME_ZONE)
);

return`#${e.id} | ${e.local_date} ${e.local_time}${Number(e.duration_minutes||0)?` -> ${endAt} | duration=${e.duration_minutes}m`:""} | ${e.kind} | ${e.title}`;
});

const ruleLines=rules.map(r=>{
const sr=rowToScheduleRule(r);
const rtz=String(r.timezone||profile.timezone||TIME_ZONE);
const next=getNextRuleOccurrence(r,localNowString(rtz),500);

const status=
!r.active
?"inactive"
:r.paused_until&&r.paused_until>localNowString(rtz)
?`paused-until=${r.paused_until}`
:"active";

return`R${r.id} | ${status} | ${formatUniversalRule(sr.schedule)} | duration=${Number(r.duration_minutes||0)}m | next=${next||"none"} | ${r.kind} | ${r.title}`;
});

return[
`الوقت الحالي: ${now.date} ${now.time} (${now.weekday})`,
`إجمالي المواعيد القادمة: ${totalOne}`,
`إجمالي قواعد التكرار: ${totalRules}`,
"",
"المواعيد الأقرب/الأكثر صلة:",
eventLines.length?eventLines.join("\n"):"لا توجد مواعيد مناسبة للسياق.",
"",
"قواعد التكرار:",
ruleLines.length?ruleLines.join("\n"):"لا توجد قواعد تكرار."
].join("\n");
}

function rowToScheduleRule(row){
const timezone=String(row.timezone||TIME_ZONE);
const schedule=normalizeUniversalSchedule({
...parseJsonObject(row.rule_json),
start_at:row.start_at,
end_at:row.end_at,
max_occurrences:row.max_occurrences
},timezone);
return{
id:Number(row.id),
title:String(row.title||""),
kind:row.kind==="appointment"?"appointment":"reminder",
duration_minutes:Number(row.duration_minutes||0),
advance_alerts:sanitizeAdvanceAlerts(parseJsonArray(row.advance_alerts_json)),
timezone,
schedule
};
}

function normalizeUniversalSchedule(raw,timeZone=TIME_ZONE){
const now=localNowString(timeZone);
const x=raw&&typeof raw==="object"?raw:{};

const mode=["interval","calendar"].includes(String(x.mode||""))
?String(x.mode)
:"calendar";

const unit=[
"minutes",
"hours",
"days",
"weeks",
"months",
"years"
].includes(String(x.unit||""))
?String(x.unit)
:"days";

const every=clamp(
Math.trunc(Number(x.every||1)),
1,
100000
);

const startAt=validLocalDateTime(x.start_at)
?x.start_at
:now;

let endAt=
x.end_at==null||x.end_at===""
?null
:String(x.end_at);

if(endAt&&!validLocalDateTime(endAt)){
throw new Error("نهاية التكرار غير صالحة.");
}

if(endAt&&endAt<startAt){
throw new Error("نهاية التكرار قبل بدايته.");
}

const times=[
...new Set(
(Array.isArray(x.times)?x.times:[]).filter(validTime)
)
].sort();

const weekdays=sanitizeWeekdays(x.weekdays);
const monthdays=sanitizeMonthdaysExtended(x.monthdays);
const months=sanitizeMonths(x.months);
const ordinal_weekdays=sanitizeOrdinalWeekdays(x.ordinal_weekdays);
const exceptions=sanitizeExceptions(x.exceptions);

const max_occurrences=
x.max_occurrences==null||x.max_occurrences===""
?null
:clamp(
Math.trunc(Number(x.max_occurrences)),
1,
1000000
);

const window_minutes=
x.window_minutes==null||x.window_minutes===""
?null
:clamp(
Math.trunc(Number(x.window_minutes)),
1,
5256000
);

if(mode==="interval"&&["months","years"].includes(unit)){
return normalizeUniversalSchedule({
...x,
mode:"calendar",
unit,
every,
start_at:startAt,
end_at:endAt,
max_occurrences
},timeZone);
}

let normalizedMode=mode;
let normalizedUnit=unit;
let normalizedTimes=times;
let normalizedWeekdays=[...weekdays];
let normalizedMonthdays=[...monthdays];
let normalizedMonths=[...months];

const anchorDate=splitLocalDateTime(startAt)[0];

if(
normalizedMode==="calendar"&&
["minutes","hours"].includes(normalizedUnit)
){
normalizedMode="interval";
}

if(
normalizedMode==="calendar"&&
!normalizedTimes.length
){
normalizedTimes=[
splitLocalDateTime(startAt)[1]
];
}

if(
normalizedMode==="calendar"&&
normalizedUnit==="weeks"&&
!normalizedWeekdays.length
){
normalizedWeekdays=[
isoWeekday(anchorDate)
];
}

if(
normalizedMode==="calendar"&&
normalizedUnit==="months"&&
!normalizedMonthdays.length&&
!ordinal_weekdays.length&&
!normalizedWeekdays.length
){
normalizedMonthdays=[
Number(anchorDate.slice(8,10))
];
}

if(
normalizedMode==="calendar"&&
normalizedUnit==="years"
){
if(!normalizedMonths.length){
normalizedMonths=[
Number(anchorDate.slice(5,7))
];
}

if(
!normalizedMonthdays.length&&
!ordinal_weekdays.length&&
!normalizedWeekdays.length
){
normalizedMonthdays=[
Number(anchorDate.slice(8,10))
];
}
}

return{
mode:normalizedMode,
unit:normalizedUnit,
every,
times:normalizedTimes,
weekdays:normalizedWeekdays,
monthdays:normalizedMonthdays,
months:normalizedMonths,
ordinal_weekdays,
start_at:startAt,
end_at:endAt,
max_occurrences,
window_minutes,
exceptions
};
}

function validateScheduleItem(item){
if(!item?.title){
throw new Error("تكرار بدون عنوان.");
}

if(!item.schedule){
throw new Error("قاعدة التكرار ناقصة.");
}

const s=normalizeUniversalSchedule(item.schedule);

if(
s.mode==="calendar"&&
!s.times.length
){
throw new Error("التكرار التقويمي محتاج وقت.");
}

if(
s.mode==="interval"&&
!["minutes","hours","days","weeks"].includes(s.unit)
){
throw new Error("وحدة interval غير صالحة.");
}

if(!validLocalDateTime(s.start_at)){
throw new Error("بداية التكرار غير صالحة.");
}
}

function generateRuleOccurrences(
rowOrItem,
fromAt,
toAt,
limit=MAX_RULE_OCCURRENCES,
respectMax=true
){
if(
!validLocalDateTime(fromAt)||
!validLocalDateTime(toAt)||
toAt<fromAt
){
return[];
}

const raw=generateRuleOccurrencesRaw(
rowOrItem,
fromAt,
toAt,
limit
);

if(!respectMax){
return raw;
}

const isRow=
rowOrItem?.rule_json!=null;

const norm=
isRow
?rowToScheduleRule(rowOrItem)
:normalizeRecurringItem(rowOrItem);

const max=
norm?.schedule?.max_occurrences==null
?null
:Number(norm.schedule.max_occurrences);

if(!max||max<1){
return raw;
}

const s=norm.schedule;

const ex=new Set([
...(s.exceptions||[]),
...(isRow
?parseJsonArray(rowOrItem.exceptions_json)
:[]
)
]);

const paused=
isRow
?String(rowOrItem.paused_until||"")
:"";

const needed=Math.min(
MAX_RULE_OCCURRENCES,
Math.max(
max+ex.size+64,
max
)
);

const globalRaw=generateRuleOccurrencesRaw(
rowOrItem,
s.start_at,
toAt,
needed
);

const allowed=[];

for(const occ of globalRaw){
const date=splitLocalDateTime(occ)[0];

if(
ex.has(occ)||
ex.has(date)
){
continue;
}

if(
paused&&
occ<paused
){
continue;
}

allowed.push(occ);

if(
allowed.length>=max
){
break;
}
}

return allowed
.filter(
x=>x>=fromAt&&
x<=toAt
)
.slice(
0,
limit
);
}

function generateRuleOccurrencesRaw(
rowOrItem,
fromAt,
toAt,
limit=MAX_RULE_OCCURRENCES
){
if(
!validLocalDateTime(fromAt)||
!validLocalDateTime(toAt)||
toAt<fromAt
){
return[];
}

const row=
rowOrItem?.rule_json!=null
?rowOrItem
:null;

const item=
row
?rowToScheduleRule(row)
:{
schedule:normalizeUniversalSchedule(
rowOrItem.schedule||
rowOrItem
),
duration_minutes:Number(
rowOrItem.duration_minutes||0
),
timezone:String(
rowOrItem.timezone||
TIME_ZONE
)
};

const tz=String(
row?.timezone||
item.timezone||
TIME_ZONE
);

const s=item.schedule;

const start=s.start_at;

const end=
s.end_at&&
s.end_at<toAt
?s.end_at
:toAt;

const from=
fromAt>start
?fromAt
:start;

if(end<from){
return[];
}

const out=[];

if(
s.mode==="interval"&&
(
s.unit==="minutes"||
s.unit==="hours"
)
){
const step=
s.every*
(
s.unit==="hours"
?60
:1
);

const startMs=
localDateTimeToEpoch(
start,
tz
);

const fromMs=
localDateTimeToEpoch(
from,
tz
);

const endMs=
localDateTimeToEpoch(
end,
tz
);

const stepMs=
step*
60000;

let k=Math.max(
0,
Math.ceil(
(fromMs-startMs)/
stepMs-
1e-9
)
);

for(
;
out.length<limit;
k++
){
const ms=
startMs+
k*stepMs;

if(ms>endMs){
break;
}

const occ=
epochToLocalDateTime(
ms,
tz
);

if(
occ>=from&&
occ<=end
){
out.push(occ);
}
}

return out;
}

const[fromDate]=splitLocalDateTime(from);
const[endDate]=splitLocalDateTime(end);

const dates=enumerateDates(
fromDate,
endDate,
Math.min(
daysBetween(
fromDate,
endDate
)+2,
4000
)
);

const anchorDate=
splitLocalDateTime(start)[0];

const anchorTime=
splitLocalDateTime(start)[1];

for(const date of dates){
if(out.length>=limit){
break;
}

let dateMatches=false;

if(
s.mode==="interval"&&
(
s.unit==="days"||
s.unit==="weeks"
)
){
const stepDays=
s.every*
(
s.unit==="weeks"
?7
:1
);

const diff=
daysBetween(
anchorDate,
date
);

dateMatches=
diff>=0&&
diff%stepDays===0;

if(dateMatches){
const occ=
`${date} ${anchorTime}`;

if(
occ>=from&&
occ<=end
){
out.push(occ);
}
}

continue;
}

dateMatches=
calendarCadenceMatches(
s,
anchorDate,
date
)&&
calendarFiltersMatch(
s,
date
);

if(!dateMatches){
continue;
}

for(const time of s.times){
const occ=
`${date} ${time}`;

if(
occ>=from&&
occ<=end
){
out.push(occ);
}

if(
out.length>=limit
){
break;
}
}
}

return out.sort();
}

function calendarCadenceMatches(
s,
anchorDate,
date
){
if(date<anchorDate){
return false;
}

if(s.unit==="days"){
return daysBetween(
anchorDate,
date
)%s.every===0;
}

if(s.unit==="weeks"){
const a=
startOfIsoWeek(
anchorDate
);

const d=
startOfIsoWeek(
date
);

return Math.floor(
daysBetween(
a,
d
)/7
)%s.every===0;
}

if(s.unit==="months"){
return monthsBetween(
anchorDate,
date
)%s.every===0;
}

if(s.unit==="years"){
return(
Number(
date.slice(0,4)
)-
Number(
anchorDate.slice(0,4)
)
)%s.every===0;
}

return true;
}

function calendarFiltersMatch(
s,
date
){
const month=
Number(
date.slice(5,7)
);

const day=
Number(
date.slice(8,10)
);

const wd=
isoWeekday(date);

if(
s.months.length&&
!s.months.includes(month)
){
return false;
}

if(
s.weekdays.length&&
!s.weekdays.includes(wd)
){
return false;
}

if(s.monthdays.length){
const last=
lastDayNumber(date);

if(
!s.monthdays.some(
x=>
x===day||
(
x===-1&&
day===last
)
)
){
return false;
}
}

if(
s.ordinal_weekdays.length&&
!s.ordinal_weekdays.some(
x=>
ordinalWeekdayMatches(
date,
x.weekday,
x.ordinal
)
)
){
return false;
}

return true;
}

function isRuleOccurrenceExcluded(
row,
occ
){
const list=[
...parseJsonArray(
row.exceptions_json
),
...normalizeUniversalSchedule({
...parseJsonObject(
row.rule_json
),
start_at:row.start_at,
end_at:row.end_at,
max_occurrences:row.max_occurrences
},String(row.timezone||TIME_ZONE)).exceptions
];

const date=
splitLocalDateTime(
occ
)[0];

return(
list.includes(occ)||
list.includes(date)
);
}

function getNextRuleOccurrence(row,afterAt,limit=1000){
const tz=String(row?.timezone||TIME_ZONE);
const from=addMinutesLocal(afterAt,1,tz);
const to=addDaysLocalDateTime(from,3660);
const arr=generateRuleOccurrences(row,from,to,limit);
for(const occ of arr){
if(isRuleOccurrenceExcluded(row,occ))continue;
if(row.paused_until&&occ<row.paused_until)continue;
return occ;
}
return null;
}

function formatUniversalRule(schedule){
const s=
normalizeUniversalSchedule(
schedule
);

let core="";

if(s.mode==="interval"){
core=
`كل ${s.every} ${unitArabic(
s.unit,
s.every
)}`;

if(
["days","weeks"].includes(
s.unit
)
){
core+=
` الساعة ${formatArabicTime(
splitLocalDateTime(
s.start_at
)[1]
)}`;
}
}
else{
const cadence=
s.every===1
?unitCadenceArabic(
s.unit
)
:`كل ${s.every} ${unitArabic(
s.unit,
s.every
)}`;

core=cadence;

if(s.months.length){
core+=
` في ${s.months
.map(monthArabic)
.join(" و")}`;
}

if(s.monthdays.length){
core+=
` يوم ${s.monthdays
.map(
x=>
x===-1
?"آخر يوم"
:x
)
.join(" و")}`;
}

if(s.weekdays.length){
core+=
` (${s.weekdays
.map(weekdayArabic)
.join(" و")})`;
}

if(s.ordinal_weekdays.length){
core+=
` (${s.ordinal_weekdays
.map(
x=>
`${ordinalArabic(
x.ordinal
)} ${weekdayArabic(
x.weekday
)}`
)
.join(" و")})`;
}

if(s.times.length){
core+=
` الساعة ${s.times
.map(formatArabicTime)
.join(" و")}`;
}
}

if(
s.max_occurrences&&
s.window_minutes
){
core+=
` · ${s.max_occurrences} مرات خلال ${formatMinutes(
s.window_minutes
)}`;
}
else if(s.max_occurrences){
core+=
` · ${s.max_occurrences} مرات`;
}

if(
s.end_at&&
!s.window_minutes
){
core+=
` · لحد ${formatLocalDateTime(
s.end_at
)}`;
}

return core;
}

async function findFreePeriod(
env,
chatId,
durationDays,
horizonDays
){
const profile=
await getUserProfile(
env,
chatId
);

const now=
zonedNow(
profile.timezone
);

const start=
addDaysIso(
now.date,
1
);

const end=
addDaysIso(
start,
horizonDays-1
);

const busy=
new Set();

const one=(
await env.DB.prepare(`
SELECT * FROM reminders
WHERE chat_id=?
AND cancelled=0
AND sent=0
AND local_date BETWEEN ? AND ?
`)
.bind(
chatId,
addDaysIso(
start,
-7
),
end
)
.all()
)?.results||[];

for(const r of one){
const dur=
Number(
r.duration_minutes||0
);

if(
!isBlockingItem(
r.kind,
dur
)
){
continue;
}

const rs=
`${r.local_date} ${r.local_time}`;

{const rtz=String(r.timezone||profile.timezone);const rsMs=localDateTimeToEpoch(rs,rtz);const reMs=rsMs+Math.max(1,dur)*60000;markBusyDates(busy,epochToLocalDateTime(rsMs,profile.timezone),epochToLocalDateTime(reMs,profile.timezone),start,end,profile.timezone);}
}

const rules=(
await env.DB.prepare(`
SELECT * FROM schedule_rules
WHERE chat_id=?
AND active=1
AND kind='appointment'
AND start_at<=?
AND (end_at IS NULL OR end_at>=?)
`)
.bind(
chatId,
`${end} 23:59`,
addDaysLocalDateTime(
`${start} 00:00`,
-7
)
)
.all()
)?.results||[];

for(const r of rules){
const dur=
Number(
r.duration_minutes||0
);

for(
const occ of generateRuleOccurrences(
r,
addDaysLocalDateTime(
`${start} 00:00`,
-7
),
`${end} 23:59`,
MAX_RULE_OCCURRENCES
)
){
if(
isRuleOccurrenceExcluded(
r,
occ
)
){
continue;
}

if(
r.paused_until&&
occ<r.paused_until
){
continue;
}

{const rtz=String(r.timezone||profile.timezone);const osMs=localDateTimeToEpoch(occ,rtz);const oeMs=osMs+Math.max(1,dur)*60000;markBusyDates(busy,epochToLocalDateTime(osMs,profile.timezone),epochToLocalDateTime(oeMs,profile.timezone),start,end,profile.timezone);}
}
}

let streak=[];

for(
const d of enumerateDates(
start,
end,
horizonDays+2
)
){
if(!busy.has(d)){
streak.push(d);

if(
streak.length>=durationDays
){
return{
start:streak[0],
end:streak[
durationDays-1
]
};
}
}
else{
streak=[];
}
}

return null;
}

function markBusyDates(
set,
startAt,
endAt,
rangeStart,
rangeEnd,
timeZone=TIME_ZONE
){
const startDate=
splitLocalDateTime(
startAt
)[0];

const endDate=
splitLocalDateTime(
addMinutesLocal(
endAt,
-1,
timeZone
)
)[0];

for(
const d of enumerateDates(
startDate,
endDate,
40
)
){
if(
d>=rangeStart&&
d<=rangeEnd
){
set.add(d);
}
}
}

async function findFreeSlot(
env,
chatId,
opts
){
const profile=
await getUserProfile(
env,
chatId
);

const tz=
profile.timezone;

const duration=
opts.durationMinutes;

const now=
localNowString(
tz
);

for(
const date of enumerateDates(
opts.startDate,
opts.endDate,
400
)
){
let dayStart=
`${date} ${opts.dayStart}`;

const dayEnd=
`${date} ${opts.dayEnd}`;

if(
dayStart<now&&
date===
splitLocalDateTime(
now
)[0]
){
dayStart=now;
}

if(dayEnd<=dayStart){
continue;
}

const busy=
await getBusyIntervals(
env,
chatId,
dayStart,
dayEnd,
tz
);

let cursor=
localDateTimeToEpoch(
dayStart,
tz
);

const endMs=
localDateTimeToEpoch(
dayEnd,
tz
);

for(const b of busy){
const bStart=
localDateTimeToEpoch(
b.start,
tz
);

const bEnd=
localDateTimeToEpoch(
b.end,
tz
);

if(
bStart-cursor>=
duration*60000
){
const st=
epochToLocalDateTime(
cursor,
tz
);

const en=
epochToLocalDateTime(
cursor+
duration*60000,
tz
);

return{
date,
start:
splitLocalDateTime(
st
)[1],
end:
splitLocalDateTime(
en
)[1]
};
}

cursor=
Math.max(
cursor,
bEnd
);
}

if(
endMs-cursor>=
duration*60000
){
const st=
epochToLocalDateTime(
cursor,
tz
);

const en=
epochToLocalDateTime(
cursor+
duration*60000,
tz
);

return{
date,
start:
splitLocalDateTime(
st
)[1],
end:
splitLocalDateTime(
en
)[1]
};
}
}

return null;
}

async function getBusyIntervals(env,chatId,fromAt,toAt,userTimeZone=TIME_ZONE){
const busy=[];
const fromMs=localDateTimeToEpoch(fromAt,userTimeZone);const toMs=localDateTimeToEpoch(toAt,userTimeZone);
const fromDate=splitLocalDateTime(fromAt)[0];const toDate=splitLocalDateTime(toAt)[0];
const one=(await env.DB.prepare(`SELECT * FROM reminders WHERE chat_id=? AND cancelled=0 AND sent=0 AND local_date BETWEEN ? AND ?`).bind(chatId,addDaysIso(fromDate,-7),addDaysIso(toDate,7)).all())?.results||[];
for(const r of one){
const dur=Number(r.duration_minutes||0);if(!isBlockingItem(r.kind,dur))continue;
const rtz=String(r.timezone||userTimeZone);const rs=`${r.local_date} ${r.local_time}`;const rsMs=localDateTimeToEpoch(rs,rtz);const reMs=rsMs+Math.max(1,dur)*60000;
if(intervalsOverlapEpoch(rsMs,reMs,fromMs,toMs))busy.push({start:epochToLocalDateTime(Math.max(rsMs,fromMs),userTimeZone),end:epochToLocalDateTime(Math.min(reMs,toMs),userTimeZone),title:r.title});
}
const rules=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? AND active=1 AND (kind='appointment' OR duration_minutes>0)`).bind(chatId).all())?.results||[];
for(const r of rules){
const rtz=String(r.timezone||userTimeZone);const dur=Number(r.duration_minutes||0);const rf=epochToLocalDateTime(fromMs-Math.max(1440,dur)*60000,rtz);const rt=epochToLocalDateTime(toMs,rtz);
for(const occ of generateRuleOccurrences(r,rf,rt,MAX_RULE_OCCURRENCES)){
if(isRuleOccurrenceExcluded(r,occ)||(r.paused_until&&occ<r.paused_until))continue;
const osMs=localDateTimeToEpoch(occ,rtz);const oeMs=osMs+Math.max(1,dur)*60000;
if(intervalsOverlapEpoch(osMs,oeMs,fromMs,toMs))busy.push({start:epochToLocalDateTime(Math.max(osMs,fromMs),userTimeZone),end:epochToLocalDateTime(Math.min(oeMs,toMs),userTimeZone),title:r.title});
}
}
busy.sort((a,b)=>a.start.localeCompare(b.start));
const merged=[];
for(const b of busy){if(!merged.length||b.start>merged[merged.length-1].end)merged.push({...b});else if(b.end>merged[merged.length-1].end)merged[merged.length-1].end=b.end;}
return merged;
}


function eventStartLocal(item){
if(validLocalDateTime(item?.occurrence))return item.occurrence;
if(validDate(item?.date)&&validTime(item?.time))return`${item.date} ${item.time}`;
return"";
}
function eventTimeZone(item,fallback=TIME_ZONE){return String(item?.timezone||fallback||TIME_ZONE);}
function eventIntervalEpoch(item,fallback=TIME_ZONE){
const local=eventStartLocal(item);if(!local)return null;
const tz=eventTimeZone(item,fallback);
const startMs=localDateTimeToEpoch(local,tz);
const endMs=startMs+Math.max(1,Number(item?.duration_minutes||0))*60000;
return{startMs,endMs,tz,local};
}
function intervalsOverlapEpoch(aStartMs,aEndMs,bStartMs,bEndMs){return aStartMs<bEndMs&&bStartMs<aEndMs;}

async function findCreateConflicts(
env,
chatId,
intent
){
const out=[];

const items=
Array.isArray(
intent.items
)
?intent.items
:[];

const rules=
Array.isArray(
intent.recurring_items
)
?intent.recurring_items
:[];

for(
let i=0;
i<items.length;
i++
){
out.push(
...await findOneTimeCandidateConflicts(
env,
chatId,
items[i]
)
);

for(
let j=0;
j<i;
j++
){
if(
candidateIntervalsOverlap(
items[i],
items[j]
)
){
out.push(
makeConflict(
items[i],
items[j],
"new_one_time"
)
);
}
}
}

for(
let i=0;
i<rules.length;
i++
){
out.push(
...await findRecurringCandidateConflicts(
env,
chatId,
rules[i],
{
additionalOneTime:items,
additionalRecurring:
rules.slice(
0,
i
)
}
)
);
}

return dedupeConflicts(out);
}

async function findOneTimeCandidateConflicts(env,chatId,candidate,options={}){
const out=[];
const dur=Number(candidate.duration_minutes||0);
if(!isBlockingItem(candidate.kind,dur))return out;
const profile=await getUserProfile(env,chatId);
const ctz=String(candidate.timezone||profile.timezone||TIME_ZONE);
const cstart=`${candidate.date} ${candidate.time}`;
const cStartMs=localDateTimeToEpoch(cstart,ctz);
const cEndMs=cStartMs+Math.max(1,dur)*60000;
const startDate=addDaysIso(candidate.date,-7);
const endDate=addDaysIso(candidate.date,7);
const ignoreOne=new Set([...(Array.isArray(options.ignoreOneTimeIds)?options.ignoreOneTimeIds:[]),Number(options.ignoreOneTimeId||0)].map(Number).filter(Boolean));
const ignoreRules=new Set([...(Array.isArray(options.ignoreRecurringIds)?options.ignoreRecurringIds:[]),Number(options.ignoreRecurringId||0)].map(Number).filter(Boolean));
const rows=(await env.DB.prepare(`SELECT * FROM reminders WHERE chat_id=? AND cancelled=0 AND sent=0 AND local_date BETWEEN ? AND ?`).bind(chatId,startDate,endDate).all())?.results||[];
for(const r of rows){
if(ignoreOne.has(Number(r.id)))continue;
const rd=Number(r.duration_minutes||0);if(!isBlockingItem(r.kind,rd))continue;
const rtz=String(r.timezone||profile.timezone||TIME_ZONE);
const rs=`${r.local_date} ${r.local_time}`;
const rsMs=localDateTimeToEpoch(rs,rtz);const reMs=rsMs+Math.max(1,rd)*60000;
if(intervalsOverlapEpoch(cStartMs,cEndMs,rsMs,reMs)){
out.push({type:"existing_one_time",overlap_at:epochToLocalDateTime(Math.max(cStartMs,rsMs),ctz),candidate:{...candidate,timezone:ctz,source:"one_time"},existing:{source:"one_time",id:Number(r.id),title:r.title,kind:r.kind,date:r.local_date,time:r.local_time,timezone:rtz,duration_minutes:rd}});
}
}
const rules=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? AND active=1 AND (kind='appointment' OR duration_minutes>0)`).bind(chatId).all())?.results||[];
for(const r of rules){
if(ignoreRules.has(Number(r.id)))continue;
const rtz=String(r.timezone||profile.timezone||TIME_ZONE);
const rd=Number(r.duration_minutes||0);
const from=epochToLocalDateTime(cStartMs-Math.max(1440,rd)*60000,rtz);
const to=epochToLocalDateTime(cEndMs,rtz);
for(const occ of generateRuleOccurrences(r,from,to,500)){
if(isRuleOccurrenceExcluded(r,occ)||(r.paused_until&&occ<r.paused_until))continue;
const rsMs=localDateTimeToEpoch(occ,rtz);const reMs=rsMs+Math.max(1,rd)*60000;
if(intervalsOverlapEpoch(cStartMs,cEndMs,rsMs,reMs)){
out.push({type:"existing_recurring",overlap_at:epochToLocalDateTime(Math.max(cStartMs,rsMs),ctz),candidate:{...candidate,timezone:ctz,source:"one_time"},existing:{source:"recurring",id:Number(r.id),title:r.title,kind:r.kind,occurrence:occ,timezone:rtz,duration_minutes:rd}});
}
}
}
return dedupeConflicts(out);
}

async function findRecurringCandidateConflicts(env,chatId,candidate,options={}){
const out=[];
const profile=await getUserProfile(env,chatId);
const c=normalizeRecurringItem(candidate,candidate?.timezone||profile.timezone||TIME_ZONE);
if(!isBlockingItem(c.kind,c.duration_minutes))return out;
const ctz=c.timezone;
const now=localNowString(ctz);
const horizonEnd=c.schedule.end_at&&c.schedule.end_at<addDaysLocalDateTime(now,CONFLICT_LOOKAHEAD_DAYS)?c.schedule.end_at:addDaysLocalDateTime(now,CONFLICT_LOOKAHEAD_DAYS);
const occs=generateRuleOccurrences(c,c.schedule.start_at>now?c.schedule.start_at:now,horizonEnd,2000);
if(!occs.length)return out;
const cEpoch=occs.map(occ=>({occ,startMs:localDateTimeToEpoch(occ,ctz),endMs:localDateTimeToEpoch(occ,ctz)+Math.max(1,c.duration_minutes)*60000}));
const minMs=cEpoch[0].startMs;const maxMs=cEpoch[cEpoch.length-1].endMs;
const one=(await env.DB.prepare(`SELECT * FROM reminders WHERE chat_id=? AND cancelled=0 AND sent=0 AND local_date BETWEEN ? AND ?`).bind(chatId,addDaysIso(epochToLocalDateTime(minMs,profile.timezone).slice(0,10),-2),addDaysIso(epochToLocalDateTime(maxMs,profile.timezone).slice(0,10),2)).all())?.results||[];
for(const ce of cEpoch){
for(const r of one){
const rd=Number(r.duration_minutes||0);if(!isBlockingItem(r.kind,rd))continue;
const rtz=String(r.timezone||profile.timezone||TIME_ZONE);const rs=`${r.local_date} ${r.local_time}`;const rsMs=localDateTimeToEpoch(rs,rtz);const reMs=rsMs+Math.max(1,rd)*60000;
if(intervalsOverlapEpoch(ce.startMs,ce.endMs,rsMs,reMs))out.push({type:"recurring_vs_one_time",overlap_at:epochToLocalDateTime(Math.max(ce.startMs,rsMs),ctz),candidate:{source:"recurring",title:c.title,kind:c.kind,occurrence:ce.occ,timezone:ctz,duration_minutes:c.duration_minutes},existing:{source:"one_time",id:Number(r.id),title:r.title,kind:r.kind,date:r.local_date,time:r.local_time,timezone:rtz,duration_minutes:rd}});
if(out.length>=30)return dedupeConflicts(out);
}
}
const existingRules=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? AND active=1 AND (kind='appointment' OR duration_minutes>0)`).bind(chatId).all())?.results||[];
for(const r of existingRules){
if(Number(options.ignoreRecurringId||0)===Number(r.id))continue;
const rtz=String(r.timezone||profile.timezone||TIME_ZONE);const rd=Number(r.duration_minutes||0);
const rFrom=epochToLocalDateTime(minMs-Math.max(1,rd)*60000,rtz);const rTo=epochToLocalDateTime(maxMs,rtz);
const rocc=generateRuleOccurrences(r,rFrom,rTo,2000).filter(x=>!isRuleOccurrenceExcluded(r,x)&&!(r.paused_until&&x<r.paused_until)).map(occ=>({occ,startMs:localDateTimeToEpoch(occ,rtz),endMs:localDateTimeToEpoch(occ,rtz)+Math.max(1,rd)*60000}));
let j=0;
for(const ce of cEpoch){
while(j<rocc.length&&rocc[j].endMs<=ce.startMs)j++;
for(let k=j;k<rocc.length&&rocc[k].startMs<ce.endMs;k++)if(intervalsOverlapEpoch(ce.startMs,ce.endMs,rocc[k].startMs,rocc[k].endMs)){
out.push({type:"recurring_vs_recurring",overlap_at:epochToLocalDateTime(Math.max(ce.startMs,rocc[k].startMs),ctz),candidate:{source:"recurring",title:c.title,kind:c.kind,occurrence:ce.occ,timezone:ctz,duration_minutes:c.duration_minutes},existing:{source:"recurring",id:Number(r.id),title:r.title,kind:r.kind,occurrence:rocc[k].occ,timezone:rtz,duration_minutes:rd}});
if(out.length>=30)return dedupeConflicts(out);
}
}
}
for(const item of(options.additionalOneTime||[])){
for(const ce of cEpoch){
const local=epochToLocalDateTime(ce.startMs,ctz);const [date,time]=splitLocalDateTime(local);
if(candidateIntervalsOverlap({title:c.title,kind:c.kind,date,time,timezone:ctz,duration_minutes:c.duration_minutes},item))out.push(makeConflict({title:c.title,kind:c.kind,date,time,timezone:ctz,duration_minutes:c.duration_minutes},item,"new_one_time"));
if(out.length>=30)break;
}
}
for(const otherRaw of(options.additionalRecurring||[])){
const other=normalizeRecurringItem(otherRaw,otherRaw?.timezone||ctz);if(!isBlockingItem(other.kind,other.duration_minutes))continue;
const otz=other.timezone;const oFrom=epochToLocalDateTime(minMs,otz);const oTo=epochToLocalDateTime(maxMs,otz);
const oOccs=generateRuleOccurrences(other,oFrom,oTo,2000).map(occ=>({occ,startMs:localDateTimeToEpoch(occ,otz),endMs:localDateTimeToEpoch(occ,otz)+Math.max(1,other.duration_minutes)*60000}));
let j=0;
for(const ce of cEpoch){
while(j<oOccs.length&&oOccs[j].endMs<=ce.startMs)j++;
for(let k=j;k<oOccs.length&&oOccs[k].startMs<ce.endMs;k++)if(intervalsOverlapEpoch(ce.startMs,ce.endMs,oOccs[k].startMs,oOccs[k].endMs)){
out.push({type:"new_recurring_vs_new_recurring",overlap_at:epochToLocalDateTime(Math.max(ce.startMs,oOccs[k].startMs),ctz),candidate:{source:"recurring",title:c.title,occurrence:ce.occ,timezone:ctz},existing:{source:"new_recurring",title:other.title,occurrence:oOccs[k].occ,timezone:otz}});
if(out.length>=30)break;
}
if(out.length>=30)break;
}
}
return dedupeConflicts(out);
}

function normalizeRecurringItem(raw,timeZone=TIME_ZONE){
const item=raw||{};
const timezone=String(item.timezone||timeZone||TIME_ZONE);
return{
title:String(item.title||"").trim(),
kind:item.kind==="appointment"?"appointment":"reminder",
duration_minutes:sanitizeDuration(item.duration_minutes),
advance_alerts:sanitizeAdvanceAlerts(item.advance_alerts),
timezone,
schedule:normalizeUniversalSchedule(item.schedule||item,timezone)
};
}

function candidateIntervalsOverlap(a,b){
if(!isBlockingItem(a.kind,Number(a.duration_minutes||0))||!isBlockingItem(b.kind,Number(b.duration_minutes||0)))return false;
const ai=eventIntervalEpoch(a,a.timezone||b.timezone||TIME_ZONE);
const bi=eventIntervalEpoch(b,b.timezone||a.timezone||TIME_ZONE);
if(!ai||!bi)return false;
return intervalsOverlapEpoch(ai.startMs,ai.endMs,bi.startMs,bi.endMs);
}

function makeConflict(a,b,source="new_one_time"){
const ai=eventIntervalEpoch(a,a.timezone||b.timezone||TIME_ZONE);
const bi=eventIntervalEpoch(b,b.timezone||a.timezone||TIME_ZONE);
let overlapAt=`${a.date||""} ${a.time||""}`.trim();
if(ai&&bi)overlapAt=epochToLocalDateTime(Math.max(ai.startMs,bi.startMs),ai.tz);
return{type:"internal",overlap_at:overlapAt,candidate:{...a,source:"one_time"},existing:{...b,source}};
}

function isBlockingItem(
kind,
duration
){
return(
kind==="appointment"||
Number(
duration||0
)>0
);
}

function intervalsOverlap(
aStart,
aEnd,
bStart,
bEnd
){
return(
aStart<bEnd&&
bStart<aEnd
);
}

async function presentConflictWarning(
env,
chatId,
intent,
conflicts,
options={}
){
const clean=
dedupeConflicts(
conflicts
).slice(
0,
30
);

await savePendingConflict(
env,
chatId,
intent,
clean
);

const lines=
clean
.slice(
0,
8
)
.map(
(c,i)=>
`${i+1}) ${formatConflictLine(
c
)}`
);

if(clean.length>8){
lines.push(
`… وفي ${clean.length-8} تعارض إضافي.`
);
}

const answer=
`⚠️ فيه تعارض زمني، لذلك وقفت ${options.actionLabel||"التنفيذ"} ومفيش تغيير اتحفظ.

${lines.join("\n")}

التعارض بيتحسب من وقت البداية ومدة كل موعد، مش مجرد نفس الدقيقة. لو مقصود تقدر تنفذ رغم التعارض.${modelFooter(env,chatId,intent)}`;

await sendText(
env,
chatId,
answer,
{
inline_keyboard:[
[
{
text:"➕ نفذ رغم التعارض",
callback_data:
"conflict:force"
}
],
[
{
text:"❌ إلغاء العملية",
callback_data:
"conflict:cancel"
}
]
]
}
);

await saveConversationMessage(
env,
chatId,
"assistant",
answer
);
}

function formatConflictLine(c){
const at=
c.overlap_at||
c?.candidate?.occurrence||
`${c?.candidate?.date||""} ${c?.candidate?.time||""}`.trim();

const when=
validLocalDateTime(at)
?formatLocalDateTime(at)
:at;

const candidate=
truncateText(
c?.candidate?.title||
"الموعد الجديد",
55
);

const existing=
truncateText(
c?.existing?.title||
"موعد موجود",
55
);

return`${when?`${when} — `:""}«${candidate}» يتعارض مع «${existing}»`;
}

function dedupeConflicts(list){
const out=[];
const seen=
new Set();

for(
const c of(
Array.isArray(list)
?list
:[]
)
){
const key=[
c.type,
c.overlap_at,
c?.candidate?.title,
c?.existing?.source,
c?.existing?.id,
c?.existing?.title
].join("|");

if(!seen.has(key)){
seen.add(key);
out.push(c);
}
}

return out;
}

async function planBulkShift(
env,
chatId,
intent
){
const profile=
await getUserProfile(
env,
chatId
);

const tz=
profile.timezone;

const now=
zonedNow(tz);

const start=
validDate(
intent.range_start_date
)
?intent.range_start_date
:now.date;

const end=
validDate(
intent.range_end_date
)
?intent.range_end_date
:start;

const shift=
Number(
intent.shift_minutes||0
);

const q=
normalizeArabicLoose(
intent.query||""
);

const match=
title=>
!q||
normalizeArabicLoose(
title
).includes(q);

const oneUpdates=[];
const overrides=[];
const newCandidates=[];

const one=(
await env.DB.prepare(`
SELECT * FROM reminders
WHERE chat_id=?
AND cancelled=0
AND sent=0
AND local_date BETWEEN ? AND ?
ORDER BY local_date,local_time,id
`)
.bind(
chatId,
start,
end
)
.all()
)?.results||[];

for(
const r of one.slice(
0,
200
)
){
if(
!match(
r.title
)
){
continue;
}

const rtz=
String(
r.timezone||
tz
);

const newAt=
addMinutesLocal(
`${r.local_date} ${r.local_time}`,
shift,
rtz
);

if(
localDateTimeToEpoch(
newAt,
rtz
)<Date.now()
){
throw new Error(
`تحريك الموعد هيخليه في الماضي.`
);
}

const[date,time]=
splitLocalDateTime(
newAt
);

const candidate={
title:r.title,
kind:r.kind,
date,
time,
timezone:rtz,
duration_minutes:
Number(
r.duration_minutes||0
),
advance_alerts:
sanitizeAdvanceAlerts(
parseJsonArray(
r.advance_alerts_json
)
)
};

oneUpdates.push({
id:Number(r.id),
candidate
});

newCandidates.push({
...candidate,
_source:"one",
_source_id:
Number(r.id)
});
}

const rules=(
await env.DB.prepare(`
SELECT * FROM schedule_rules
WHERE chat_id=?
AND active=1
AND start_at<=?
AND (end_at IS NULL OR end_at>=?)
ORDER BY id
`)
.bind(
chatId,
`${end} 23:59`,
`${start} 00:00`
)
.all()
)?.results||[];

for(const r of rules){
if(
!match(
r.title
)
){
continue;
}

const rtz=
String(
r.timezone||
tz
);

for(
const occ of generateRuleOccurrences(
r,
`${start} 00:00`,
`${end} 23:59`,
500
)
){
if(
isRuleOccurrenceExcluded(
r,
occ
)||
(
r.paused_until&&
occ<r.paused_until
)
){
continue;
}

const newAt=
addMinutesLocal(
occ,
shift,
rtz
);

if(
localDateTimeToEpoch(
newAt,
rtz
)<Date.now()
){
throw new Error(
`تحريك التكرار هيخليه في الماضي.`
);
}

const[date,time]=
splitLocalDateTime(
newAt
);

const candidate={
title:r.title,
kind:r.kind,
date,
time,
timezone:rtz,
duration_minutes:
Number(
r.duration_minutes||0
),
advance_alerts:
sanitizeAdvanceAlerts(
parseJsonArray(
r.advance_alerts_json
)
)
};

overrides.push({
ruleId:Number(r.id),
oldOccurrence:occ,
candidate
});

newCandidates.push({
...candidate,
_source:"rule",
_source_id:
Number(r.id),
_old_occurrence:occ
});

if(
overrides.length>=200
){
break;
}
}

if(
overrides.length>=200
){
break;
}
}

const ignoreOneTimeIds=
oneUpdates.map(
x=>x.id
);

const ignoreRecurringIds=[
...new Set(
overrides.map(
x=>x.ruleId
)
)
];

const conflicts=[];

for(
let i=0;
i<newCandidates.length;
i++
){
const c=
newCandidates[i];

conflicts.push(
...await findOneTimeCandidateConflicts(
env,
chatId,
c,
{
ignoreOneTimeIds,
ignoreRecurringIds
}
)
);

for(
let j=0;
j<i;
j++
){
if(
candidateIntervalsOverlap(
c,
newCandidates[j]
)
){
conflicts.push(
makeConflict(
c,
newCandidates[j],
"new_one_time"
)
);
}
}
}

return{
oneUpdates,
overrides,
conflicts:
dedupeConflicts(
conflicts
),
total:
oneUpdates.length+
overrides.length
};
}

async function applyBulkShift(
env,
chatId,
plan
){
const nowIso=
new Date().toISOString();

const statements=[];

for(const x of plan.oneUpdates){
statements.push(
env.DB.prepare(`
UPDATE reminders
SET local_date=?,
local_time=?,
updated_at=?
WHERE id=? AND chat_id=?
`)
.bind(
x.candidate.date,
x.candidate.time,
nowIso,
x.id,
chatId
)
);
}

const byRule=
new Map();

for(const x of plan.overrides){
if(
!byRule.has(
x.ruleId
)
){
byRule.set(
x.ruleId,
[]
);
}

byRule
.get(
x.ruleId
)
.push(x);

statements.push(
env.DB.prepare(`
INSERT INTO reminders(
chat_id,
title,
kind,
local_date,
local_time,
sent,
cancelled,
created_at,
duration_minutes,
advance_alerts_json,
updated_at,
timezone
)
VALUES(
?,?,?,?,?,
0,
0,
?,?,?,?,?
)
`)
.bind(
chatId,
x.candidate.title,
x.candidate.kind,
x.candidate.date,
x.candidate.time,
nowIso,
x.candidate.duration_minutes,
JSON.stringify(
x.candidate.advance_alerts
),
nowIso,
x.candidate.timezone||
TIME_ZONE
)
);
}

for(
const[
ruleId,
items
]of byRule
){
const r=
await env.DB.prepare(`
SELECT exceptions_json
FROM schedule_rules
WHERE id=? AND chat_id=?
LIMIT 1
`)
.bind(
ruleId,
chatId
)
.first();

const ex=[
...new Set([
...parseJsonArray(
r?.exceptions_json
),
...items.map(
x=>x.oldOccurrence
)
])
];

statements.push(
env.DB.prepare(`
UPDATE schedule_rules
SET exceptions_json=?,
updated_at=?
WHERE id=? AND chat_id=?
`)
.bind(
JSON.stringify(ex),
nowIso,
ruleId,
chatId
)
);
}

if(statements.length){
await env.DB.batch(
statements
);
}

return{
changed:plan.total,
overrides:
plan.overrides.length
};
}

async function searchScheduleText(env,chatId,intent){
const profile=await getUserProfile(env,chatId);const now=zonedNow(profile.timezone);
const start=validDate(intent.range_start_date)?intent.range_start_date:now.date;
const end=validDate(intent.range_end_date)?intent.range_end_date:addDaysIso(start,365);
const q=normalizeArabicLoose(intent.query||"");const match=title=>!q||normalizeArabicLoose(title).includes(q);const lines=[];
const one=(await env.DB.prepare(`SELECT * FROM reminders WHERE chat_id=? AND local_date BETWEEN ? AND ? ORDER BY local_date,local_time,id`).bind(chatId,addDaysIso(start,-2),addDaysIso(end,2)).all())?.results||[];
const startMs=localDateTimeToEpoch(`${start} 00:00`,profile.timezone);const endMs=localDateTimeToEpoch(`${end} 23:59`,profile.timezone);
for(const r of one){if(!match(r.title))continue;const rtz=String(r.timezone||profile.timezone);const ms=localDateTimeToEpoch(`${r.local_date} ${r.local_time}`,rtz);if(ms<startMs||ms>endMs)continue;const shown=epochToLocalDateTime(ms,profile.timezone);const[d,t]=splitLocalDateTime(shown);lines.push(`${r.sent?"✅":r.cancelled?"❌":r.kind==="appointment"?"📅":"⏰"} ${formatEventWhen(d,t,Number(r.duration_minutes||0),profile.timezone)} — ${r.title}`);}
const rules=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? ORDER BY id`).bind(chatId).all())?.results||[];
for(const r of rules){if(!match(r.title))continue;const rtz=String(r.timezone||profile.timezone);const rf=epochToLocalDateTime(startMs,rtz),rt=epochToLocalDateTime(endMs,rtz);const occs=generateRuleOccurrences(r,rf,rt,100);for(const occ of occs.slice(0,20)){if(isRuleOccurrenceExcluded(r,occ))continue;const ms=localDateTimeToEpoch(occ,rtz);if(ms<startMs||ms>endMs)continue;lines.push(`🔁 ${formatLocalDateTime(epochToLocalDateTime(ms,profile.timezone))} — ${r.title}`);}}
if(!lines.length)return`🔎 ملقتش مواعيد${intent.query?` مطابقة لـ «${intent.query}»`:""} في الفترة المطلوبة.`;
return`🔎 نتائج الجدول${intent.query?` لـ «${intent.query}»`:""}:\n\n${lines.slice(0,60).join("\n")}${lines.length>60?`\n… وفي نتائج إضافية.`:""}`;
}

async function bulkDeleteSchedule(env,chatId,intent){
const profile=await getUserProfile(env,chatId);const now=zonedNow(profile.timezone);
const hasRange=validDate(intent.range_start_date)||validDate(intent.range_end_date);
const start=validDate(intent.range_start_date)?intent.range_start_date:now.date;
const end=validDate(intent.range_end_date)?intent.range_end_date:addDaysIso(start,3650);
const q=normalizeArabicLoose(intent.query||"");const match=title=>!q||normalizeArabicLoose(title).includes(q);
const startMs=localDateTimeToEpoch(`${start} 00:00`,profile.timezone),endMs=localDateTimeToEpoch(`${end} 23:59`,profile.timezone);
const oneRows=(await env.DB.prepare(`SELECT * FROM reminders WHERE chat_id=? AND cancelled=0 AND sent=0 AND local_date BETWEEN ? AND ?`).bind(chatId,addDaysIso(start,-2),addDaysIso(end,2)).all())?.results||[];
const oneIds=oneRows.filter(r=>{if(!match(r.title))return false;const tz=String(r.timezone||profile.timezone);const ms=localDateTimeToEpoch(`${r.local_date} ${r.local_time}`,tz);return ms>=startMs&&ms<=endMs;}).map(r=>Number(r.id));
let oneTime=0;if(oneIds.length){const res=await env.DB.batch(oneIds.map(id=>env.DB.prepare(`DELETE FROM reminders WHERE id=? AND chat_id=?`).bind(id,chatId)));oneTime=res.reduce((n,x)=>n+Number(x?.meta?.changes||0),0);}
const ruleRows=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? ORDER BY id`).bind(chatId).all())?.results||[];let rulesDeleted=0,ruleExceptions=0;
for(const r of ruleRows){if(!match(r.title))continue;if(!hasRange){const res=await env.DB.prepare(`DELETE FROM schedule_rules WHERE id=? AND chat_id=?`).bind(r.id,chatId).run();rulesDeleted+=Number(res?.meta?.changes||0);continue;}
const rtz=String(r.timezone||profile.timezone);const rf=epochToLocalDateTime(startMs,rtz),rt=epochToLocalDateTime(endMs,rtz);const occs=generateRuleOccurrences(r,rf,rt,MAX_RULE_OCCURRENCES);const existing=parseJsonArray(r.exceptions_json);const next=[...new Set([...existing,...occs])];if(next.length===existing.length)continue;await env.DB.prepare(`UPDATE schedule_rules SET exceptions_json=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(next),new Date().toISOString(),r.id,chatId).run();ruleExceptions+=next.length-existing.length;}
return{oneTime,rulesDeleted,ruleExceptions};
}
async function deliverDueReminders(env,scheduledTimeMs=null){
if(!env.DB||!env.TELEGRAM_BOT_TOKEN)return;
await ensureSchemaOnce(env);

const nowMs=Number.isFinite(Number(scheduledTimeMs))
?Number(scheduledTimeMs)
:Date.now();

const state=await env.DB.prepare(`
SELECT value
FROM scheduler_state
WHERE key='last_scheduled_ms'
LIMIT 1
`).first();

let lastMs=Number(
state?.value||
(nowMs-120000)
);

if(
!Number.isFinite(lastMs)||
lastMs>nowMs
){
lastMs=nowMs-120000;
}

if(
nowMs-lastMs>
SCHEDULER_MAX_CATCHUP_MINUTES*60000
){
lastMs=
nowMs-
SCHEDULER_MAX_CATCHUP_MINUTES*60000;
}

await deliverOneTimeAdvanceAlerts(
env,
lastMs,
nowMs
);

await deliverOneTimeMainAlerts(
env,
nowMs
);

await deliverRecurringAlerts(
env,
lastMs,
nowMs
);

await deliverPrayerRules(
env,
lastMs,
nowMs
);

if(
Math.floor(
nowMs/60000
)%5===0
){
await deliverLiveWatches(
env,
nowMs
);
}

await env.DB.prepare(`
INSERT INTO scheduler_state(
key,
value,
updated_at
)
VALUES(
'last_scheduled_ms',
?,
?
)
ON CONFLICT(key)
DO UPDATE SET
value=excluded.value,
updated_at=excluded.updated_at
`)
.bind(
String(nowMs),
new Date().toISOString()
)
.run();
}

async function deliverOneTimeAdvanceAlerts(
env,
lastMs,
nowMs
){
const rows=(
await env.DB.prepare(`
SELECT *
FROM reminders
WHERE cancelled=0
AND sent=0
ORDER BY id
LIMIT 5000
`)
.all()
)?.results||[];

for(const r of rows){
const tz=
String(
r.timezone||
TIME_ZONE
);

const eventAt=
`${r.local_date} ${r.local_time}`;

let eventMs;

try{
eventMs=
localDateTimeToEpoch(
eventAt,
tz
);
}
catch{
continue;
}

for(
const offset of sanitizeAdvanceAlerts(
parseJsonArray(
r.advance_alerts_json
)
)
){
const alertMs=
eventMs-
offset*60000;

if(
alertMs<=lastMs||
alertMs>nowMs
){
continue;
}

const fireKey=
`pre:${offset}:${eventAt}`;

if(
!await claimReminderFire(
env,
r.id,
r.chat_id,
fireKey
)
){
continue;
}

try{
await sendText(
env,
r.chat_id,
`🔔 تنبيه مسبق

${r.title}
ميعاده ${formatLocalDateTime(eventAt)}
باقي ${formatMinutes(offset)}.`,
quickMenuKeyboard()
);
}
catch(e){
await releaseReminderFire(
env,
r.id,
fireKey
);

console.error(
"Advance alert failed",
r.id,
e
);
}
}
}
}

async function deliverOneTimeMainAlerts(
env,
nowMs
){
const rows=(
await env.DB.prepare(`
SELECT *
FROM reminders
WHERE cancelled=0
AND sent=0
ORDER BY id
LIMIT 5000
`)
.all()
)?.results||[];

for(const r of rows){
const tz=
String(
r.timezone||
TIME_ZONE
);

const eventAt=
`${r.local_date} ${r.local_time}`;

let eventMs;

try{
eventMs=
localDateTimeToEpoch(
eventAt,
tz
);
}
catch{
continue;
}

if(eventMs>nowMs){
continue;
}

const claim=
await env.DB.prepare(`
UPDATE reminders
SET sent=1
WHERE id=?
AND sent=0
AND cancelled=0
`)
.bind(r.id)
.run();

if(
!Number(
claim?.meta?.changes||0
)
){
continue;
}

try{
const late=
Math.max(
0,
Math.floor(
(nowMs-eventMs)/60000
)
);

const heading=
late>=2
?(
r.kind==="appointment"
?"📅 تنبيه موعد متأخر"
:"⏰ تذكير متأخر"
)
:(
r.kind==="appointment"
?"📅 موعدك دلوقتي"
:"⏰ تذكير"
);

const duration=
Number(
r.duration_minutes||0
);

await sendText(
env,
r.chat_id,
`${heading}

${r.title}${late>=2?`
🕒 كان ميعاده من ${formatMinutes(late)}`:""}${duration?`
⏳ المدة: ${formatMinutes(duration)}`:""}`,
{
inline_keyboard:[
[
{
text:"✅ تم",
callback_data:
`rem:done:${r.id}`
},
{
text:"⏰ +10 د",
callback_data:
`rem:s10:${r.id}`
},
{
text:"🕐 +1 س",
callback_data:
`rem:s60:${r.id}`
}
],
[
{
text:"📅 مواعيدي",
callback_data:
"panel:list"
}
]
]
}
);
}
catch(e){
console.error(
"One-time delivery failed",
r.id,
e
);

await env.DB.prepare(`
UPDATE reminders
SET sent=0
WHERE id=?
`)
.bind(r.id)
.run();
}
}
}

async function deliverRecurringAlerts(
env,
lastMs,
nowMs
){
const rules=(
await env.DB.prepare(`
SELECT *
FROM schedule_rules
WHERE active=1
ORDER BY id
LIMIT 2000
`)
.all()
)?.results||[];

for(const r of rules){
let firedCount=
Number(
r.fired_count||0
);

const maxCount=
r.max_occurrences==null
?null
:Number(
r.max_occurrences
);

if(
maxCount!=null&&
firedCount>=maxCount
){
await env.DB.prepare(`
UPDATE schedule_rules
SET active=0,
updated_at=?
WHERE id=?
`)
.bind(
new Date().toISOString(),
r.id
)
.run();

continue;
}

const tz=
String(
r.timezone||
TIME_ZONE
);

const offsets=
sanitizeAdvanceAlerts(
parseJsonArray(
r.advance_alerts_json
)
);

const maxOffset=
offsets.length
?Math.max(...offsets)
:0;

const windowStart=
epochToLocalDateTime(
lastMs,
tz
);

const genTo=
epochToLocalDateTime(
nowMs+
maxOffset*60000,
tz
);

const occurrences=
generateRuleOccurrences(
r,
windowStart,
genTo,
MAX_RULE_OCCURRENCES
);

for(const occ of occurrences){
if(
isRuleOccurrenceExcluded(
r,
occ
)||
(
r.paused_until&&
occ<r.paused_until
)
){
continue;
}

const occMs=
localDateTimeToEpoch(
occ,
tz
);

for(const offset of offsets){
const alertMs=
occMs-
offset*60000;

if(
alertMs<=lastMs||
alertMs>nowMs
){
continue;
}

if(
!await claimScheduleFire(
env,
r.id,
r.chat_id,
occ,
offset
)
){
continue;
}

try{
await sendText(
env,
r.chat_id,
`🔔 تنبيه مسبق

${r.title}
الموعد ${formatLocalDateTime(occ)}
باقي ${formatMinutes(offset)}.`,
quickMenuKeyboard()
);
}
catch(e){
await releaseScheduleFire(
env,
r.id,
occ,
offset
);
}
}

if(
occMs<=lastMs||
occMs>nowMs
){
continue;
}

if(
maxCount!=null&&
firedCount>=maxCount
){
break;
}

if(
!await claimScheduleFire(
env,
r.id,
r.chat_id,
occ,
0
)
){
continue;
}

try{
const heading=
r.kind==="appointment"
?"📅 موعد متكرر"
:"🔁 تذكير متكرر";

const duration=
Number(
r.duration_minutes||0
);

await sendText(
env,
r.chat_id,
`${heading}

${r.title}${duration?`
⏳ المدة: ${formatMinutes(duration)}`:""}`,
{
inline_keyboard:[
[
{
text:"✅ تم",
callback_data:
`occ:done:${r.id}`
},
{
text:"⏰ +10 د",
callback_data:
`occ:s10:${r.id}`
},
{
text:"🕐 +1 س",
callback_data:
`occ:s60:${r.id}`
}
],
[
{
text:"⏭️ تخطي الجاية",
callback_data:
`rule:skip:${r.id}`
},
{
text:"🔁 إدارة",
callback_data:
"panel:recurring"
}
]
]
}
);

firedCount++;

await env.DB.prepare(`
UPDATE schedule_rules
SET fired_count=?,
active=?,
updated_at=?
WHERE id=?
`)
.bind(
firedCount,
maxCount!=null&&
firedCount>=maxCount
?0
:1,
new Date().toISOString(),
r.id
)
.run();
}
catch(e){
await releaseScheduleFire(
env,
r.id,
occ,
0
);
}
}
}
}

async function claimReminderFire(
env,
reminderId,
chatId,
fireKey
){
try{
await env.DB.prepare(`
INSERT INTO reminder_fires(
reminder_id,
chat_id,
fire_key,
sent_at
)
VALUES(
?,?,?,?
)
`)
.bind(
reminderId,
String(chatId),
fireKey,
new Date().toISOString()
)
.run();

return true;
}
catch(e){
if(
/unique|constraint/i.test(
String(
e?.message||e
)
)
){
return false;
}

throw e;
}
}

async function releaseReminderFire(
env,
reminderId,
fireKey
){
await env.DB.prepare(`
DELETE FROM reminder_fires
WHERE reminder_id=?
AND fire_key=?
`)
.bind(
reminderId,
fireKey
)
.run();
}

async function claimScheduleFire(
env,
ruleId,
chatId,
occurrenceKey,
offset
){
try{
await env.DB.prepare(`
INSERT INTO schedule_fires(
rule_id,
chat_id,
occurrence_key,
alert_offset,
sent_at
)
VALUES(
?,?,?,?,?
)
`)
.bind(
ruleId,
String(chatId),
occurrenceKey,
offset,
new Date().toISOString()
)
.run();

return true;
}
catch(e){
if(
/unique|constraint/i.test(
String(
e?.message||e
)
)
){
return false;
}

throw e;
}
}

async function releaseScheduleFire(
env,
ruleId,
occurrenceKey,
offset
){
await env.DB.prepare(`
DELETE FROM schedule_fires
WHERE rule_id=?
AND occurrence_key=?
AND alert_offset=?
`)
.bind(
ruleId,
occurrenceKey,
offset
)
.run();
}

async function insertOneTimeDirect(
env,
chatId,
item
){
const nowIso=
new Date().toISOString();

const profile=
await getUserProfile(
env,
chatId
);

const tz=
String(
item.timezone||
profile.timezone||
TIME_ZONE
);

return env.DB.prepare(`
INSERT INTO reminders(
chat_id,
title,
kind,
local_date,
local_time,
sent,
cancelled,
created_at,
duration_minutes,
advance_alerts_json,
updated_at,
timezone
)
VALUES(
?,?,?,?,?,
0,
0,
?,?,?,?,?
)
`)
.bind(
chatId,
item.title,
item.kind==="appointment"
?"appointment"
:"reminder",
item.date,
item.time,
nowIso,
sanitizeDuration(
item.duration_minutes
),
JSON.stringify(
sanitizeAdvanceAlerts(
item.advance_alerts
)
),
nowIso,
tz
)
.run();
}

async function cancelReminder(
env,
chatId,
id,
intent=null
){
const res=
await env.DB.prepare(`
UPDATE reminders
SET cancelled=1
WHERE id=?
AND chat_id=?
AND cancelled=0
AND sent=0
`)
.bind(
id,
chatId
)
.run();

const answer=
Number(
res?.meta?.changes||0
)
?`🗑️ تم إلغاء الموعد.`
:`مش لاقي الموعد المطلوب أو الموعد خلص بالفعل.`;

const final=
answer+
modelFooter(
env,
chatId,
intent
);

await sendText(
env,
chatId,
final,
quickMenuKeyboard()
);

await saveConversationMessage(
env,
chatId,
"assistant",
final
);
}

async function deleteScheduleRule(env,chatId,id,intent=null){
const res=await env.DB.batch([
env.DB.prepare(`DELETE FROM schedule_fires WHERE rule_id=? AND chat_id=?`).bind(id,chatId),
env.DB.prepare(`DELETE FROM schedule_rules WHERE id=? AND chat_id=?`).bind(id,chatId)
]);
const deleted=Number(res?.[1]?.meta?.changes||0);
const answer=deleted?`🗑️ تم حذف التكرار بالكامل.`:`مش لاقي التكرار المطلوب.`;
const final=answer+modelFooter(env,chatId,intent);
await sendText(env,chatId,final,quickMenuKeyboard());
await saveConversationMessage(env,chatId,"assistant",final);
}
async function savePendingConflict(
env,
chatId,
intent,
conflicts
){
const now=
new Date();

const expires=
new Date(
now.getTime()+
CONFLICT_TTL_MINUTES*60000
);

await env.DB.prepare(`
INSERT INTO pending_conflicts(
chat_id,
intent_json,
conflicts_json,
expires_at,
created_at,
updated_at
)
VALUES(
?,?,?,?,?,?
)
ON CONFLICT(chat_id)
DO UPDATE SET
intent_json=excluded.intent_json,
conflicts_json=excluded.conflicts_json,
expires_at=excluded.expires_at,
updated_at=excluded.updated_at
`)
.bind(
chatId,
JSON.stringify(
intent||{}
),
JSON.stringify(
conflicts||[]
),
expires.toISOString(),
now.toISOString(),
now.toISOString()
)
.run();
}

async function getPendingConflict(
env,
chatId
){
const now=
new Date().toISOString();

await env.DB.prepare(`
DELETE FROM pending_conflicts
WHERE expires_at<=?
`)
.bind(now)
.run();

return env.DB.prepare(`
SELECT *
FROM pending_conflicts
WHERE chat_id=?
AND expires_at>?
LIMIT 1
`)
.bind(
chatId,
now
)
.first();
}

async function clearPendingConflict(
env,
chatId
){
await env.DB.prepare(`
DELETE FROM pending_conflicts
WHERE chat_id=?
`)
.bind(chatId)
.run();
}

function isConflictConfirmReply(text){
const t=
normalizeArabicLoose(
text
);

return(
/^(?:ايوه|نعم|تمام|موافق|ماشي)$/u.test(t)||
/(?:سجل|سجله|سجلها|نفذ|اعمل|حفظ|احفظ).*(?:برضه|رغم|عادي|التعارض)?/u.test(t)
);
}

function isConflictCancelReply(text){
const t=
normalizeArabicLoose(
text
);

return(
/^(?:لا|الغاء|الغي|الغيه|سيبه|سيبها|خلاص)$/u.test(t)||
/(?:ما تسجل|ماتسجل|مش عايز|الغ|سيب)/u.test(t)
);
}

function buildReminderSystemPrompt(now){
return`
أنت Super Agent V9.1 Final Fix Life Context Engine: سكرتير شخصي ومساعد حياة يومي لمستخدم يتكلم غالبًا بالمصري.
المنطقة الافتراضية ${TIME_ZONE}. الوقت المرجعي عند إنشاء البرومبت: ${now.date} ${now.time} ${now.weekday}.

مهم جدًا:
- الواقع الحي المرسل في رسالة المستخدم هو المصدر الأول للوقت والتاريخ والصلاة والمناسبات والبيانات الحية. لا تستبدله بذاكرتك.
- افهم اللهجة المصرية بحرية شديدة: عاوز/عايز، بكره، النهارده، الضهر، العشا، المغرب، كده، دلوقتي، حالًا، كمان، بعدين، حبة، شوية، ربع، نص، تلت، إلا ربع، خمستاشر، تلاتين… واستنتج المعنى من السياق.
- لو السياق ديني وفيه «أذان/أصلي/صلاة/الفجر/الظهر/العصر/المغرب/العشاء»، فكلمة «العشاء/العشا» تعني صلاة العشاء لا وجبة العشاء.
- لا تخترع معلومة لحظية. لو سؤال عن أخبار/أحداث حالية أو معلومة متغيرة ولا توجد بيانات حية كافية، اجعل needs_live_data=true واكتب live_query_en بالإنجليزية كعبارة بحث قصيرة ودقيقة.
- لا تذكر للمستخدم أسماء الموديلات أو IDs الداخلية.
- لا تستخدم أرقام # أو R في الرد الطبيعي.

أرجع JSON فقط بلا Markdown بهذا الشكل:
{
 "action":"create|list|delete|update|clear_all|find_free_period|find_free_slot|manage_rule|search_schedule|bulk_delete|bulk_shift|chat",
 "needs_clarification":false,
 "question":"",
 "reply":"",
 "needs_live_data":false,
 "live_query_en":"",
 "live_kind":"news|general",
 "range":"today|tomorrow|week|month|upcoming",
 "target_id":null,
 "target_type":"one_time|recurring",
 "duration_days":7,
 "slot_duration_minutes":60,
 "slot_start_date":null,
 "slot_end_date":null,
 "day_start":"08:00",
 "day_end":"23:00",
 "manage_operation":"pause|resume|skip_next|add_exception",
 "pause_until":null,
 "exception":null,
 "query":"",
 "range_start_date":null,
 "range_end_date":null,
 "shift_minutes":0,
 "items":[
   {
    "date":"YYYY-MM-DD",
    "time":"HH:mm",
    "title":"المطلوب",
    "kind":"reminder|appointment",
    "duration_minutes":0,
    "advance_alerts":[]
   }
 ],
 "recurring_items":[
   {
    "title":"المطلوب",
    "kind":"reminder|appointment",
    "duration_minutes":0,
    "advance_alerts":[],
    "schedule":{
      "mode":"interval|calendar",
      "every":1,
      "unit":"minutes|hours|days|weeks|months|years",
      "times":[],
      "weekdays":[],
      "monthdays":[],
      "months":[],
      "ordinal_weekdays":[],
      "start_at":"YYYY-MM-DD HH:mm",
      "end_at":null,
      "max_occurrences":null,
      "exceptions":[]
    }
   }
 ],
 "one_time_update":{
   "title":null,
   "kind":null,
   "date":null,
   "time":null,
   "duration_minutes":null,
   "advance_alerts":null
 },
 "recurring_update":{
   "title":null,
   "kind":null,
   "duration_minutes":null,
   "advance_alerts":null,
   "schedule":null
 }
}

قواعد:
1) كلام عادي => chat ورد مصري طبيعي مختصر مناسب للموقف.
2) وقت نسبي واضح مثل بعد 5 دقايق => احسبه بلا سؤال.
3) ساعة 1-12 بدون فترة يوم واضحة => اسأل صباح ولا مساء فقط.
4) وقت واضح بلا يوم => اليوم إن لم يمر وإلا غدًا.
5) المدة المركبة تُجمع: ساعة و45 دقيقة=105، ساعتين و35=155، ساعة إلا ربع=45، ساعة وتلت=80، ساعة ونص=90.
6) «كل 17 دقيقة لمدة ساعتين و20» مدة نافذة التكرار 140 دقيقة وليست مدة كل occurrence؛ max_occurrences=floor(140/17)=8.
7) التنبيه المركب وحدة واحدة: «قبلها بساعة و20 دقيقة»=[80]. ولو «وكمان قبلها 10 دقايق»=[80,10].
8) العلاقات: «بعد الدكتور بنص ساعة» = نهاية الدكتور +30 إن كان له مدة؛ «قبل X بربع ساعة» = وقت X -15.
9) الصلاة: استخدم أوقات الصلاة الحية في الواقع المرسل. «قبل أذان العشاء بربع ساعة» = Isha-15. لا تسأل عن وقت وجبة العشاء.
9.1) لو المستخدم طلب عدة تذكيرات صلاة في جملة واحدة، استخرج كل Anchor مستقل ولا تسقط أي واحد.
9.2) فرّق بين وقت تنفيذ التذكير ووقت مذكور كسبب أو مرجع: «الساعة 5 مساء فكرني أكلم الممرضة عشان تيجي الساعة 6» = تذكير واحد الساعة 17:00؛ الساعة 6 معلومة داخل معنى التذكير وليست موعدًا مستقلًا إلا لو طلب المستخدم حفظها صراحة.
10) التكرار يدعم دقائق/ساعات/أيام/أسابيع/شهور/سنين وأيام أسبوع وordinal weekdays وآخر يوم بالشهر.
11) max_occurrences حد حقيقي لا يُتجاوز.
12) لا تفترض مدة أو تنبيه مسبق لم يطلبهما المستخدم.
13) لو المستخدم يطلب معلومة حديثة مثل آخر الأخبار/إيه اللي حصل النهارده/أحدث تطورات، action=chat وneeds_live_data=true.
14) أي طلب مواعيد متعدد: لا تسقط أي عنصر.
15) التعارض يترك للسيرفر؛ استخرج الطلب ولا ترفضه.
16) استخدم جدول المستخدم وذاكرته والواقع الحي لحل المراجع بدل الأسئلة الزائدة.
`.trim();
}

function buildAIUserMessage({
baseText,
clarifications,
history,
scheduleContext,
realityContext,
memoryContext
}){
const lines=[];

if(realityContext){
lines.push(
"=== الواقع الحي الآن (مصدره السيرفر وليس ذاكرة الموديل) ===",
realityContext,
""
);
}

if(memoryContext){
lines.push(
"=== ذاكرة المستخدم طويلة المدى ===",
memoryContext,
""
);
}

if(
Array.isArray(history)&&
history.length
){
lines.push(
"=== سياق المحادثة السابق ==="
);

for(
const m of history.slice(-20)
){
lines.push(
`${m.role==="assistant"?"المساعد":"المستخدم"}: ${m.content}`
);
}

lines.push("");
}

lines.push(
"=== جدول المستخدم الحقيقي ===",
scheduleContext||
"لا يوجد جدول متاح.",
"",
"=== الطلب الحالي ===",
String(
baseText||""
).trim()
);

if(
Array.isArray(clarifications)&&
clarifications.length
){
lines.push(
"",
"=== توضيحات سابقة ملزمة ==="
);

clarifications.forEach(
(c,i)=>{
lines.push(
`${i+1}) السؤال: ${c?.question||""}`,
`   الإجابة: ${c?.answer||""}`
);

if(c?.interpretation){
lines.push(
`   التفسير المؤكد: ${c.interpretation}`
);
}
}
);
}

return lines.join("\n");
}

async function parseIntentWithFallback(
env,
userText,
validationContext
){
const systemPrompt=
buildReminderSystemPrompt(
zonedNow(
validationContext?.timezone||
TIME_ZONE
)
);

const startedAt=
Date.now();

const failures=[];

for(
let i=0;
i<REMINDER_MODELS.length;
i++
){
const model=
REMINDER_MODELS[i];

const remaining=
TOTAL_AI_BUDGET_MS-
(Date.now()-startedAt);

if(remaining<700){
break;
}

const timeoutMs=
Math.max(
500,
Math.min(
model.timeoutMs,
remaining-250
)
);

const attemptStart=
Date.now();

try{
const raw=
await callOneModel(
env,
model,
systemPrompt,
userText,
timeoutMs
);

const safetyContext=
validationContext||
{
baseText:userText,
clarifications:[]
};

const intent=
validateAndNormalizeIntent(
raw,
safetyContext
);

applySafetyFixes(
intent,
safetyContext
);

finalSafetyCheck(
intent,
safetyContext
);

const latency=
Date.now()-
attemptStart;

const score=
await recordModelResult(
env,
model,
true,
latency,
null
);

Object.assign(
intent,
{
_model:model.id,
_model_name:model.name,
_model_short:model.short,
_priority:i+1,
_score:
`${score.successes}/${score.attempts}`,
_latency_ms:latency
}
);

return intent;
}
catch(e){
const latency=
Date.now()-
attemptStart;

const reason=
safeError(e);

await recordModelResult(
env,
model,
false,
latency,
reason
);

failures.push({
priority:i+1,
model:model.id,
reason,
latencyMs:latency
});

console.warn(
`AI failed #${i+1} ${model.id}: ${reason}`
);
}
}

console.error(
"All models failed",
failures
);

throw new Error(
`لم ينجح أي موديل متاح حاليًا. تمت ${failures.length} محاولة. جرّب تاني بعد لحظات.`
);
}

async function callOneModel(
env,
model,
systemPrompt,
userText,
timeoutMs
){
const controller=
new AbortController();

const timer=
setTimeout(
()=>controller.abort(),
timeoutMs
);

try{
const req=
new Request(
OMNIAI_INTERNAL_URL,
{
method:"POST",
headers:{
Authorization:
`Bearer ${env.OMNIAI_API_KEY}`,
"Content-Type":
"application/json"
},
body:
JSON.stringify({
model:model.id,
messages:[
{
role:"system",
content:systemPrompt
},
{
role:"user",
content:userText
}
],
max_tokens:1800,
stream:false
}),
signal:
controller.signal
}
);

const res=
await env.OMNIAI_SERVICE.fetch(
req
);

const raw=
await res.text();

let data;

try{
data=
JSON.parse(raw);
}
catch{
throw new Error(
`HTTP ${res.status}: OmniAI رجّع رد غير JSON`
);
}

if(!res.ok){
throw new Error(
data?.error?.message||
data?.message||
`OmniAI HTTP ${res.status}`
);
}

const content=
String(
data?.choices?.[0]?.message?.content||
""
).trim();

if(!content){
throw new Error(
"الموديل رجّع رد فاضي"
);
}

return parseModelJson(
content
);
}
catch(e){
if(e?.name==="AbortError"){
const x=
new Error(
`Timeout بعد ${timeoutMs}ms`
);

x.name=
"AbortError";

throw x;
}

throw e;
}
finally{
clearTimeout(timer);
}
}

function validateAndNormalizeIntent(
intent,
context
){
if(
!intent||
typeof intent!=="object"||
Array.isArray(intent)
){
throw new Error(
"JSON غير صالح: الجذر ليس object"
);
}

const allowed=[
"create",
"list",
"delete",
"update",
"clear_all",
"find_free_period",
"find_free_slot",
"manage_rule",
"search_schedule",
"bulk_delete",
"bulk_shift",
"chat"
];

const action=
String(
intent.action||""
)
.trim()
.toLowerCase();

if(
!allowed.includes(action)
){
throw new Error(
"JSON غير صالح: action غير معروف"
);
}

const out={
action,
needs_clarification:
!!intent.needs_clarification,
question:
String(
intent.question||""
).trim(),
reply:
String(
intent.reply||""
).trim(),
needs_live_data:
!!intent.needs_live_data,
live_query_en:
String(
intent.live_query_en||""
).trim().slice(0,300),
live_kind:
["news","general"].includes(
String(
intent.live_kind||""
)
)
?String(
intent.live_kind
)
:"general",
range:
[
"today",
"tomorrow",
"week",
"month",
"upcoming"
].includes(
String(
intent.range||""
)
)
?String(
intent.range
)
:"upcoming",
target_id:
intent.target_id==null
?null
:Number(
intent.target_id
),
target_type:
intent.target_type===
"recurring"
?"recurring"
:"one_time",
duration_days:
clamp(
Number(
intent.duration_days||7
),
1,
30
),
slot_duration_minutes:
clamp(
Number(
intent.slot_duration_minutes||60
),
5,
1440
),
slot_start_date:
intent.slot_start_date==null
?null
:String(
intent.slot_start_date
),
slot_end_date:
intent.slot_end_date==null
?null
:String(
intent.slot_end_date
),
day_start:
validTime(
intent.day_start
)
?intent.day_start
:"08:00",
day_end:
validTime(
intent.day_end
)
?intent.day_end
:"23:00",
manage_operation:
String(
intent.manage_operation||""
),
pause_until:
intent.pause_until==null
?null
:String(
intent.pause_until
),
exception:
intent.exception==null
?null
:String(
intent.exception
),
query:
String(
intent.query||""
).trim().slice(0,200),
range_start_date:
intent.range_start_date==null
?null
:String(
intent.range_start_date
),
range_end_date:
intent.range_end_date==null
?null
:String(
intent.range_end_date
),
shift_minutes:
clamp(
Math.trunc(
Number(
intent.shift_minutes||0
)
),
-10080,
10080
),
items:[],
recurring_items:[],
one_time_update:
normalizeOptionalObject(
intent.one_time_update
),
recurring_update:
normalizeOptionalObject(
intent.recurring_update
)
};

if(out.needs_clarification){
if(!out.question){
throw new Error(
"طلب توضيح بدون سؤال"
);
}

if(
clarificationIsObviouslyUnnecessary(
out.question,
String(
context?.baseText||""
),
Array.isArray(
context?.clarifications
)
?context.clarifications
:[]
)
){
throw new Error(
"الموديل كرر سؤالًا محلولًا"
);
}

return out;
}

if(action==="create"){
for(
const item of(
Array.isArray(
intent.items
)
?intent.items
:[]
)
){
const x={
title:
String(
item?.title||""
).trim().slice(0,500),
kind:
item?.kind==="appointment"
?"appointment"
:"reminder",
date:
String(
item?.date||""
),
time:
String(
item?.time||""
),
timezone:String(context?.timezone||TIME_ZONE),
duration_minutes:
sanitizeDuration(
item?.duration_minutes
),
advance_alerts:
sanitizeAdvanceAlerts(
item?.advance_alerts
)
};

if(
!x.title||
!validDate(x.date)||
!validTime(x.time)
){
throw new Error(
"موعد مرة واحدة غير صالح"
);
}

if(
isPastLocal(
x.date,
x.time,
context?.timezone||
TIME_ZONE
)
){
throw new Error(
`الموديل أنشأ موعدًا في الماضي: ${x.date} ${x.time}`
);
}

out.items.push(x);
}

for(
const item of(
Array.isArray(
intent.recurring_items
)
?intent.recurring_items
:[]
)
){
const r=
normalizeRecurringItem(
item,
context?.timezone||TIME_ZONE
);

validateScheduleItem(r);

if(!r.title){
throw new Error(
"تكرار بدون عنوان"
);
}

out.recurring_items.push(r);
}

if(
!out.items.length&&
!out.recurring_items.length
){
throw new Error(
"create بدون موعد صالح"
);
}
}

if(
[
"delete",
"update",
"manage_rule"
].includes(action)
){
if(
!Number.isInteger(
out.target_id
)||
out.target_id<=0
){
throw new Error(
`${action} بدون target_id صالح`
);
}
}

if(action==="update"){
if(
out.target_type===
"one_time"
){
const p=
out.one_time_update;

if(
p.duration_minutes!=null
){
p.duration_minutes=
sanitizeDuration(
p.duration_minutes
);
}

if(
Array.isArray(
p.advance_alerts
)
){
p.advance_alerts=
sanitizeAdvanceAlerts(
p.advance_alerts
);
}
}
else{
const p=
out.recurring_update;

if(
p.duration_minutes!=null
){
p.duration_minutes=
sanitizeDuration(
p.duration_minutes
);
}

if(
Array.isArray(
p.advance_alerts
)
){
p.advance_alerts=
sanitizeAdvanceAlerts(
p.advance_alerts
);
}

if(p.schedule){
p.schedule=
normalizeUniversalSchedule(
p.schedule,
context?.timezone||TIME_ZONE
);
}
}
}

if(
action==="manage_rule"&&
![
"pause",
"resume",
"skip_next",
"add_exception"
].includes(
out.manage_operation
)
){
throw new Error(
"manage_rule operation غير صالح"
);
}

if(
action==="bulk_shift"&&
!out.shift_minutes
){
throw new Error(
"bulk_shift بدون shift_minutes"
);
}

if(
action==="chat"&&
!out.reply
){
throw new Error(
"chat بدون reply"
);
}

return out;
}

function applySafetyFixes(
intent,
context
){
const base=
String(
context?.baseText||""
).trim();

if(
!base||
intent?.needs_clarification
){
return intent;
}

if(intent.action==="create"){
const oneCount=
(intent.items||[]).length;

const recCount=
(intent.recurring_items||[]).length;

for(
const item of(
intent.items||[]
)
){
const clause=
getSafetyClauseForTitle(
base,
item.title
);

groundEventDuration(
item,
clause,
false
);

groundAdvanceAlerts(
item,
hasExplicitAdvanceAlertRequest(
clause
)
?clause
:(
oneCount===1&&
recCount===0
?base
:clause
)
);
}

for(
const item of(
intent.recurring_items||[]
)
){
const clause=
getSafetyClauseForTitle(
base,
item.title
);

const intervalEvery=
parseIntervalEveryMinutes(
clause
);

const det=
parseDeterministicIntervalWindow(
clause,
context?.timezone||
TIME_ZONE
);

if(
det&&
item.schedule
){
const unit=
det.everyMinutes%60===0
?"hours"
:"minutes";

const every=
unit==="hours"
?det.everyMinutes/60
:det.everyMinutes;

item.schedule=
normalizeUniversalSchedule({
...item.schedule,
mode:"interval",
unit,
every,
times:[],
weekdays:[],
monthdays:[],
months:[],
ordinal_weekdays:[],
start_at:det.startAt,
end_at:det.endAt,
max_occurrences:
det.maxOccurrences,
window_minutes:
det.windowMinutes
});
}

groundEventDuration(
item,
clause,
intervalEvery!=null
);

groundAdvanceAlerts(
item,
hasExplicitAdvanceAlertRequest(
clause
)
?clause
:(
recCount===1&&
oneCount===0
?base
:clause
)
);
}

applyDeterministicRelationships(
intent,
base,
context?.timezone||intent._timezone||TIME_ZONE
);

applyReferenceClockSafety(intent,base);
}

if(intent.action==="update"){
if(
intent.target_type===
"one_time"
){
const p=
intent.one_time_update||
{};

if(
wantsRemoveDuration(
base
)
){
p.duration_minutes=0;
}
else if(
hasExplicitEventDurationCue(
base
)
){
const d=
deriveExplicitEventDurationMinutes(
base,
null
);

if(d!=null){
p.duration_minutes=d;
}
}
else{
p.duration_minutes=null;
}

if(
wantsRemoveAdvanceAlerts(
base
)
){
p.advance_alerts=[];
}
else if(
hasExplicitAdvanceAlertRequest(
base
)
){
p.advance_alerts=
parseExplicitAdvanceOffsets(
base
);
}
else{
p.advance_alerts=null;
}
}
else{
const p=
intent.recurring_update||
{};

const intervalEvery=
parseIntervalEveryMinutes(
base
);

if(
wantsRemoveDuration(
base
)
){
p.duration_minutes=0;
}
else if(
hasExplicitOccurrenceDurationCue(
base,
intervalEvery!=null
)
){
const d=
deriveExplicitEventDurationMinutes(
base,
null
);

if(d!=null){
p.duration_minutes=d;
}
}
else{
p.duration_minutes=null;
}

if(
wantsRemoveAdvanceAlerts(
base
)
){
p.advance_alerts=[];
}
else if(
hasExplicitAdvanceAlertRequest(
base
)
){
p.advance_alerts=
parseExplicitAdvanceOffsets(
base
);
}
else{
p.advance_alerts=null;
}

if(p.schedule){
const det=
parseDeterministicIntervalWindow(
base,
context?.timezone||
TIME_ZONE
);

if(det){
const unit=
det.everyMinutes%60===0
?"hours"
:"minutes";

const every=
unit==="hours"
?det.everyMinutes/60
:det.everyMinutes;

p.schedule=
normalizeUniversalSchedule({
...p.schedule,
mode:"interval",
unit,
every,
times:[],
weekdays:[],
monthdays:[],
months:[],
ordinal_weekdays:[],
start_at:det.startAt,
end_at:det.endAt,
max_occurrences:
det.maxOccurrences,
window_minutes:
det.windowMinutes
});
}
}
}
}

return intent;
}

function applyDeterministicRelationships(
intent,
base,
timeZone=TIME_ZONE
){
const items=
Array.isArray(
intent?.items
)
?intent.items
:[];

if(items.length<2){
return;
}

const rels=[];

for(
let i=0;
i<items.length;
i++
){
const target=
items[i];

const clause=
getSafetyClauseForTitle(
base,
target.title
);

const n=
normalizeArabicLoose(
normalizeDigits(
clause
)
);

const relation=
n.match(
/(?:^|\s)و?(بعد|قبل)(?:\s+ما)?\s+/u
);

if(!relation){
continue;
}

const dir=
relation[1]==="بعد"
?1
:-1;

const offset=
/(?:مباشره|مباشرة|علي طول|على طول)/u.test(n)
?0
:parseRelationOffsetMinutes(n);

if(offset==null){
continue;
}

const beforeTarget=
n.split(
/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى)/u
)[0]||n;

let best=null;
let bestScore=0;

for(
let j=0;
j<items.length;
j++
){
if(j===i){
continue;
}

const keys=
extractScheduleKeywords(
items[j].title||""
);

let score=0;

for(const k of keys){
if(
beforeTarget.includes(
normalizeArabicLoose(k)
)
){
score+=
Math.max(
2,
k.length
);
}
}

const nt=
normalizeArabicLoose(
items[j].title||""
);

if(
nt&&
(
beforeTarget.includes(nt)||
nt.includes(
beforeTarget.replace(
/^(?:بعد|قبل)\s+/u,
""
)
)
)
){
score+=1000;
}

if(score>bestScore){
bestScore=score;
best=j;
}
}

if(
best!=null&&
bestScore>0
){
rels.push({
target:i,
ref:best,
dir,
offset
});
}
}

for(
let pass=0;
pass<Math.max(
3,
items.length+1
);
pass++
){
let changed=false;

for(const r of rels){
const ref=
items[r.ref];

const target=
items[r.target];

if(
!validDate(
ref.date
)||
!validTime(
ref.time
)
){
continue;
}

const refStart=
`${ref.date} ${ref.time}`;

const anchor=
r.dir>0
?addMinutesLocal(
refStart,
Math.max(
0,
Number(
ref.duration_minutes||0
)
),
timeZone
)
:refStart;

const at=
addMinutesLocal(
anchor,
r.dir*r.offset,
timeZone
);

const[d,t]=
splitLocalDateTime(at);

if(
target.date!==d||
target.time!==t
){
target.date=d;
target.time=t;
changed=true;
}
}

if(!changed){
break;
}
}
}

function parseRelationOffsetMinutes(text){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

if(
/(?:مباشره|مباشرة|علي طول|على طول)/u.test(t)
){
return 0;
}

const b=
t.match(
/(?:^|\s)ب\s*(.+)$/u
);

if(b){
const x=
parseDurationValuePhrase(
b[1]
);

if(x!=null){
return x;
}
}

const words=
t.split(/\s+/);

for(
let i=1;
i<words.length;
i++
){
const x=
parseDurationValuePhrase(
words.slice(i).join(" ")
);

if(x!=null){
return x;
}
}

return null;
}

function egyptianNumberValue(value){
let s=
normalizeArabicLoose(
normalizeDigits(
value
)
)
.replace(/\s+/g," ")
.trim();

if(/^\d+$/.test(s)){
return Number(s);
}

const direct={
صفر:0,
واحد:1,
واحده:1,
اتنين:2,
اثنين:2,
تنين:2,
تلاته:3,
ثلاثه:3,
اربعه:4,
خمسه:5,
سته:6,
سبعه:7,
تمانيه:8,
ثمانيه:8,
تسعه:9,
عشره:10,
عشر:10,
حداشر:11,
احداشر:11,
اتناشر:12,
اثناشر:12,
تلتاشر:13,
تلاتاشر:13,
اربعتاشر:14,
اربعطاشر:14,
خمستاشر:15,
ستاشر:16,
سبعتاشر:17,
تمنتاشر:18,
ثمانتاشر:18,
تسعتاشر:19,
عشرين:20,
تلاتين:30,
ثلاثين:30,
اربعين:40,
خمسين:50,
ستين:60,
سبعين:70,
تمانين:80,
ثمانين:80,
تسعين:90,
ميه:100,
مئه:100
};

if(s in direct){
return direct[s];
}

s=
s.replace(
/^و/u,
""
);

const parts=
s.split(
/\s+و\s+|و(?=[\p{L}\d])/u
).filter(Boolean);

if(parts.length>1){
let total=0;

for(const p of parts){
const n=
egyptianNumberValue(p);

if(n==null){
return null;
}

total+=n;
}

return total;
}

return null;
}

function groundEventDuration(
item,
clause,
isIntervalRecurrence=false
){
if(!item){
return;
}

if(
wantsRemoveDuration(
clause
)
){
item.duration_minutes=0;
return;
}

if(
isIntervalRecurrence&&
!hasExplicitOccurrenceDurationCue(
clause,
true
)
){
item.duration_minutes=0;
return;
}

const derived=
deriveExplicitEventDurationMinutes(
clause,
item
);

if(derived!=null){
item.duration_minutes=
sanitizeDuration(
derived
);

return;
}

if(
!hasExplicitEventDurationCue(
clause
)
){
item.duration_minutes=0;
}
}

function groundAdvanceAlerts(
item,
clause
){
if(!item){
return;
}

if(
wantsRemoveAdvanceAlerts(
clause
)
){
item.advance_alerts=[];
return;
}

const offsets=
parseExplicitAdvanceOffsets(
clause
);

item.advance_alerts=
offsets.length
?offsets
:[];
}

function splitSafetyClauses(text){
return String(
text||""
)
.replace(
/[،,؛;\n]+/gu,
"|||"
)
.replace(
/\s+و?كمان\s+/giu,
"|||"
)
.replace(
/\s+و(?=\s*(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|عندي|عندى)(?:\s|$))/giu,
"|||"
)
.split("|||")
.map(
x=>x.trim()
)
.filter(Boolean);
}

function getSafetyClauseForTitle(
base,
title
){
const clauses=
splitSafetyClauses(
base
);

if(clauses.length<=1){
return String(base||"");
}

const keys=
extractScheduleKeywords(
title
)
.filter(
x=>x.length>=3
);

if(!keys.length){
return String(base||"");
}

let best=
String(base||"");

let bestScore=0;
let bestIndex=-1;

for(
let i=0;
i<clauses.length;
i++
){
const n=
normalizeArabicLoose(
clauses[i]
);

let score=0;

for(const k of keys){
if(
n.includes(
normalizeArabicLoose(k)
)
){
score+=
Math.max(
1,
k.length
);
}
}

if(score>bestScore){
bestScore=score;
best=clauses[i];
bestIndex=i;
}
}

if(
bestScore&&
bestIndex>=0
){
for(
let j=bestIndex+1;
j<clauses.length;
j++
){
const next=
clauses[j]||"";

const nn=
normalizeArabicLoose(
next
);

if(
hasExplicitAdvanceAlertRequest(
next
)||
/^(?:و?كمان\s+)?(?:و?نبهني\s+)?(?:قبله|قبلها|قبل الموعد|قبل المعاد)|تنبيه(?:ات)?\s+مسبق/u.test(nn)
){
best+=` ${next}`;
}
else{
break;
}
}

return best;
}

return String(base||"");
}

function hasExplicitEventDurationCue(text){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

return/(?:لمده(?:\s|$)|مدته(?:\s|$)|مدتها(?:\s|$)|مده\s+(?:الموعد|المعاد|الاجتماع|الكشف|الحجز)|كل\s+مره\s+مدت(?:ه|ها)|من\s+(?:الساعه\s*)?\d{1,2}(?::\d{1,2})?.{0,25}(?:ل|لحد|الي|الى)\s*(?:الساعه\s*)?\d{1,2}(?::\d{1,2})?)/iu.test(t);
}

function hasExplicitOccurrenceDurationCue(
text,
isInterval=false
){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

if(
/(?:مده\s+(?:كل\s+مره|المره)|كل\s+مره\s+مدت(?:ه|ها)|كل\s+تنبيه\s+مدت(?:ه|ها))/iu.test(t)
){
return true;
}

if(
/من\s+(?:الساعه\s*)?\d{1,2}(?::\d{1,2})?.{0,25}(?:ل|لحد|الي|الى)\s*(?:الساعه\s*)?\d{1,2}(?::\d{1,2})?/iu.test(t)
){
return true;
}

return(
!isInterval&&
hasExplicitEventDurationCue(t)
);
}

function wantsRemoveDuration(text){
const t=
normalizeArabicLoose(
text
);

return/(?:شيل|الغ|امسح|احذف).{0,25}(?:المده|مده الموعد|مده المعاد)|(?:من غير|بدون)\s+مده/iu.test(t);
}

function wantsRemoveAdvanceAlerts(text){
const t=
normalizeArabicLoose(
text
);

return/(?:شيل|الغ|امسح|احذف).{0,35}(?:التنبيه المسبق|التنبيهات المسبقه|التنبيهات المسبقة|تنبيه قبل|التنبيه قبل)|(?:من غير|بدون)\s+(?:تنبيه مسبق|تنبيه قبل|تنبيهات)/iu.test(t);
}

function hasExplicitAdvanceAlertRequest(text){
const t=
normalizeArabicLoose(
text
);

return/(?:نبهني|نبهنى|فكرني|فكرنى|ذكرني|ذكرنى|تنبيه).{0,45}قبل|(?:قبلها|قبله|قبل الموعد|قبل المعاد).{0,45}(?:نبهني|نبهنى|تنبيه)/iu.test(t);
}

function parseExplicitAdvanceOffsets(text){
if(
!hasExplicitAdvanceAlertRequest(
text
)
){
return[];
}

const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

const out=[];

const re=
/(?:قبل(?:ها|ه)?|قبل\s+(?:الموعد|المعاد|الدكتور|الاجتماع|الكشف|الحجز|الاذان|الأذان|اذان|صلاه|صلاة))\s*(?:ب)?\s*/gu;

const matches=[
...t.matchAll(re)
];

for(
let i=0;
i<matches.length;
i++
){
const start=
matches[i].index+
matches[i][0].length;

const end=
i+1<matches.length
?matches[i+1].index
:t.length;

let seg=
t.slice(
start,
end
);

const stop=
seg.search(
/(?:\s+وكمان\s+|\s+كمان\s+|،|;|؛)/u
);

if(stop>=0){
seg=
seg.slice(
0,
stop
);
}

const d=
parseDurationValuePhrase(
seg
);

if(
d!=null&&
d>0&&
d<=MAX_ADVANCE_ALERT_MINUTES
){
out.push(d);
}
}

if(!out.length){
const idx=
t.search(/قبل/u);

const d=
parseDurationValuePhrase(
idx>=0
?t.slice(idx+3)
:t
);

if(
d!=null&&
d>0&&
d<=MAX_ADVANCE_ALERT_MINUTES
){
out.push(d);
}
}

return[
...new Set(out)
].sort(
(a,b)=>b-a
);
}

function deriveExplicitEventDurationMinutes(
text,
item=null
){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

const marked=
parseDurationAfterMarkers(
t
);

if(marked!=null){
return marked;
}

if(item?.time){
const ranged=
parseRangeDurationMinutes(
t,
item.time
);

if(ranged!=null){
return ranged;
}
}

return null;
}

function parseDurationAfterMarkers(text){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

const m=
t.match(
/(?:لمده|مدته|مدتها|مده\s+(?:الموعد|المعاد|الاجتماع|الكشف|الحجز)|كل\s+مره\s+مدت(?:ه|ها))\s+(.{1,45})/u
);

if(!m){
return null;
}

return parseDurationValuePhrase(
m[1]
);
}

function parseDurationValuePhrase(value){
let s=
normalizeArabicLoose(
normalizeDigits(
value
)
)
.trim()
.replace(
/^(?:ب|بـ)+/u,
""
)
.trim();

if(!s){
return null;
}

if(
/^ساعه\s+الا\s+ربع/u.test(s)
){
return 45;
}

if(
/^ساعتين\s+الا\s+ربع/u.test(s)
){
return 105;
}

if(
/^ساعه\s+(?:و)?(?:تلت|ثلث)/u.test(s)
){
return 80;
}

if(
/^ساعتين\s+(?:و)?(?:تلت|ثلث)/u.test(s)
){
return 140;
}

let total=0;
let consumed=false;

for(
let guard=0;
guard<16&&s;
guard++
){
s=
s.replace(
/^و\s*/u,
""
)
.trim();

let m;

if(
(m=s.match(
/^(?:نص|نصف)\s+ساعه(?:\s|$)/u
))
){
total+=30;
s=s.slice(m[0].length).trim();
consumed=true;
continue;
}

if(
(m=s.match(
/^ربع\s+ساعه(?:\s|$)/u
))
){
total+=15;
s=s.slice(m[0].length).trim();
consumed=true;
continue;
}

if(
(m=s.match(
/^(?:تلت|ثلث)\s+ساعه(?:\s|$)/u
))
){
total+=20;
s=s.slice(m[0].length).trim();
consumed=true;
continue;
}

if(
(m=s.match(
/^ساعتين(?:\s|$)/u
))
){
total+=120;
s=s.slice(m[0].length).trim();
consumed=true;
continue;
}

if(
(m=s.match(
/^ساعه(?:\s|$)/u
))
){
total+=60;
s=s.slice(m[0].length).trim();
consumed=true;
continue;
}

if(
(m=s.match(
/^دقيقتين(?:\s|$)/u
))
){
total+=2;
s=s.slice(m[0].length).trim();
consumed=true;
continue;
}

if(
(m=s.match(
/^دقيقه(?:\s|$)/u
))
){
total+=1;
s=s.slice(m[0].length).trim();
consumed=true;
continue;
}

if(
(m=s.match(
/^(?:نص|نصف)(?:\s|$)/u
))&&
consumed
){
total+=30;
s=s.slice(m[0].length).trim();
continue;
}

if(
(m=s.match(
/^ربع(?:\s|$)/u
))&&
consumed
){
total+=15;
s=s.slice(m[0].length).trim();
continue;
}

if(
(m=s.match(
/^(?:تلت|ثلث)(?:\s|$)/u
))&&
consumed
){
total+=20;
s=s.slice(m[0].length).trim();
continue;
}

m=
s.match(
/^([\p{L}\d]+(?:\s+و?[\p{L}\d]+)?)\s*(دقيقه|دقايق|دقائق|ساعه|ساعات|يوم|ايام|اسبوع|اسابيع|شهر|شهور)(?:\s|$)/u
);

if(!m){
break;
}

const n=
egyptianNumberValue(
m[1]
);

if(n==null){
break;
}

const u=
m[2];

if(
/^دقيق/u.test(u)||
/دقايق|دقائق/u.test(u)
){
total+=n;
}
else if(
/^ساع/u.test(u)
){
total+=n*60;
}
else if(
/^يوم|ايام/u.test(u)
){
total+=n*1440;
}
else if(
/^اسبوع|اسابيع/u.test(u)
){
total+=n*10080;
}
else if(
/^شهر|شهور/u.test(u)
){
total+=n*43200;
}

consumed=true;

s=
s.slice(
m[0].length
).trim();
}

return(
consumed&&
total>0
)
?total
:null;
}

function extractDurationMentionsMinutes(text){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

const out=[];
const starts=[0];

for(
const m of t.matchAll(
/(?:^|\s)(?=(?:ب)?(?:نص|نصف|ربع|تلت|ثلث|ساعه|ساعتين|دقيقه|دقيقتين|\d+|[\p{L}]+))/gu
)
){
starts.push(
m.index+
(
m[0].startsWith(" ")
?1
:0
)
);
}

for(
const i of[
...new Set(starts)
]
){
const d=
parseDurationValuePhrase(
t.slice(i)
);

if(d!=null){
out.push(d);
}
}

return[
...new Set(out)
];
}

function parseRangeDurationMinutes(
text,
startHHMM
){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

const m=
t.match(
/من\s+(?:الساعه\s*)?(\d{1,2})(?::(\d{1,2}))?(?:\s*(صباح|الصبح|ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|مساء|المساء|بالليل|ليل))?.{0,18}(?:ل|لحد|الي|الى)\s*(?:الساعه\s*)?(\d{1,2})(?::(\d{1,2}))?(?:\s*(صباح|الصبح|ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|مساء|المساء|بالليل|ليل))?/u
);

if(
!m||
!validTime(
startHHMM
)
){
return null;
}

const startM=
Number(
startHHMM.slice(0,2)
)*60+
Number(
startHHMM.slice(3,5)
);

const endH=
Number(m[4]);

const endMin=
Number(
m[5]||0
);

if(
endH<1||
endH>12||
endMin>59
){
return null;
}

let candidates=[];

const period=
String(
m[6]||""
);

if(period){
const pm=
/(?:ظهر|ضهر|عصر|مغرب|مساء|ليل)/u.test(
period
);

let h=
endH%12;

if(pm){
h+=12;
}

candidates=[
h*60+
endMin
];
}
else{
candidates=[
(endH%12)*60+
endMin,
(endH%12+12)*60+
endMin
];
}

candidates=
candidates
.map(
x=>
x<=startM
?x+1440
:x
)
.filter(
x=>x>startM
);

if(!candidates.length){
return null;
}

const dur=
Math.min(...candidates)-
startM;

return(
dur>0&&
dur<=10080
)
?dur
:null;
}

function parseIntervalEveryMinutes(text){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

if(
/كل\s+(?:نص|نصف)\s+ساعه/u.test(t)
){
return 30;
}

if(
/كل\s+ربع\s+ساعه/u.test(t)
){
return 15;
}

if(
/كل\s+ساعتين(?:\s|$)/u.test(t)
){
return 120;
}

if(
/كل\s+ساعه(?:\s|$)/u.test(t)
){
return 60;
}

const m=
t.match(
/كل\s+(\d+|واحد|واحده|اتنين|اثنين|تنين|تلاته|ثلاثه|اربعه|خمسه|سته|سبعه|تمانيه|ثمانيه|تسعه|عشره|عشر|حداشر|احداشر|اتناشر|اثناشر)\s*(دقيقه|دقايق|دقائق|ساعه|ساعات)(?:\s|$)/u
);

if(!m){
return null;
}

const n=
arabicNumberValue(
m[1]
);

if(
n==null||
n<=0
){
return null;
}

return(
/^ساع/u.test(
m[2]
)
?n*60
:n
);
}

function parseExplicitOccurrenceCount(text){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

const m=
t.match(
/(?:لمده|عدد(?:هم|ها)?|لمجموع)\s+(\d+|واحد|واحده|اتنين|اثنين|تنين|تلاته|ثلاثه|اربعه|خمسه|سته|سبعه|تمانيه|ثمانيه|تسعه|عشره|عشر|حداشر|احداشر|اتناشر|اثناشر)\s*(?:مره|مرات)(?:\s|$)/u
);

if(!m){
return null;
}

const n=
arabicNumberValue(
m[1]
);

return(
n&&
n>0
)
?Math.trunc(n)
:null;
}

function parseDeterministicIntervalWindow(
text,
timeZone=TIME_ZONE
){
const everyMinutes=
parseIntervalEveryMinutes(
text
);

if(!everyMinutes){
return null;
}

const normalized=
normalizeArabicLoose(
normalizeDigits(
text
)
);

const windowMinutes=
parseDurationAfterMarkers(
normalized
);

const explicitCount=
parseExplicitOccurrenceCount(
text
);

let maxOccurrences=
explicitCount;

let effectiveWindow=
null;

if(windowMinutes!=null){
const byWindow=
Math.floor(
windowMinutes/
everyMinutes
);

if(byWindow<1){
return null;
}

maxOccurrences=
maxOccurrences==null
?byWindow
:Math.min(
maxOccurrences,
byWindow
);

effectiveWindow=
windowMinutes;
}

if(maxOccurrences==null){
return null;
}

const now=
localNowString(
timeZone
);

const startAt=
addMinutesLocal(
now,
everyMinutes,
timeZone
);

const lastAfterMinutes=
everyMinutes*
maxOccurrences;

const endAt=
addMinutesLocal(
now,
lastAfterMinutes,
timeZone
);

return{
everyMinutes,
maxOccurrences,
startAt,
endAt,
windowMinutes:
effectiveWindow||
lastAfterMinutes
};
}

function arabicNumberValue(value){
return egyptianNumberValue(
value
);
}

function finalSafetyCheck(
intent,
context
){
const base=
String(
context?.baseText||""
);

if(intent.needs_clarification){
if(
/(?:لا يدعم|مش مدعوم|غير مدعوم|غير متاح|لا يمكن للنظام|daily\s*\|\s*weekly)/iu.test(
String(
intent.question||""
)
)
){
throw new Error(
"Safety: الموديل ادعى أن نوع التكرار غير مدعوم"
);
}

return;
}

if(
intent.action==="chat"&&
looksLikeCreateRequest(
base
)
){
throw new Error(
"Safety: طلب مواعيد اتصنف كمحادثة عامة"
);
}

if(intent.action==="create"){
const expected=
estimateMinimumItems(
base
);

const actual=
intent.items.length+
intent.recurring_items.length;

if(
expected>1&&
actual<expected
){
throw new Error(
`Safety: الموديل أسقط عنصرًا (${actual}/${expected})`
);
}

const named=
extractNamedWeekdays(
base
);

if(
named.length===1&&
intent.items.length===1&&
!/(?:كل\s+)/iu.test(base)
){
if(
isoWeekday(
intent.items[0].date
)!==named[0]
){
throw new Error(
"Safety: التاريخ لا يطابق يوم الأسبوع المذكور"
);
}
}

const rel=
parseSimpleRelativeMinutes(
base
);

if(
rel!=null&&
intent.items.length===1&&
!/(?:بعد\s+(?:الدكتور|الاجتماع|المعاد|الموعد|الكشف))/iu.test(base)
){
const tz=
context?.timezone||
TIME_ZONE;

const expectedAt=
addMinutesLocal(
localNowString(tz),
rel,
tz
);

const actualAt=
`${intent.items[0].date} ${intent.items[0].time}`;

const delta=
Math.abs(
localDateTimeToEpoch(
expectedAt,
tz
)-
localDateTimeToEpoch(
actualAt,
tz
)
);

if(
delta>
2*60000
){
throw new Error(
"Safety: الحساب النسبي غير متطابق"
);
}
}

for(
const item of(
intent.items||[]
)
){
const clause=
getSafetyClauseForTitle(
base,
item.title
);

if(
Number(
item.duration_minutes||0
)>0&&
!hasExplicitEventDurationCue(
clause
)
){
throw new Error(
"Safety: مدة موعد غير مذكورة في طلب المستخدم"
);
}

if(
(item.advance_alerts||[]).length&&
!hasExplicitAdvanceAlertRequest(
clause
)
){
throw new Error(
"Safety: تنبيه مسبق غير مذكور في طلب المستخدم"
);
}
}

for(
const item of(
intent.recurring_items||[]
)
){
const clause=
getSafetyClauseForTitle(
base,
item.title
);

if(
Number(
item.duration_minutes||0
)>0&&
!hasExplicitOccurrenceDurationCue(
clause,
parseIntervalEveryMinutes(
clause
)!=null
)
){
throw new Error(
"Safety: مدة occurrence غير مذكورة صراحة"
);
}

if(
(item.advance_alerts||[]).length&&
!hasExplicitAdvanceAlertRequest(
clause
)
){
throw new Error(
"Safety: تنبيه مسبق متكرر غير مذكور في الطلب"
);
}
}
}
}

function clarificationIsObviouslyUnnecessary(
question,
baseText,
clarifications
){
const q=
String(
question||""
).toLowerCase();

if(
hasClearRelativeTime(
baseText
)&&
!findAmbiguous12HourTimesDetailed(
baseText
).length&&
/(?:الساعه|الساعة|اليوم|التاريخ|امتى|إمتى|متى)/iu.test(q)
){
return true;
}

const facts=
clarifications.flatMap(
c=>
Array.isArray(
c?.facts
)
?c.facts
:[]
);

const mer=
facts.some(
f=>
f?.kind==="all_meridiem"||
f?.kind==="meridiem"
);

return(
mer&&
/(?:صباح|مساء|ليل|ظهر|عصر|مغرب|am\b|pm\b)/iu.test(q)
);
}

function classifyClarificationQuestion(
question,
baseText
){
const q=
String(
question||""
);

const ambiguous=
findAmbiguous12HourTimesDetailed(
baseText
);

if(
/(?:صباح|مساء).*(?:ولا|أو).*(?:صباح|مساء)|(?:صباحًا|صباحا)\s+ولا\s+(?:مساءً|مساء)/iu.test(q)
){
return{
type:
ambiguous.length>1
?"meridiem_multi"
:"meridiem_single",
meta:{
times:
ambiguous.map(
compactAmbiguousTime
)
}
};
}

if(
/(?:الساعه\s+كام|الساعة\s+كام|الوقت\s+ايه|الوقت\s+إيه|تحب.*الساعه\s+كام|تحب.*الساعة\s+كام)/iu.test(q)
){
return{
type:
/(?:بعد|عقب|بعده|بعدها)/iu.test(q)
?"reference_time"
:"missing_time",
meta:{}
};
}

if(
/(?:إمتى|امتى|متى)/iu.test(q)
){
return{
type:"missing_when",
meta:{}
};
}

return{
type:"generic",
meta:{}
};
}

function normalizeClarificationReply(
pending,
replyText
){
const answer=
String(
replyText||""
).trim();

const type=
String(
pending.question_type||
"generic"
);

const meta=
parseJsonObject(
pending.question_meta
);

const entry={
question:
String(
pending.question||""
),
question_type:type,
answer,
interpretation:"",
facts:[]
};

if(
type==="meridiem_single"||
type==="meridiem_multi"
){
const p=
detectSinglePeriodMeaning(
answer
);

if(p){
const times=
Array.isArray(
meta.times
)
?meta.times
:[];

if(
type==="meridiem_single"
){
entry.facts.push({
kind:"meridiem",
applies_to:times,
value:p.code
});

entry.interpretation=
`الوقت المقصود = ${p.arabic}.`;
}
else if(
isBlanketPeriodReply(
answer
)
){
entry.facts.push({
kind:"all_meridiem",
applies_to:times,
value:p.code
});

entry.interpretation=
`كل الأوقات التي كان السؤال يشير إليها = ${p.arabic}.`;
}
}
}

if(
type==="missing_time"||
type==="reference_time"
){
entry.interpretation=
`الوقت الذي حدده المستخدم هو: ${answer}.`;
}

if(
type==="missing_when"
){
entry.interpretation=
`المستخدم حدد موعد الطلب بهذه الإجابة: ${answer}.`;
}

return entry;
}

function replyLikelyAnswersPending(
pending,
text
){
const type=
String(
pending.question_type||
"generic"
);

const t=
normalizeTimeWords(
normalizeDigits(
String(
text||""
)
)
);

if(
[
"meridiem_single",
"meridiem_multi"
].includes(type)
){
return!!detectSinglePeriodMeaning(
t
);
}

if(
[
"missing_time",
"reference_time"
].includes(type)
){
return(
hasExplicitClock(t)||
hasClearRelativeTime(t)||
/\b(?:[1-9]|1[0-2])\s*(?:صباح|ظهر|عصر|مغرب|مساء|بالليل|ليل)\b/iu.test(t)
);
}

if(
type==="missing_when"
){
return(
hasExplicitClock(t)||
hasClearRelativeTime(t)||
hasExplicitDateCue(t)
);
}

return!
looksLikeIndependentNewRequest(
t
);
}

function looksLikeIndependentNewRequest(text){
const t=
String(
text||""
).trim();

return(
/^(?:\/)/u.test(t)||
looksLikeCreateRequest(t)||
/(?:امسح|احذف|غير|غيّر|عدل|عدّل|وقف|شغل|استكمل|مواعيدي|جدولنا|عندي اي|عندى اي)/iu.test(t)
);
}

function analyzeHardAmbiguity(
originalText
){
const text=
normalizeTimeWords(
normalizeDigits(
String(
originalText||""
)
)
).trim();

if(
!looksLikeCreateRequest(
text
)
){
return null;
}

if(
hasClearRelativeTime(
text
)&&
!hasExplicitClock(
text
)
){
return null;
}

const ambiguous=
findAmbiguous12HourTimesDetailed(
text
).filter(x=>!isReferenceOnlyClock(text,x));

if(
ambiguous.length===1
){
return{
type:"meridiem_single",
question:
`${ambiguous[0].label} صباحًا ولا مساءً؟`,
meta:{
times:
ambiguous.map(
compactAmbiguousTime
)
}
};
}

if(
ambiguous.length>1
){
return{
type:"meridiem_multi",
question:
`الأوقات ${ambiguous.map(x=>x.label).join("، ")} كلهم صباحًا ولا مساءً؟ ولو مختلفين قولّي كل واحد.`,
meta:{
times:
ambiguous.map(
compactAmbiguousTime
)
}
};
}

return null;
}

function compactAmbiguousTime(x){
return{
hour:x.hour,
minute:x.minute,
label:x.label
};
}

function looksLikeCreateRequest(text){
const t=
String(
text||""
).trim();

if(
/^(?:\/)/u.test(t)
){
return false;
}

return/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|عايزك\s+تفكرني|عاوزك\s+تفكرني|خلي(?:ني|نى)?\s+افتكر|عندي\s+(?:دكتور|طبيب|كشف|اجتماع|حجز|مقابله|مقابلة|موعد)|عندى\s+(?:دكتور|طبيب|كشف|اجتماع|حجز|مقابله|مقابلة|موعد)|كل\s+(?:\d+|نص|ربع|ساعه|ساعة|يوم|اسبوع|أسبوع|شهر))/iu.test(t);
}

function hasExplicitClock(text){
const t=
normalizeTimeWords(
normalizeDigits(
text
)
);

const period=
"(?:صباح(?:ًا|ا)?|الصبح|صبح|ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|مساء(?:ً|ا)?|المساء|بالليل|ليل|الفجر|am|pm)";

return(
new RegExp(
`(?:الساعة|الساعه)\\s*(?:\\d{1,2}(?::\\d{1,2})?)(?:\\s*(?:ونص|و\\s*نص|وربع|و\\s*ربع|إلا\\s*ربع|الا\\s*ربع))?`,
"iu"
).test(t)||
/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/u.test(t)||
new RegExp(
`\\b(?:1[0-2]|[1-9])(?:\\s*[:٫.]\\s*[0-5]?\\d)?\\s*${period}`,
"iu"
).test(t)
);
}

function hasClearRelativeTime(text){
const t=
normalizeDigits(
text
)
.replace(
/ـ/g,
" "
)
.replace(
/\s+/g,
" "
)
.trim();

const n=
"(?:\\d+|واحد(?:ة)?|اتنين|اثنين|تنين|تلاتة|ثلاثة|اربعة|أربعة|خمسة|خمس|ستة|ست|سبعة|سبع|تمانية|ثمانية|تمنية|تسعة|تسع|عشرة|عشر|حداشر|احداشر|اتناشر|اثناشر)";

const unit=
"(?:دقيقة|دقيقه|دقايق|دقائق|ساعة|ساعه|ساعتين|ساعتان|ساعات)";

return[
new RegExp(
`(?:بعد|بعدها|كمان)\\s*(?:ب|بـ)?\\s*${n}\\s*${unit}`,
"iu"
),
/(?:بعد|بعدها|كمان)\s*(?:ب|بـ)?\s*(?:نص|نصف|ربع|تلت|ثلث)\s*(?:ساعة|ساعه)/iu,
/(?:بعد|بعدها|كمان)\s*(?:ب|بـ)?\s*(?:ساعة|ساعه|ساعتين|ساعتان)/iu
].some(
re=>re.test(t)
);
}

function hasExplicitDateCue(text){
const t=
normalizeDigits(
text
);

return(
/(?:النهاردة|النهارده|اليوم|بكرة|بكره|غدًا|غداً|غدا|بعد\s+بكرة|بعد\s+بكره|السبت|الأحد|الاحد|الإثنين|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة)/iu.test(t)||
/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/u.test(t)||
/(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)/iu.test(t)
);
}

function findAmbiguous12HourTimesDetailed(text){
const t=
normalizeTimeWords(
normalizeDigits(
text
)
);

const regex=
/(?:الساعة|الساعه)\s*(1[0-2]|[1-9])(?:\s*[:٫.]\s*([0-5]?\d)|\s*(ونص|و\s*نص|وربع|و\s*ربع|إلا\s*ربع|الا\s*ربع))?/giu;

const matches=[];

let m;

while(
(m=regex.exec(t))!==null
){
const suffix=
String(
m[3]||""
)
.replace(
/\s+/g,
" "
)
.trim();

const minute=
m[2]
?String(
m[2]
).padStart(
2,
"0"
)
:/نص/u.test(suffix)
?"30"
:/ربع/u.test(suffix)
?"15"
:"";

matches.push({
index:m.index,
end:regex.lastIndex,
hour:Number(m[1]),
minute,
label:
m[0]
.replace(
/^الساعه/u,
"الساعة"
)
.replace(
/\s+/g,
" "
)
.trim()
});
}

const period=
/(?:صباح(?:ًا|ا)?|الصبح|صبح|ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|مساء(?:ً|ا)?|المساء|بالليل|ليل|الفجر|am\b|pm\b)/iu;

return matches.filter(
(cur,i)=>{
const next=
matches[i+1];

const before=
i===0
?t.slice(
Math.max(
0,
cur.index-50
),
cur.index
)
:"";

const after=
t.slice(
cur.end,
next
?next.index
:t.length
);

return!
period.test(
`${before} ${after}`
);
}
);
}

function detectSinglePeriodMeaning(text){
const t=
String(
text||""
).toLowerCase();

const found=[];

if(
/(?:صباح|الصبح|صبح|الفجر|am\b)/iu.test(t)
){
found.push({
code:"AM",
arabic:"صباحًا"
});
}

if(
/(?:ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|مساء|المساء|بالليل|ليل|pm\b)/iu.test(t)
){
found.push({
code:"PM",
arabic:"مساءً"
});
}

const unique=[
...new Map(
found.map(
x=>[x.code,x]
)
).values()
];

return(
unique.length===1
)
?unique[0]
:null;
}

function isBlanketPeriodReply(text){
const t=
normalizeArabicLoose(
text
);

return(
/^(?:صباح|الصبح|مساء|بالليل|ليل|العصر|المغرب)$/u.test(t)||
/(?:كلهم|كلها|كله|جميعهم|الجميع|التلاته|الثلاثه|الاتنين|الاثنين)/u.test(t)
);
}

function estimateMinimumItems(text){
const t=
normalizeTimeWords(
normalizeDigits(
String(
text||""
)
)
);

const clocks=
findAllClockMentionsDetailed(t).filter(x=>!isReferenceOnlyClock(t,x));

const rel=
t.match(
/(?:بعدها|بعد|كمان)\s*(?:ب|بـ)?\s*(?:(?:\d+)\s*)?(?:دقيقة|دقيقه|دقايق|دقائق|ساعة|ساعه|ساعتين|ساعتان|نص\s*ساعة|نص\s*ساعه|ربع\s*ساعة|ربع\s*ساعه)/giu
)||[];

return Math.max(
1,
Math.min(
clocks.length+
rel.length,
20
)
);
}


function findAllClockMentionsDetailed(text){
const t=normalizeTimeWords(normalizeDigits(String(text||"")));
const re=/(?:الساعة|الساعه)\s*(1[0-2]|[1-9])(?:\s*[:٫.]\s*([0-5]?\d)|\s*(ونص|و\s*نص|وربع|و\s*ربع|إلا\s*ربع|الا\s*ربع))?(?:\s*(صباح(?:ًا|ا)?|الصبح|صبح|ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|مساء(?:ً|ا)?|المساء|بالليل|ليل|الفجر|am|pm))?/giu;
const out=[];let m;
while((m=re.exec(t))!==null)out.push({index:m.index,end:re.lastIndex,hour:Number(m[1]),minute:m[2]?Number(m[2]):/نص/u.test(m[3]||"")?30:/ربع/u.test(m[3]||"")?15:0,period:String(m[4]||""),label:m[0]});
return out;
}
function isReferenceOnlyClock(text,clock){
const t=normalizeArabicLoose(normalizeDigits(String(text||""))),start=Math.max(0,Number(clock?.index||0)),before=t.slice(0,start),near=t.slice(Math.max(0,start-100),start),after=t.slice(Number(clock?.end||start),Math.min(t.length,Number(clock?.end||start)+90));
const causal=/(?:عشان|علشان|لان|لأن|بحيث|علي شان|على شان)[^.!؟\n]{0,95}$/u.test(near);
const purpose=/(?:عشان|علشان|لان|لأن|بحيث)[^.!؟\n]{0,130}(?:ييجي|تيجي|تجي|ياخد|تاخد|اخد|تدي|يدي|نعمل|اعمل|يعمل|تعمل|يكون|تبقي|تبقى)/u.test(`${near} ${after}`);
const priorAction=/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|عندي|عندى|موعد|ميعاد|معاد)/u.test(before);
return !!(priorAction&&(causal||purpose));
}
function resolveFirstActionClock(text){
const t=normalizeTimeWords(normalizeDigits(String(text||""))),all=findAllClockMentionsDetailed(t);
for(const c of all){if(isReferenceOnlyClock(t,c))continue;const around=t.slice(Math.max(0,c.index-35),Math.min(t.length,c.end+50));if(/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|عندي|عندى|موعد|ميعاد|معاد)/iu.test(around))return c;}
return all.find(c=>!isReferenceOnlyClock(t,c))||null;
}
function clockTo24(c){
if(!c)return null;let h=Number(c.hour),m=Number(c.minute||0);const p=normalizeArabicLoose(c.period||"");if(/(?:مساء|المساء|ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|بالليل|ليل|pm)/u.test(p)){if(h<12)h+=12;}else if(/(?:صباح|الصبح|صبح|الفجر|am)/u.test(p)){if(h===12)h=0;}else return null;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function applyReferenceClockSafety(intent,base){
if(intent?.action!=="create"||!Array.isArray(intent.items)||intent.items.length<2)return;
const refs=findAllClockMentionsDetailed(base).filter(c=>isReferenceOnlyClock(base,c));if(!refs.length)return;
const primaryTime=clockTo24(resolveFirstActionClock(base));let keep=primaryTime?intent.items.find(x=>String(x.time)===primaryTime):null;if(!keep)keep=intent.items[0];intent.items=[keep];
}

function extractNamedWeekdays(text){
const t=
normalizeArabicLoose(
text
);

const map=[
{
n:1,
re:/(?:^|\s)و?(?:الاثنين|اثنين|الاتنين|اتنين)(?:\s|$)/u
},
{
n:2,
re:/(?:^|\s)و?(?:الثلاثاء|ثلاثاء|التلات|تلات)(?:\s|$)/u
},
{
n:3,
re:/(?:^|\s)و?(?:الاربعاء|اربعاء|الاربع|اربع)(?:\s|$)/u
},
{
n:4,
re:/(?:^|\s)و?(?:الخميس|خميس)(?:\s|$)/u
},
{
n:5,
re:/(?:^|\s)و?(?:الجمعه|جمعه)(?:\s|$)/u
},
{
n:6,
re:/(?:^|\s)و?(?:السبت|سبت)(?:\s|$)/u
},
{
n:7,
re:/(?:^|\s)و?(?:الاحد|احد|الحد|حد)(?:\s|$)/u
}
];

return map
.filter(
x=>x.re.test(t)
)
.map(
x=>x.n
);
}

function parseSimpleRelativeMinutes(text){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

let m=
t.match(
/(?:بعد|كمان)\s*(\d+)\s*(دقيقه|دقايق|دقائق|ساعه|ساعات)/u
);

if(m){
return(
Number(
m[1]
)*
(
/ساع/u.test(
m[2]
)
?60
:1
)
);
}

if(
/(?:بعد|كمان)\s*(?:نص|نصف)\s*ساع/u.test(t)
){
return 30;
}

if(
/(?:بعد|كمان)\s*ربع\s*ساع/u.test(t)
){
return 15;
}

if(
/(?:بعد|كمان)\s*ساعتين/u.test(t)
){
return 120;
}

if(
/(?:بعد|كمان)\s*ساعه/u.test(t)
){
return 60;
}

return null;
}

async function ensureUserProfile(
env,
chatId
){
const now=
new Date().toISOString();

await env.DB.prepare(`
INSERT OR IGNORE INTO user_profiles(
chat_id,
timezone,
city,
country,
country_code,
locale,
debug_mode,
updated_at
)
VALUES(
?,?,?,?,?,
'ar-EG',
0,
?
)
`)
.bind(
chatId,
TIME_ZONE,
DEFAULT_CITY,
DEFAULT_COUNTRY,
DEFAULT_COUNTRY_CODE,
now
)
.run();

return getUserProfile(
env,
chatId
);
}

async function getUserProfile(
env,
chatId
){
const r=
await env.DB.prepare(`
SELECT *
FROM user_profiles
WHERE chat_id=?
LIMIT 1
`)
.bind(chatId)
.first();

if(r){
return{
chat_id:
String(chatId),
timezone:
String(
r.timezone||
TIME_ZONE
),
city:
String(
r.city||
DEFAULT_CITY
),
country:
String(
r.country||
DEFAULT_COUNTRY
),
country_code:
String(
r.country_code||
DEFAULT_COUNTRY_CODE
).toUpperCase(),
latitude:
r.latitude==null
?null
:Number(
r.latitude
),
longitude:
r.longitude==null
?null
:Number(
r.longitude
),
locale:
String(
r.locale||
"ar-EG"
),
debug_mode:
Number(
r.debug_mode||0
)
};
}

return ensureUserProfile(
env,
chatId
);
}

async function handleUserLocation(
env,
chatId,
loc
){
const lat=
Number(
loc.latitude
);

const lon=
Number(
loc.longitude
);

if(
!Number.isFinite(lat)||
!Number.isFinite(lon)
){
throw new Error(
"الموقع غير صالح."
);
}

const temp={
...(await getUserProfile(
env,
chatId
)),
latitude:lat,
longitude:lon
};

let tz=
temp.timezone;

try{
const p=
await fetchPrayerDay(
env,
temp,
zonedNow(
temp.timezone
).date,
true
);

if(p?.timezone){
tz=p.timezone;
}
}
catch{}

const cc=
inferCountryCodeFromTimezone(
tz,
temp.country_code
);

const now=
new Date().toISOString();

await env.DB.prepare(`
UPDATE user_profiles
SET latitude=?,
longitude=?,
timezone=?,
country_code=?,
city=?,
updated_at=?
WHERE chat_id=?
`)
.bind(
lat,
lon,
tz,
cc,
"موقعي الحالي",
now,
chatId
)
.run();

const profile=
await getUserProfile(
env,
chatId
);

const reality=
await buildLiveRealityContext(
env,
chatId,
"الوقت والصلاة اليوم",
profile,
true
);

await sendText(
env,
chatId,
`📍 تم حفظ موقعك.
🕒 المنطقة الزمنية: ${profile.timezone}

${reality.short}`,
quickMenuKeyboard()
);
}

function inferCountryCodeFromTimezone(
tz,
fallback="EG"
){
const map={
"Africa/Cairo":"EG",
"Asia/Riyadh":"SA",
"Asia/Dubai":"AE",
"Asia/Kuwait":"KW",
"Asia/Qatar":"QA",
"Asia/Bahrain":"BH",
"Asia/Muscat":"OM",
"Asia/Amman":"JO",
"Asia/Beirut":"LB",
"Asia/Baghdad":"IQ",
"Asia/Damascus":"SY",
"Africa/Casablanca":"MA",
"Africa/Tunis":"TN",
"Africa/Algiers":"DZ",
"Africa/Tripoli":"LY",
"Europe/Istanbul":"TR",
"Asia/Jerusalem":"IL",
"Europe/London":"GB",
"Europe/Paris":"FR",
"Europe/Berlin":"DE",
"Europe/Rome":"IT",
"Europe/Madrid":"ES",
"America/New_York":"US",
"America/Chicago":"US",
"America/Los_Angeles":"US",
"Asia/Tokyo":"JP",
"Asia/Shanghai":"CN",
"Asia/Kolkata":"IN"
};

return(
map[tz]||
String(
fallback||"EG"
).toUpperCase()
);
}

async function getUserMemories(
env,
chatId,
limit=30
){
return(
await env.DB.prepare(`
SELECT id,memory,created_at
FROM user_memories
WHERE chat_id=?
ORDER BY id DESC
LIMIT ?
`)
.bind(
chatId,
clamp(
Number(
limit||30
),
1,
100
)
)
.all()
)?.results||[];
}

async function addUserMemory(
env,
chatId,
memory
){
const m=
String(
memory||""
).trim().slice(0,1000);

const n=
normalizeArabicLoose(
m
);

if(
!m||
n.length<2
){
return false;
}

await env.DB.prepare(`
INSERT OR IGNORE INTO user_memories(
chat_id,
memory,
normalized,
created_at
)
VALUES(
?,?,?,?
)
`)
.bind(
chatId,
m,
n,
new Date().toISOString()
)
.run();

return true;
}

async function forgetUserMemory(
env,
chatId,
query
){
const q=
normalizeArabicLoose(
query
);

if(!q){
return 0;
}

const rows=(
await env.DB.prepare(`
SELECT id,normalized
FROM user_memories
WHERE chat_id=?
ORDER BY id DESC
LIMIT 200
`)
.bind(chatId)
.all()
)?.results||[];

const ids=
rows
.filter(
r=>
String(
r.normalized||""
).includes(q)||
q.includes(
String(
r.normalized||""
)
)
)
.map(
r=>Number(r.id)
);

if(!ids.length){
return 0;
}

const res=
await env.DB.batch(
ids.map(
id=>
env.DB.prepare(`
DELETE FROM user_memories
WHERE id=?
AND chat_id=?
`)
.bind(
id,
chatId
)
)
);

return res.reduce(
(n,x)=>
n+
Number(
x?.meta?.changes||0
),
0
);
}

async function handleLifeDirectCommands(
env,
chatId,
text
){
const raw=
String(
text||""
).trim();

const t=
normalizeArabicLoose(
raw
);

if(
/^\/where$/u.test(t)||
/^(?:انا فين|الوقت عندي|الوقت والتاريخ عندي)$/u.test(t)
){
const p=
await getUserProfile(
env,
chatId
);

const r=
await buildLiveRealityContext(
env,
chatId,
"الوقت والتاريخ والصلاة",
p,
true
);

await sendText(
env,
chatId,
r.short,
quickMenuKeyboard()
);

return true;
}

if(
/^\/live$/u.test(t)||
/^(?:ملخص الواقع|ايه المناسبه النهارده|اي المناسبه النهارده)$/u.test(t)
){
const p=
await getUserProfile(
env,
chatId
);

const r=
await buildLiveRealityContext(
env,
chatId,
raw,
p,
true
);

await sendText(
env,
chatId,
r.text,
quickMenuKeyboard()
);

return true;
}

if(
/^\/memory$/u.test(t)||
/^(?:ذاكرتك عني|فاكر عني ايه|فاكر عني اي)$/u.test(t)
){
const rows=
await getUserMemories(
env,
chatId,
50
);

await sendText(
env,
chatId,
rows.length
?`💭 الحاجات اللي طلبت مني أفتكرها:

${rows.map(x=>`• ${x.memory}`).join("\n")}`
:"💭 مفيش معلومات محفوظة في ذاكرتي طويلة المدى لسه.",
quickMenuKeyboard()
);

return true;
}

let m=
raw.match(
/^(?:افتكر\s+ان|افتكر\s+إن|خلي\s+بالك\s+ان|خلي\s+بالك\s+إن|سجل\s+عندك\s+ان|سجل\s+عندك\s+إن)\s+(.+)$/iu
);

if(m){
await addUserMemory(
env,
chatId,
m[1]
);

await sendText(
env,
chatId,
"💭 تمام، حفظتها وهفتكرها في كلامنا الجاي.",
quickMenuKeyboard()
);

return true;
}

m=
raw.match(
/^(?:انسى|انسي|انسَ|امسح\s+من\s+ذاكرتك)\s+(.+)$/iu
);

if(m){
const n=
await forgetUserMemory(
env,
chatId,
m[1]
);

await sendText(
env,
chatId,
n
?"🧹 تمام، شلتها من ذاكرتي."
:"مش لاقي معلومة محفوظة مطابقة للكلام ده.",
quickMenuKeyboard()
);

return true;
}

m=
raw.match(
/^\/setcity\s+(.+)$/iu
);

if(m){
const city=
m[1].trim().slice(0,120);

const p=
await getUserProfile(
env,
chatId
);

const temp={
...p,
city,
latitude:null,
longitude:null
};

let tz=
p.timezone;

try{
const pd=
await fetchPrayerDay(
env,
temp,
zonedNow(
p.timezone
).date,
true
);

if(pd?.timezone){
tz=pd.timezone;
}
}
catch{}

await env.DB.prepare(`
UPDATE user_profiles
SET city=?,
latitude=NULL,
longitude=NULL,
timezone=?,
updated_at=?
WHERE chat_id=?
`)
.bind(
city,
tz,
new Date().toISOString(),
chatId
)
.run();

await sendText(
env,
chatId,
`📍 تمام، خليت مدينتك ${city} والمنطقة الزمنية ${tz}.`,
quickMenuKeyboard()
);

return true;
}

m=
raw.match(
/^\/country\s+([A-Za-z]{2})$/u
);

if(m){
await env.DB.prepare(`
UPDATE user_profiles
SET country_code=?,
updated_at=?
WHERE chat_id=?
`)
.bind(
m[1].toUpperCase(),
new Date().toISOString(),
chatId
)
.run();

await sendText(
env,
chatId,
"🌍 تم تحديث كود الدولة.",
quickMenuKeyboard()
);

return true;
}

if(
isAdmin(
env,
chatId
)&&
(
m=raw.match(
/^\/debug\s+(on|off)$/i
)
)
){
await env.DB.prepare(`
UPDATE user_profiles
SET debug_mode=?,
updated_at=?
WHERE chat_id=?
`)
.bind(
m[1].toLowerCase()==="on"
?1
:0,
new Date().toISOString(),
chatId
)
.run();

await sendText(
env,
chatId,
`🛠️ Debug ${m[1].toLowerCase()==="on"?"ON":"OFF"}.`,
quickMenuKeyboard()
);

return true;
}

const prayerBatch=parseRecurringPrayerAnchors(raw);
if(prayerBatch.length>1){
const profile=await getUserProfile(env,chatId);
const now=zonedNow(profile.timezone);
const ts=new Date().toISOString();
const statements=prayerBatch.map(pr=>env.DB.prepare(`
INSERT INTO prayer_rules(chat_id,title,prayer,offset_minutes,start_date,end_date,weekdays_json,max_occurrences,fired_count,active,paused_until,exceptions_json,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,?,0,1,NULL,'[]',?,?)
`).bind(chatId,pr.title,pr.prayer,pr.offset,now.date,JSON.stringify(pr.weekdays),pr.max_occurrences,ts,ts));
await env.DB.batch(statements);
const lines=prayerBatch.map(pr=>`🕌 ${formatPrayerRule({...pr,start_date:now.date,active:1})}${pr.max_occurrences?` · ${pr.max_occurrences} مرات`:""} — ${pr.title}`);
await sendText(env,chatId,`✅ تم حفظ ${prayerBatch.length} تذكيرات مرتبطة بمواقيت الصلاة اليومية:

${lines.join("\n")}`,quickMenuKeyboard());
return true;
}

const pr=prayerBatch[0]||parseRecurringPrayerAnchor(raw);

if(pr){
const profile=
await getUserProfile(
env,
chatId
);

const now=
zonedNow(
profile.timezone
);

const ts=
new Date().toISOString();

await env.DB.prepare(`
INSERT INTO prayer_rules(
chat_id,
title,
prayer,
offset_minutes,
start_date,
end_date,
weekdays_json,
max_occurrences,
fired_count,
active,
paused_until,
exceptions_json,
created_at,
updated_at
)
VALUES(
?,?,?,?,?,
NULL,
?,?,
0,
1,
NULL,
'[]',
?,?
)
`)
.bind(
chatId,
pr.title,
pr.prayer,
pr.offset,
now.date,
JSON.stringify(
pr.weekdays
),
pr.max_occurrences,
ts,
ts
)
.run();

await sendText(
env,
chatId,
`✅ تم الحفظ:

🕌 ${formatPrayerRule({...pr,start_date:now.date,active:1})}${pr.max_occurrences?` · ${pr.max_occurrences} مرات`:""} — ${pr.title}`,
quickMenuKeyboard()
);

return true;
}

m=
raw.match(
/^(?:تابعلي|تابع لي|راقبلي|راقب لي|بلغني لو حصل جديد في|بلغني لو فيه جديد في)\s+(.+)$/iu
);

if(m){
const qAr=
m[1].trim().slice(0,300);

const qEn=
await translateLiveQuery(
env,
qAr
);

const latest=
await fetchGdeltNews(
qEn,
1
);

const last=
latest[0]?.url||
null;

await env.DB.prepare(`
INSERT INTO live_watches(
chat_id,
query_ar,
query_en,
last_url,
active,
created_at,
updated_at
)
VALUES(
?,?,?,?,1,?,?
)
`)
.bind(
chatId,
qAr,
qEn,
last,
new Date().toISOString(),
new Date().toISOString()
)
.run();

await sendText(
env,
chatId,
`👀 تمام، هتابع «${qAr}» وهبلغك لما يظهر تطور جديد في مصدر الأخبار الحي.`,
quickMenuKeyboard()
);

return true;
}

if(
/^\/watches$/u.test(t)||
t==="المتابعات"
){
const rows=(
await env.DB.prepare(`
SELECT *
FROM live_watches
WHERE chat_id=?
AND active=1
ORDER BY id DESC
LIMIT 20
`)
.bind(chatId)
.all()
)?.results||[];

await sendText(
env,
chatId,
rows.length
?`👀 المتابعات النشطة:
${rows.map(r=>`• ${r.query_ar}`).join("\n")}`
:"👀 مفيش متابعات حية نشطة.",
quickMenuKeyboard()
);

return true;
}

m=
raw.match(
/^(?:وقف\s+متابعه|وقف\s+متابعة|الغ\s+متابعه|الغي\s+متابعة)\s+(.+)$/iu
);

if(m){
const q=
normalizeArabicLoose(
m[1]
);

const rows=(
await env.DB.prepare(`
SELECT id,query_ar
FROM live_watches
WHERE chat_id=?
AND active=1
`)
.bind(chatId)
.all()
)?.results||[];

const ids=
rows
.filter(
r=>
normalizeArabicLoose(
r.query_ar
).includes(q)||
q.includes(
normalizeArabicLoose(
r.query_ar
)
)
)
.map(
r=>r.id
);

if(ids.length){
await env.DB.batch(
ids.map(
id=>
env.DB.prepare(`
UPDATE live_watches
SET active=0,
updated_at=?
WHERE id=?
AND chat_id=?
`)
.bind(
new Date().toISOString(),
id,
chatId
)
)
);
}

await sendText(
env,
chatId,
ids.length
?"✅ وقفت المتابعة."
:"ملقتش متابعة مطابقة.",
quickMenuKeyboard()
);

return true;
}

return false;
}

function cleanPrayerTime(v){
const m=
String(
v||""
).match(
/(\d{1,2}:\d{2})/
);

return m
?m[1].padStart(
5,
"0"
)
:"";
}

function prayerMethodForProfile(p){
return(
String(
p?.country_code||""
).toUpperCase()==="EG"
?5
:3
);
}

async function cacheGet(
env,
key
){
const now=
new Date().toISOString();

const r=
await env.DB.prepare(`
SELECT value_json
FROM live_cache
WHERE cache_key=?
AND expires_at>?
LIMIT 1
`)
.bind(
key,
now
)
.first();

return r
?parseJsonObject(
r.value_json
)
:null;
}

async function cachePut(
env,
key,
value,
ttlMin
){
const now=
new Date();

const exp=
new Date(
now.getTime()+
ttlMin*60000
);

await env.DB.prepare(`
INSERT INTO live_cache(
cache_key,
value_json,
expires_at,
updated_at
)
VALUES(
?,?,?,?
)
ON CONFLICT(cache_key)
DO UPDATE SET
value_json=excluded.value_json,
expires_at=excluded.expires_at,
updated_at=excluded.updated_at
`)
.bind(
key,
JSON.stringify(value),
exp.toISOString(),
now.toISOString()
)
.run();

return value;
}

function toAladhanDate(iso){
const[
y,
m,
d
]=iso.split("-");

return`${d}-${m}-${y}`;
}

async function fetchPrayerDay(
env,
profile,
date,
force=false
){
const method=
prayerMethodForProfile(
profile
);

const loc=
profile.latitude!=null&&
profile.longitude!=null
?`${Number(profile.latitude).toFixed(5)},${Number(profile.longitude).toFixed(5)}`
:`${profile.city},${profile.country}`;

const key=
`prayer:${loc}:${date}:m${method}`;

if(!force){
const c=
await cacheGet(
env,
key
);

if(c){
return c;
}
}

const d=
toAladhanDate(
date
);

let url;

if(
profile.latitude!=null&&
profile.longitude!=null
){
url=
`https://api.aladhan.com/v1/timings/${encodeURIComponent(d)}?latitude=${encodeURIComponent(profile.latitude)}&longitude=${encodeURIComponent(profile.longitude)}&method=${method}`;
}
else{
url=
`https://api.aladhan.com/v1/timingsByAddress/${encodeURIComponent(d)}?address=${encodeURIComponent(`${profile.city}, ${profile.country}`)}&method=${method}`;
}

const r=
await fetch(
url,
{
headers:{
accept:"application/json"
}
}
);

if(!r.ok){
throw new Error(
`Prayer API HTTP ${r.status}`
);
}

const j=
await r.json();

const data=
j?.data;

if(
!data?.timings
){
throw new Error(
"Prayer API data missing"
);
}

const timings={};

for(
const k of[
"Fajr",
"Sunrise",
"Dhuhr",
"Asr",
"Maghrib",
"Isha"
]
){
timings[k]=
cleanPrayerTime(
data.timings[k]
);
}

const out={
date,
timings,
hijri:
data?.date?.hijri||
null,
timezone:
String(
data?.meta?.timezone||
profile.timezone||
TIME_ZONE
),
method:
Number(
data?.meta?.method?.id??
method
)
};

return cachePut(
env,
key,
out,
PRAYER_CACHE_TTL_MINUTES
);
}

async function fetchPublicHolidays(
env,
profile,
year
){
const cc=
String(
profile.country_code||
DEFAULT_COUNTRY_CODE
).toUpperCase();

const key=
`holidays:${cc}:${year}`;

const c=
await cacheGet(
env,
key
);

if(c){
return(
Array.isArray(
c.items
)
?c.items
:[]
);
}

let items=[];

for(
const url of[
`https://date.nager.at/api/v4/Holidays/${encodeURIComponent(cc)}/${year}`,
`https://date.nager.at/api/v3/PublicHolidays/${year}/${encodeURIComponent(cc)}`
]
){
try{
const r=
await fetch(
url,
{
headers:{
accept:"application/json"
}
}
);

if(!r.ok){
continue;
}

const j=
await r.json();

if(Array.isArray(j)){
items=
j.map(
x=>({
date:
String(
x.date||""
),
name:
String(
x.localName||
x.name||
""
),
english:
String(
x.name||""
)
})
)
.filter(
x=>validDate(x.date)
);

if(items.length){
break;
}
}
}
catch{}
}

await cachePut(
env,
key,
{items},
HOLIDAY_CACHE_TTL_MINUTES
);

return items;
}

function hijriOccasion(h){
if(!h){
return"";
}

const m=
Number(
h?.month?.number||0
);

const d=
Number(
h?.day||0
);

if(m===9){
return(
d>=21
?"العشر الأواخر من رمضان"
:"شهر رمضان"
);
}

if(
m===10&&
d<=3
){
return"عيد الفطر";
}

if(
m===12&&
d===9
){
return"يوم عرفة";
}

if(
m===12&&
d>=10&&
d<=13
){
return"عيد الأضحى وأيام التشريق";
}

if(
m===1&&
d===1
){
return"رأس السنة الهجرية";
}

if(
m===3&&
d===12
){
return"المولد النبوي (تاريخ هجري تقويمي)";
}

return"";
}

function needsPrayerContext(text){
return/(?:اذان|أذان|صلاه|صلاة|الفجر|الفجر|الظهر|الضهر|العصر|المغرب|العشاء|العشا|رمضان|العيد|هجري)/iu.test(
String(
text||""
)
);
}

function needsLiveNews(text){
return/(?:اخر|آخر|أحدث|دلوقتي|حاليا|حاليًا|النهارده|اليوم).{0,25}(?:اخبار|أخبار|تطورات|احداث|أحداث)|(?:ايه|إيه|اي)\s+(?:الاخبار|الأخبار)|(?:حصل ايه|حصل إيه)\s+(?:في|فى)\s+العالم|breaking|latest news/iu.test(
String(
text||""
)
);
}

async function buildLiveRealityContext(
env,
chatId,
text,
profile,
force=false
){
profile=
profile||
await getUserProfile(
env,
chatId
);

let now=
zonedNow(
profile.timezone
);

let tomorrow=
addDaysIso(
now.date,
1
);

let todayPrayer=null;
let tomPrayer=null;

try{
todayPrayer=
await fetchPrayerDay(
env,
profile,
now.date,
force
);

if(
todayPrayer?.timezone&&
todayPrayer.timezone!==
profile.timezone&&
profile.latitude!=null
){
profile={
...profile,
timezone:
todayPrayer.timezone
};

await env.DB.prepare(`
UPDATE user_profiles
SET timezone=?,
updated_at=?
WHERE chat_id=?
`)
.bind(
todayPrayer.timezone,
new Date().toISOString(),
chatId
)
.run();

now=
zonedNow(
profile.timezone
);
tomorrow=addDaysIso(now.date,1);
}

tomPrayer=
await fetchPrayerDay(
env,
profile,
tomorrow,
force
);
}
catch(e){
console.warn(
"prayer context",
safeError(e)
);
}

let holidays=[];
const holidayEnd=addDaysIso(now.date,14);
try{
const y1=Number(now.date.slice(0,4));
holidays=await fetchPublicHolidays(env,profile,y1);
const y2=Number(holidayEnd.slice(0,4));
if(y2!==y1)holidays=[...holidays,...await fetchPublicHolidays(env,profile,y2)];
}
catch{}
const near=holidays.filter(h=>h.date>=now.date&&h.date<=holidayEnd).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,8);

const h=
todayPrayer?.hijri||
null;

const occasion=
hijriOccasion(h);

const hijriText=
h
?`${h.day} ${h.month?.ar||h.month?.en||""} ${h.year} هـ`
:"غير متاح";

const prayerLine=
todayPrayer
?`الفجر ${todayPrayer.timings.Fajr} | الشروق ${todayPrayer.timings.Sunrise} | الظهر ${todayPrayer.timings.Dhuhr} | العصر ${todayPrayer.timings.Asr} | المغرب ${todayPrayer.timings.Maghrib} | العشاء ${todayPrayer.timings.Isha}`
:"أوقات الصلاة غير متاحة لحظيًا";

const lines=[
`الوقت الحي: ${now.date} ${now.time}:${now.second} — ${now.weekday} — ${profile.timezone}`,
`المكان: ${profile.city}, ${profile.country} (${profile.country_code})`,
`التاريخ الهجري: ${hijriText}`,
`المناسبة الإسلامية الحالية: ${occasion||"لا توجد مناسبة رئيسية محددة اليوم"}`,
`صلاة اليوم: ${prayerLine}`
];

if(tomPrayer){
lines.push(
`صلاة بكرة: الفجر ${tomPrayer.timings.Fajr} | الظهر ${tomPrayer.timings.Dhuhr} | العصر ${tomPrayer.timings.Asr} | المغرب ${tomPrayer.timings.Maghrib} | العشاء ${tomPrayer.timings.Isha}`
);
}

lines.push(
`المناسبات/العطلات الرسمية القريبة: ${near.length?near.map(x=>`${x.date} ${x.name||x.english}`).join("؛ "):"لا توجد بيانات عطلات قريبة متاحة من المصدر"}`
);

return{
now,
profile,
prayers:{
today:todayPrayer,
tomorrow:tomPrayer
},
holidays:near,
occasion,
text:
lines.join("\n"),
short:
`🕒 ${now.weekday} ${now.date} — ${now.time}
📍 ${profile.city} · ${profile.timezone}
☪️ ${hijriText}${occasion?` — ${occasion}`:""}
🕌 ${prayerLine}`
};
}

function buildOneTimePrayerIntent(
text,
reality,
timeZone=TIME_ZONE
){
const raw=
String(
text||""
);

const n=
normalizeArabicLoose(
normalizeDigits(
raw
)
);

if(
/(?:كل\s+يوم|يوميا|يوميًا|كل\s+(?:سبت|احد|أحد|اتنين|اثنين|ثلاثاء|اربعاء|أربعاء|خميس|جمعه|جمعة))/u.test(n)
){
return null;
}

if(
!/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى)/iu.test(raw)
){
return null;
}

const rel=
parsePrayerRelative(
raw
);

if(
!rel||
!reality?.prayers
){
return null;
}

if(
/(?:بعد\s+بكره|بعد\s+بكرة|الاسبوع|الأسبوع|الشهر|يوم\s+\d|\d{1,2}[\/-]\d{1,2})/iu.test(raw)
){
return null;
}

let title="";

const m=
raw.match(
/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى)\s+(.+?)(?=\s+(?:قبل|بعد)\s+(?:(?:اذان|أذان|الاذان|الأذان|صلاه|صلاة)\s*)?(?:الفجر|الشروق|الظهر|الضهر|العصر|المغرب|العشاء|العشا))/iu
);

title=
String(
m?.[1]||
`تذكير ${arabicPrayerName(rel.prayer)}`
)
.trim()
.slice(
0,
500
);

const wantTomorrow=
/(?:بكره|بكرة|غدا|غدًا|غداً)/iu.test(raw);

const days=
wantTomorrow
?[
reality.prayers.tomorrow
]
:[
reality.prayers.today,
reality.prayers.tomorrow
];

let chosen=null;

for(const pd of days){
const pt=
pd?.timings?.[
rel.prayer
];

if(
!pd||
!validTime(pt)
){
continue;
}

const at=
addMinutesLocal(
`${pd.date} ${pt}`,
rel.offset,
timeZone
);

if(
wantTomorrow||
localDateTimeToEpoch(
at,
timeZone
)>
Date.now()-60000
){
chosen=at;
break;
}
}

if(!chosen){
return null;
}

const[d,t]=
splitLocalDateTime(
chosen
);

return{
action:"create",
needs_clarification:false,
items:[
{
date:d,
time:t,
title,
kind:"reminder",
duration_minutes:0,
advance_alerts:[]
}
],
recurring_items:[],
_timezone:timeZone
};
}

function prayerNameFromArabic(text){
const t=
normalizeArabicLoose(
text
);

if(
/الفجر/u.test(t)
){
return"Fajr";
}

if(
/الشروق|شروق/u.test(t)
){
return"Sunrise";
}

if(
/الظهر|الضهر/u.test(t)
){
return"Dhuhr";
}

if(
/العصر/u.test(t)
){
return"Asr";
}

if(
/المغرب/u.test(t)
){
return"Maghrib";
}

if(
/العشاء|العشا/u.test(t)
){
return"Isha";
}

return null;
}

function arabicPrayerName(p){
return({
Fajr:"الفجر",
Sunrise:"الشروق",
Dhuhr:"الظهر",
Asr:"العصر",
Maghrib:"المغرب",
Isha:"العشاء"
})[p]||p;
}

function parsePrayerRelative(text){
const t=
normalizeArabicLoose(
normalizeDigits(
text
)
);

const m=
t.match(
/(قبل|بعد)\s+(?:اذان|الاذان|أذان|الأذان|صلاه|صلاة)?\s*(الفجر|الشروق|الظهر|الضهر|العصر|المغرب|العشاء|العشا)(?:\s+ب)?\s*(.*)$/u
);

if(!m){
return null;
}

const prayer=
prayerNameFromArabic(
m[2]
);

const dir=
m[1]==="قبل"
?-1
:1;

let offset=0;

if(m[3]){
const d=
parseDurationValuePhrase(
m[3]
);

if(d!=null){
offset=d;
}
}

return{
prayer,
offset:
dir*offset
};
}


function parseRecurringPrayerAnchors(text){
const raw=String(text||""),n=normalizeArabicLoose(normalizeDigits(raw));
const daily=/(?:كل\s+يوم|يوميا|يومياً|يوميًا|التذكيرات\s+اليوميه|التذكيرات\s+اليومية|يوميه|يومية)/u.test(n),named=extractNamedWeekdays(n);if(!daily&&!named.length)return[];
let globalDur=null;const gd=n.match(/(?:قبل|بعد)\s+(?:اذان|الاذان|صلاه|صلاة)?\s*(?:الفجر|الشروق|الظهر|الضهر|العصر|المغرب|العشاء|العشا)\s+(?:ب|بـ)?\s*([^،,.؛;\n]{1,28})/u);if(gd)globalDur=parseDurationValuePhrase(gd[1]);
const clauseRe=/(قبل|بعد)\s+(?:اذان|الاذان|أذان|الأذان|صلاه|صلاة)?\s*(الفجر|الشروق|الظهر|الضهر|العصر|المغرب|العشاء|العشا)([^،,.؛;\n]*?)(?=(?:\s+و?قبل|\s+و?بعد|[،,.؛;\n]|$))/giu;
const out=[];let m;
while((m=clauseRe.exec(raw))!==null){const anchor=prayerNameFromArabic(m[2]);if(!anchor)continue;const tail=String(m[3]||"");let d=null;const dm=tail.match(/(?:ب|بـ)\s*((?:ربع|نص|نصف|تلت|ثلث|ساعه|ساعة|ساعتين|\d+|[\p{L}]+)(?:\s+(?:ساعه|ساعة|دقيقه|دقيقة|دقايق|دقائق))?)/u);if(dm)d=parseDurationValuePhrase(dm[1]);if(d==null)d=globalDur||0;const dir=m[1]==="قبل"?-1:1;
let target=null;const tm=tail.match(/(?:اصلي|أصلي|صلي|صلّي|بال|بصلاه|بصلاة|صلاه|صلاة|نبهني\s+ب|فكرني\s+ب|ذكرني\s+ب)\s*(الفجر|الظهر|الضهر|العصر|المغرب|العشاء|العشا)/iu);if(tm)target=prayerNameFromArabic(tm[1]);
if(!target){const after=raw.slice(clauseRe.lastIndex,Math.min(raw.length,clauseRe.lastIndex+65)),tm2=after.match(/(?:نبهني|نبهنى|فكرني|فكرنى|ذكرني|ذكرنى)?\s*(?:ب|بصلاه|بصلاة)?\s*(الفجر|الظهر|الضهر|العصر|المغرب|العشاء|العشا)/iu);if(tm2)target=prayerNameFromArabic(tm2[1]);}
if(!target)continue;const title=`صلي ${arabicPrayerName(target)}`,key=`${anchor}|${dir*d}|${title}`;if(out.some(x=>x._key===key))continue;out.push({_key:key,title,prayer:anchor,offset:dir*d,weekdays:daily?[]:named,max_occurrences:parseExplicitOccurrenceCount(raw)});
}
return out.map(({_key,...x})=>x);
}

function parseRecurringPrayerAnchor(text){
const raw=
String(
text||""
);

const n=
normalizeArabicLoose(
normalizeDigits(
raw
)
);

const daily=
/(?:كل\s+يوم|يوميا|يوميًا)/u.test(n);

const named=
extractNamedWeekdays(n);

if(
(
!daily&&
!/(?:كل\s+)/u.test(n)
)||
(
!daily&&
!named.length
)
){
return null;
}

const rel=
parsePrayerRelative(
n
);

if(!rel){
return null;
}

let title=
raw
.replace(
/(?:كل\s+يوم|يوميا|يوميًا)/iu,
""
)
.trim();

const fm=
title.match(
/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى)\s+(.+?)(?=\s+(?:قبل|بعد)\s+)/iu
);

title=
fm?.[1]?.trim()||
`تذكير ${rel.offset<0?"قبل":"بعد"} ${arabicPrayerName(rel.prayer)}`;

return{
title,
prayer:rel.prayer,
offset:rel.offset,
weekdays:
daily
?[]
:named,
max_occurrences:
parseExplicitOccurrenceCount(
raw
)
};
}

function formatPrayerRule(r){
const off=
Number(
r.offset_minutes??
r.offset??
0
);

const desc=
off===0
?`عند ${arabicPrayerName(r.prayer)}`
:off<0
?`قبل ${arabicPrayerName(r.prayer)} بـ${formatMinutes(Math.abs(off))}`
:`بعد ${arabicPrayerName(r.prayer)} بـ${formatMinutes(off)}`;

const days=
sanitizeWeekdays(
parseJsonArray(
r.weekdays_json||
JSON.stringify(
r.weekdays||[]
)
)
);

return`كل ${days.length?days.map(weekdayArabic).join(" و"):"يوم"} ${desc}`;
}

function applyPrayerGrounding(
intent,
base,
reality
){
if(
intent?.action!=="create"||
!intent.items?.length||
!reality?.prayers
){
return;
}

const rel=
parsePrayerRelative(
base
);

if(!rel){
return;
}

const tz=
reality.profile?.timezone||
TIME_ZONE;

const nowMs=
Date.now();

let chosen=null;

for(
const pd of[
reality.prayers.today,
reality.prayers.tomorrow
]
){
const time=
pd?.timings?.[
rel.prayer
];

if(
!pd||
!validTime(time)
){
continue;
}

const at=
addMinutesLocal(
`${pd.date} ${time}`,
rel.offset,
tz
);

const ms=
localDateTimeToEpoch(
at,
tz
);

if(
ms>
nowMs-60000
){
chosen=at;
break;
}
}

if(!chosen){
return;
}

const target=
intent.items.length===1
?intent.items[0]
:intent.items.find(
x=>
normalizeArabicLoose(
base
).includes(
normalizeArabicLoose(
x.title
)
)
)||
intent.items[0];

const[d,t]=
splitLocalDateTime(
chosen
);

target.date=d;
target.time=t;
target.duration_minutes=
Number(
target.duration_minutes||0
);
}

async function nextPrayerRuleDate(
r,
fromDate
){
for(
const d of enumerateDates(
fromDate,
addDaysIso(
fromDate,
370
),
371
)
){
if(d<r.start_date){
continue;
}

if(
r.end_date&&
d>r.end_date
){
break;
}

if(
parseJsonArray(
r.exceptions_json
).includes(d)
){
continue;
}

const days=
sanitizeWeekdays(
parseJsonArray(
r.weekdays_json
)
);

if(
days.length&&
!days.includes(
isoWeekday(d)
)
){
continue;
}

return d;
}

return null;
}

async function deliverPrayerRules(
env,
lastMs,
nowMs
){
const rows=(
await env.DB.prepare(`
SELECT *
FROM prayer_rules
WHERE active=1
ORDER BY id
LIMIT 1000
`)
.all()
)?.results||[];

for(const r of rows){
const profile=
await getUserProfile(
env,
r.chat_id
);

const tz=
profile.timezone;

const now=
zonedNow(
tz,
nowMs
);

const dates=[
addDaysIso(
now.date,
-1
),
now.date,
addDaysIso(
now.date,
1
)
];

const days=
sanitizeWeekdays(
parseJsonArray(
r.weekdays_json
)
);

for(const date of dates){
if(
date<r.start_date||
(
r.end_date&&
date>r.end_date
)||
parseJsonArray(
r.exceptions_json
).includes(date)||
(
days.length&&
!days.includes(
isoWeekday(date)
)
)
){
continue;
}

let pd;

try{
pd=
await fetchPrayerDay(
env,
profile,
date
);
}
catch{
continue;
}

const pt=
pd?.timings?.[
r.prayer
];

if(
!validTime(pt)
){
continue;
}

const occ=
addMinutesLocal(
`${date} ${pt}`,
Number(
r.offset_minutes||0
),
tz
);

const ms=
localDateTimeToEpoch(
occ,
tz
);

if(
ms<=lastMs||
ms>nowMs
){
continue;
}

if(
r.max_occurrences!=null&&
Number(
r.fired_count||0
)>=
Number(
r.max_occurrences
)
){
await env.DB.prepare(`
UPDATE prayer_rules
SET active=0,
updated_at=?
WHERE id=?
`)
.bind(
new Date().toISOString(),
r.id
)
.run();

break;
}

try{
await env.DB.prepare(`
INSERT INTO prayer_rule_fires(
rule_id,
chat_id,
occurrence_date,
sent_at
)
VALUES(
?,?,?,?
)
`)
.bind(
r.id,
r.chat_id,
date,
new Date().toISOString()
)
.run();
}
catch(e){
if(
/unique|constraint/i.test(
String(
e?.message||e
)
)
){
continue;
}

throw e;
}

await sendText(
env,
r.chat_id,
`🕌 تذكير مرتبط بالصلاة

${r.title}
${formatPrayerRule(r)}`,
quickMenuKeyboard()
);

const count=
Number(
r.fired_count||0
)+1;

const active=
r.max_occurrences!=null&&
count>=Number(
r.max_occurrences
)
?0
:1;

await env.DB.prepare(`
UPDATE prayer_rules
SET fired_count=?,
active=?,
updated_at=?
WHERE id=?
`)
.bind(
count,
active,
new Date().toISOString(),
r.id
)
.run();
}
}
}

async function translateLiveQuery(
env,
q
){
try{
const out=
await callTextModel(
env,
`حوّل طلب البحث التالي إلى كلمات بحث إنجليزية قصيرة جدًا ومباشرة دون شرح. أخرج الكلمات فقط:
${q}`,
1800
);

return(
out
.replace(
/[\n\r]+/g,
" "
)
.trim()
.slice(
0,
250
)||
q
);
}
catch{
return q;
}
}

async function fetchGdeltNews(
query,
max=LIVE_NEWS_MAX
){
const q=
String(
query||""
).trim();

if(!q){
return[];
}

try{
const url=
`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=${clamp(Number(max||8),1,20)}&format=json&sort=datedesc&timespan=24h`;

const r=
await fetch(
url,
{
headers:{
accept:"application/json"
}
}
);

if(!r.ok){
return[];
}

const j=
await r.json();

const arr=
Array.isArray(
j?.articles
)
?j.articles
:Array.isArray(j)
?j
:[];

return arr
.map(
x=>({
title:
String(
x.title||""
),
url:
String(
x.url||""
),
domain:
String(
x.domain||""
),
seen:
String(
x.seendate||
x.datetime||
""
)
})
)
.filter(
x=>
x.title&&
x.url
)
.slice(
0,
max
);
}
catch(e){
console.warn(
"GDELT",
safeError(e)
);

return[];
}
}

async function callTextModel(
env,
prompt,
timeoutMs=3500
){
for(
const model of REMINDER_MODELS.slice(
0,
6
)
){
const c=
new AbortController();

const timer=
setTimeout(
()=>c.abort(),
Math.min(
timeoutMs,
model.timeoutMs+1000
)
);

try{
const req=
new Request(
OMNIAI_INTERNAL_URL,
{
method:"POST",
headers:{
Authorization:
`Bearer ${env.OMNIAI_API_KEY}`,
"Content-Type":
"application/json"
},
body:
JSON.stringify({
model:model.id,
messages:[
{
role:"system",
content:
"أجب بالنص المطلوب فقط وباختصار."
},
{
role:"user",
content:prompt
}
],
max_tokens:900,
stream:false
}),
signal:c.signal
}
);

const res=
await env.OMNIAI_SERVICE.fetch(
req
);

const raw=
await res.text();

let j;

try{
j=
JSON.parse(raw);
}
catch{
continue;
}

const text=
String(
j?.choices?.[0]?.message?.content||
""
).trim();

if(
res.ok&&
text
){
return text;
}
}
catch{}
finally{
clearTimeout(timer);
}
}

throw new Error(
"تعذر الحصول على رد حي من الموديلات."
);
}

async function answerChatWithLiveData(
env,
chatId,
userText,
intent,
reality,
history,
memories
){
const q=
intent.live_query_en||
await translateLiveQuery(
env,
userText
);

const news=
await fetchGdeltNews(
q,
LIVE_NEWS_MAX
);

if(!news.length){
return"مش قادر أتحقق من مصدر الأخبار الحي دلوقتي، فمش هخمن معلومة حديثة. جرّب تاني بعد شوية.";
}

const feed=
news.map(
(x,i)=>
`${i+1}. ${x.title} | ${x.domain} | ${x.seen} | ${x.url}`
).join("\n");

const prompt=
`الطلب: ${userText}

الواقع الآن:
${reality.text}

نتائج أخبار حية تم جلبها الآن:
${feed}

أجب بالعربية المصرية باختصار ودقة. استخدم النتائج فقط للأخبار الحالية، وقل بوضوح لو النتائج لا تكفي. لا تخترع. لا تذكر الموديل.`;

return callTextModel(
env,
prompt,
5000
);
}

async function deliverLiveWatches(env,nowMs){
const key="live_watch_cursor_id";
const st=await env.DB.prepare(`SELECT value FROM scheduler_state WHERE key=? LIMIT 1`).bind(key).first();
let cursor=Math.max(0,Number(st?.value||0));
let rows=(await env.DB.prepare(`SELECT * FROM live_watches WHERE active=1 AND id>? ORDER BY id LIMIT ?`).bind(cursor,LIVE_WATCH_BATCH_SIZE).all())?.results||[];
if(!rows.length&&cursor>0){cursor=0;rows=(await env.DB.prepare(`SELECT * FROM live_watches WHERE active=1 ORDER BY id LIMIT ?`).bind(LIVE_WATCH_BATCH_SIZE).all())?.results||[];}
if(!rows.length){await setSchedulerState(env,key,"0");return;}
for(const r of rows){
try{
const news=await fetchGdeltNews(r.query_en,1);const top=news[0];
if(!top?.url||top.url===r.last_url)continue;
await sendText(env,r.chat_id,`🌍 تطور جديد في «${r.query_ar}»\n\n${top.title}\n${top.domain||""}`,quickMenuKeyboard());
await env.DB.prepare(`UPDATE live_watches SET last_url=?,updated_at=? WHERE id=?`).bind(top.url,new Date().toISOString(),r.id).run();
}catch(e){console.error("live watch failed",r.id,safeError(e));}
}
const lastId=Number(rows[rows.length-1]?.id||0);
const more=await env.DB.prepare(`SELECT id FROM live_watches WHERE active=1 AND id>? ORDER BY id LIMIT 1`).bind(lastId).first();
await setSchedulerState(env,key,String(more?lastId:0));
}

async function setSchedulerState(env,key,value){
await env.DB.prepare(`INSERT INTO scheduler_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(String(key),String(value),new Date().toISOString()).run();
}

async function saveConversationMessage(
env,
chatId,
role,
content
){
const clean=
String(
content||""
).trim().slice(
0,
6000
);

if(!clean){
return;
}

await env.DB.prepare(`
INSERT INTO conversation_messages(
chat_id,
role,
content,
created_at
)
VALUES(
?,?,?,?
)
`)
.bind(
chatId,
role==="assistant"
?"assistant"
:"user",
clean,
new Date().toISOString()
)
.run();

await env.DB.prepare(`
DELETE FROM conversation_messages
WHERE chat_id=?
AND id NOT IN(
SELECT id
FROM conversation_messages
WHERE chat_id=?
ORDER BY id DESC
LIMIT 80
)
`)
.bind(
chatId,
chatId
)
.run();
}

async function getRecentConversation(
env,
chatId,
limit=20
){
const rows=(
await env.DB.prepare(`
SELECT role,content
FROM conversation_messages
WHERE chat_id=?
ORDER BY id DESC
LIMIT ?
`)
.bind(
chatId,
clamp(
Number(
limit||20
),
1,
40
)
)
.all()
)?.results||[];

return rows
.reverse()
.map(
r=>({
role:
r.role==="assistant"
?"assistant"
:"user",
content:
String(
r.content||""
)
})
);
}

async function clearConversation(
env,
chatId
){
await env.DB.prepare(`
DELETE FROM conversation_messages
WHERE chat_id=?
`)
.bind(chatId)
.run();
}

async function getPendingDialog(
env,
chatId
){
const now=
new Date().toISOString();

await env.DB.prepare(`
DELETE FROM pending_dialogs
WHERE expires_at<=?
`)
.bind(now)
.run();

return env.DB.prepare(`
SELECT *
FROM pending_dialogs
WHERE chat_id=?
AND expires_at>?
LIMIT 1
`)
.bind(
chatId,
now
)
.first();
}

async function savePendingDialog(
env,
chatId,
data
){
const now=
new Date();

const expires=
new Date(
now.getTime()+
PENDING_TTL_MINUTES*60000
);

await env.DB.prepare(`
INSERT INTO pending_dialogs(
chat_id,
base_text,
context_json,
question,
question_type,
question_meta,
expires_at,
created_at,
updated_at
)
VALUES(
?,?,?,?,?,?,?,?,?
)
ON CONFLICT(chat_id)
DO UPDATE SET
base_text=excluded.base_text,
context_json=excluded.context_json,
question=excluded.question,
question_type=excluded.question_type,
question_meta=excluded.question_meta,
expires_at=excluded.expires_at,
updated_at=excluded.updated_at
`)
.bind(
chatId,
String(
data.baseText||""
).slice(
0,
7000
),
JSON.stringify(
Array.isArray(
data.context
)
?data.context
:[]
),
String(
data.question||""
).slice(
0,
800
),
String(
data.questionType||
"generic"
),
JSON.stringify(
data.questionMeta||
{}
),
expires.toISOString(),
now.toISOString(),
now.toISOString()
)
.run();
}

async function clearPendingDialog(
env,
chatId
){
await env.DB.batch([
env.DB.prepare(`
DELETE FROM pending_dialogs
WHERE chat_id=?
`).bind(chatId),

env.DB.prepare(`
DELETE FROM pending_requests
WHERE chat_id=?
`).bind(chatId)
]);
}

async function recordModelResult(
env,
model,
success,
latencyMs,
errorText
){
const ok=
success
?1
:0;

const fail=
success
?0
:1;

const latency=
Math.max(
0,
Math.round(
Number(
latencyMs
)||0
)
);

const lastError=
success
?null
:String(
errorText||
"Unknown"
).slice(
0,
500
);

const now=
new Date().toISOString();

try{
await env.DB.prepare(`
INSERT INTO model_stats(
model_id,
short_name,
attempts,
successes,
failures,
total_latency_ms,
last_latency_ms,
last_error,
updated_at
)
VALUES(
?,?,1,?,?,?,?,?,?
)
ON CONFLICT(model_id)
DO UPDATE SET
short_name=excluded.short_name,
attempts=model_stats.attempts+1,
successes=model_stats.successes+excluded.successes,
failures=model_stats.failures+excluded.failures,
total_latency_ms=model_stats.total_latency_ms+excluded.total_latency_ms,
last_latency_ms=excluded.last_latency_ms,
last_error=excluded.last_error,
updated_at=excluded.updated_at
`)
.bind(
model.id,
model.short,
ok,
fail,
latency,
latency,
lastError,
now
)
.run();

const row=
await env.DB.prepare(`
SELECT attempts,successes,failures
FROM model_stats
WHERE model_id=?
LIMIT 1
`)
.bind(
model.id
)
.first();

return{
attempts:
Number(
row?.attempts||0
),
successes:
Number(
row?.successes||0
),
failures:
Number(
row?.failures||0
)
};
}
catch(e){
console.error(
"model_stats error",
model.id,
e
);

return{
attempts:1,
successes:
success
?1
:0,
failures:
success
?0
:1
};
}
}

async function getAllModelStats(env){
try{
return(
await env.DB.prepare(`
SELECT *
FROM model_stats
`)
.all()
)?.results||[];
}
catch(e){
console.error(
"getAllModelStats",
e
);

return[];
}
}

function modelFooter(
env,
chatId,
intent
){
return"";
}

async function enforceAiRateLimit(
env,
chatId
){
if(
isAdmin(
env,
chatId
)
){
return;
}

const now=
Date.now();

const windowMs=
60000;

const row=
await env.DB.prepare(`
SELECT window_start,request_count
FROM user_rate_limits
WHERE chat_id=?
LIMIT 1
`)
.bind(chatId)
.first();

const start=
Number(
row?.window_start||0
);

const count=
Number(
row?.request_count||0
);

if(
!start||
now-start>=windowMs
){
await env.DB.prepare(`
INSERT INTO user_rate_limits(
chat_id,
window_start,
request_count
)
VALUES(
?,?,1
)
ON CONFLICT(chat_id)
DO UPDATE SET
window_start=excluded.window_start,
request_count=1
`)
.bind(
chatId,
now
)
.run();

return;
}

if(
count>=
AI_RATE_LIMIT_PER_MINUTE
){
const sec=
Math.max(
1,
Math.ceil(
(
windowMs-
(now-start)
)/1000
)
);

throw new Error(
`طلبات كتير بسرعة. جرّب كمان ${sec} ثانية.`
);
}

await env.DB.prepare(`
UPDATE user_rate_limits
SET request_count=request_count+1
WHERE chat_id=?
`)
.bind(chatId)
.run();
}

async function sendText(
env,
chatId,
text,
replyMarkup=null
){
const chunks=
splitTelegramText(
String(text),
3900
);

let last=null;

for(
let i=0;
i<chunks.length;
i++
){
const payload={
chat_id:chatId,
text:chunks[i],
link_preview_options:{
is_disabled:true
}
};

if(
replyMarkup&&
i===chunks.length-1
){
payload.reply_markup=
replyMarkup;
}

last=
await telegramApiWithRetry(
env,
"sendMessage",
payload,
1
);

if(!last.ok){
throw new Error(
last.description||
"Telegram sendMessage failed"
);
}
}

return last;
}

async function editOrSend(
env,
chatId,
messageId,
text,
replyMarkup=null
){
if(
String(text).length>
3900
){
return sendText(
env,
chatId,
text,
replyMarkup
);
}

if(messageId){
const payload={
chat_id:chatId,
message_id:messageId,
text:String(text)
};

if(replyMarkup){
payload.reply_markup=
replyMarkup;
}

const edited=
await telegramApiWithRetry(
env,
"editMessageText",
payload,
1
);

if(
edited.ok||
/message is not modified/i.test(
String(
edited.description||""
)
)
){
return edited;
}
}

return sendText(
env,
chatId,
text,
replyMarkup
);
}

async function answerCallback(
env,
callbackQueryId,
text="",
showAlert=false
){
if(!callbackQueryId){
return{
ok:true
};
}

return telegramApiWithRetry(
env,
"answerCallbackQuery",
{
callback_query_id:
callbackQueryId,
...(
text
?{text}
:{}
),
show_alert:
showAlert,
cache_time:0
},
1
);
}

async function telegramApi(
env,
method,
payload
){
const response=
await fetch(
`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
{
method:"POST",
headers:{
"Content-Type":
"application/json"
},
body:
JSON.stringify(
payload||{}
)
}
);

const raw=
await response.text();

try{
return JSON.parse(raw);
}
catch{
return{
ok:false,
error_code:
response.status,
description:
`Telegram returned non-JSON (${response.status})`
};
}
}

async function telegramApiWithRetry(
env,
method,
payload,
maxRetries=1
){
let last=null;

for(
let attempt=0;
attempt<=maxRetries;
attempt++
){
last=
await telegramApi(
env,
method,
payload
);

if(last?.ok){
return last;
}

const retry=
Number(
last?.parameters?.retry_after||0
);

if(
Number(
last?.error_code
)===429&&
retry>0&&
attempt<maxRetries
){
await sleep(
retry*1000+
150
);

continue;
}

return last;
}

return last||{
ok:false,
description:
"Telegram request failed"
};
}

function parseModelJson(text){
const cleaned=
String(
text||""
)
.trim()
.replace(
/^```(?:json)?\s*/i,
""
)
.replace(
/\s*```$/i,
""
)
.trim();

try{
return JSON.parse(
cleaned
);
}
catch{
const a=
cleaned.indexOf(
"{"
);

const b=
cleaned.lastIndexOf(
"}"
);

if(
a>=0&&
b>a
){
return JSON.parse(
cleaned.slice(
a,
b+1
)
);
}

throw new Error(
"Invalid JSON from model"
);
}
}

function zonedNow(
timeZone=TIME_ZONE,
at=null
){
const date=
at instanceof Date
?at
:Number.isFinite(
Number(at)
)&&
at!==null
?new Date(
Number(at)
)
:new Date();

let tz=
timeZone||
TIME_ZONE;

try{
new Intl.DateTimeFormat(
"en-CA",
{
timeZone:tz
}
).format(date);
}
catch{
tz=TIME_ZONE;
}

const parts=
new Intl.DateTimeFormat(
"en-CA",
{
timeZone:tz,
year:"numeric",
month:"2-digit",
day:"2-digit",
hour:"2-digit",
minute:"2-digit",
second:"2-digit",
hourCycle:"h23"
}
)
.formatToParts(
date
);

const p=
Object.fromEntries(
parts.map(
x=>[
x.type,
x.value
]
)
);

const weekday=
new Intl.DateTimeFormat(
"ar-EG",
{
timeZone:tz,
weekday:"long"
}
)
.format(date);

return{
date:
`${p.year}-${p.month}-${p.day}`,
time:
`${p.hour}:${p.minute}`,
second:p.second,
weekday,
timezone:tz
};
}

function cairoNow(at=null){
return zonedNow(
TIME_ZONE,
at
);
}

function localNowString(
timeZone=TIME_ZONE
){
const n=
zonedNow(
timeZone
);

return`${n.date} ${n.time}`;
}

function epochToLocalDateTime(
ms,
timeZone=TIME_ZONE
){
const n=
zonedNow(
timeZone,
ms
);

return`${n.date} ${n.time}`;
}

function localDateTimeToEpoch(
local,
timeZone=TIME_ZONE
){
if(
!validLocalDateTime(
local
)
){
throw new Error(
`Local datetime غير صالح: ${local}`
);
}

const[
date,
time
]=
splitLocalDateTime(
local
);

const[
y,
m,
d
]=
date.split("-").map(Number);

const[
hh,
mm
]=
time.split(":").map(Number);

let guess=
Date.UTC(
y,
m-1,
d,
hh,
mm,
0,
0
);

for(
let i=0;
i<5;
i++
){
const shown=
zonedNow(
timeZone,
guess
);

const[
sy,
sm,
sd
]=
shown.date.split("-").map(Number);

const[
sh,
smin
]=
shown.time.split(":").map(Number);

const desired=
Date.UTC(
y,
m-1,
d,
hh,
mm
);

const seen=
Date.UTC(
sy,
sm-1,
sd,
sh,
smin
);

const diff=
desired-
seen;

if(!diff){
break;
}

guess+=diff;
}

return guess;
}

function splitLocalDateTime(value){
const s=
String(
value||""
);

const m=
s.match(
/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/
);

return m
?[
m[1],
m[2]
]
:[
"",
""
];
}

function validLocalDateTime(value){
const[
d,
t
]=
splitLocalDateTime(
value
);

return(
validDate(d)&&
validTime(t)
);
}

function addMinutesLocal(
local,
minutes,
timeZone=TIME_ZONE
){
return epochToLocalDateTime(
localDateTimeToEpoch(
local,
timeZone
)+
Number(
minutes||0
)*60000,
timeZone
);
}

function addDaysLocalDateTime(
local,
days
){
const[
date,
time
]=
splitLocalDateTime(
local
);

return`${addDaysIso(date,days)} ${time}`;
}

function maxLocal(a,b){
return a>b
?a
:b;
}

function rangeBounds(
range,
now=cairoNow()
){
if(
range==="today"
){
return{
start:now.date,
end:now.date
};
}

if(
range==="tomorrow"
){
const d=
addDaysIso(
now.date,
1
);

return{
start:d,
end:d
};
}

if(
range==="week"
){
return{
start:now.date,
end:
addDaysIso(
now.date,
6
)
};
}

if(
range==="month"
){
return{
start:now.date,
end:
lastDayOfMonth(
now.date
)
};
}

return{
start:now.date,
end:
addDaysIso(
now.date,
29
)
};
}

function addDaysIso(
iso,
days
){
const[
y,
m,
d
]=
iso.split("-").map(Number);

const dt=
new Date(
Date.UTC(
y,
m-1,
d+days,
12
)
);

return`${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
}

function lastDayOfMonth(iso){
const[
y,
m
]=
iso.split("-").map(Number);

const dt=
new Date(
Date.UTC(
y,
m,
0,
12
)
);

return`${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
}

function lastDayNumber(iso){
return Number(
lastDayOfMonth(
iso
).slice(
8,
10
)
);
}

function enumerateDates(
start,
end,
maxDays=370
){
const out=[];

let cur=start;

for(
let i=0;
i<maxDays&&
cur<=end;
i++
){
out.push(cur);
cur=
addDaysIso(
cur,
1
);
}

return out;
}

function daysBetween(a,b){
const[
ay,
am,
ad
]=
a.split("-").map(Number);

const[
by,
bm,
bd
]=
b.split("-").map(Number);

return Math.round(
(
Date.UTC(
by,
bm-1,
bd,
12
)-
Date.UTC(
ay,
am-1,
ad,
12
)
)/
86400000
);
}

function monthsBetween(a,b){
const ay=
Number(
a.slice(0,4)
);

const am=
Number(
a.slice(5,7)
);

const by=
Number(
b.slice(0,4)
);

const bm=
Number(
b.slice(5,7)
);

return(
(by-ay)*12+
(bm-am)
);
}

function isoWeekday(iso){
const[
y,
m,
d
]=
iso.split("-").map(Number);

const js=
new Date(
Date.UTC(
y,
m-1,
d,
12
)
).getUTCDay();

return(
js===0
?7
:js
);
}

function startOfIsoWeek(iso){
return addDaysIso(
iso,
1-
isoWeekday(iso)
);
}

function ordinalWeekdayMatches(
date,
weekday,
ordinal
){
if(
isoWeekday(date)!==
weekday
){
return false;
}

const day=
Number(
date.slice(8,10)
);

if(ordinal>0){
return(
Math.floor(
(day-1)/7
)+1===
ordinal
);
}

if(ordinal===-1){
return(
day+7>
lastDayNumber(
date
)
);
}

return false;
}

function validDate(value){
const s=
String(
value||""
);

if(
!/^\d{4}-\d{2}-\d{2}$/.test(s)
){
return false;
}

const[
y,
m,
d
]=
s.split("-").map(Number);

const dt=
new Date(
Date.UTC(
y,
m-1,
d
)
);

return(
dt.getUTCFullYear()===y&&
dt.getUTCMonth()+1===m&&
dt.getUTCDate()===d
);
}

function validTime(value){
const s=
String(
value||""
);

if(
!/^\d{2}:\d{2}$/.test(s)
){
return false;
}

const[
h,
m
]=
s.split(":").map(Number);

return(
h>=0&&
h<=23&&
m>=0&&
m<=59
);
}

function isPastLocal(
date,
time,
timeZone=TIME_ZONE
){
try{
return(
localDateTimeToEpoch(
`${date} ${time}`,
timeZone
)<
Date.now()-60000
);
}
catch{
return true;
}
}

function formatArabicDate(iso){
try{
const[
y,
m,
d
]=
iso.split("-").map(Number);

return new Intl.DateTimeFormat(
"ar-EG",
{
weekday:"short",
day:"numeric",
month:"short",
year:"numeric",
timeZone:"UTC"
}
)
.format(
new Date(
Date.UTC(
y,
m-1,
d,
12
)
)
);
}
catch{
return iso;
}
}

function formatArabicTime(hhmm){
try{
const[
h,
m
]=
hhmm.split(":").map(Number);

return new Intl.DateTimeFormat(
"ar-EG",
{
hour:"numeric",
minute:"2-digit",
hour12:true,
timeZone:"UTC"
}
)
.format(
new Date(
Date.UTC(
2000,
0,
1,
h,
m
)
)
);
}
catch{
return hhmm;
}
}

function formatLocalDateTime(local){
const[
d,
t
]=
splitLocalDateTime(
local
);

return(
validDate(d)&&
validTime(t)
)
?`${formatArabicDate(d)} ${formatArabicTime(t)}`
:local;
}

function formatEventWhen(date,time,duration,timeZone=TIME_ZONE){
if(!Number(duration||0))return`${formatArabicDate(date)} ${formatArabicTime(time)}`;
const end=addMinutesLocal(`${date} ${time}`,Number(duration),timeZone);
const[ed,et]=splitLocalDateTime(end);
return ed===date?`${formatArabicDate(date)} من ${formatArabicTime(time)} لـ ${formatArabicTime(et)}`:`${formatArabicDate(date)} ${formatArabicTime(time)} → ${formatArabicDate(ed)} ${formatArabicTime(et)}`;
}

function formatMinutes(mins){
const n=
Number(
mins||0
);

if(n<60){
return`${n} دقيقة`;
}

if(n%60===0){
return`${n/60} ساعة`;
}

return`${Math.floor(n/60)} ساعة و${n%60} دقيقة`;
}

function formatAdvanceAlerts(arr){
const x=
sanitizeAdvanceAlerts(
arr
);

if(!x.length){
return"";
}

if(x.length===1){
return` · 🔔 قبلها ${formatMinutes(x[0])}`;
}

return` · 🔔 ${x.map(v=>`قبلها ${formatMinutes(v)}`).join(" + ")}`;
}

function weekdayArabic(n){
return({
1:"الاثنين",
2:"الثلاثاء",
3:"الأربعاء",
4:"الخميس",
5:"الجمعة",
6:"السبت",
7:"الأحد"
})[n]||
`يوم ${n}`;
}

function monthArabic(n){
return({
1:"يناير",
2:"فبراير",
3:"مارس",
4:"أبريل",
5:"مايو",
6:"يونيو",
7:"يوليو",
8:"أغسطس",
9:"سبتمبر",
10:"أكتوبر",
11:"نوفمبر",
12:"ديسمبر"
})[n]||
String(n);
}

function ordinalArabic(n){
return(
n===1
?"أول"
:n===2
?"ثاني"
:n===3
?"ثالث"
:n===4
?"رابع"
:n===5
?"خامس"
:n===-1
?"آخر"
:String(n)
);
}

function unitArabic(
unit,
every
){
const singular={
minutes:"دقيقة",
hours:"ساعة",
days:"يوم",
weeks:"أسبوع",
months:"شهر",
years:"سنة"
};

const plural={
minutes:"دقائق",
hours:"ساعات",
days:"أيام",
weeks:"أسابيع",
months:"شهور",
years:"سنين"
};

return(
every===1
?singular[unit]
:plural[unit]
);
}

function unitCadenceArabic(unit){
return({
days:"كل يوم",
weeks:"كل أسبوع",
months:"كل شهر",
years:"كل سنة"
})[unit]||
`كل ${unitArabic(unit,1)}`;
}

function sanitizeDuration(value){
return clamp(
Math.trunc(
Number(
value||0
)
),
0,
10080
);
}

function sanitizeAdvanceAlerts(value){
const arr=
Array.isArray(value)
?value
:[];

return[
...new Set(
arr
.map(Number)
.filter(
n=>
Number.isInteger(n)&&
n>0&&
n<=MAX_ADVANCE_ALERT_MINUTES
)
)
]
.sort(
(a,b)=>b-a
);
}

function sanitizeWeekdays(value){
const arr=
Array.isArray(value)
?value
:[];

return[
...new Set(
arr
.map(Number)
.filter(
n=>
Number.isInteger(n)&&
n>=1&&
n<=7
)
)
]
.sort(
(a,b)=>a-b
);
}

function sanitizeMonthdays(value){
const arr=
Array.isArray(value)
?value
:[];

return[
...new Set(
arr
.map(Number)
.filter(
n=>
Number.isInteger(n)&&
n>=1&&
n<=31
)
)
]
.sort(
(a,b)=>a-b
);
}

function sanitizeMonthdaysExtended(value){
const arr=
Array.isArray(value)
?value
:[];

return[
...new Set(
arr
.map(Number)
.filter(
n=>
Number.isInteger(n)&&
(
n===-1||
(
n>=1&&
n<=31
)
)
)
)
]
.sort(
(a,b)=>a-b
);
}

function sanitizeMonths(value){
const arr=
Array.isArray(value)
?value
:[];

return[
...new Set(
arr
.map(Number)
.filter(
n=>
Number.isInteger(n)&&
n>=1&&
n<=12
)
)
]
.sort(
(a,b)=>a-b
);
}

function sanitizeOrdinalWeekdays(value){
const arr=
Array.isArray(value)
?value
:[];

const out=[];

for(const x of arr){
const weekday=
Number(
x?.weekday
);

const ordinal=
Number(
x?.ordinal
);

if(
Number.isInteger(weekday)&&
weekday>=1&&
weekday<=7&&
[
1,
2,
3,
4,
5,
-1
].includes(ordinal)
){
out.push({
weekday,
ordinal
});
}
}

return out;
}

function sanitizeExceptions(value){
const arr=
Array.isArray(value)
?value
:[];

return[
...new Set(
arr
.map(String)
.filter(
x=>
validDate(x)||
validLocalDateTime(x)
)
)
];
}

function normalizeTimeWords(text){
const map=
new Map([
["واحد","1"],
["واحدة","1"],
["واحده","1"],
["اتنين","2"],
["اثنين","2"],
["تنين","2"],
["تلاتة","3"],
["تلاته","3"],
["ثلاثة","3"],
["ثلاثه","3"],
["اربعة","4"],
["اربعه","4"],
["أربعة","4"],
["أربعه","4"],
["خمسة","5"],
["خمسه","5"],
["ستة","6"],
["سته","6"],
["سبعة","7"],
["سبعه","7"],
["تمانية","8"],
["تمانيه","8"],
["ثمانية","8"],
["ثمانيه","8"],
["تسعة","9"],
["تسعه","9"],
["عشرة","10"],
["عشره","10"],
["حداشر","11"],
["احداشر","11"],
["إحداشر","11"],
["اتناشر","12"],
["اثناشر","12"]
]);

const words=[
...map.keys()
]
.sort(
(a,b)=>b.length-a.length
)
.map(
escapeRegex
)
.join("|");

const re=
new RegExp(
`(الساعة|الساعه)\\s+(${words})(?=\\s|$|،|,|\\.)`,
"giu"
);

return String(
text||""
)
.replace(
re,
(
full,
prefix,
word
)=>
`${prefix} ${map.get(word)||word}`
);
}

function normalizeDigits(text){
return String(
text||""
)
.replace(
/[٠-٩]/g,
d=>
String(
"٠١٢٣٤٥٦٧٨٩".indexOf(d)
)
)
.replace(
/[۰-۹]/g,
d=>
String(
"۰۱۲۳۴۵۶۷۸۹".indexOf(d)
)
);
}

function normalizeArabicLoose(text){
return String(
text||""
)
.trim()
.toLowerCase()
.replace(
/[أإآ]/g,
"ا"
)
.replace(
/ى/g,
"ي"
)
.replace(
/ة/g,
"ه"
)
.replace(
/[ًٌٍَُِّْـ]/g,
""
)
.replace(
/[.!؟?،,]/g,
" "
)
.replace(
/\s+/g,
" "
)
.trim();
}

function extractScheduleKeywords(text){
const stop=
new Set(
[
"فكرني",
"فكرنى",
"ذكرني",
"ذكرنى",
"نبهني",
"نبهنى",
"عايز",
"عاوز",
"عايزك",
"عاوزك",
"ممكن",
"لو",
"سمحت",
"عندي",
"عندى",
"عندنا",
"جدولنا",
"جدولي",
"جدولى",
"موعد",
"ميعاد",
"معاد",
"مواعيد",
"الموعد",
"المعاد",
"المواعيد",
"الساعه",
"ساعه",
"الوقت",
"وقت",
"النهارده",
"اليوم",
"بكره",
"غدا",
"بعد",
"قبل",
"كمان",
"كل",
"يوم",
"اسبوع",
"شهر",
"صباح",
"مساء",
"ظهر",
"عصر",
"ليل",
"ايه",
"اي",
"في",
"فى",
"من",
"الي",
"على",
"علي",
"ده",
"دا",
"دي",
"هو",
"هي",
"انا",
"احنا",
"اروح",
"اعمل",
"اسجل",
"سجل"
]
.map(
normalizeArabicLoose
)
);

const normalized=
normalizeArabicLoose(
normalizeDigits(
String(
text||""
)
)
)
.replace(
/[^\p{L}\p{N}\s]/gu,
" "
)
.replace(
/\s+/g,
" "
)
.trim();

const out=[];

for(
const raw of normalized.split(" ")
){
const w=
raw.trim();

if(
w.length<3||
/^\d+$/.test(w)||
stop.has(w)
){
continue;
}

const variants=[w];

const prefixes=[
"وال",
"بال",
"كال",
"فال",
"لل",
"ال",
"و",
"ب",
"ك",
"ف",
"ل"
];

for(const p of prefixes){
if(
w.startsWith(p)&&
w.length-p.length>=3
){
variants.push(
w.slice(
p.length
)
);

break;
}
}

for(const v of variants){
if(
v.length>=3&&
!stop.has(v)&&
!/^\d+$/.test(v)
){
out.push(v);
}
}
}

return[
...new Set(out)
];
}

function normalizeOptionalObject(value){
return(
value&&
typeof value==="object"&&
!Array.isArray(value)
)
?value
:{};
}

function parseJsonArray(value){
try{
const x=
JSON.parse(
String(
value||"[]"
)
);

return(
Array.isArray(x)
?x
:[]
);
}
catch{
return[];
}
}

function parseJsonObject(value){
try{
const x=
JSON.parse(
String(
value||"{}"
)
);

return(
x&&
typeof x==="object"&&
!Array.isArray(x)
)
?x
:{};
}
catch{
return{};
}
}

function escapeRegex(value){
return String(
value
)
.replace(
/[.*+?^${}()|[\]\\]/g,
"\\$&"
);
}

function splitTelegramText(
text,
maxLen=3900
){
const s=
String(
text||""
);

if(
s.length<=maxLen
){
return[s];
}

const out=[];
let rest=s;

while(
rest.length>maxLen
){
let cut=
rest.lastIndexOf(
"\n",
maxLen
);

if(
cut<
Math.floor(
maxLen*.6
)
){
cut=
rest.lastIndexOf(
" ",
maxLen
);
}

if(
cut<
Math.floor(
maxLen*.6
)
){
cut=maxLen;
}

out.push(
rest.slice(
0,
cut
).trim()
);

rest=
rest.slice(cut).trim();
}

if(rest){
out.push(rest);
}

return(
out.length
?out
:[
s.slice(
0,
maxLen
)
]
);
}

function truncateText(
value,
maxLen=100
){
const s=
String(
value||""
);

return(
s.length<=maxLen
?s
:`${s.slice(0,maxLen-1)}…`
);
}

function clamp(
value,
min,
max
){
return Math.min(
max,
Math.max(
min,
Number.isFinite(value)
?value
:min
)
);
}

function sleep(ms){
return new Promise(
resolve=>
setTimeout(
resolve,
ms
)
);
}

function isPublicMode(env){
return(
String(
env.PUBLIC_BOT||
"false"
)
.trim()
.toLowerCase()==="true"
);
}

function isAdmin(
env,
chatId
){
const admin=
String(
env.ADMIN_CHAT_ID||
env.ALLOWED_CHAT_ID||
""
).trim();

return(
!!admin&&
String(chatId)===admin
);
}

function requiredBindings(env){
return[
"TELEGRAM_BOT_TOKEN",
"OMNIAI_API_KEY",
"TELEGRAM_WEBHOOK_SECRET",
"SETUP_KEY",
"DB",
"OMNIAI_SERVICE"
]
.filter(
name=>!env[name]
);
}

function safeError(error){
if(
error?.name==="AbortError"
){
return"الموديل اتأخر عن المهلة المحددة.";
}

return String(
error?.message||
error||
"Unknown error"
).slice(
0,
500
);
}

function json(
data,
status=200
){
return new Response(
JSON.stringify(
data,
null,
2
),
{
status,
headers:{
"Content-Type":
"application/json; charset=utf-8"
}
}
);
}