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

const hardening=String.raw`

/* =====================================================================
   SuperAgent V11.5 HARDENING
   Fixes identified in the V11.4 full-file review without changing the
   Google-only 3-model chain or reintroducing an AI router.
   ===================================================================== */
const V115_SCHEMA_MARKER='schema_version_v115';
const V115_SCHEMA_VERSION='11.5.0';
const V115_CONTINUATION_TIMEOUT_MS=1800;
const V115_QUEUE_HEARTBEAT_MS=8000;
const V115_VOICE_TOTAL_BUDGET_MS=20000;
const V115_VOICE_FILE_TIMEOUT_MS=7000;
const V115_VOICE_STT_TIMEOUT_MS=11000;
const V115_PURGE_TRANSPORT_CHAT_IDS=new Set();
let V115_SCHEMA_CONFIRMED=false;

function adminKeyFromRequestV115(request){
  const h=String(request?.headers?.get('X-SuperAgent-Key')||'').trim();if(h)return h;
  const a=String(request?.headers?.get('Authorization')||'').trim();const m=a.match(/^Bearer\s+(.+)$/i);return m?m[1].trim():'';
}
async function markSchemaVersionV115(env){
  if(!env?.DB)return;await env.DB.prepare(`INSERT INTO scheduler_state(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(V115_SCHEMA_MARKER,V115_SCHEMA_VERSION,new Date().toISOString()).run();V115_SCHEMA_CONFIRMED=true;
}
async function ensureRuntimeSchemaReadyV115(env){
  if(V115_SCHEMA_CONFIRMED)return;
  try{const row=await env.DB.prepare(`SELECT value FROM scheduler_state WHERE key=? LIMIT 1`).bind(V115_SCHEMA_MARKER).first();if(String(row?.value||'')===V115_SCHEMA_VERSION){V115_SCHEMA_CONFIRMED=true;return;}}catch{}
  await ensureSchemaOnce(env);await markSchemaVersionV115(env);
}

function needsPersonalizationContextV115(text){
  const t=normalizeArabicLoose(String(text||''));
  return /(?:على ذوقي|علي ذوقي|يناسبني|مناسب ليا|مناسب لي|حسب ذوقي|بناء على اللي تعرفه عني|بناء علي اللي تعرفه عني|على حسب اللي تعرفه عني|علي حسب اللي تعرفه عني|فاكر انا بحب|فاكر إني بحب|رشحلي.+(?:ليا|لي)|اختارلي.+(?:ذوقي|يناسبني))/u.test(t);
}
needsCurrentExternalDataV113=function(text){
  const t=normalizeArabicLoose(normalizeDigits(String(text||''))).toLowerCase();
  if(needsLiveNews(text))return true;
  if(/(?:^|\s)(?:سعر|اسعار|أسعار|صرف|الدولار|اليورو|الريال|الذهب|الدهب|بورصه|بورصة|سهم|اسهم|أسهم)(?:\s|$)/u.test(t))return true;
  if(/(?:الطقس|الجو|درجه الحراره|درجة الحرارة|حراره|حرارة)/u.test(t)&&!/(?:يعني ايه|ما معنى|تعريف|ليه الجو|لماذا الجو)/u.test(t))return true;
  if(/(?:نتيجه|نتيجة|ماتش|الماتش|الاسكور|ترتيب الدوري|ترتيب الفرق|الدوري)/u.test(t)&&/(?:مين|كام|امتى|إمتى|متى|النهارده|اليوم|بكره|بكرة|دلوقتي|حاليا|حاليًا|نتيجه|نتيجة|ترتيب)/u.test(t))return true;
  if(/(?:مين\s+(?:هو\s+)?(?:رئيس|وزير|محافظ|مدير|ceo)|(?:رئيس|وزير|محافظ|مدير|ceo).{0,35}\sمين|(?:الرئيس|الوزير|المحافظ|المدير|ceo)\s+الحالي)/iu.test(t))return true;
  if(/(?:مفتوح|متاح|متوفر|فيه حجز|في حجز).{0,30}(?:دلوقتي|النهارده|اليوم|بكره|بكرة|امتى|إمتى|متى)?/u.test(t))return true;
  if(/(?:دلوقتي|حاليا|حاليًا|الآن|النهارده|اليوم)/u.test(t)&&/(?:مين|كام|ايه|اي|عامل|وصل|الرئيس|رئيس|الوزير|وزير|المدير|مدير|ceo|سعر|صرف|الجو|الطقس|نتيجه|نتيجة|ترتيب|متاح|مفتوح)/iu.test(t))return true;
  return false;
};
const __V114_v112LooksLikeToolOrStateRequest=v112LooksLikeToolOrStateRequest;
v112LooksLikeToolOrStateRequest=function(text){return needsPersonalizationContextV115(text)||__V114_v112LooksLikeToolOrStateRequest(text);};
v112LooksLikeDirectChat=function(text){const raw=String(text||'').trim();return !!raw&&!v112LooksLikeToolOrStateRequest(raw);};

