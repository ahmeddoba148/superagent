import fs from 'node:fs';

const SOURCE='SuperAgent_V11_FULL.js';
const OUT='SuperAgent_V11_1_FULL.js';
let s=fs.readFileSync(SOURCE,'utf8');

function mustReplace(oldValue,newValue,label){
  const before=s;
  s=s.replace(oldValue,newValue);
  if(s===before) throw new Error(`V11.1 build anchor not found: ${label}`);
}
function mustReplaceRegex(re,replacement,label){
  const before=s;
  s=s.replace(re,replacement);
  if(s===before) throw new Error(`V11.1 regex anchor not found: ${label}`);
}
function replaceBetween(startMarker,endMarker,replacement,label){
  const a=s.indexOf(startMarker);
  if(a<0) throw new Error(`V11.1 start marker missing: ${label}`);
  const b=s.indexOf(endMarker,a+startMarker.length);
  if(b<0) throw new Error(`V11.1 end marker missing: ${label}`);
  s=s.slice(0,a)+replacement+'\n'+s.slice(b);
}

mustReplace('const V10_VERSION="11.0.0";const V10_NAME="سوبر إيجنت V11 — الوكيل الدلالي متعدد النماذج";',
  'const V10_VERSION="11.1.0";const V10_NAME="سوبر إيجنت V11.1 — سريع وسلس ومتعدد النماذج";',
  'version/name');

mustReplace('const TOTAL_AI_BUDGET_MS=32000;const V11_ROUTER_BUDGET_MS=2600;const V11_ROUTE_LOCAL_CONFIDENCE=0.90;const V11_MIN_ROUTE_CONFIDENCE=0.55;',
  'const TOTAL_AI_BUDGET_MS=12000;const V11_ROUTER_BUDGET_MS=1100;const V11_ROUTE_LOCAL_CONFIDENCE=0.90;const V11_MIN_ROUTE_CONFIDENCE=0.55;const V111_EASY_PLAN_BUDGET_MS=6000;const V111_COMPLEX_PLAN_BUDGET_MS=11500;const V111_HEDGE_DELAY_MS=120;',
  'AI budgets');

// Faster execution-model deadlines. A failed provider cannot monopolize the chat queue.
const timeoutMap=[
  ['gemini::gemini-3.5-flash-lite',1800],['gemini::gemini-3.5-flash',2200],['groq::openai/gpt-oss-20b',1700],['groq::qwen/qwen3.6-27b',1900],
  ['mistral::ministral-3b-latest',1700],['mistral::ministral-8b-latest',1900],['mistral::mistral-small-2603',2200],['nvidia::deepseek-ai/deepseek-v4-flash',2400],
  ['nvidia::stepfun-ai/step-3.7-flash',2400],['nvidia::nvidia/nemotron-3-nano-30b-a3b',2400],
  ['gemini::gemini-3.6-flash',4500],['gemini::gemini-pro-latest',6000],['groq::openai/gpt-oss-120b',3500],['mistral::mistral-large-latest',5000],
  ['mistral::mistral-medium-latest',4500],['mistral::magistral-medium-latest',5000],['nvidia::deepseek-ai/deepseek-v4-pro',5000],['nvidia::qwen/qwen3.5-397b-a17b',5200],
  ['nvidia::nvidia/nemotron-3-super-120b-a12b',5200],['nvidia::nvidia/nemotron-3-ultra-550b-a55b',6000]
];
for(const [id,ms] of timeoutMap){
  const esc=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp(`(id:\"${esc}\",timeoutMs:)\\d+`);
  if(!re.test(s)) throw new Error(`model timeout anchor missing: ${id}`);
  s=s.replace(re,`$1${ms}`);
}
for(const [id,ms] of [['gemini::gemini-3.5-flash-lite',550],['groq::openai/gpt-oss-20b',650],['mistral::ministral-8b-latest',800]]){
  const esc=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp(`(name:\"Router[^\\n]+?id:\"${esc}\",timeoutMs:)\\d+`);
  if(!re.test(s)) throw new Error(`router timeout anchor missing: ${id}`);
  s=s.replace(re,`$1${ms}`);
}

