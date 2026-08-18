import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

execFileSync(process.execPath,['tools/build_sanad_v12_7.mjs'],{stdio:'inherit'});
const input=new URL('../Sanad_V12_7_HARDENED.js',import.meta.url);
const runtime=new URL('./sanad_v12_8_runtime.jsfrag',import.meta.url);
const selftest=new URL('./sanad_v12_8_selftest.jsfrag',import.meta.url);
const pre=new URL('../Sanad_V12_8_PRE.js',import.meta.url);
const output=new URL('../Sanad_V12_8_ATOMIC.js',import.meta.url);
let src=fs.readFileSync(input,'utf8');

function renameFunction(name,renamed){
  const a=`async function ${name}(`,s=`function ${name}(`;
  if(src.includes(a)){src=src.replace(a,`async function ${renamed}(`);return;}
  if(src.includes(s)){src=src.replace(s,`function ${renamed}(`);return;}
  throw new Error(`V12.8 rename marker missing: ${name}`);
}
function replaceRequired(label,needle,replacement){if(!src.includes(needle))throw new Error(`V12.8 marker missing: ${label}`);src=src.replace(needle,replacement);}

src=src.replaceAll('12.7.0','12.8.0').replaceAll('V12.7','V12.8');
src=src.replace('const NAME = "سند — Sanad V12.8 Correctness Hardened";','const NAME = "سند — Sanad V12.8 Atomic Runtime";');

for(const [name,renamed] of [
  ['ensureSchema','ensureSchemaCore'],
  ['runAgent','runAgentCore'],
  ['callBrainJson','callBrainJsonCore'],
  ['callBrainText','callBrainTextCore'],
  ['buildContext','buildContextLegacyV128'],
  ['executeTool','executeToolLegacyV128'],
  ['snapshotUserStateV125','snapshotUserStateLegacyV128'],
  ['restoreUserStateV125','restoreUserStateLegacyV128'],
  ['restoreUserStateVerifiedV127','restoreUserStateVerifiedLegacyV128'],
  ['ensureOperationSnapshotV125','ensureOperationSnapshotLegacyV128'],
  ['commitOperationSnapshotV125','commitOperationSnapshotLegacyV128'],
  ['discardOperationSnapshotV125','discardOperationSnapshotLegacyV128'],
  ['sendOnceV125','sendOnceLegacyV128'],
  ['deliverUserScheduleV125','deliverUserScheduleLegacyV128'],
  ['deliverPrayerRulesV125','deliverPrayerRulesLegacyV128'],
  ['deliverDailyBriefsV125','deliverDailyBriefsLegacyV128'],
  ['checkLiveWatchesV125','checkLiveWatchesLegacyV128'],
  ['runSanadScheduler','runSanadSchedulerLegacyV128'],
  ['drainInbox','drainInboxLegacyV128'],
  ['recoverPendingInbox','recoverPendingInboxLegacyV128'],
  ['diagnosticsV126','diagnosticsLegacyV128']
])renameFunction(name,renamed);

replaceRequired('diagnostics route','if (request.method === "GET" && url.pathname === "/diagnostics") return diagnosticsV126(request, env);','if (request.method === "GET" && url.pathname === "/diagnostics") return diagnosticsV128(request, env);');
const selftestNeedle='if (request.method === "GET" && url.pathname === "/selftest") { if (url.searchParams.get("v127") === "1") { if(!env.SETUP_KEY||!secureEq(adminKey(request),env.SETUP_KEY))return j({ok:false,error:"Unauthorized"},401); await ensureSchema(env); return j(await deepSelftestV127(env)); } return selftest(request, env); }';
replaceRequired('v128 selftest route',selftestNeedle,'if (request.method === "GET" && url.pathname === "/selftest") { if (url.searchParams.get("v128") === "1") { if(!env.SETUP_KEY||!secureEq(adminKey(request),env.SETUP_KEY))return j({ok:false,error:"Unauthorized"},401); await ensureSchema(env); return j(await deepSelftestV128(env)); } if (url.searchParams.get("v127") === "1") { if(!env.SETUP_KEY||!secureEq(adminKey(request),env.SETUP_KEY))return j({ok:false,error:"Unauthorized"},401); await ensureSchema(env); return j(await deepSelftestV127(env)); } return selftest(request, env); }');
replaceRequired('not found route','    return new Response("Not found", { status: 404 });','    if (url.pathname === "/admin/dead-letter" && (request.method === "GET" || request.method === "POST")) return deadLetterAdminV128(request,env,ctx,url);\n    if (url.pathname === "/admin/delivery/replay" && request.method === "POST") return deliveryReplayAdminV128(request,env);\n    return new Response("Not found", { status: 404 });');

let layer=fs.readFileSync(runtime,'utf8').trim().replaceAll('Buffer.byteLength(JSON.stringify(out))','new TextEncoder().encode(JSON.stringify(out)).length');
src+='\n\n'+layer+'\n\n'+fs.readFileSync(selftest,'utf8').trim()+'\n';
fs.writeFileSync(pre,src);

execFileSync('npx',['--yes','esbuild@0.25.9',pre.pathname,'--bundle','--format=esm','--platform=browser','--target=es2022','--tree-shaking=true','--legal-comments=none',`--outfile=${output.pathname}`],{stdio:'inherit'});
let final=fs.readFileSync(output,'utf8');

// esbuild intentionally removes non-legal comments. Re-apply precise JSDoc only where checkJs otherwise over-narrows local unions.
final=final.replace('    const simpleMaps = [','    /** @type {Array<[string,string,(r:any)=>Promise<any>]>} */\n    const simpleMaps = [');
final=final.replace('  function add(name, ok, detail = "") {','  /** @param {string} name @param {any} ok @param {any} [detail] */\n  function add(name, ok, detail = "") {');
final=final.replace('    let r = await toolShoppingAdd(env, chat, {','    /** @type {any} */\n    let r = await toolShoppingAdd(env, chat, {');
final=final.replace('  const add = (name, ok, detail = "") => tests.push({ name, ok: !!ok, detail: String(detail ?? "") });','  /** @type {(name:string,ok:any,detail?:any)=>void} */\n  const add = (name, ok, detail = "") => tests.push({ name, ok: !!ok, detail: String(detail ?? "") });');
final=final.replace('    let r = await toolReminderCancel(env, chat, { ids: [987654321] });','    /** @type {any} */\n    let r = await toolReminderCancel(env, chat, { ids: [987654321] });');

const forbidden=['BeforeHardening','BeforeOperationDedupe','executeToolV127BeforeOperationDedupe','drainInboxV126BeforeHardening','fallbackComposeV126BeforeHardening'];
const leftovers=forbidden.filter(x=>final.includes(x));if(leftovers.length)throw new Error(`V12.8 canonicalization failed: ${leftovers.join(',')}`);
if(!final.includes('sanad_delivery_queue')||!final.includes('sanad_mutation_journal')||!final.includes('sanad_scheduler_cycles')||!final.includes('sanad_dead_letters')||!final.includes('sanad_operation_metrics'))throw new Error('V12.8 architecture tables missing');
fs.writeFileSync(output,final);
const buf=Buffer.from(final,'utf8'),sha=crypto.createHash('sha256').update(buf).digest('hex');
console.log(JSON.stringify({ok:true,version:'12.8.0',bytes:buf.length,lines:final.split('\n').length,sha256:sha,canonical_no_beforehardening:true}));
