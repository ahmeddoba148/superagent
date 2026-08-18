import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

execFileSync(process.execPath,['tools/build_sanad_v12_8_1.mjs'],{stdio:'inherit'});
const input=new URL('../Sanad_V12_8_1_HOTFIX.js',import.meta.url);
const patchFile=new URL('./sanad_v12_8_2_context_budget.jsfrag',import.meta.url);
const pre=new URL('../Sanad_V12_8_2_PRE.js',import.meta.url);
const output=new URL('../Sanad_V12_8_2_CONTEXT_BUDGET.js',import.meta.url);
let src=fs.readFileSync(input,'utf8');

src=src.replaceAll('12.8.1','12.8.2').replaceAll('Sanad V12.8.1','Sanad V12.8.2');
src=src.replace('سند — Sanad V12.8.2 Atomic Runtime','سند — Sanad V12.8.2 Structured Context Hotfix');

const marker='async function buildContext(env, chatId, user, userText) {';
if(!src.includes(marker))throw new Error('V12.8.2 buildContext marker missing');
src=src.replace(marker,'async function buildContextUnbudgetedV1282(env, chatId, user, userText) {');
const patch=fs.readFileSync(patchFile,'utf8');
src+='\n\n'+patch+'\n';

const routeNeedle='    if (request.method === "GET" && url.pathname === "/selftest") {\n      if (url.searchParams.get("v1281") === "1") {';
if(!src.includes(routeNeedle))throw new Error('V12.8.2 selftest route marker missing');
src=src.replace(routeNeedle,'    if (request.method === "GET" && url.pathname === "/selftest") {\n      if (url.searchParams.get("v1282") === "1") { if (!env.SETUP_KEY || !secureEq(adminKey(request), env.SETUP_KEY)) return j({ok:false,error:"Unauthorized"},401); await ensureSchema(env); return j(await deepSelftestV1282(env)); }\n      if (url.searchParams.get("v1281") === "1") {');

fs.writeFileSync(pre,src);
execFileSync('npx',['--yes','esbuild@0.25.9',pre.pathname,'--bundle','--format=esm','--platform=browser','--target=es2022','--tree-shaking=true','--legal-comments=none',`--outfile=${output.pathname}`],{stdio:'inherit'});
let final=fs.readFileSync(output,'utf8');

// Preserve the narrow JSDoc hints required by checkJs after canonical bundling.
final=final.replace('    const simpleMaps = [','    /** @type {Array<[string,string,(r:any)=>Promise<any>]>} */\n    const simpleMaps = [');
final=final.replace('  function add(name, ok, detail = "") {','  /** @param {string} name @param {any} ok @param {any} [detail] */\n  function add(name, ok, detail = "") {');
final=final.replace('    let r = await toolShoppingAdd(env, chat, {','    /** @type {any} */\n    let r = await toolShoppingAdd(env, chat, {');
final=final.replace('  const add = (name, ok, detail = "") => tests.push({ name, ok: !!ok, detail: String(detail ?? "") });','  /** @type {(name:string,ok:any,detail?:any)=>number} */\n  const add = (name, ok, detail = "") => tests.push({ name, ok: !!ok, detail: String(detail ?? "") });');
final=final.replace('    let r = await toolReminderCancel(env, chat, { ids: [987654321] });','    /** @type {any} */\n    let r = await toolReminderCancel(env, chat, { ids: [987654321] });');

const gates={
  version:final.includes('12.8.2'),
  structured_budget:final.includes('structuredContextBudgetV1282')&&final.includes("strategy: 'structured_priority'")||final.includes('strategy: "structured_priority"'),
  wrapped_context_builder:final.includes('buildContextUnbudgetedV1282')&&final.includes('async function buildContext('),
  no_serialized_context_slice:!final.includes('JSON.stringify(context).slice(0, 28e3)')&&!final.includes('slice(0,28000)'),
  byte_budget_enforced:final.includes('structured_context_budget_failed')&&final.includes('m.context_bytes = budgeted.bytes'),
  priority_tiers:final.includes('shopping_session')&&final.includes("['memories', 'entities']")||final.includes('["memories", "entities"]'),
  journal_fix_inherited:(final.includes('COALESCE(MAX(seq), 0) + 1')||final.includes('COALESCE(MAX(seq),0)+1')),
  scheduler_fix_inherited:final.includes('uq_sanad_scheduler_single_active')&&final.includes('claimSchedulerCycleV1281'),
  legacy_v126before_removed:!final.includes('V126Before'),
  selftest:final.includes('deepSelftestV1282')
};
if(Object.values(gates).some(x=>!x))throw new Error(`V12.8.2 canonical gates failed: ${JSON.stringify(gates)}`);
fs.writeFileSync(output,final);
const buf=Buffer.from(final,'utf8'),sha=crypto.createHash('sha256').update(buf).digest('hex');
console.log(JSON.stringify({ok:true,version:'12.8.2',bytes:buf.length,lines:final.split('\n').length,sha256:sha,new_features:0,requested_fixes:1,gates}));