// Shorter durable-chat lease/retry sleeps now that AI work has a strict 12s ceiling.
mustReplace('const V106_INBOX_LEASE_MS=90000;','const V106_INBOX_LEASE_MS=30000;','queue lease');
mustReplace('const V106_LEASE_RETRY_COUNT=12;','const V106_LEASE_RETRY_COUNT=8;','queue retry count');
mustReplace('const V106_LEASE_RETRY_DELAY_MS=180;','const V106_LEASE_RETRY_DELAY_MS=60;','queue retry delay');
mustReplace('const V106_INTER_UPDATE_DELAY_MS=90;','const V106_INTER_UPDATE_DELAY_MS=20;','queue inter-update delay');

const routeV111=`async function routeRequestV11(env,text){
const local=v11RouteAxes(text);
if(local.confidence>=V11_ROUTE_LOCAL_CONFIDENCE)return{...local,source:"local"};
const started=Date.now();
const attempts=ROUTER_MODELS.map((model,index)=>(async()=>{
  if(index)await new Promise(resolve=>setTimeout(resolve,index*70));
  if(Date.now()-started>=V11_ROUTER_BUDGET_MS)throw new Error("router_budget");
  const routed=await callV11RouterModel(env,model,text,local);
  if(routed.confidence<V11_MIN_ROUTE_CONFIDENCE)throw new Error("router_low_confidence");
  return{...routed,source:model.id};
})());
try{return await Promise.any(attempts);}catch{}
if(local.needs_context&&local.needs_tools)return{...local,route:"complex",risk:local.risk==="low"?"medium":local.risk,needs_reasoning:true,confidence:0.70,source:"safe_local_fallback",reason:"router_unavailable_contextual_mutation"};
return{...local,source:"local_fallback"};
}`;
replaceBetween('async function routeRequestV11(env,text){','async function v11RankModels(env,route,pool){',routeV111,'hedged router');

const parseV111=`async function parseIntentWithFallback(env,userText,validationContext){
const routeText=String(validationContext?.baseText||userText||"");
const route=await routeRequestV11(env,routeText);
const explicitShoppingUnitsV11=extractExplicitShoppingUnitsV11(routeText);
if(route.task==="shopping"&&explicitShoppingUnitsV11.length>=2){
  const seed={action:"shopping",needs_clarification:false,question:"",reply:"",shopping:{mode:"mutate",query:"all",query_value:"",operations:explicitShoppingUnitsV11.map(title=>({op:"add",target:"",title,replacement:"",quantity_value:null,quantity_unit:"",quantity_text:"",quantity_exact:false,factor:null,meta:{}}))}};
  const safetyContext={...(validationContext||{}),baseText:routeText};
  const intent=validateAndNormalizeIntent(seed,safetyContext);
  applySafetyFixes(intent,safetyContext);
  finalSafetyCheck(intent,safetyContext);
  assertShoppingEntityPreservationV11(intent,routeText);
  Object.assign(intent,{_v11_route:route,_v11_model:"deterministic:explicit-shopping-list",_latency_ms:0,_v111_fast_path:true});
  return intent;
}
const firstPool=route.route==="complex"?COMPLEX_MODELS:FAST_MODELS;
const secondPool=route.route==="complex"?FAST_MODELS:COMPLEX_MODELS;
const rankedFirst=await v11RankModels(env,route,firstPool),rankedSecond=await v11RankModels(env,route,secondPool);
const candidates=[];
for(const m of [...v11ProviderDiverse(rankedFirst,6),...rankedFirst,...v11ProviderDiverse(rankedSecond,4),...rankedSecond])if(!candidates.some(x=>x.id===m.id))candidates.push(m);
const failures=[];const started=Date.now();const budget=route.route==="complex"?V111_COMPLEX_PLAN_BUDGET_MS:V111_EASY_PLAN_BUDGET_MS;
const selected=candidates.slice(0,route.route==="complex"?8:6);
const attempt=async(model)=>{try{const intent=await parseIntentWithFallbackLegacy(env,userText,validationContext,[model]);assertShoppingEntityPreservationV11(intent,routeText);Object.assign(intent,{_v11_route:route,_v11_model:model.id,_v111_hedged:true});return intent;}catch(error){failures.push({model:model.id,error:String(error?.message||error).slice(0,300)});throw error;}};
for(let i=0;i<selected.length;i+=2){
  if(Date.now()-started>=budget)break;
  const wave=selected.slice(i,i+2).map((model,j)=>(async()=>{if(j)await new Promise(resolve=>setTimeout(resolve,V111_HEDGE_DELAY_MS));return attempt(model);})());
  try{return await Promise.any(wave);}catch{}
}
const e=Object.assign(new Error("V11.1: تعذر الوصول لخطة موثوقة بسرعة، لذلك لم يتم تنفيذ أي تغيير."),{v11_failures:failures});throw e;
}`;
replaceBetween('async function parseIntentWithFallback(env,userText,validationContext){','async function parseIntentWithFallbackLegacy(env,userText,validationContext,V11_MODEL_POOL){',parseV111,'hedged planner');

