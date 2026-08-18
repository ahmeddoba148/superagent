import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

execFileSync(process.execPath,['tools/build_sanad_v12_6_final.mjs'],{stdio:'inherit'});
const input=new URL('../Sanad_V12_6_ULTIMATE_PARITY.js',import.meta.url);
const layer=new URL('./sanad_v12_7_hardening.jsfrag',import.meta.url);
const output=new URL('../Sanad_V12_7_HARDENED.js',import.meta.url);
let src=fs.readFileSync(input,'utf8');

function renameFunction(name,renamed){
  const a=`async function ${name}(`,s=`function ${name}(`;
  if(src.includes(a)){src=src.replace(a,`async function ${renamed}(`);return;}
  if(src.includes(s)){src=src.replace(s,`function ${renamed}(`);return;}
  throw new Error(`V12.7 rename marker missing: ${name}`);
}
function replaceRequired(label,needle,replacement){if(!src.includes(needle))throw new Error(`V12.7 marker missing: ${label}`);src=src.replace(needle,replacement);}

src=src.replaceAll('12.6.0','12.7.0').replaceAll('V12.6','V12.7');
src=src.replace('const NAME = "سند — Sanad V12.7 Ultimate Parity";','const NAME = "سند — Sanad V12.7 Correctness Hardened";');

for(const [name,renamed] of [
  ['fallbackCompose','fallbackComposeV126BeforeHardening'],
  ['executeTool','executeToolV126BeforeHardening'],
  ['drainInbox','drainInboxV126BeforeHardening'],
  ['recoverPendingInbox','recoverPendingInboxV126BeforeHardening'],
  ['runSanadScheduler','runSanadSchedulerV126BeforeHardening'],
  ['deliverUserScheduleV125','deliverUserScheduleV126BeforeHardening'],
  ['deliverPrayerRulesV125','deliverPrayerRulesV126BeforeHardening'],
  ['deliverDailyBriefsV125','deliverDailyBriefsV126BeforeHardening'],
  ['checkLiveWatchesV125','checkLiveWatchesV126BeforeHardening'],
  ['sendOnceV125','sendOnceV126BeforeHardening'],
  ['snapshotUserStateV125','snapshotUserStateV126BeforeHardening'],
  ['restoreUserStateV125','restoreUserStateV126BeforeHardening'],
  ['toolAuditUndoV125','toolAuditUndoV126BeforeHardening'],
  ['toolReminderCreate','toolReminderCreateV126BeforeHardening'],
  ['toolReminderUpdate','toolReminderUpdateV126BeforeHardening'],
  ['toolReminderCancel','toolReminderCancelV126BeforeHardening'],
  ['toolMemoryForget','toolMemoryForgetV126BeforeHardening'],
  ['toolDependencyCreateV125','toolDependencyCreateV126BeforeHardening'],
  ['toolWorldUpsertV125','toolWorldUpsertV126BeforeHardening'],
  ['toolWorldLinkV125','toolWorldLinkV126BeforeHardening'],
  ['toolProfileUpdateV125','toolProfileUpdateV126BeforeHardening'],
  ['toolSettingsUpdateV125','toolSettingsUpdateV126BeforeHardening'],
  ['toolProjectTaskUpdateV125','toolProjectTaskUpdateV126BeforeHardening'],
  ['recordModelAttemptV126','recordModelAttemptV126BeforeHardening'],
  ['updateLocationV125','updateLocationV126BeforeHardening'],
  ['buildContext','buildContextV126BeforeHardening'],
  ['toolSystemClearAllV125','toolSystemClearAllV126BeforeHardening']
])renameFunction(name,renamed);

replaceRequired('domain scoped agent snapshot','if(hasMutation){const fresh=await snapshotUserStateV125(env,chatId);before=await ensureOperationSnapshotV125(env,chatId,operationId,fresh,normalizeText(plan?.goal||text).slice(0,500));}','if(hasMutation){const fresh=await snapshotUserStateV125(env,chatId,steps);before=await ensureOperationSnapshotV125(env,chatId,operationId,fresh,normalizeText(plan?.goal||text).slice(0,500));}');

