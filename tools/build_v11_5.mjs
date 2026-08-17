import fs from 'node:fs';
import crypto from 'node:crypto';

const srcPath=process.argv[2]||'SuperAgent_V11_4_FULL.js';
const outPath=process.argv[3]||'SuperAgent_V11_5_FULL.js';
let s=fs.readFileSync(srcPath,'utf8');
const must=(needle,label=needle)=>{if(!s.includes(needle))throw new Error(`V11.5 anchor missing: ${label}`);};
const once=(from,to,label=from)=>{must(from,label);const n=s.split(from).length-1;if(n!==1)throw new Error(`V11.5 anchor not unique (${n}): ${label}`);s=s.replace(from,to);};

once('const V10_VERSION="11.4.0";','const V10_VERSION="11.5.0";','version');
once('const V10_NAME="سوبر إيجنت V11.4 — سلسلة Gemini ثلاثية مستقرة + طبقة تحقق واعتمادية";','const V10_NAME="سوبر إيجنت V11.5 — Gemini ثلاثي + Hardening شامل للاعتمادية والأمان والسرعة";','name');
once('v11_4:true,v114_google_three_model_chain:true','v11_4:true,v11_5:true,v115_hardened:true,v114_google_three_model_chain:true','root flags');
once('if(request.method==="GET"&&url.pathname==="/setup")return setup(request,env);','if((request.method==="GET"||request.method==="POST")&&url.pathname==="/setup")return setup(request,env);','setup route');

s=s.replaceAll('url.searchParams.get("key")||""','adminKeyFromRequestV115(request)');
s=s.replaceAll("url.searchParams.get('key')||''",'adminKeyFromRequestV115(request)');
s=s.replaceAll('سوبر إيجنت V11.4 جاهز للعمل','سوبر إيجنت V11.5 جاهز للعمل');
s=s.replaceAll('أنا سوبر إيجنت V11.4 🤖','أنا سوبر إيجنت V11.5 🤖');
s=s.replaceAll('أنت SuperAgent V11.2. اتكلم بالمصري الطبيعي جدًا','أنت SuperAgent V11.5. اتكلم بالمصري الطبيعي جدًا');

once('await ensureSchemaOnce(env,true);\nconst webhookUrl=`${url.origin}/telegram`;','await ensureSchemaOnce(env,true);\nawait markSchemaVersionV115(env);\nconst webhookUrl=`${url.origin}/telegram`;','setup schema marker');
once('await ensureSchemaOnce(env);\nctx.waitUntil(drainTelegramInboxV106(env,chatId,url.origin));','await ensureRuntimeSchemaReadyV115(env);\nctx.waitUntil(drainTelegramInboxV106(env,chatId,url.origin));','internal drain schema');
once('await ensureSchemaOnce(env);\nawait persistTelegramInboxV106(update,env);','await ensureRuntimeSchemaReadyV115(env);\nawait persistTelegramInboxV106(update,env);','webhook schema');
once('async function handleTelegramUpdate(update,env){\nawait ensureSchemaOnce(env);','async function handleTelegramUpdate(update,env){\nawait ensureRuntimeSchemaReadyV115(env);','handler schema');
once('await clearPendingConflict(env,chatId);\n}\n\nif(await handleDirectCommands(env,chatId,text))return;\n\nconst history=','await clearPendingConflict(env,chatId);\n}\n\nconst history=','duplicate direct handler');

const hardening=fs.readFileSync('tools/v115_hardening.jsfrag','utf8');
s='/* SuperAgent V11.5 FULL — hardening over V11.4; same Google-only 3-model chain; no AI router. */\n'+s+'\n'+hardening+'\n';

for(const [name,x] of [
  ['old fast-chat brand','أنت SuperAgent V11.2. اتكلم بالمصري الطبيعي جدًا'],
  ['old setup brand','سوبر إيجنت V11.4 جاهز للعمل'],
  ['old identity brand','أنا سوبر إيجنت V11.4 🤖']
])if(s.includes(x))throw new Error(`V11.5 forbidden marker remains: ${name}`);
const chain=s.match(/const MODEL_CHAIN=\[([\s\S]*?)\n\];\nconst PRIMARY_MODEL/);if(!chain)throw new Error('MODEL_CHAIN missing');
const ids=[...chain[1].matchAll(/id:"([^"]+)"/g)].map(x=>x[1]);
const expected=['gemini::gemini-3.5-flash-lite','gemini::gemini-3.1-flash-lite','gemini::gemini-3.6-flash'];
if(JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('V11.5 model chain changed unexpectedly: '+JSON.stringify(ids));
fs.writeFileSync(outPath,s);
const cert={version:'11.5.0',sha256:crypto.createHash('sha256').update(s).digest('hex'),bytes:Buffer.byteLength(s),lines:s.split(/\n/).length,models:expected,hardening:{current_data_gate:true,personalization_context_gate:true,direct_mutation_exception_disarm:true,queue_heartbeat:true,voice_deadline:true,chat_rate_limit:true,transport_purge_after_clear:true,non_mutating_world_updates:true,fast_schema_marker:true,continuation_timeout:true,header_admin_auth:true,brief_windows:true,branding_v115:true,chat_failure_incident:true,duplicate_direct_handler_removed:true,holiday_failure_not_cached:true,accurate_model_timeout:true}};
fs.writeFileSync('V11_5_CERTIFICATION.json',JSON.stringify(cert,null,2));
console.log(JSON.stringify(cert,null,2));
