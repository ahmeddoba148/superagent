import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath,['tools/build_sanad_v12_6.mjs'],{stdio:'inherit'});
const file=new URL('../Sanad_V12_6_ULTIMATE_PARITY.js',import.meta.url);
const pack2=new URL('./sanad_v12_6_parity_pack2.jsfrag',import.meta.url);
const pack3=new URL('./sanad_v12_6_parity_pack3.jsfrag',import.meta.url);
const pack4=new URL('./sanad_v12_6_parity_pack4.jsfrag',import.meta.url);
const pack5=new URL('./sanad_v12_6_parity_pack5.jsfrag',import.meta.url);
const pack6=new URL('./sanad_v12_6_parity_pack6.jsfrag',import.meta.url);
let src=fs.readFileSync(file,'utf8');
src+='\n\n/* ================= SANAD V12.6 PARITY LAYER 2 ================= */\n'+fs.readFileSync(pack2,'utf8').trim()+'\n';
// Final generated-source hardening: update legacy self-test literal and make telemetry success shape explicit for checkJs.
src=src.replaceAll("'12.5.0'","'12.6.0'").replaceAll('"12.5.0"','"12.6.0"');
src=src.replaceAll('recordModelAttemptV126(env,model.id,{ok:true,latency})','recordModelAttemptV126(env,model.id,{ok:true,latency,error:null})');
// Layer 3 replaces the V12.6 explicit-life and dispatch entry points so deterministic dependency grounding can sit above the model plan.
if(!src.includes('function augmentExplicitLifeStepsV125('))throw new Error('V12.6 augment entry missing');
src=src.replace('function augmentExplicitLifeStepsV125(','function augmentExplicitLifeStepsV126BeforeDeps(');
if(!src.includes('async function dispatchTool(env,chatId,tool,args,user){'))throw new Error('V12.6 dispatch entry missing');
src=src.replace('async function dispatchTool(env,chatId,tool,args,user){','async function dispatchToolV126BeforeDeps(env,chatId,tool,args,user){');
src+='\n\n/* ================= SANAD V12.6 PARITY LAYER 3 ================= */\n'+fs.readFileSync(pack3,'utf8').trim()+'\n';
// Layer 4 makes dependency propagation a runtime invariant for every reminder time/duration mutation, regardless of which planning tool the model chose.
if(!src.includes('async function toolScheduleShiftV125('))throw new Error('V12.6 schedule shift entry missing');
src=src.replace('async function toolScheduleShiftV125(','async function toolScheduleShiftV126BeforePropagationGuard(');
if(!src.includes('async function propagateDependenciesV125('))throw new Error('V12.6 dependency propagation entry missing');
src=src.replace('async function propagateDependenciesV125(','async function propagateDependenciesV126BeforePropagationGuard(');
if(!src.includes('async function toolReminderUpdate(env,chatId,args){'))throw new Error('V12.6 reminder update entry missing');
src=src.replace('async function toolReminderUpdate(env,chatId,args){','async function toolReminderUpdateV126BeforePropagationGuard(env,chatId,args){');
src+='\n\n/* ================= SANAD V12.6 PARITY LAYER 4 ================= */\n'+fs.readFileSync(pack4,'utf8').trim()+'\n';
// Layer 5 silences only explicit CI/staging Telegram output when the D1 test flag is enabled.
if(!src.includes('async function sendText(env,chatId,text,reply_markup){'))throw new Error('V12.6 sendText entry missing');
src=src.replace('async function sendText(env,chatId,text,reply_markup){','async function sendTextV126BeforeCiMute(env,chatId,text,reply_markup){');
src+='\n\n/* ================= SANAD V12.6 PARITY LAYER 5 ================= */\n'+fs.readFileSync(pack5,'utf8').trim()+'\n';
// Layer 6 restores the organized V11-style control panels while retaining the V12.6 agent/runtime underneath.
if(!src.includes('async function showMenuV125(env,chatId){'))throw new Error('V12.6 menu entry missing');
src=src.replace('async function showMenuV125(env,chatId){','async function showMenuV126BeforeRestoredPanels(env,chatId){');
if(!src.includes('async function showSettingsV126(env,chatId){'))throw new Error('V12.6 settings panel entry missing');
src=src.replace('async function showSettingsV126(env,chatId){','async function showSettingsV126BeforeRestoredPanels(env,chatId){');
if(!src.includes('async function handleCallback(env,q){'))throw new Error('V12.6 callback entry missing');
src=src.replace('async function handleCallback(env,q){','async function handleCallbackV126BeforeRestoredPanels(env,q){');
if(!src.includes('if (text === "/settings") return showSettingsV126(env,chatId);'))throw new Error('V12.6 direct settings command marker missing');
src=src.replace('if (text === "/settings") return showSettingsV126(env,chatId);','if (text === "/settings") return showSettingsV126(env,chatId);\n    if (text === "/clear" || text === "/data") return showDataPanelV126(env,chatId);');
src+='\n\n/* ================= SANAD V12.6 RESTORED V11 MENU LAYER 6 ================= */\n'+fs.readFileSync(pack6,'utf8').trim()+'\n';
const buf=Buffer.from(src,'utf8');
fs.writeFileSync(file,buf);
console.log(JSON.stringify({ok:true,version:'12.6.0',bytes:buf.length,lines:src.split('\n').length,sha256:crypto.createHash('sha256').update(buf).digest('hex')}));
