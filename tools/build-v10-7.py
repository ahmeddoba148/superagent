from pathlib import Path

BASE=Path('SuperAgent_V10_6_CLOUDFLARE_READY_REAL_SHOPPING_FIX.js')
OUT=Path('SuperAgent_V10_7_Universal_Agent.js')
s=BASE.read_text(encoding='utf-8')

def rep(old,new,count=1):
    global s
    n=s.count(old)
    if n < count:
        raise SystemExit(f'missing patch anchor ({n}<{count}): {old[:120]!r}')
    s=s.replace(old,new,count)

# Version + less brittle AI budget. Give capable planners enough time instead of timing out early.
rep('const V10_VERSION="10.6";const V10_NAME="سوبر إيجنت 10.6 — قفل الاعتمادية الحي · صفر أخطاء معروفة";',
    'const V10_VERSION="10.7";const V10_NAME="سوبر إيجنت 10.7 — الوكيل الدلالي الشامل";')
rep('const TOTAL_AI_BUDGET_MS=25000;', 'const TOTAL_AI_BUDGET_MS=32000;')
rep('const REMINDER_MODELS=[{short:"G3.5-L",name:"Gemini 3.5 Flash-Lite",id:"gemini::gemini-3.5-flash-lite",timeoutMs:4200},{short:"G3.6-F",name:"Gemini 3.6 Flash",id:"gemini::gemini-3.6-flash",timeoutMs:3600},{short:"G3.1-L",name:"Gemini 3.1 Flash-Lite",id:"gemini::gemini-3.1-flash-lite",timeoutMs:3000},{short:"G3.5-F",name:"Gemini 3.5 Flash",id:"gemini::gemini-3.5-flash",timeoutMs:2600},{short:"G2.5-L",name:"Gemini 2.5 Flash-Lite",id:"gemini::gemini-2.5-flash-lite",timeoutMs:2300},{short:"G2.5-F",name:"Gemini 2.5 Flash",id:"gemini::gemini-2.5-flash",timeoutMs:2100},{short:"OSS120",name:"GPT OSS 120B — Groq",id:"groq::openai/gpt-oss-120b",timeoutMs:1900},{short:"Qwen3.6",name:"Qwen 3.6 27B — Groq",id:"groq::qwen/qwen3.6-27b",timeoutMs:1700},{short:"MistralS",name:"Mistral Small 2603",id:"mistral::mistral-small-2603",timeoutMs:1500},{short:"DS-V4F",name:"DeepSeek V4 Flash — NVIDIA",id:"nvidia::deepseek-ai/deepseek-v4-flash",timeoutMs:1500},];',
    'const REMINDER_MODELS=[{short:"G3.6-F",name:"Gemini 3.6 Flash",id:"gemini::gemini-3.6-flash",timeoutMs:8000},{short:"G3.5-L",name:"Gemini 3.5 Flash-Lite",id:"gemini::gemini-3.5-flash-lite",timeoutMs:6500},{short:"OSS120",name:"GPT OSS 120B — Groq",id:"groq::openai/gpt-oss-120b",timeoutMs:5000},{short:"Qwen3.6",name:"Qwen 3.6 27B — Groq",id:"groq::qwen/qwen3.6-27b",timeoutMs:4500},{short:"G3.5-F",name:"Gemini 3.5 Flash",id:"gemini::gemini-3.5-flash",timeoutMs:4000},{short:"G2.5-F",name:"Gemini 2.5 Flash",id:"gemini::gemini-2.5-flash",timeoutMs:3500},{short:"G3.1-L",name:"Gemini 3.1 Flash-Lite",id:"gemini::gemini-3.1-flash-lite",timeoutMs:3200},{short:"MistralS",name:"Mistral Small 2603",id:"mistral::mistral-small-2603",timeoutMs:3000},{short:"DS-V4F",name:"DeepSeek V4 Flash — NVIDIA",id:"nvidia::deepseek-ai/deepseek-v4-flash",timeoutMs:3000},{short:"G2.5-L",name:"Gemini 2.5 Flash-Lite",id:"gemini::gemini-2.5-flash-lite",timeoutMs:2800},];')

