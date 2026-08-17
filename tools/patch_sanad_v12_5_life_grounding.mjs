import fs from 'node:fs';
import crypto from 'node:crypto';

const file = new URL('../Sanad_V12_5_FULL.js', import.meta.url);
let src = fs.readFileSync(file, 'utf8');

const helper = String.raw`
function explicitMinuteCountV125(text){
  const t=digitsAsciiV125(normalizeText(text)).toLowerCase();
  const m=t.match(/(?:ب)?(\d{1,3}|خمس|خمسه|خمسة|عشر|عشرة|عشره|ربع|خمستاشر|خمسة عشر|خمس عشرة|عشرين|عشرون|تلت|ثلث|نص|نصف|تلاتين|ثلاثين|اربعين|أربعين|خمسه واربعين|خمسة واربعين|خمسة وأربعين)\s*(?:دقيقه|دقيقة|دقايق|دقائق|د)?/u);
  if(!m)return null;
  if(/^\d+$/.test(m[1]))return Math.min(180,Math.max(0,Number(m[1])));
  const w=normalizeText(m[1]).replace(/أ/g,'ا');
  const map={خمس:5,خمسه:5,خمسة:5,عشر:10,عشرة:10,عشره:10,ربع:15,خمستاشر:15,'خمسة عشر':15,'خمس عشرة':15,عشرين:20,عشرون:20,تلت:20,ثلث:20,نص:30,نصف:30,تلاتين:30,ثلاثين:30,اربعين:40,'خمسه واربعين':45,'خمسة واربعين':45,'خمسة وأربعين':45};
  return Number(map[w]??map[m[1]]??0)||null;
}
function explicitPrayerRuleHintV125(text){
  const t=normalizeText(text).toLowerCase();
  const prayers=[['Fajr',/(?:الفجر|\bفجر\b)/u],['Dhuhr',/(?:الظهر|\bظهر\b)/u],['Asr',/(?:العصر|\bعصر\b)/u],['Maghrib',/(?:المغرب|\bمغرب\b)/u],['Isha',/(?:العشاء|\bعشاء\b)/u]];
  const hit=prayers.find(([,re])=>re.test(t));
  if(!hit)return null;
  const minutes=explicitMinuteCountV125(t);
  let offset=0;
  if(/قبل/u.test(t))offset=-(minutes??0);else if(/بعد/u.test(t))offset=minutes??0;
  return {prayer:hit[0],offset_minutes:offset};
}
function explicitBriefHintV125(text){
  const t=normalizeText(text).toLowerCase(),times=extractExplicitTimesV125(t),time=times[0]||null;
  if(/(?:ملخص|الملخص).*(?:الصباحي|الصباح)|(?:الصباحي|الصباح).*(?:ملخص|الملخص)/u.test(t))return {morning_brief_enabled:1,...(time?{morning_brief_time:time}:{})};
  if(/(?:ملخص|الملخص).*(?:المسائي|المساء)|(?:المسائي|المساء).*(?:ملخص|الملخص)/u.test(t))return {evening_brief_enabled:1,...(time?{evening_brief_time:time}:{})};
  return null;
}
function groundExplicitLifeFactsV125(text,steps){
  const prayer=explicitPrayerRuleHintV125(text),brief=explicitBriefHintV125(text),task=explicitProjectTaskHintV125(text);
  const out=(Array.isArray(steps)?steps:[]).map(s=>({...(s||{}),args:s?.args&&typeof s.args==='object'&&!Array.isArray(s.args)?{...s.args}:{}}));
  if(prayer){
    const i=out.findIndex(s=>String(s?.tool||'')==='prayer.rules.create');
    if(i>=0)out[i]={...out[i],args:{...out[i].args,...prayer}};
  }
  if(brief){
    const i=out.findIndex(s=>String(s?.tool||'')==='settings.update');
    if(i>=0)out[i]={...out[i],args:{...out[i].args,...brief}};
  }
  if(task){
    const pi=out.findIndex(s=>String(s?.tool||'')==='projects.create');
    const ti=out.findIndex(s=>String(s?.tool||'')==='project_tasks.create');
    if(pi>=0&&ti>=0&&!out[ti]?.args?.project_id)out[ti]={...out[ti],args:{...out[ti].args,project_id:'$step:'+(pi+1)+'.id'}};
  }
  return out;
}
function augmentExplicitLifeStepsV125(text,steps){
  let out=groundExplicitLifeFactsV125(text,steps);
  const prayer=explicitPrayerRuleHintV125(text),brief=explicitBriefHintV125(text),task=explicitProjectTaskHintV125(text);
  if(prayer&&!out.some(s=>String(s?.tool||'')==='prayer.rules.create'))out.push({tool:'prayer.rules.create',args:prayer});
  if(brief&&!out.some(s=>String(s?.tool||'')==='settings.update'))out.push({tool:'settings.update',args:brief});
  if(task){
    const pi=out.findIndex(s=>String(s?.tool||'')==='projects.create');
    if(pi>=0&&!out.some(s=>String(s?.tool||'')==='project_tasks.create'))out.push({tool:'project_tasks.create',args:{project_id:'$step:'+(pi+1)+'.id',title:task}});
  }
  return out.slice(0,MAX_AGENT_STEPS);
}
`;

const runMarker='async function runAgent(env,{chatId,text,user,operationId}) {';
if(!src.includes(runMarker))throw new Error('runAgent marker missing');
src=src.replace(runMarker,helper+'\n'+runMarker);

const stepsMarker='  let steps=Array.isArray(plan?.steps)?plan.steps.slice(0,MAX_AGENT_STEPS):[];';
if(!src.includes(stepsMarker))throw new Error('steps marker missing');
src=src.replace(stepsMarker,stepsMarker+'\n  steps=augmentExplicitLifeStepsV125(text,steps);');

const groundMarker='  steps=groundExplicitTemporalFactsV125(text,steps);';
if(!src.includes(groundMarker))throw new Error('ground marker missing');
src=src.replace(groundMarker,'  steps=groundExplicitLifeFactsV125(text,groundExplicitTemporalFactsV125(text,steps));');

const repairMarker='const groundedRepairSteps=groundExplicitTemporalFactsV125(text,Array.isArray(repair?.steps)?repair.steps.slice(0,MAX_REPAIR_STEPS):[]);';
if(src.includes(repairMarker))src=src.replace(repairMarker,'const groundedRepairSteps=groundExplicitLifeFactsV125(text,groundExplicitTemporalFactsV125(text,Array.isArray(repair?.steps)?repair.steps.slice(0,MAX_REPAIR_STEPS):[]));');

const missingMarker='const missing=groundExplicitTemporalFactsV125(text,Array.isArray(completion?.steps)?completion.steps.slice(0,MAX_REPAIR_STEPS):[]);';
if(src.includes(missingMarker))src=src.replace(missingMarker,'const missing=groundExplicitLifeFactsV125(text,groundExplicitTemporalFactsV125(text,Array.isArray(completion?.steps)?completion.steps.slice(0,MAX_REPAIR_STEPS):[]));');

const buf=Buffer.from(src,'utf8');
fs.writeFileSync(file,buf);
console.log(JSON.stringify({ok:true,sha256:crypto.createHash('sha256').update(buf).digest('hex'),bytes:buf.length,patch:'life-grounding-v1'}));
