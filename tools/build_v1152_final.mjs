import fs from 'node:fs';
const input='SuperAgent_V11_5_1_FULL.js';
const output='SuperAgent_V11_5_2_FULL.js';
let s=fs.readFileSync(input,'utf8');
s='/* SuperAgent V11.5.2 FINAL — fixed Google chain; V11.5.1 hardening retained; durable inbox lease-collision self-recovery; certified staging matrix. */\n'+s;
s=s.replaceAll('SuperAgent V11.5.1','SuperAgent V11.5.2').replaceAll('سوبر إيجنت V11.5.1','سوبر إيجنت V11.5.2');
s=s.replace('const V10_VERSION="11.5.1"','const V10_VERSION="11.5.2"');
s=s.replace('v11_5_1:true,v1151_final:true','v11_5_1:true,v11_5_2:true,v1152_final:true,v1152_lease_collision_recovery:true,v1151_final:true');
s=s.replace(
  '{short:"G3-FP",name:"Gemini 3 Flash Preview",id:"gemini::gemini-3-flash-preview",timeoutMs:3000,role:"fallback_2",tags:["chat","shopping","schedule","coding","json","arabic"]}',
  '{short:"G3.5-F",name:"Gemini 3.5 Flash",id:"gemini::gemini-3.5-flash",timeoutMs:3000,role:"fallback_2",tags:["chat","shopping","schedule","coding","json","arabic"]}'
);
s=s.replace(
  'push("v114_fallback2_is_gemini36_flash",FALLBACK_MODELS[1]?.id==="gemini::gemini-3-flash-preview",FALLBACK_MODELS[1]?.id||"");',
  'push("v1152_fallback2_is_gemini35_flash",FALLBACK_MODELS[1]?.id==="gemini::gemini-3.5-flash",FALLBACK_MODELS[1]?.id||"");'
);
s=s.replace(
  "add('v114 fallback2 Gemini 3 Flash Preview',ids[2]==='gemini::gemini-3-flash-preview',ids[2]||'');",
  "add('v1152 fallback2 Gemini 3.5 Flash',ids[2]==='gemini::gemini-3.5-flash',ids[2]||'');"
);
const leaseNeedle='if(!acquired)return;';
const leaseFix='if(!acquired){if(origin&&await hasRunnableInboxV106(env,chatId)){const delay=Math.min(1800,Math.max(700,Math.floor(V106_INBOX_LEASE_MS/20)))+Math.floor(Math.random()*120);await sleepV106(delay);await triggerDrainContinuationV106(env,chatId,origin);}return;}';
const leasePatchCount=s.split(leaseNeedle).length-1;
if(leasePatchCount<2)throw new Error('expected at least two durable inbox lease exits, found '+leasePatchCount);
s=s.replaceAll(leaseNeedle,leaseFix);
if(s.includes(leaseNeedle))throw new Error('unprotected durable inbox lease exit remains');
const forbidden=['gemini::gemini-2.5-flash-lite'];
for(const id of forbidden){if(s.includes(id))throw new Error('known-dead model leaked into final source: '+id);}
const expected=['gemini::gemini-3.5-flash-lite','gemini::gemini-3.1-flash-lite','gemini::gemini-3.5-flash'];
const ids=[...s.matchAll(/id:"(gemini::[^"]+)"[^\n]+role:"(?:primary|fallback_1|fallback_2)"/g)].slice(0,3).map(x=>x[1]);
if(JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('unexpected model chain '+JSON.stringify(ids));
if(!s.includes('const V10_VERSION="11.5.2"'))throw new Error('version replacement failed');
if(!s.includes('v1152_lease_collision_recovery:true'))throw new Error('lease collision feature marker missing');
const recoveryCount=s.split('if(!acquired){if(origin&&await hasRunnableInboxV106(env,chatId))').length-1;
if(recoveryCount<leasePatchCount)throw new Error('not every lease exit received self-continuation');
fs.writeFileSync(output,s);
console.log(JSON.stringify({ok:true,output,models:ids,lease_collision_self_recovery:true,lease_paths_hardened:leasePatchCount,bytes:Buffer.byteLength(s),lines:s.split('\n').length}));