v112CallPlainChat=async function(env,model,text,history=[]){
  const controller=new AbortController();const timeout=Math.min(Number(model?.timeoutMs||V112_CHAT_TIMEOUT_MS),V112_CHAT_TIMEOUT_MS);const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const recent=(Array.isArray(history)?history:[]).slice(-8).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content||'').slice(0,1200)}));
    const messages=[{role:'system',content:'أنت SuperAgent V11.5. اتكلم بالمصري الطبيعي جدًا وباختصار ووضوح. افهم العامية المصرية والإملاء غير الرسمي. لو السؤال محتاج بيانات حالية أو بيانات شخصية محفوظة وما وصلتكش في السياق، ما تخمنش. ممنوع تقول إنك نفذت موعد أو مشتريات أو غيرت بيانات في مسار الدردشة. ما ترجعش JSON.'},...recent,{role:'user',content:String(text||'').slice(0,7000)}];
    const req=new Request(OMNIAI_INTERNAL_URL,{method:'POST',headers:{Authorization:'Bearer '+env.OMNIAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:model.id,messages,temperature:0.35,max_tokens:900,stream:false}),signal:controller.signal});
    const res=await env.OMNIAI_SERVICE.fetch(req);if(!res.ok){const e=new Error('chat_http_'+res.status);e.httpStatus=res.status;throw e;}const data=await res.json();const out=v11ExtractModelText(data).trim();if(!out)throw new Error('chat_empty');return out;
  }catch(e){if(e?.name==='AbortError'){const x=new Error(`chat_timeout_${timeout}ms`);x.name='AbortError';throw x;}throw e;}finally{clearTimeout(timer);}
};
tryV112FastChat=async function(env,chatId,text,history=[]){
  const fixed=v112DeterministicCasualReply(text);if(fixed){await sendText(env,chatId,fixed,quickMenuKeyboard());await saveConversationMessage(env,chatId,'assistant',fixed);return true;}
  if(!v112LooksLikeDirectChat(text))return false;
  await enforceAiRateLimit(env,chatId);
  const started=Date.now(),errors=[];
  for(const model of V112_CHAT_MODELS){if(Date.now()-started>=V112_CHAT_TOTAL_BUDGET_MS)break;const a=Date.now();try{const answer=await v112CallPlainChat(env,model,text,history);try{await recordModelResult(env,model,true,Date.now()-a,null);}catch{}await sendText(env,chatId,answer,quickMenuKeyboard());await saveConversationMessage(env,chatId,'assistant',answer);return true;}catch(e){errors.push(e);try{await recordModelResult(env,model,false,Date.now()-a,String(e?.message||e));}catch{}}}
  const incident=await recordRuntimeFailure(env,{chatId,scope:'v115_direct_chat_all_models_failed',error:errors.map(e=>safeError(e)).join(' | ')});
  const allRateLimited=errors.length>0&&errors.every(e=>Number(e?.httpStatus||0)===429);
  if(allRateLimited){const answer=`⚠️ خدمة Gemini وصلت لحد الاستخدام المؤقت. جرّب بعد شوية. رقم التتبع: ${incident}`;await sendText(env,chatId,answer,quickMenuKeyboard());await saveConversationMessage(env,chatId,'assistant',answer);return true;}
  const e=new Error(`V11.5 transient chat failure ${incident}`);e.retryable=true;throw e;
};