# Cloudflare editor / TS inference cleanup from V10.6.
rep('function localizeUserFacingArabicV1043(value){\n  let t=String(value??"");\n  const pairs=[',
    'function localizeUserFacingArabicV1043(value){\n  let t=String(value??"");\n  /** @type {[RegExp,string][]} */\n  const pairs=[')

# Structured shopping metadata, backward compatible with existing D1.
anchor='await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_list_items_active ON smart_list_items(chat_id,list_id,status,position,id)`).run();'
rep(anchor, anchor+'\nawait ensureColumn(env,"smart_list_items","meta_json","TEXT NOT NULL DEFAULT \'{}\'");')

# Natural language goes through the semantic planner first. Exact slash/panel and LifeOS utilities stay deterministic.
early='''await telegramApi(env,"sendChatAction",{chat_id:chatId,action:"typing"});
if(await handleV102CompoundInput(env,chatId,text,{fromVoice}))return;
if(await handleV10DirectCommands(env,chatId,text,{fromVoice}))return;
if(await handleLifeDirectCommands(env,chatId,text))return;
'''
late='''await telegramApi(env,"sendChatAction",{chat_id:chatId,action:"typing"});
// V10.7: normal human language is interpreted semantically first. Regex routes are only fallbacks.
if(await handleDirectCommands(env,chatId,text))return;
if(await handleLifeDirectCommands(env,chatId,text))return;
'''
rep(early,late)

# Add shopping to the universal AI contract.
rep('"action":"create|list|delete|update|clear_all|find_free_period|find_free_slot|manage_rule|search_schedule|bulk_delete|bulk_shift|chat",',
    '"action":"create|list|delete|update|clear_all|find_free_period|find_free_slot|manage_rule|search_schedule|bulk_delete|bulk_shift|shopping|chat",')
rep(''' "recurring_update":{
   "title":null,
   "kind":null,
   "duration_minutes":null,
   "advance_alerts":null,
   "schedule":null
 }
}''',''' "recurring_update":{
   "title":null,
   "kind":null,
   "duration_minutes":null,
   "advance_alerts":null,
   "schedule":null
 },
 "shopping":{
   "mode":"mutate|query",
   "query":"all|pending|bought|progress|count|important|category",
   "query_value":"",
   "operations":[
     {
       "op":"add|set_quantity|increment|multiply|remove|replace|mark_bought|mark_pending|set_meta|reorder",
       "target":"",
       "title":"",
       "replacement":"",
       "quantity_value":null,
       "quantity_unit":"",
       "quantity_text":"",
       "quantity_exact":false,
       "factor":null,
       "meta":{"brand":"","size":"","category":"","store":"","priority":"","optional":null,"notes":"","negative":[],"alternative":""}
     }
   ]
 }
}''')

