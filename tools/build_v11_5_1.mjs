import fs from 'node:fs';
import crypto from 'node:crypto';

const srcPath=process.argv[2]||'SuperAgent_V11_5_FULL.js';
const outPath=process.argv[3]||'SuperAgent_V11_5_1_FULL.js';
let s=fs.readFileSync(srcPath,'utf8');
const must=(needle,label=needle)=>{if(!s.includes(needle))throw new Error(`V11.5.1 anchor missing: ${label}`)};
const once=(from,to,label=from)=>{must(from,label);const n=s.split(from).length-1;if(n!==1)throw new Error(`V11.5.1 anchor not unique (${n}): ${label}`);s=s.replace(from,to)};

// Advance version/branding/schema together.
s=s.replaceAll('11.5.0','11.5.1');
s=s.replaceAll('V11.5','V11.5.1');
once('v11_5:true,v115_hardened:true','v11_5:true,v11_5_1:true,v1151_final:true,v115_hardened:true','root version flags');

// Google-only, Lite-priority failover. The first two are GA Lite models.
// The third is a stronger Google fallback selected only after live OmniAI probing:
// gemini-2.5-flash-lite returned 404, gemini-3.5-flash was 0/4, gemini-3.6-flash 2/4,
// while gemini-3-flash-preview was 4/4. Timeouts sum to 9.6s, so fallback 2 is reachable
// inside the unchanged 10s global AI budget.
once('{short:"G3.1-L",name:"Gemini 3.1 Flash-Lite",id:"gemini::gemini-3.1-flash-lite",timeoutMs:4500,role:"fallback_1",tags:["chat","shopping","schedule","json","arabic"]},','{short:"G3.1-L",name:"Gemini 3.1 Flash-Lite",id:"gemini::gemini-3.1-flash-lite",timeoutMs:3600,role:"fallback_1",tags:["chat","shopping","schedule","json","arabic"]},','fallback 1 timeout');
once('{short:"GL-Latest",name:"Gemini Flash-Lite Latest",id:"gemini::gemini-flash-lite-latest",timeoutMs:4500,role:"fallback_2",tags:["chat","shopping","schedule","coding","json","arabic"]}','{short:"G3-FP",name:"Gemini 3 Flash Preview",id:"gemini::gemini-3-flash-preview",timeoutMs:3000,role:"fallback_2",tags:["chat","shopping","schedule","coding","json","arabic"]}','fallback 2 model');
s=s.replaceAll('gemini::gemini-flash-lite-latest','gemini::gemini-3-flash-preview');
s=s.replaceAll('Gemini Flash-Lite Latest','Gemini 3 Flash Preview');
s=s.replaceAll('GL-Latest','G3-FP');

s='/* SuperAgent V11.5.1 FINAL — Google-only Lite-priority chain; stronger live-proven third fallback; V11.5 hardening retained; no AI router. */\n'+s;

const expected=['gemini::gemini-3.5-flash-lite','gemini::gemini-3.1-flash-lite','gemini::gemini-3-flash-preview'];
const chain=s.match(/const MODEL_CHAIN=\[([\s\S]*?)\n\];\nconst PRIMARY_MODEL/);if(!chain)throw new Error('MODEL_CHAIN missing');
const ids=[...chain[1].matchAll(/id:"([^"]+)"/g)].map(x=>x[1]);
if(JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('Unexpected V11.5.1 model chain '+JSON.stringify(ids));
for(const forbidden of ['gemini::gemini-flash-lite-latest','gemini::gemini-2.5-flash-lite','11.5.0'])if(s.includes(forbidden))throw new Error('Forbidden legacy/broken marker remains: '+forbidden);
if(!s.includes('const TOTAL_AI_BUDGET_MS=10000;'))throw new Error('Global AI budget changed unexpectedly');
if(!s.includes("const V115_SCHEMA_VERSION='11.5.1';"))throw new Error('Schema version did not advance');

fs.writeFileSync(outPath,s);
const cert={
  ok:true,version:'11.5.1',
  sha256:crypto.createHash('sha256').update(s).digest('hex'),
  bytes:Buffer.byteLength(s),lines:s.split(/\n/).length,
  models:expected,
  model_timeouts_ms:{primary:3000,fallback_1:3600,fallback_2:3000},
  total_ai_budget_ms:10000,
  router:false,
  model_policy:'Google-only; Lite priority for primary/fallback1; stronger third fallback after live availability/stability probes.',
  note:'V11.5 hardening retained. gemini-2.5-flash-lite was rejected after the actual OmniAI route returned 404. Gemini 3 Flash Preview was selected as fallback 2 only after a 4/4 live probe; final release still requires multi-round stability plus Telegram/D1 regression.'
};
fs.writeFileSync('V11_5_1_CERTIFICATION.json',JSON.stringify(cert,null,2));
console.log(JSON.stringify(cert,null,2));
