import fs from 'node:fs';

const file=process.argv[2]||'SuperAgent_V11_3_FULL.js';
let s=fs.readFileSync(file,'utf8');
function one(oldValue,newValue,label){
  if(!s.includes(oldValue))throw new Error(`missing V11.3 live-fix anchor: ${label}`);
  s=s.replace(oldValue,newValue);
}
one('const TOTAL_AI_BUDGET_MS=6200;const V112_CHAT_TOTAL_BUDGET_MS=4600;const V112_CHAT_TIMEOUT_MS=1700;',
    'const TOTAL_AI_BUDGET_MS=9000;const V112_CHAT_TOTAL_BUDGET_MS=4600;const V112_CHAT_TIMEOUT_MS=1700;',
    'planner budget');
one('timeoutMs:1600,role:"primary"','timeoutMs:2600,role:"primary"','primary timeout');
one('timeoutMs:1900,role:"fallback_1"','timeoutMs:2800,role:"fallback_1"','fallback 1 timeout');
one('timeoutMs:2300,role:"fallback_2"','timeoutMs:3200,role:"fallback_2"','fallback 2 timeout');
one('live_reality:true,long_term_memory:true,fallback_models:FALLBACK_MODELS.length});',
    'live_reality:true,long_term_memory:true,fallback_count:FALLBACK_MODELS.length});',
    'duplicate setup key');
one('new Error("V11.2: الموديل الأساسي والـ2 fallback فشلوا، فمغيّرتش أي بيانات. جرّب تاني بعد لحظات.")',
    'new Error("V11.3: الموديل الأساسي والـ2 fallback فشلوا، فمغيّرتش أي بيانات. جاري إعادة المحاولة تلقائيًا عند فشل مؤقت.")',
    'versioned model failure');
one('const V106_INTER_UPDATE_DELAY_MS=5;\nconst V106_CONTINUATION_MAX_CHAT_LENGTH=64;',
    'const V106_INTER_UPDATE_DELAY_MS=5;\nconst V113_TRANSIENT_RETRY_BASE_MS=180;\nconst V106_CONTINUATION_MAX_CHAT_LENGTH=64;',
    'retry delay constant');
one('let acquired=false,processed=0,failed=false;',
    'let acquired=false,processed=0,failed=false,retryPending=false,retryAttempt=0;',
    'drain retry state');
one("        await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status=?,last_error=?,lease_until=NULL,updated_at=? WHERE update_id=?`).bind(terminal?'failed':'pending',err,new Date().toISOString(),String(row.update_id)).run();\n        await recordRuntimeFailure(env,{chatId,scope:'telegram_inbox_v106',error:e,context:{update_id:String(row.update_id),attempts}});\n        failed=true;break;\n",
    "        await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status=?,last_error=?,lease_until=NULL,updated_at=? WHERE update_id=?`).bind(terminal?'failed':'pending',err,new Date().toISOString(),String(row.update_id)).run();\n        await recordRuntimeFailure(env,{chatId,scope:'telegram_inbox_v106',error:e,context:{update_id:String(row.update_id),attempts,terminal}});\n        if(!terminal){retryPending=true;retryAttempt=attempts;}\n        failed=true;break;\n",
    'transient retry mark');
one("  if(!failed&&processed===V106_INBOX_BATCH_SIZE&&origin&&await hasRunnableInboxV106(env,chatId)){\n    await triggerDrainContinuationV106(env,chatId,origin);\n  }\n}",
    "  if(retryPending&&origin){\n    const delay=Math.min(1400,V113_TRANSIENT_RETRY_BASE_MS*Math.pow(2,Math.max(0,retryAttempt-1)))+Math.floor(Math.random()*90);\n    await sleepV106(delay);\n    await triggerDrainContinuationV106(env,chatId,origin);\n    return;\n  }\n  if(!failed&&processed===V106_INBOX_BATCH_SIZE&&origin&&await hasRunnableInboxV106(env,chatId)){\n    await triggerDrainContinuationV106(env,chatId,origin);\n  }\n}",
    'immediate continuation');
const readyStart=s.indexOf('async function reliabilityReadyV113(request,env){');
const readyEnd=s.indexOf('\n// Versioned identity.',readyStart);
if(readyStart<0||readyEnd<0)throw new Error('missing V11.3 live-fix anchor: readiness function');
const ready=`async function reliabilityReadyV113(request,env){
  const url=new URL(request.url),key=url.searchParams.get('key')||'';if(!env.SETUP_KEY||key!==env.SETUP_KEY)return json({ok:false,error:'غير مصرح'},401);
  const base={ok:false,version:V10_VERSION,db:false,omniai:false,primary_model:PRIMARY_MODEL.id,probe_model:null,attempts:[]};
  try{
    await ensureSchemaOnce(env);const p=await env.DB.prepare(\`SELECT 1 AS ok\`).first();base.db=Number(p?.ok||0)===1;
    if(!env.OMNIAI_SERVICE||!env.OMNIAI_API_KEY)return json({...base,error:'ربط OmniAI ناقص'},503);
    for(const model of MODEL_CHAIN){
      const c=new AbortController(),timeout=Math.min(3600,Math.max(1800,Number(model.timeoutMs||2500)+350)),timer=setTimeout(()=>c.abort(),timeout),started=Date.now();
      try{
        const req=new Request(OMNIAI_INTERNAL_URL,{method:'POST',headers:{Authorization:\`Bearer \${env.OMNIAI_API_KEY}\`,'Content-Type':'application/json'},body:JSON.stringify({model:model.id,messages:[{role:'user',content:'رد بكلمة OK فقط'}],max_tokens:8,stream:false}),signal:c.signal});
        const r=await env.OMNIAI_SERVICE.fetch(req);base.attempts.push({model:model.id,ok:r.ok,status:r.status,latency_ms:Date.now()-started});
        if(r.ok){base.omniai=true;base.probe_model=model.id;break;}
      }catch(e){base.attempts.push({model:model.id,ok:false,status:0,latency_ms:Date.now()-started,error:safeError(e)});}finally{clearTimeout(timer);}
    }
    return json({...base,ok:base.db&&base.omniai,...(!base.omniai?{error:'لم يستجب أي موديل في فحص الجاهزية'}:{})},base.db&&base.omniai?200:503);
  }catch(e){return json({...base,error:safeError(e)},503);}
}
`;
s=s.slice(0,readyStart)+ready+s.slice(readyEnd);
fs.writeFileSync(file,s);
console.log(JSON.stringify({file,bytes:Buffer.byteLength(s),lines:s.split(/\n/).length},null,2));