rep('''22) فرّق بين حقيقة صريحة واقتراح؛ confidence للحقائق الصريحة = 1.
`.trim();''','''22) فرّق بين حقيقة صريحة واقتراح؛ confidence للحقائق الصريحة = 1.
23) أنت وكيل عام، لا تعتمد على كلمات سحرية. افهم الهدف من المعنى والسياق. «طلبات البيت»، «حاجات الهايبر»، «ناقصنا»، «وأنت نازل هات»، «حطه معاهم»، «فكك من»، «جبت»، وغيرها قد تكون عمليات مشتريات حتى لو كلمة مشتريات غير موجودة.
24) أي طلب يخص شراء/احتياجات منزل/سوبرماركت/هايبر/صيدلية أو تعديل قائمة شراء: action=shopping. لا تحوله لتذكير إلا لو المستخدم طلب وقت تنفيذ واضح فعلًا (موعد/ساعة/بعد مدة) وكان مقصوده تنبيه في ذلك الوقت.
25) في shopping استخدم قائمة المشتريات الحقيقية الموجودة في السياق لحل «منها»، «الأولى»، «الكبيرة»، «آخر حاجة»، «اللي قولتلك عليه». لو المرجع غير قابل للحسم، needs_clarification=true ولا تنفذ أي تغيير.
26) لا تخترع كمية أو حجم أو ماركة. «شوية/كام واحدة/كمية تكفينا أسبوع» quantity_exact=false واحفظ الوصف في quantity_text. الكميات الدقيقة مثل 2، نص كيلو، دستة إلا اتنين تُحوّل رقميًا عند الإمكان مع الوحدة.
27) لو المستخدم يغيّر رأيه في نفس الجملة، نفّذ آخر قرار الواضح فقط. لو الرسالة فيها عدة عمليات، أخرجها كلها بالترتيب.
28) أسئلة واقتراحات المشتريات فقط => shopping.mode=query ولا تضف أو تحذف شيئًا. أوامر التنفيذ => mutate.
29) عند تكرار نفس المنتج بنفس الماركة والحجم، عدّل/ادمج الكمية بدل إنشاء عنصر مطابق جديد. المنتجات المختلفة في الماركة/الحجم/النوع تظل منفصلة.
30) target في عمليات shopping يجب أن يكون اسم عنصر موجود كما يظهر في سياق القائمة متى كان التعديل على عنصر سابق. يمكنك استخدام __last__ أو __first__ أو __all__ فقط عندما يقصدها المستخدم بوضوح.
31) للعمليات النسبية: increment = زيادة كمية، multiply = ضرب الكمية (نص الكمية factor=0.5، الضعف factor=2). set_quantity يحدد القيمة النهائية.
32) set_meta للمواصفات/الأولوية/المكان/الاختيارية/الملاحظات دون اختراع قيم. replace للاستبدال. mark_bought وmark_pending لحالة الشراء.
`.trim();''')

# Parser accepts shopping action and preserves structured plan.
rep('''"bulk_shift",
"chat"
];''','''"bulk_shift",
"shopping",
"chat"
];''')
rep('''recurring_update:
normalizeOptionalObject(
intent.recurring_update
)
};''','''recurring_update:
normalizeOptionalObject(
intent.recurring_update
),
shopping:normalizeShoppingPlanV107(intent.shopping)
};''')

# Shopping action validation before chat validation.
rep('''if(
action==="chat"&&
!out.reply
){''','''if(action==="shopping"){
if(out.shopping.mode==="mutate"&&!out.shopping.operations.length){throw new Error("shopping mutate بدون عمليات");}
if(out.shopping.mode==="query"&&out.shopping.operations.length){out.shopping.operations=[];}
}

if(
action==="chat"&&
!out.reply
){''')

# Executor dispatch.
rep('''await persistWorldUpdatesSafely(env,chatId,intent);
if(intent.action==="create"){''','''await persistWorldUpdatesSafely(env,chatId,intent);
if(intent.action==="shopping")return executeShoppingPlanV107(env,chatId,intent);
if(intent.action==="create"){''')

# Give AI the real shopping state in addition to world memory.
rep('''memoryContext:[memories.map(x=>x.memory).join("\\n"),worldContext].filter(Boolean).join("\\n")''',
    '''memoryContext:[memories.map(x=>x.memory).join("\\n"),worldContext,await buildShoppingContextV107(env,chatId)].filter(Boolean).join("\\n")''',2)

# If the AI service genuinely fails, fall back to the old deterministic routes, never fake success.
rep('''const intent=await parseIntentWithFallback(env,userPayload,{baseText:text,clarifications:[],timezone:profile.timezone});''','''let intent;
try{intent=await parseIntentWithFallback(env,userPayload,{baseText:text,clarifications:[],timezone:profile.timezone});}
catch(aiError){
  if(await handleV102CompoundInput(env,chatId,text,{fromVoice:false}))return;
  if(await handleV10DirectCommands(env,chatId,text,{fromVoice:false}))return;
  throw aiError;
}''')

