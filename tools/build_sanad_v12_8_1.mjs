import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

execFileSync(process.execPath,['tools/build_sanad_v12_8.mjs'],{stdio:'inherit'});
const input=new URL('../Sanad_V12_8_ATOMIC.js',import.meta.url);
const patchFile=new URL('./sanad_v12_8_1_hotfix.jsfrag',import.meta.url);
const pre=new URL('../Sanad_V12_8_1_PRE.js',import.meta.url);
const output=new URL('../Sanad_V12_8_1_HOTFIX.js',import.meta.url);
let src=fs.readFileSync(input,'utf8');

function replaceTopLevelFunction(source,name,newDefinition){
  const esc=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const head=new RegExp(`(?:async\\s+)?function\\s+${esc}\\s*\\(`),m=head.exec(source);
  if(!m)throw new Error(`V12.8.1 replacement function missing: ${name}`);
  const start=m.index,next=/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g;next.lastIndex=start+m[0].length;
  const n=next.exec(source),end=n?n.index:source.length;
  return source.slice(0,start)+newDefinition.trim()+"\n"+source.slice(end+1);
}
function replaceRequired(label,needle,replacement){if(!src.includes(needle))throw new Error(`V12.8.1 marker missing: ${label}`);src=src.replace(needle,replacement);}

src=src.replaceAll('12.8.0','12.8.1').replaceAll('Sanad V12.8','Sanad V12.8.1');
src=src.replace('سند — Sanad V12.8.1 Atomic Runtime','سند — Sanad V12.8.1 Hotfix');

// Point 2: the retrieval layer already bounds/ranks context; never chop the serialized context at an arbitrary 28k boundary.
if(!src.includes('JSON.stringify(context).slice(0, 28e3)'))throw new Error('V12.8.1 context slice marker missing');
src=src.replaceAll('JSON.stringify(context).slice(0, 28e3)','JSON.stringify(context)');

// Point 4: remove legacy "V126Before..." nomenclature from the canonical runtime.
// These are stable core helpers now; behavior is unchanged and esbuild removes any dead helpers.
src=src.replace(/\b([A-Za-z_$][\w$]*)V126Before([A-Za-z_$][\w$]*)\b/g,'$1CoreV1281$2');

const patch=fs.readFileSync(patchFile,'utf8'),appendMarker='/* @append */',appendIndex=patch.indexOf(appendMarker),replacePart=appendIndex>=0?patch.slice(0,appendIndex):patch,appendPart=appendIndex>=0?patch.slice(appendIndex+appendMarker.length).trim():'';
const re=/\/\* @replace ([A-Za-z_$][\w$]*) \*\/\n([\s\S]*?)\n\/\* @end \*\//g;let match,count=0;
while((match=re.exec(replacePart))){src=replaceTopLevelFunction(src,match[1],match[2]);count++;}
if(count!==4)throw new Error(`V12.8.1 expected 4 function replacements, got ${count}`);
if(appendPart)src+='\n\n'+appendPart+'\n';

replaceRequired('v1281 selftest route','    if (request.method === "GET" && url.pathname === "/selftest") {\n      const v128 = url.searchParams.get("v128");','    if (request.method === "GET" && url.pathname === "/selftest") {\n      if (url.searchParams.get("v1281") === "1") { if (!env.SETUP_KEY || !secureEq(adminKey(request), env.SETUP_KEY)) return j({ok:false,error:"Unauthorized"},401); await ensureSchema(env); return j(await deepSelftestV1281(env)); }\n      const v128 = url.searchParams.get("v128");');

fs.writeFileSync(pre,src);
execFileSync('npx',['--yes','esbuild@0.25.9',pre.pathname,'--bundle','--format=esm','--platform=browser','--target=es2022','--tree-shaking=true','--legal-comments=none',`--outfile=${output.pathname}`],{stdio:'inherit'});
let final=fs.readFileSync(output,'utf8');

const gates={
  version:final.includes('12.8.1'),
  journal_seq_sql:final.includes('COALESCE(MAX(seq), 0) + 1')||final.includes('COALESCE(MAX(seq),0)+1'),
  journal_no_stepkey_seq:!final.includes('Date.now() % 1e6')&&!final.includes('Date.now()%1000000'),
  context_unsliced:!final.includes('JSON.stringify(context).slice(0, 28e3)')&&!final.includes('slice(0,28000)'),
  scheduler_single_active:final.includes('uq_sanad_scheduler_single_active'),
  scheduler_lease:final.includes('claimSchedulerCycleV1281')&&final.includes('lease_owner')&&final.includes('lease_until'),
  legacy_v126before_removed:!final.includes('V126Before'),
  no_old_hardening_labels:!final.includes('BeforeHardening')&&!final.includes('BeforeOperationDedupe'),
  hotfix_selftest:final.includes('deepSelftestV1281')
};
if(Object.values(gates).some(x=>!x))throw new Error(`V12.8.1 canonical gates failed: ${JSON.stringify(gates)}`);
fs.writeFileSync(output,final);
const buf=Buffer.from(final,'utf8'),sha=crypto.createHash('sha256').update(buf).digest('hex');
console.log(JSON.stringify({ok:true,version:'12.8.1',bytes:buf.length,lines:final.split('\n').length,sha256:sha,replacements:count,gates}));
