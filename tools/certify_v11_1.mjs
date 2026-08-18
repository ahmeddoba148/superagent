import fs from 'node:fs';
import crypto from 'node:crypto';

const base=fs.readFileSync('SuperAgent_V10_7_Universal_Agent.js','utf8');
const v11=fs.readFileSync('SuperAgent_V11_FULL.js','utf8');
const next=fs.readFileSync('SuperAgent_V11_1_FULL.js','utf8');

const fnNames=s=>new Set([...s.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]));
const tableNames=s=>new Set([...s.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)/g)].map(m=>m[1]));
const baseFns=fnNames(base),nextFns=fnNames(next),baseTables=tableNames(base),nextTables=tableNames(next);
const missingFunctions=[...baseFns].filter(x=>!nextFns.has(x));
const missingTables=[...baseTables].filter(x=>!nextTables.has(x));

const checks=[];
const add=(name,ok,detail='')=>checks.push({name,ok:Boolean(ok),detail});
add('version_11_1',next.includes('const V10_VERSION="11.1.0"'));
add('all_named_v10_7_1_functions_retained',missingFunctions.length===0,missingFunctions.join(','));
add('all_v10_7_1_schema_tables_retained',missingTables.length===0,missingTables.join(','));
add('v11_router_retained',next.includes('const ROUTER_MODELS=')&&next.includes('v11_semantic_router:true'));
add('10_fast_models',(next.match(/tier:"easy"/g)||[]).length===10,String((next.match(/tier:"easy"/g)||[]).length));
add('10_complex_models',(next.match(/tier:"complex"/g)||[]).length===10,String((next.match(/tier:"complex"/g)||[]).length));
add('router_primary_plus_two_fallbacks',(next.match(/short:"R-/g)||[]).length===3,String((next.match(/short:"R-/g)||[]).length));
add('bounded_ai_budget_12s',next.includes('const TOTAL_AI_BUDGET_MS=12000;'));
add('fast_router_budget',next.includes('const V11_ROUTER_BUDGET_MS=1100;'));
add('hedged_router',next.includes('Promise.any(attempts)'));
add('hedged_planner',next.includes('_v111_hedged:true')&&next.includes('V111_HEDGE_DELAY_MS=120'));
add('queue_lease_30s',next.includes('const V106_INBOX_LEASE_MS=30000;'));
add('queue_retry_delay_60ms',next.includes('const V106_LEASE_RETRY_DELAY_MS=60;'));
add('queue_inter_update_20ms',next.includes('const V106_INTER_UPDATE_DELAY_MS=20;'));
add('deterministic_multiline_shopping',next.includes('deterministic:explicit-shopping-list'));
add('shopping_completeness_guard',next.includes('V11_SHOPPING_ENTITY_DROP')&&next.includes('assertShoppingEntityPreservationV11'));
add('shopping_todo_buttons',next.includes('callback_data:`shop:toggle:${x.id}`'));
add('shopping_toggle_bought_pending',next.includes("const next=before==='bought'?'pending':'bought';"));
add('shopping_todo_guidance',next.includes('اضغط على أي صنف لتعلّمه تم شراؤه'));
add('shopping_auto_checklist_after_semantic_mutation',next.includes("await showShoppingList(env,chatId,null,{startSession:false})"));

const featureMarkers=[
'life_os:true','personal_world_model:true','memory_graph:true','event_dependencies:true','planner_executor_verifier:true','shadow_safety:true',
'smart_lists:true','interactive_shopping:true','voice_first:true','audit_undo:true','permission_levels:true','context_memory:true','universal_recurrence:true',
'safety_grounding:true','live_reality:true','live_world_news:true','prayer_awareness:true','hijri_calendar:true','public_holidays:true','per_user_location:true',
'long_term_memory:true','egyptian_dialect_engine:true','duration_conflicts:true','advance_alerts:true','snooze:true','general_chat:true','multi_user_isolation:true',
'v106_durable_telegram_inbox:true','v106_crash_recovery:true','v106_ledger_confirmed_delivery:true','v107_universal_shopping:true','v107_transactional_shopping:true',
'reliability_lock:true','operation_receipts:true','runtime_failure_log:true'
];
for(const marker of featureMarkers)add(`feature:${marker}`,next.includes(marker));

const baseBytes=Buffer.byteLength(base),v11Bytes=Buffer.byteLength(v11),nextBytes=Buffer.byteLength(next);
add('not_truncated_vs_v10_7_1',nextBytes>=baseBytes,`${nextBytes}/${baseBytes}`);
add('not_truncated_vs_v11',nextBytes>=v11Bytes,`${nextBytes}/${v11Bytes}`);

const failed=checks.filter(x=>!x.ok);
const report={
  build:'SuperAgent V11.1 FULL',
  version:'11.1.0',
  sha256:crypto.createHash('sha256').update(next).digest('hex'),
  bytes:nextBytes,
  lines:next.split(/\n/).length,
  base_v10_7_1_named_functions:baseFns.size,
  retained_named_functions:baseFns.size-missingFunctions.length,
  missing_functions:missingFunctions,
  base_v10_7_1_tables:baseTables.size,
  retained_tables:baseTables.size-missingTables.length,
  missing_tables:missingTables,
  checks_passed:checks.length-failed.length,
  checks_total:checks.length,
  failed_checks:failed,
  note:'Structural/CI parity plus syntax checks do not replace live Cloudflare/Telegram/provider testing.'
};
fs.writeFileSync('V11_1_CERTIFICATION.json',JSON.stringify(report,null,2));
fs.writeFileSync('V11_1_BUILD_REPORT.txt',`V11.1 certification ${failed.length?'FAIL':'PASS'}\nversion=11.1.0\nbytes=${nextBytes}\nlines=${report.lines}\nchecks=${report.checks_passed}/${report.checks_total}\nbase_functions=${baseFns.size}\nretained_functions=${report.retained_named_functions}\nbase_tables=${baseTables.size}\nretained_tables=${report.retained_tables}\nsha256=${report.sha256}\n`);
console.log(JSON.stringify(report,null,2));
if(failed.length)process.exit(1);