function remainingBudgetV115(deadline,min=250){return Math.max(min,deadline-Date.now());}
async function fetchBlobWithTimeoutV115(url,options={},timeoutMs=V115_VOICE_FILE_TIMEOUT_MS){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{...options,signal:c.signal});const blob=await r.blob();return{r,blob};}finally{clearTimeout(timer);}
}
transcribeTelegramVoice=async function(env,voice){
  const fileId=String(voice?.file_id||'');if(!fileId)throw new Error('ملف الفويس غير صالح.');if(Number(voice?.file_size||0)>VOICE_MAX_BYTES)throw new Error('الفويس كبير جدًا للمعالجة.');
  const deadline=Date.now()+V115_VOICE_TOTAL_BUDGET_MS;const info=await telegramApi(env,'getFile',{file_id:fileId});if(!info?.ok||!info?.result?.file_path)throw new Error('مقدرتش أحمل الرسالة الصوتية من تيليجرام.');
  const dl=Math.min(V115_VOICE_FILE_TIMEOUT_MS,remainingBudgetV115(deadline));const {r:fileRes,blob}=await fetchBlobWithTimeoutV115(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`,{},dl);if(!fileRes.ok)throw new Error(`فشل تحميل ملف الفويس HTTP ${fileRes.status}.`);if(blob.size>VOICE_MAX_BYTES)throw new Error('الفويس كبير جدًا للمعالجة.');
  const makeForm=model=>{const form=new FormData();form.append('file',blob,'voice.ogg');form.append('model',String(model||'auto'));form.append('language','ar');form.append('response_format','json');return form;};
  if(env.OMNIAI_SERVICE&&env.OMNIAI_API_KEY&&Date.now()<deadline-500){
    const ms=Math.min(V115_VOICE_STT_TIMEOUT_MS,remainingBudgetV115(deadline));const c=new AbortController(),timer=setTimeout(()=>c.abort(),ms);try{const req=new Request(OMNIAI_INTERNAL_URL.replace(/\/chat\/completions$/,'/audio/transcriptions'),{method:'POST',headers:{Authorization:`Bearer ${env.OMNIAI_API_KEY}`},body:makeForm(env.VOICE_MODEL||'auto'),signal:c.signal});const r=await env.OMNIAI_SERVICE.fetch(req);const raw=await r.text();let j;try{j=JSON.parse(raw)}catch{j=null}if(r.ok){const text=String(j?.text||j?.transcript||'').trim();if(text)return text;}console.warn('OmniAI transcription failed',r.status,j?.error?.message||raw.slice(0,200));}catch(e){console.warn('OmniAI transcription error',safeError(e));}finally{clearTimeout(timer);}
  }
  const key=String(env.VOICE_TRANSCRIBE_KEY||env.GROQ_API_KEY||'');if(!key)throw new Error('محرك الذكاء لم ينجح في تحويل الرسالة الصوتية إلى نص. تأكد إن مزود تحويل الصوت إلى نص مفعّل.');if(Date.now()>=deadline-300)throw new Error('مهلة معالجة الفويس انتهت قبل الـfallback.');
  const url=String(env.VOICE_TRANSCRIBE_URL||'https://api.groq.com/openai/v1/audio/transcriptions'),ms=remainingBudgetV115(deadline);const c=new AbortController(),timer=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${key}`},body:makeForm(env.VOICE_MODEL||'whisper-large-v3-turbo'),signal:c.signal});const raw=await r.text();let j;try{j=JSON.parse(raw)}catch{j=null}if(!r.ok)throw new Error(j?.error?.message||`Voice HTTP ${r.status}`);const text=String(j?.text||j?.transcript||'').trim();if(!text)throw new Error('الفويس اتحول لنص فاضي.');return text;}finally{clearTimeout(timer);}
};

