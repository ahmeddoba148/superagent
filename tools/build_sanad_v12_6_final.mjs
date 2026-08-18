import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath,['tools/build_sanad_v12_6.mjs'],{stdio:'inherit'});
const file=new URL('../Sanad_V12_6_ULTIMATE_PARITY.js',import.meta.url);
const pack2=new URL('./sanad_v12_6_parity_pack2.jsfrag',import.meta.url);
const pack3=new URL('./sanad_v12_6_parity_pack3.jsfrag',import.meta.url);
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
const buf=Buffer.from(src,'utf8');
fs.writeFileSync(file,buf);
console.log(JSON.stringify({ok:true,version:'12.6.0',bytes:buf.length,lines:src.split('\n').length,sha256:crypto.createHash('sha256').update(buf).digest('hex')}));
