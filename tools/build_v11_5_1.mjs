import fs from 'node:fs';
import crypto from 'node:crypto';

const srcPath=process.argv[2]||'SuperAgent_V11_5_FULL.js';
const outPath=process.argv[3]||'SuperAgent_V11_5_1_FULL.js';
let s=fs.readFileSync(srcPath,'utf8');
const must=(needle,label=needle)=>{if(!s.includes(needle))throw new Error(`V11.5.1 anchor missing: ${label}`)};
const once=(from,to,label=from)=>{must(from,label);const n=s.split(from).length-1;if(n!==1)throw new Error(`V11.5.1 anchor not unique (${n}): ${label}`);s=s.replace(from,to)};

// Version/branding and schema marker are deliberately advanced together.
s=s.replaceAll('11.5.0','11.5.1');
s=s.replaceAll('V11.5','V11.5.1');
once('v11_5:true,v115_hardened:true','v11_5:true,v11_5_1:true,v1151_final:true,v115_hardened:true','root version flags');

// Keep the same Google-only 3-model architecture, but use three explicit Lite model IDs.
// Rebalance fallbacks so fallback 2 remains reachable inside the existing 10s global AI budget.
once('{short:"G3.1-L",name:"Gemini 3.1 Flash-Lite",id:"gemini::gemini-3.1-flash-lite",timeoutMs:4500,role:"fallback_1",tags:["chat","shopping","schedule","json","arabic"]},','{short:"G3.1-L",name:"Gemini 3.1 Flash-Lite",id:"gemini::gemini-3.1-flash-lite",timeoutMs:3200,role:"fallback_1",tags:["chat","shopping","schedule","json","arabic"]},','fallback 1 timeout');
once('{short:"GL-Latest",name:"Gemini Flash-Lite Latest",id:"gemini::gemini-flash-lite-latest",timeoutMs:4500,role:"fallback_2",tags:["chat","shopping","schedule","coding","json","arabic"]}','{short:"G2.5-L",name:"Gemini 2.5 Flash-Lite",id:"gemini::gemini-2.5-flash-lite",timeoutMs:3400,role:"fallback_2",tags:["chat","shopping","schedule","coding","json","arabic"]}','fallback 2 model');
s=s.replaceAll('gemini::gemini-flash-lite-latest','gemini::gemini-2.5-flash-lite');
s=s.replaceAll('Gemini Flash-Lite Latest','Gemini 2.5 Flash-Lite');
s=s.replaceAll('GL-Latest','G2.5-L');

// Top release banner.
s='/* SuperAgent V11.5.1 FINAL — three explicit Google Gemini Lite models; V11.5 hardening retained; fallback reachability rebalanced; no AI router. */\n'+s;

const expected=['gemini::gemini-3.5-flash-lite','gemini::gemini-3.1-flash-lite','gemini::gemini-2.5-flash-lite'];
const chain=s.match(/const MODEL_CHAIN=\[([\s\S]*?)\n\];\nconst PRIMARY_MODEL/);if(!chain)throw new Error('MODEL_CHAIN missing');
const ids=[...chain[1].matchAll(/id:"([^"]+)"/g)].map(x=>x[1]);
if(JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('Unexpected V11.5.1 model chain '+JSON.stringify(ids));
for(const forbidden of ['gemini::gemini-flash-lite-latest','11.5.0'])if(s.includes(forbidden))throw new Error('Forbidden legacy marker remains: '+forbidden);
if(!s.includes('const TOTAL_AI_BUDGET_MS=10000;'))throw new Error('Global AI budget changed unexpectedly');
if(!s.includes("const V115_SCHEMA_VERSION='11.5.1';"))throw new Error('Schema version did not advance');

fs.writeFileSync(outPath,s);
const cert={
  ok:true,version:'11.5.1',
  sha256:crypto.createHash('sha256').update(s).digest('hex'),
  bytes:Buffer.byteLength(s),lines:s.split(/\n/).length,
  models:expected,
  model_timeouts_ms:{primary:3000,fallback_1:3200,fallback_2:3400},
  total_ai_budget_ms:10000,
  router:false,
  note:'V11.5 hardening retained. Fallback 2 is explicit gemini-2.5-flash-lite; fallback timeouts are rebalanced so all three models can be attempted within the 10s global budget.'
};
fs.writeFileSync('V11_5_1_CERTIFICATION.json',JSON.stringify(cert,null,2));
console.log(JSON.stringify(cert,null,2));