triggerDrainContinuationV106=async function(env,chatId,origin){
  if(!origin||!env?.TELEGRAM_WEBHOOK_SECRET)return false;const id=String(chatId||'').trim();if(!id||id.length>V106_CONTINUATION_MAX_CHAT_LENGTH)return false;
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),V115_CONTINUATION_TIMEOUT_MS);try{const r=await fetch(`${String(origin).replace(/\/$/,'')}/internal/drain-v106`,{method:'POST',headers:{'content-type':'application/json','X-SuperAgent-Internal':env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify({chat_id:id}),signal:c.signal});if(r.body)try{await r.body.cancel();}catch{}if(r.status!==202)throw new Error(`continuation HTTP ${r.status}`);return true;}catch(e){await recordRuntimeFailure(env,{chatId:id,scope:'telegram_inbox_v115_continuation',error:e});return false;}finally{clearTimeout(timer);}
};
async function renewInboxLeaseV115(env,chatId,updateId){await env.DB.prepare(`UPDATE telegram_inbox_v106 SET lease_until=?,updated_at=? WHERE update_id=? AND chat_id=? AND status='processing'`).bind(isoAfterV106(V106_INBOX_LEASE_MS),new Date().toISOString(),String(updateId),String(chatId)).run();}
async function purgeTransportForChatV115(env,chatId,throughUpdateId){
  const id=String(throughUpdateId||'');const numeric=/^\d+$/.test(id);const stmts=[env.DB.prepare(`DELETE FROM operation_receipts WHERE chat_id=?`).bind(String(chatId)),env.DB.prepare(`DELETE FROM conversation_messages WHERE chat_id=?`).bind(String(chatId))];
  if(numeric){stmts.push(env.DB.prepare(`DELETE FROM telegram_inbox_v106 WHERE chat_id=? AND CAST(update_id AS INTEGER)<=?`).bind(String(chatId),Number(id)));stmts.push(env.DB.prepare(`DELETE FROM telegram_updates WHERE chat_id=? AND CAST(update_id AS INTEGER)<=?`).bind(String(chatId),Number(id)));}else{stmts.push(env.DB.prepare(`DELETE FROM telegram_inbox_v106 WHERE chat_id=? AND update_id=?`).bind(String(chatId),id));stmts.push(env.DB.prepare(`DELETE FROM telegram_updates WHERE chat_id=? AND update_id=?`).bind(String(chatId),id));}
  await env.DB.batch(stmts);V115_PURGE_TRANSPORT_CHAT_IDS.delete(String(chatId));
}
const __V114_clearEverythingV105=clearEverythingV105;
clearEverythingV105=async function(env,chatId){const out=await __V114_clearEverythingV105(env,chatId);V115_PURGE_TRANSPORT_CHAT_IDS.add(String(chatId));return out;};