# New shopping semantic engine. It intentionally executes only a validated plan; no success text before commit.
inject=r'''

/* ========================= V10.7 SEMANTIC SHOPPING ENGINE ========================= */
function normalizeShoppingPlanV107(raw){
  const x=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const allowed=new Set(['add','set_quantity','increment','multiply','remove','replace','mark_bought','mark_pending','set_meta','reorder']);
  const mode=String(x.mode||'mutate')==='query'?'query':'mutate';
  const ops=[];
  for(const o0 of (Array.isArray(x.operations)?x.operations:[]).slice(0,60)){
    const op=String(o0?.op||'').trim();if(!allowed.has(op))continue;
    const meta=o0?.meta&&typeof o0.meta==='object'&&!Array.isArray(o0.meta)?o0.meta:{};
    let qv=o0?.quantity_value==null?null:Number(o0.quantity_value);if(qv!=null&&!Number.isFinite(qv))qv=null;
    let factor=o0?.factor==null?null:Number(o0.factor);if(factor!=null&&!Number.isFinite(factor))factor=null;
    ops.push({op,target:String(o0?.target||'').trim().slice(0,220),title:String(o0?.title||'').trim().slice(0,220),replacement:String(o0?.replacement||'').trim().slice(0,220),quantity_value:qv,quantity_unit:String(o0?.quantity_unit||'').trim().slice(0,40),quantity_text:String(o0?.quantity_text||'').trim().slice(0,120),quantity_exact:!!o0?.quantity_exact,factor,meta:{brand:String(meta.brand||'').trim().slice(0,100),size:String(meta.size||'').trim().slice(0,100),category:String(meta.category||'').trim().slice(0,100),store:String(meta.store||'').trim().slice(0,100),priority:String(meta.priority||'').trim().slice(0,40),optional:meta.optional==null?null:!!meta.optional,notes:String(meta.notes||'').trim().slice(0,300),negative:Array.isArray(meta.negative)?meta.negative.map(v=>String(v).trim()).filter(Boolean).slice(0,12):[],alternative:String(meta.alternative||'').trim().slice(0,180)}});
  }
  return{mode,query:['all','pending','bought','progress','count','important','category'].includes(String(x.query||''))?String(x.query):'all',query_value:String(x.query_value||'').trim().slice(0,120),operations:ops};
}
function parseShopMetaV107(raw){try{const x=JSON.parse(String(raw||'{}'));return x&&typeof x==='object'&&!Array.isArray(x)?x:{}}catch{return{}}}
function shopQtyTextV107(v,u,raw=''){if(raw)return String(raw).trim();if(v==null)return'';const n=Number(v);return`${Number.isInteger(n)?n:Number(n.toFixed(3))}${u?` ${u}`:''}`.trim()}
function normalizeShopUnitV107(u){const n=normalizeArabicLoose(String(u||''));if(/^(?:كجم|كيلو|كيلوجرام|kg)$/.test(n))return'كجم';if(/^(?:جرام|جم|g)$/.test(n))return'جرام';if(/^(?:لتر|l)$/.test(n))return'لتر';if(/^(?:ملي|مل|ml)$/.test(n))return'مل';if(/^(?:علبه|علبة|علب)$/.test(n))return'علبة';if(/^(?:كيس|اكياس|أكياس)$/.test(n))return'كيس';if(/^(?:باكو|باكيت)$/.test(n))return'باكو';if(/^(?:حبه|حبة|واحده|واحدة|قطعه|قطعة)$/.test(n))return'قطعة';return String(u||'').trim().slice(0,40)}
function shopVariantKeyV107(title,meta={}){return[canonicalShoppingKeyV105(title),normalizeArabicLoose(meta.brand||''),normalizeArabicLoose(meta.size||'')].join('|')}
async function buildShoppingContextV107(env,chatId){
  const list=await getDefaultShoppingList(env,chatId,false);if(!list)return'=== قائمة المشتريات الحقيقية ===\nالقائمة فارغة.';
  const rows=await getShoppingItems(env,chatId,list.id);if(!rows.length)return'=== قائمة المشتريات الحقيقية ===\nالقائمة فارغة.';
  const lines=rows.slice(-80).map((r,i)=>{const m=parseShopMetaV107(r.meta_json);return`${i+1}) id=${r.id} | ${r.title} | quantity=${r.quantity||m.quantity_text||''} | value=${m.quantity_value??''} | unit=${m.quantity_unit||''} | status=${r.status} | brand=${m.brand||''} | size=${m.size||''} | category=${m.category||''} | store=${m.store||''} | priority=${m.priority||''} | optional=${m.optional==null?'':m.optional}`});
  return`=== قائمة المشتريات الحقيقية (استخدمها لحل المراجع ولا تخترع عناصر) ===\n${lines.join('\n')}`;
}
async function snapshotShoppingV107(env,chatId){const list=await getDefaultShoppingList(env,chatId,false);return list?{list:{...list},items:(await getShoppingItems(env,chatId,list.id)).map(x=>({...x}))}:{list:null,items:[]}}
async function restoreShoppingSnapshotV107(env,chatId,snap){
  const cur=await getDefaultShoppingList(env,chatId,false);if(cur)await env.DB.batch([env.DB.prepare(`DELETE FROM shopping_sessions WHERE chat_id=? AND list_id=?`).bind(chatId,Number(cur.id)),env.DB.prepare(`DELETE FROM smart_list_items WHERE chat_id=? AND list_id=?`).bind(chatId,Number(cur.id)),env.DB.prepare(`DELETE FROM smart_lists WHERE chat_id=? AND id=?`).bind(chatId,Number(cur.id))]);
  if(!snap?.list)return;
  const now=new Date().toISOString(),l=snap.list;await env.DB.prepare(`INSERT OR REPLACE INTO smart_lists(id,chat_id,name,normalized_name,list_type,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(Number(l.id),chatId,l.name,l.normalized_name,l.list_type||'shopping',Number(l.active??1),l.created_at||now,now).run();
  for(const x of snap.items||[])await env.DB.prepare(`INSERT OR REPLACE INTO smart_list_items(id,list_id,chat_id,title,normalized_title,quantity,status,position,created_at,updated_at,meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(Number(x.id),Number(l.id),chatId,x.title,x.normalized_title,x.quantity,x.status,Number(x.position||0),x.created_at||now,now,x.meta_json||'{}').run();
}
function scoreShopTargetV107(target,row){const t=canonicalShoppingKeyV105(target),r=canonicalShoppingKeyV105(row.title);if(!t)return 0;if(t===r)return 1000;if(r.includes(t)||t.includes(r))return 700;const a=t.split(/\s+/).filter(x=>x.length>1),b=new Set(r.split(/\s+/));let s=0;for(const x of a)if(b.has(x))s+=x.length*10;return s}
async function resolveShopTargetsV107(env,chatId,target){
  const list=await getDefaultShoppingList(env,chatId,false);if(!list)return[];const rows=await getShoppingItems(env,chatId,list.id);const active=rows.filter(x=>['pending','bought','unavailable','skipped'].includes(String(x.status)));
  if(target==='__all__')return active;if(target==='__last__')return active.length?[active[active.length-1]]:[];if(target==='__first__')return active.length?[active[0]]:[];
  const ranked=active.map(r=>({r,s:scoreShopTargetV107(target,r)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s);if(!ranked.length)return[];const top=ranked[0].s;return ranked.filter(x=>x.s===top).map(x=>x.r);
}
async function updateShopRowV107(env,row,patch){
  const oldMeta=parseShopMetaV107(row.meta_json);const meta={...oldMeta,...(patch.meta||{})};
  if(patch.quantity_value!==undefined)meta.quantity_value=patch.quantity_value;if(patch.quantity_unit!==undefined)meta.quantity_unit=normalizeShopUnitV107(patch.quantity_unit);if(patch.quantity_exact!==undefined)meta.quantity_exact=!!patch.quantity_exact;if(patch.quantity_text!==undefined)meta.quantity_text=patch.quantity_text;
  const title=patch.title!=null?String(patch.title).trim().slice(0,180):row.title;const qty=patch.quantity!==undefined?patch.quantity:shopQtyTextV107(meta.quantity_value,meta.quantity_unit,meta.quantity_text||'');
  await env.DB.prepare(`UPDATE smart_list_items SET title=?,normalized_title=?,quantity=?,status=?,meta_json=?,updated_at=? WHERE id=? AND chat_id=?`).bind(title,canonicalShoppingKeyV105(title),qty,patch.status||row.status,JSON.stringify(meta),new Date().toISOString(),Number(row.id),String(row.chat_id)).run();
}
async function addShopItemV107(env,chatId,op){
  const list=await getDefaultShoppingList(env,chatId,true),rows=await getShoppingItems(env,chatId,list.id);const meta={...op.meta,quantity_value:op.quantity_value,quantity_unit:normalizeShopUnitV107(op.quantity_unit),quantity_exact:op.quantity_exact,quantity_text:op.quantity_text};const key=shopVariantKeyV107(op.title,meta);const same=rows.find(r=>shopVariantKeyV107(r.title,parseShopMetaV107(r.meta_json))===key&&r.status!=='removed');
  if(same){const sm=parseShopMetaV107(same.meta_json);if(op.quantity_value!=null&&sm.quantity_value!=null&&normalizeShopUnitV107(sm.quantity_unit)===meta.quantity_unit){const v=Number(sm.quantity_value)+Number(op.quantity_value);await updateShopRowV107(env,same,{quantity_value:v,quantity_unit:meta.quantity_unit,quantity_exact:!!op.quantity_exact,quantity_text:'',meta:{...sm,...op.meta}});return same.id}if(same.status!=='pending')await updateShopRowV107(env,same,{status:'pending'});return same.id}
  const pos=Number((await env.DB.prepare(`SELECT COALESCE(MAX(position),0) m FROM smart_list_items WHERE list_id=? AND chat_id=?`).bind(Number(list.id),chatId).first())?.m||0)+1;const now=new Date().toISOString();const qty=shopQtyTextV107(meta.quantity_value,meta.quantity_unit,meta.quantity_text);const r=await env.DB.prepare(`INSERT INTO smart_list_items(list_id,chat_id,title,normalized_title,quantity,status,position,created_at,updated_at,meta_json) VALUES (?,?,?,?,?,'pending',?,?,?,?)`).bind(Number(list.id),chatId,op.title,canonicalShoppingKeyV105(op.title),qty,pos,now,now,JSON.stringify(meta)).run();return Number(r?.meta?.last_row_id||0)
}
async function applyShopOperationV107(env,chatId,op){
  if(op.op==='add'){if(!op.title)throw new Error('عملية إضافة مشتريات بدون اسم');await addShopItemV107(env,chatId,op);return 1}
  const targets=await resolveShopTargetsV107(env,chatId,op.target);if(!targets.length)throw new Error(`مش لاقي عنصر مشتريات مطابق لـ «${op.target||'المرجع المطلوب'}»`);
  if(op.op!=='reorder'&&op.target!=='__all__'&&targets.length>1)throw new Error(`المرجع «${op.target}» مطابق لأكتر من عنصر؛ محتاج تحديد أوضح`);
  if(op.op==='remove'){for(const r of targets)await env.DB.prepare(`DELETE FROM smart_list_items WHERE id=? AND chat_id=?`).bind(Number(r.id),chatId).run();return targets.length}
  if(op.op==='mark_bought'||op.op==='mark_pending'){for(const r of targets)await updateShopRowV107(env,r,{status:op.op==='mark_bought'?'bought':'pending'});return targets.length}
  if(op.op==='replace'){if(!op.replacement)throw new Error('الاستبدال ناقص المنتج الجديد');for(const r of targets)await updateShopRowV107(env,r,{title:op.replacement,meta:op.meta,quantity_value:op.quantity_value??parseShopMetaV107(r.meta_json).quantity_value,quantity_unit:op.quantity_unit||parseShopMetaV107(r.meta_json).quantity_unit,quantity_text:op.quantity_text||parseShopMetaV107(r.meta_json).quantity_text});return targets.length}
  if(op.op==='set_meta'){for(const r of targets)await updateShopRowV107(env,r,{meta:{...parseShopMetaV107(r.meta_json),...op.meta}});return targets.length}
  if(op.op==='set_quantity'||op.op==='increment'||op.op==='multiply'){
    for(const r of targets){const m=parseShopMetaV107(r.meta_json);let base=m.quantity_value==null?null:Number(m.quantity_value),unit=normalizeShopUnitV107(op.quantity_unit||m.quantity_unit||'');let next=null;
      if(op.op==='set_quantity'){next=op.quantity_value;if(next==null&&op.quantity_text){await updateShopRowV107(env,r,{quantity_value:null,quantity_unit:unit,quantity_exact:op.quantity_exact,quantity_text:op.quantity_text});continue}}
      if(op.op==='increment'){if(op.quantity_value==null)throw new Error('الزيادة بدون كمية');if(base==null){if(unit&&unit!=='قطعة')throw new Error(`كمية «${r.title}» الحالية غير رقمية`);base=1}next=base+Number(op.quantity_value)}
      if(op.op==='multiply'){if(base==null)throw new Error(`كمية «${r.title}» الحالية غير رقمية فلا ينفع أضربها`);if(op.factor==null||op.factor<0)throw new Error('معامل التعديل غير صالح');next=base*Number(op.factor)}
      if(next==null||!Number.isFinite(Number(next))||Number(next)<0)throw new Error('الكمية الناتجة غير صالحة');await updateShopRowV107(env,r,{quantity_value:Number(next),quantity_unit:unit,quantity_exact:true,quantity_text:''});
    }return targets.length
  }
  if(op.op==='reorder'){return 0}
  return 0
}
async function answerShoppingQueryV107(env,chatId,plan){
  const list=await getDefaultShoppingList(env,chatId,false),rows=list?await getShoppingItems(env,chatId,list.id):[];let filtered=rows.filter(x=>['pending','bought','unavailable','skipped'].includes(String(x.status)));
  if(plan.query==='pending')filtered=filtered.filter(x=>x.status==='pending');if(plan.query==='bought')filtered=filtered.filter(x=>x.status==='bought');if(plan.query==='important')filtered=filtered.filter(x=>['high','important','ضروري'].includes(String(parseShopMetaV107(x.meta_json).priority||'').toLowerCase()));if(plan.query==='category'&&plan.query_value)filtered=filtered.filter(x=>normalizeArabicLoose(parseShopMetaV107(x.meta_json).category||'').includes(normalizeArabicLoose(plan.query_value)));
  const all=rows.filter(x=>['pending','bought','unavailable','skipped'].includes(String(x.status))),done=all.filter(x=>x.status==='bought').length,pending=all.filter(x=>x.status==='pending').length;
  if(plan.query==='progress')return`🛒 خلصت ${all.length?Math.round(done/all.length*100):0}% — اتجاب ${done} من ${all.length}، وفاضل ${pending}.`;if(plan.query==='count')return`🛒 فاضل ${pending} عنصر من ${all.length}.`;
  return filtered.length?`🛒 ${plan.query==='bought'?'اللي اتجاب':plan.query==='pending'?'اللي لسه ناقص':'القائمة'}:\n${filtered.map(x=>`• ${x.title}${x.quantity?` — ${x.quantity}`:''}`).join('\n')}`:'🛒 مفيش عناصر مطابقة.';
}
async function executeShoppingPlanV107(env,chatId,intent){
  const plan=normalizeShoppingPlanV107(intent.shopping);if(plan.mode==='query'){const answer=await answerShoppingQueryV107(env,chatId,plan);await sendText(env,chatId,answer);await saveConversationMessage(env,chatId,'assistant',answer);return}
  const before=await snapshotShoppingV107(env,chatId);let changed=0;
  try{for(const op of plan.operations)changed+=await applyShopOperationV107(env,chatId,op);const after=await snapshotShoppingV107(env,chatId);const same=JSON.stringify(before.items)===JSON.stringify(after.items);if(same&&plan.operations.some(x=>x.op!=='reorder'))throw new Error('خطة المشتريات لم تنتج أي تغيير قابل للتحقق');
    await writeAudit(env,chatId,{action:'shopping_v107',entityType:'shopping_transaction',entityId:String(after.list?.id||''),summary:`تنفيذ ${plan.operations.length} عملية مشتريات`,before,after,undo:{type:'restore_shopping_snapshot_v107',snapshot:before},strict:true});
  }catch(e){await restoreShoppingSnapshotV107(env,chatId,before);throw e}
  const list=await getDefaultShoppingList(env,chatId,false),rows=list?await getShoppingItems(env,chatId,list.id):[];const pending=rows.filter(x=>x.status==='pending');const answer=`✅ نفذت طلب المشتريات بدقة. ${changed?`التغييرات: ${changed}. `:''}المتبقي في القائمة: ${pending.length}.`;await sendText(env,chatId,answer);await saveConversationMessage(env,chatId,'assistant',answer)
}
/* ======================= END V10.7 SEMANTIC SHOPPING ENGINE ======================= */
'''
rep('\nasync function processFreshAgentText(env,chatId,text,history){',inject+'\nasync function processFreshAgentText(env,chatId,text,history){')