// Shopping is always presented as an interactive to-do checklist.
const shoppingTextV111=`function shoppingText(items,session=false){
  const relevant=items.filter(x=>["pending","bought","unavailable","skipped"].includes(String(x.status)));
  const pending=relevant.filter(x=>x.status==='pending').length,done=relevant.length-pending;
  const lines=relevant.map(x=>\`${'${'}x.status==='bought'?'✅':x.status==='unavailable'?'🚫':x.status==='skipped'?'⏭️':'⬜'} ${'${'}x.title}\`);
  const hint=relevant.length?"\\n\\n👆 اضغط على أي صنف لتعلّمه تم شراؤه ✅، واضغط عليه تاني لو عاوز ترجعه ⬜.":"";
  return \`${'${'}session?'🛒 وضع التسوق':'🛒 قائمة المشتريات'}\\n\\n${'${'}lines.length?lines.join("\\n"):"القائمة فاضية."}\\n\\n${'${'}done}/${'${'}relevant.length} تم · باقي ${'${'}pending}${'${'}hint}\`;
}`;
replaceBetween('function shoppingText(items,session=false){','async function showShoppingList(env,chatId,messageId=null,{startSession=false,placeName=null}={}){',shoppingTextV111,'shopping todo text');

const executeStart=s.indexOf('async function executeShoppingPlanV107(env,chatId,intent){');
const executeEnd=s.indexOf('/* ======================= END V10.7 SEMANTIC SHOPPING ENGINE',executeStart);
if(executeStart<0||executeEnd<0)throw new Error('executeShoppingPlanV107 range missing');
let executeBlock=s.slice(executeStart,executeEnd);
const execNeedle="await sendText(env,chatId,answer);await saveConversationMessage(env,chatId,'assistant',answer)";
if(!executeBlock.includes(execNeedle))throw new Error('shopping success send anchor missing');
executeBlock=executeBlock.replace(execNeedle,execNeedle+";await showShoppingList(env,chatId,null,{startSession:false})");
s=s.slice(0,executeStart)+executeBlock+s.slice(executeEnd);

const helper=`async function sendShoppingResultAndChecklistV111(env,chatId,result){
  const answer=shoppingResultMessageV1034(result);
  await sendText(env,chatId,answer);
  await saveConversationMessage(env,chatId,"assistant",answer);
  await showShoppingList(env,chatId,null,{startSession:false});
}\n\n`;
const shopTextPos=s.indexOf('function shoppingText(items,session=false){');
if(shopTextPos<0)throw new Error('shoppingText insertion point missing');
s=s.slice(0,shopTextPos)+helper+s.slice(shopTextPos);

const directNeedle='await sendText(env,chatId,shoppingResultMessageV1034(r));return true;';
const directCount=s.split(directNeedle).length-1;
if(directCount>0)s=s.split(directNeedle).join('await sendShoppingResultAndChecklistV111(env,chatId,r);return true;');
s=s.replace('if(compoundResult)await sendText(env,chatId,shoppingResultMessageV1034(compoundResult));','if(compoundResult)await sendShoppingResultAndChecklistV111(env,chatId,compoundResult);');

s=s.replace(/v11:true,v11_semantic_router:true/g,'v11:true,v11_1:true,v111_fast_router:true,v111_hedged_planning:true,v111_shopping_todo:true,v11_semantic_router:true');
s=s.replace('return json({ok:true,message:"سوبر إيجنت V11 جاهز للعمل",v11:true,','return json({ok:true,message:"سوبر إيجنت V11.1 جاهز للعمل",v11:true,v11_1:true,');

s=`/* SuperAgent V11.1 FULL — V10.7.1 full feature engine + V11 semantic router + V11.1 latency/UX hardening.\nKey V11.1 changes: 12s bounded AI budget, hedged semantic routing/planning, shorter durable queue lease/retry sleeps, deterministic multiline shopping, interactive shopping to-do checklist after mutations. */\n`+s;
fs.writeFileSync(OUT,s);
console.log(JSON.stringify({out:OUT,bytes:Buffer.byteLength(s),lines:s.split(/\n/).length,directShoppingResultPatches:directCount,version:'11.1.0'},null,2));