drainTelegramInboxV106=async function(env,chatId,origin=''){
  if(!env?.DB)return;const owner=newQueueOwnerV106();let acquired=false,processed=0,failed=false,retryPending=false,retryAttempt=0;
  for(let retry=0;retry<V106_LEASE_RETRY_COUNT;retry++){if(await acquireChatLeaseV106(env,chatId,owner)){acquired=true;break;}await sleepV106(V106_LEASE_RETRY_DELAY_MS+Math.floor(Math.random()*50));}if(!acquired)return;
  try{
    for(let i=0;i<V106_INBOX_BATCH_SIZE;i++){
      const row=await nextInboxRowV106(env,chatId);if(!row)break;const now=new Date().toISOString(),until=isoAfterV106(V106_INBOX_LEASE_MS);const upd=await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status='processing',attempts=attempts+1,lease_until=?,updated_at=? WHERE update_id=? AND chat_id=? AND status IN ('pending','processing') AND (status='pending' OR lease_until IS NULL OR lease_until<=?) RETURNING attempts`).bind(until,now,String(row.update_id),String(chatId),now).first();if(!upd)continue;
      const attempts=Number(upd.attempts||1);if(attempts>1)await env.DB.prepare(`DELETE FROM telegram_updates WHERE update_id=? AND status!='done'`).bind(String(row.update_id)).run();let update;try{update=JSON.parse(String(row.payload_json||'{}'));}catch{await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status='failed',last_error=?,lease_until=NULL,updated_at=? WHERE update_id=?`).bind('invalid payload',new Date().toISOString(),String(row.update_id)).run();failed=true;break;}
      let hb=null;try{
        await renewChatLeaseV106(env,chatId,owner);await renewInboxLeaseV115(env,chatId,row.update_id);hb=setInterval(()=>{Promise.all([renewChatLeaseV106(env,chatId,owner),renewInboxLeaseV115(env,chatId,row.update_id)]).catch(e=>console.warn('V11.5 lease heartbeat failed',safeError(e)));},V115_QUEUE_HEARTBEAT_MS);
        await enqueueTelegramUpdateV105(update,env);const ledger=await env.DB.prepare(`SELECT status,error_text FROM telegram_updates WHERE update_id=? LIMIT 1`).bind(String(row.update_id)).first();if(String(ledger?.status||'')!=='done')throw new Error(String(ledger?.error_text||'Telegram update did not commit'));await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status='done',last_error=NULL,lease_until=NULL,updated_at=? WHERE update_id=?`).bind(new Date().toISOString(),String(row.update_id)).run();processed++;
        if(V115_PURGE_TRANSPORT_CHAT_IDS.has(String(chatId))){await purgeTransportForChatV115(env,chatId,row.update_id);break;}
        if(i+1<V106_INBOX_BATCH_SIZE)await sleepV106(V106_INTER_UPDATE_DELAY_MS);
      }catch(e){const err=safeError(e),terminal=attempts>=V106_INBOX_MAX_ATTEMPTS;await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status=?,last_error=?,lease_until=NULL,updated_at=? WHERE update_id=?`).bind(terminal?'failed':'pending',err,new Date().toISOString(),String(row.update_id)).run();await recordRuntimeFailure(env,{chatId,scope:'telegram_inbox_v115',error:e,context:{update_id:String(row.update_id),attempts,terminal}});if(!terminal){retryPending=true;retryAttempt=attempts;}failed=true;break;}finally{if(hb)clearInterval(hb);}
    }
  }finally{await releaseChatLeaseV106(env,chatId,owner).catch(()=>{});}
  if(retryPending&&origin){const delay=Math.min(1400,V113_TRANSIENT_RETRY_BASE_MS*Math.pow(2,Math.max(0,retryAttempt-1)))+Math.floor(Math.random()*90);await sleepV106(delay);await triggerDrainContinuationV106(env,chatId,origin);return;}
  if(!failed&&processed===V106_INBOX_BATCH_SIZE&&origin&&await hasRunnableInboxV106(env,chatId))await triggerDrainContinuationV106(env,chatId,origin);
};

const __V114_executeIntent=executeIntent;
executeIntent=async function(env,chatId,intent,options={}){const action=String(intent?.action||''),mutating=new Set(['create','delete','update','manage_rule','bulk_shift','bulk_delete','shopping']);const out=await __V114_executeIntent(env,chatId,intent,options);if(!mutating.has(action)&&Array.isArray(intent?.world_updates)&&intent.world_updates.length)await __V112_persistWorldUpdatesSafely(env,chatId,intent);return out;};

const __V114_handleV10DirectCommands=handleV10DirectCommands;
handleV10DirectCommands=async function(env,chatId,text,options={}){try{return await __V114_handleV10DirectCommands(env,chatId,text,options);}catch(e){v113DisarmMutationReceipt(chatId);throw e;}};
const __V114_handleLifeDirectCommands=handleLifeDirectCommands;
handleLifeDirectCommands=async function(env,chatId,text){try{return await __V114_handleLifeDirectCommands(env,chatId,text);}catch(e){v113DisarmMutationReceipt(chatId);throw e;}};
const __V114_handleDirectCommands=handleDirectCommands;
handleDirectCommands=async function(env,chatId,text){try{return await __V114_handleDirectCommands(env,chatId,text);}catch(e){v113DisarmMutationReceipt(chatId);throw e;}};
const __V114_handleCallbackQuery=handleCallbackQuery;
handleCallbackQuery=async function(query,env){const chatId=String(query?.message?.chat?.id??query?.from?.id??'');try{return await __V114_handleCallbackQuery(query,env);}catch(e){if(chatId)v113DisarmMutationReceipt(chatId);throw e;}};