const rbStart='  if(hasMutation&&(badMutations.length||finalFailures.length)){';
const rbEnd='  if(hasMutation)await commitOperationSnapshotV125(env,operationId);';
const si=src.indexOf(rbStart),ei=src.indexOf(rbEnd,si);
if(si<0||ei<0)throw new Error('V12.7 atomic rollback block marker missing');
const rollback=`  if(hasMutation&&(badMutations.length||finalFailures.length)){\n    let restored;\n    try{restored=await restoreUserStateVerifiedV127(env,chatId,before,true);}\n    catch(e){const incident=await reportFailure(env,chatId,'atomic_rollback_restore',e,{operationId});return \`⚠️ التنفيذ فشل، وكمان استرجاع الحالة السابقة نفسه فشل. مش هقولك إن التغييرات رجعت. رقم التتبع: \${incident}\`; }\n    if(!restored?.verified){const incident=await reportFailure(env,chatId,'atomic_rollback_verify',new Error((restored?.failures||[]).join('|')),{operationId});return \`⚠️ التنفيذ فشل، ومحاولة الاسترجاع لم تنجح في التحقق الكامل. مش هعتبر الحالة رجعت. رقم التتبع: \${incident}\`; }\n    await discardOperationSnapshotV125(env,operationId);\n    await env.DB.prepare(\`INSERT INTO sanad_audit(operation_id,chat_id,tool,args_json,result_json,verified,created_at) VALUES(?,?,?,?,?,?,?)\`).bind(operationId,chatId,'system.atomic_rollback','{}',JSON.stringify({reason:'failed_or_unverified',bad:badMutations.map(x=>({tool:x.tool,error:x.error})),restore_verified:true}),1,nowIso()).run();\n    return \`الخطة ما اكتملتش بشكل يمكن إثباته، فرجّعت التغييرات واتأكدت إن الحالة السابقة رجعت فعلًا.\${badMutations.length?\` السبب: \${badMutations.map(x=>\`\${x.tool}: \${x.error||'verification_failed'}\`).join(' | ')}\`:''}\`;\n  }\n`;
src=src.slice(0,si)+rollback+src.slice(ei);

replaceRequired('critic catch','if(Array.isArray(critic?.steps)&&critic.steps.length)steps=critic.steps.slice(0,MAX_AGENT_STEPS);}catch{}','if(Array.isArray(critic?.steps)&&critic.steps.length)steps=critic.steps.slice(0,MAX_AGENT_STEPS);}catch(e){await reportFailure(env,chatId,"critic",e,{operationId,text:normalizeText(text).slice(0,300)});}');
replaceRequired('repair catch','    }catch{}\n  }\n  const badMutations=','    }catch(e){await reportFailure(env,chatId,"repair",e,{operationId,text:normalizeText(text).slice(0,300)});}\n  }\n  const badMutations=');
replaceRequired('composer catch','try{const out=await callBrainText(env,composer,deadline);if(out)return out;}catch{}','try{const out=await callBrainText(env,composer,deadline);if(out)return out;}catch(e){await reportFailure(env,chatId,"composer",e,{operationId});}');

replaceRequired('base migration row catch','for(const [legacy,_,fn] of simpleMaps)if(await tableExistsV125(env,legacy)){const rows=(await env.DB.prepare(`SELECT * FROM ${legacy} LIMIT 10000`).all())?.results||[];for(const r of rows)try{await fn(r)}catch{}}','for(const [legacy,_,fn] of simpleMaps)if(await tableExistsV125(env,legacy)){const rows=(await env.DB.prepare(`SELECT * FROM ${legacy} LIMIT 10000`).all())?.results||[];for(const r of rows)try{await fn(r)}catch(e){await reportFailure(env,String(r?.chat_id||""),"legacy_migration_row",e,{table:legacy});throw e;}}');
replaceRequired('base migration terminal catch','  }catch(e){console.warn("Sanad V11 migration warning",safeError(e));}\n  await env.DB.prepare(`INSERT INTO sanad_meta(key,value,updated_at) VALUES(\'legacy_v11_migrated\',\'1\',?) ON CONFLICT(key) DO UPDATE SET value=\'1\',updated_at=excluded.updated_at`).bind(nowIso()).run();','  }catch(e){await reportFailure(env,null,"legacy_migration",e);throw e;}\n  await env.DB.prepare(`INSERT INTO sanad_meta(key,value,updated_at) VALUES(\'legacy_v11_migrated\',\'1\',?) ON CONFLICT(key) DO UPDATE SET value=\'1\',updated_at=excluded.updated_at`).bind(nowIso()).run();');

replaceRequired('voice fallback catch',"if(rr.ok&&text)return text;}catch{}finally{clearTimeout(timer)}}if(env.GROQ_API_KEY", "if(rr.ok&&text)return text;}catch(e){await reportFailure(env,null,'voice_omniai_fallback',e,{file_id:fileId});}finally{clearTimeout(timer)}}if(env.GROQ_API_KEY");
replaceRequired('selftest verified change', 'fallbackCompose([{tool:"shopping.add",ok:true,verified:true}]).includes("✅")','fallbackCompose([{tool:"shopping.add",ok:true,verified:true,changed:1}]).includes("✅")');

src+='\n\n'+fs.readFileSync(layer,'utf8').trim()+'\n';
const buf=Buffer.from(src,'utf8');fs.writeFileSync(output,buf);
console.log(JSON.stringify({ok:true,version:'12.7.0',bytes:buf.length,lines:src.split('\n').length,sha256:crypto.createHash('sha256').update(buf).digest('hex')}));