# Undo V10.7 shopping transaction snapshot.
rep('''    }else if(u.type==="restore_deleted_shopping_list"){
      await restoreShoppingListSnapshotV1034(env,chatId,u.snapshot||{});
    }else{''','''    }else if(u.type==="restore_deleted_shopping_list"){
      await restoreShoppingListSnapshotV1034(env,chatId,u.snapshot||{});
    }else if(u.type==="restore_shopping_snapshot_v107"){
      await restoreShoppingSnapshotV107(env,chatId,u.snapshot||{});
    }else{''')

# Existing addShoppingItems keeps metadata valid when deterministic fallback is used.
rep("const res=await env.DB.prepare(`INSERT INTO smart_list_items(list_id,chat_id,title,normalized_title,status,position,created_at,updated_at) VALUES (?,?,?,?, 'pending',?,?,?)`).bind(Number(list.id),chatId,title,n,++pos,now,now).run();",
    "const res=await env.DB.prepare(`INSERT INTO smart_list_items(list_id,chat_id,title,normalized_title,status,position,created_at,updated_at,meta_json) VALUES (?,?,?,?, 'pending',?,?,?,'{}')`).bind(Number(list.id),chatId,title,n,++pos,now,now).run();")

# Root feature flags make the deployed build auditable.
rep('v106_self_continuation:true,reliability_lock:true', 'v106_self_continuation:true,v107_semantic_first:true,v107_universal_shopping:true,v107_transactional_shopping:true,reliability_lock:true')

OUT.write_text(s,encoding='utf-8')
print(f'Wrote {OUT} ({len(s)} chars)')