fetchPublicHolidays=async function(env,profile,year){
  const cc=String(profile.country_code||DEFAULT_COUNTRY_CODE).toUpperCase(),key=`holidays:${cc}:${year}`,c=await cacheGet(env,key);if(c)return Array.isArray(c.items)?c.items:[];let items=[],successful=false;
  for(const url of[`https://date.nager.at/api/v4/Holidays/${encodeURIComponent(cc)}/${year}`,`https://date.nager.at/api/v3/PublicHolidays/${year}/${encodeURIComponent(cc)}`]){try{const r=await fetchWithTimeoutV113(url,{headers:{accept:'application/json'}},1800);if(!r.ok)continue;const j=await r.json();if(!Array.isArray(j))continue;successful=true;items=j.map(x=>({date:String(x.date||''),name:String(x.localName||x.name||''),english:String(x.name||'')})).filter(x=>validDate(x.date));if(items.length)break;}catch{}}
  if(!successful){const stale=await cacheGetAnyV113(env,key);if(Array.isArray(stale?.items))return stale.items;return[];}await cachePut(env,key,{items},HOLIDAY_CACHE_TTL_MINUTES);return items;
};

callOneModel=async function(env,model,systemPrompt,userText,timeoutMs){
  const total=Math.max(450,Number(timeoutMs)||1500),deadline=Date.now()+total;let structured=true,lastErr=null;
  for(let pass=0;pass<2;pass++){const remaining=deadline-Date.now();if(remaining<300)break;const attemptMs=remaining,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),attemptMs);try{const body={model:model.id,messages:[{role:'system',content:systemPrompt},{role:'user',content:userText}],max_tokens:1200,stream:false};if(structured)body.response_format={type:'json_object'};const req=new Request(OMNIAI_INTERNAL_URL,{method:'POST',headers:{Authorization:`Bearer ${env.OMNIAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const res=await env.OMNIAI_SERVICE.fetch(req),raw=await res.text();let data;try{data=JSON.parse(raw)}catch{throw new Error(`HTTP ${res.status}: OmniAI رجّع رد غير JSON`);}if(!res.ok){const msg=String(data?.error?.message||data?.message||`OmniAI HTTP ${res.status}`);if(structured&&res.status>=400&&res.status<500&&/(response.?format|json.?object|unsupported|not supported|schema)/i.test(msg)){structured=false;lastErr=new Error(msg);continue;}throw new Error(msg);}const content=v11ExtractModelText(data).trim();if(!content)throw new Error('الموديل رجّع رد فاضي');return parseModelJson(content);}catch(e){if(e?.name==='AbortError'){const x=new Error(`Timeout بعد ${attemptMs}ms`);x.name='AbortError';throw x;}lastErr=e;if(!structured)break;throw e;}finally{clearTimeout(timer);}}
  throw lastErr||new Error('فشل JSON من الموديل');
};

function clockInWindowV115(hhmm,start,end){const toM=v=>{const [h,m]=String(v).split(':').map(Number);return h*60+m;},x=toM(hhmm);return x>=toM(start)&&x<=toM(end);}
runV10PeriodicIntelligence=async function(env,scheduledTime){
  if(!env.DB)return;await ensureRuntimeSchemaReadyV115(env);const cairo=zonedNow(TIME_ZONE);if(clockInWindowV115(cairo.time,'03:00','03:09'))await cleanupTelegramUpdateLedger(env);
  const users=(await env.DB.prepare(`SELECT s.*,p.timezone FROM agent_settings s LEFT JOIN user_profiles p ON p.chat_id=s.chat_id WHERE s.morning_brief_enabled=1 OR s.evening_brief_enabled=1`).all())?.results||[];
  for(const u of users){try{const tz=String(u.timezone||TIME_ZONE),now=zonedNow(tz);let type=null;if(Number(u.morning_brief_enabled)&&clockInWindowV115(now.time,'08:00','08:09'))type='morning';if(Number(u.evening_brief_enabled)&&clockInWindowV115(now.time,'21:00','21:09'))type='evening';if(!type)continue;const exists=await env.DB.prepare(`SELECT 1 FROM daily_brief_fires WHERE chat_id=? AND brief_date=? AND brief_type=?`).bind(String(u.chat_id),now.date,type).first();if(exists)continue;const text=await buildDailyBrief(env,String(u.chat_id),type,now);await sendText(env,String(u.chat_id),text);await env.DB.prepare(`INSERT OR IGNORE INTO daily_brief_fires(chat_id,brief_date,brief_type,sent_at) VALUES (?,?,?,?)`).bind(String(u.chat_id),now.date,type,new Date().toISOString()).run();}catch(e){await recordRuntimeFailure(env,{chatId:String(u.chat_id||''),scope:'v115_daily_brief',error:e});}}
};

function runV115PureSelfTests(){
  const tests=[],add=(name,ok,detail='')=>tests.push({name,ok:!!ok,detail});
  for(const q of['مين رئيس مصر؟','سعر الدولار؟','الطقس في القاهرة؟','مين CEO جوجل؟'])add(`current gate: ${q}`,v112LooksLikeDirectChat(q)===false,String(v112LooksLikeDirectChat(q)));
  add('personalization gate',v112LooksLikeDirectChat('اختارلي فيلم على ذوقي')===false,String(v112LooksLikeDirectChat('اختارلي فيلم على ذوقي')));
  add('stable chat remains direct',v112LooksLikeDirectChat('اشرحلي يعني ايه الذكاء الاصطناعي')===true,String(v112LooksLikeDirectChat('اشرحلي يعني ايه الذكاء الاصطناعي')));
  add('brief 08:07 window',clockInWindowV115('08:07','08:00','08:09')===true);
  add('brief 08:10 outside',clockInWindowV115('08:10','08:00','08:09')===false);
  add('continuation timeout bounded',V115_CONTINUATION_TIMEOUT_MS<=2000,String(V115_CONTINUATION_TIMEOUT_MS));
  add('queue heartbeat below lease',V115_QUEUE_HEARTBEAT_MS<V106_INBOX_LEASE_MS,`${V115_QUEUE_HEARTBEAT_MS}/${V106_INBOX_LEASE_MS}`);
  add('voice budget bounded',V115_VOICE_TOTAL_BUDGET_MS<=20000,String(V115_VOICE_TOTAL_BUDGET_MS));
  add('three Google models unchanged',MODEL_CHAIN.length===3&&MODEL_CHAIN.every(x=>x.id.startsWith('gemini::')),JSON.stringify(MODEL_CHAIN.map(x=>x.id)));
  const passed=tests.filter(x=>x.ok).length;return{ok:passed===tests.length,passed,total:tests.length,tests};
}
const __V114_selfTestEndpoint=selfTestEndpoint;
selfTestEndpoint=async function(request,env){const base=await __V114_selfTestEndpoint(request,env);if(!(base instanceof Response))return base;const j=await base.json();const v115=runV115PureSelfTests();return json({...j,version:V10_VERSION,v115,ok:!!j.ok&&v115.ok},base.status);};
`;

s='/* SuperAgent V11.5 FULL — hardening over V11.4; same Google-only 3-model chain; no AI router. */\n'+s+hardening;

const forbidden=[
  ['old fast-chat brand','أنت SuperAgent V11.2. اتكلم بالمصري الطبيعي جدًا'],
  ['old setup brand','سوبر إيجنت V11.4 جاهز للعمل'],
  ['old identity brand','أنا سوبر إيجنت V11.4 🤖']
];
for(const [name,x] of forbidden)if(s.includes(x))throw new Error(`V11.5 forbidden marker remains: ${name}`);
const ids=[...s.matchAll(/id:"(gemini::gemini-[^"]+)"/g)].slice(0,3).map(x=>x[1]);
const expected=['gemini::gemini-3.5-flash-lite','gemini::gemini-3.1-flash-lite','gemini::gemini-3.6-flash'];
if(JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('V11.5 model chain changed unexpectedly: '+JSON.stringify(ids));
fs.writeFileSync(outPath,s);
const cert={version:'11.5.0',sha256:crypto.createHash('sha256').update(s).digest('hex'),bytes:Buffer.byteLength(s),lines:s.split(/\n/).length,models:expected,hardening:{current_data_gate:true,personalization_context_gate:true,direct_mutation_exception_disarm:true,queue_heartbeat:true,voice_deadline:true,chat_rate_limit:true,transport_purge_after_clear:true,non_mutating_world_updates:true,fast_schema_marker:true,continuation_timeout:true,header_admin_auth:true,brief_windows:true,branding_v115:true,chat_failure_incident:true,duplicate_direct_handler_removed:true,holiday_failure_not_cached:true,accurate_model_timeout:true}};
fs.writeFileSync('V11_5_CERTIFICATION.json',JSON.stringify(cert,null,2));
console.log(JSON.stringify(cert,null,2));
