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
fs.writeFileSync(file,s);
console.log(JSON.stringify({file,bytes:Buffer.byteLength(s),lines:s.split(/\n/).length},null,2));
