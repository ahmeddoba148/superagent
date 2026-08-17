import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import crypto from 'node:crypto';

const dir = new URL('../source_parts/', import.meta.url);
const files = fs.readdirSync(dir).filter(x => x.startsWith('sanad125.part')).sort();
if (!files.length) throw new Error('Sanad V12.5 source parts are missing');
const b64 = files.map(f => fs.readFileSync(new URL(f, dir), 'utf8')).join('').trim();
const baseSrc = gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
const baseSha = crypto.createHash('sha256').update(baseSrc).digest('hex');
const expectedBase = '8afea4bbd5d3429feb3db537a0298462dbbf7b15950f207f66903ce8bfce5310';
if (baseSha !== expectedBase) throw new Error(`base source SHA mismatch: ${baseSha}`);

const groundingHelper = String.raw`
function digitsAsciiV125(value) {
  const ar="٠١٢٣٤٥٦٧٨٩",fa="۰۱۲۳۴۵۶۷۸۹";
  return String(value||"").replace(/[٠-٩]/g,c=>String(ar.indexOf(c))).replace(/[۰-۹]/g,c=>String(fa.indexOf(c)));
}
function clockValueV125(hourRaw,minuteRaw,modifier,daypart){
  let h=Number(hourRaw),m=minuteRaw==null||minuteRaw===""?0:Number(minuteRaw);
  const mod=normalizeText(modifier||"").replace(/\s+/g,"");
  if(/نص|نصف/.test(mod))m=30;
  else if(/وربع|والربع/.test(mod))m=15;
  else if(/إلاربع|الاربع/.test(mod)){h-=1;m=45;if(h<0)h=23;}
  if(!Number.isInteger(h)||!Number.isInteger(m)||h<0||h>23||m<0||m>59)return null;
  const p=normalizeText(daypart||"").toLowerCase();
  const pm=/(?:^م$|مساء|المساء|بالليل|ليل|الظهر|ظهر|العصر)/.test(p),am=/(?:^ص$|صباح|الصبح|الصباح|الفجر)/.test(p);
  if(pm&&h<12)h+=12;
  if(am&&h===12)h=0;
  if(h>23)return null;
  return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
}
function extractExplicitTimesV125(text){
  const t=digitsAsciiV125(normalizeText(text));
  const found=[];
  const add=(h,m,mod,part)=>{const v=clockValueV125(h,m,mod,part);if(v&&!found.includes(v))found.push(v);};
  const cue=/(?:الساعة|الساعه|ساعة|ساعه)\s*(\d{1,2})(?:\s*[:：٫.]\s*(\d{1,2}))?(?:\s*(ونص|ونصف|والنصف|وربع|والربع|إلا\s*ربع|الا\s*ربع))?\s*(ص|م|صباحا|صباحًا|الصبح|الصباح|مساء|مساءً|المساء|بالليل|ليلا|ليلًا|الظهر|ظهرا|ظهرًا|العصر)?/g;
  for(const m of t.matchAll(cue))add(m[1],m[2],m[3],m[4]);
  const part=/(?:^|[^\d])(\d{1,2})(?:\s*[:：٫.]\s*(\d{1,2}))?\s*(ص|م|صباحا|صباحًا|الصبح|الصباح|مساء|مساءً|المساء|بالليل|ليلا|ليلًا|الظهر|ظهرا|ظهرًا|العصر)(?=$|[^\p{L}\d])/gu;
  for(const m of t.matchAll(part))add(m[1],m[2],"",m[3]);
  const clock24=/(?:^|[^\d])([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?!\d)/g;
  for(const m of t.matchAll(clock24))add(m[1],m[2],"","");
  return found;
}
function explicitDateV125(text){
  const t=digitsAsciiV125(normalizeText(text)).toLowerCase();
  const months={"يناير":1,"فبراير":2,"مارس":3,"أبريل":4,"ابريل":4,"مايو":5,"يونيو":6,"يوليو":7,"أغسطس":8,"اغسطس":8,"سبتمبر":9,"أكتوبر":10,"اكتوبر":10,"نوفمبر":11,"ديسمبر":12};
  let m=t.match(/(?:يوم\s+)?([0-3]?\d)\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+(\d{4})/);
  let d,mo,y;
  if(m){d=Number(m[1]);mo=months[m[2]];y=Number(m[3]);}
  else{m=t.match(/(?:يوم\s+)?([0-3]?\d)[\/-]([01]?\d)[\/-](\d{4})/);if(!m)return null;d=Number(m[1]);mo=Number(m[2]);y=Number(m[3]);}
  const probe=new Date(Date.UTC(y,mo-1,d));
  if(probe.getUTCFullYear()!==y||probe.getUTCMonth()!==mo-1||probe.getUTCDate()!==d)return null;
  return String(y).padStart(4,"0")+"-"+String(mo).padStart(2,"0")+"-"+String(d).padStart(2,"0");
}
function groundExplicitTemporalFactsV125(text,steps){
  const times=extractExplicitTimesV125(text),date=explicitDateV125(text);
  return (Array.isArray(steps)?steps:[]).map(step=>{
    const tool=String(step?.tool||""),raw=step?.args&&typeof step.args==="object"&&!Array.isArray(step.args)?step.args:{},args={...raw};
    if(tool==="recurrence.create"){
      if(times.length){const rule=args.rule&&typeof args.rule==="object"&&!Array.isArray(args.rule)?{...args.rule}:{};rule.times=[...times];args.rule=rule;}
      if(date)args.start_date=date;
    }
    if(tool==="reminders.create"){
      if(times.length===1)args.local_time=times[0];
      if(date)args.local_date=date;
    }
    return {...step,args};
  });
}
`;

let src = baseSrc;
const runMarker = 'async function runAgent(env,{chatId,text,user,operationId}) {';
if (!src.includes(runMarker)) throw new Error('runAgent marker missing');
src = src.replace(runMarker, groundingHelper + '\n' + runMarker);
const riskyMarker = '  const risky=steps.filter(s=>TOOL_SPECS[String(s?.tool||"")]?.risky);';
if (!src.includes(riskyMarker)) throw new Error('risky marker missing');
src = src.replace(riskyMarker, '  steps=groundExplicitTemporalFactsV125(text,steps);\n' + riskyMarker);
const repairMarker = '      for(const [i,s] of (Array.isArray(repair?.steps)?repair.steps.slice(0,MAX_REPAIR_STEPS):[]).entries()){';
if (!src.includes(repairMarker)) throw new Error('repair marker missing');
src = src.replace(repairMarker, '      const groundedRepairSteps=groundExplicitTemporalFactsV125(text,Array.isArray(repair?.steps)?repair.steps.slice(0,MAX_REPAIR_STEPS):[]);\n      for(const [i,s] of groundedRepairSteps.entries()){');

const finalBuffer = Buffer.from(src, 'utf8');
const sha = crypto.createHash('sha256').update(finalBuffer).digest('hex');
fs.writeFileSync(new URL('../Sanad_V12_5_FULL.js', import.meta.url), finalBuffer);
console.log(JSON.stringify({ok:true,parts:files.length,bytes:finalBuffer.length,base_sha256:baseSha,sha256:sha}));
