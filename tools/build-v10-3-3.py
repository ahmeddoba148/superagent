from pathlib import Path

src=Path('SuperAgent_V10_3_2_Dependency_Canonical.js')
out=Path('SuperAgent_V10_3_3_Chain_Final.js')
s=src.read_text()

s=s.replace('const V10_VERSION="10.3.2";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Dependency Canonical";',
            'const V10_VERSION="10.3.3";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Chain Final";',1)
s=s.replace('dependency_canonicalization:true,reliability_lock:true',
            'dependency_canonicalization:true,chain_final_guard:true,reliability_lock:true',1)
s=s.replace('message:"Super Agent V10.3.2 Dependency Canonical is ready"',
            'message:"Super Agent V10.3.3 Chain Final is ready"')

start=s.find('function repairV102LinkedEventIntent(intent,base,timeZone=TIME_ZONE){')
end=s.find('\nfunction applyV102SemanticRepairs(',start)
if start<0 or end<0:
    raise SystemExit('repair block not found')

new_block=r'''function createV1033LinkedTarget(intent,sourceIndex,task,relation,offset,timeZone,usedTargets){
  const source=intent.items[sourceIndex];let targetIndex=-1,best=0;
  for(let i=0;i<intent.items.length;i++){
    if(i===sourceIndex||usedTargets.has(i))continue;
    const sc=scoreV102TaskMatch(task,intent.items[i].title);
    if(sc>best){best=sc;targetIndex=i;}
  }
  if(best<2)targetIndex=-1;
  const off=Number.isFinite(Number(offset))?Math.max(0,Number(offset)):60;
  if(targetIndex<0){
    const base=`${source.date} ${source.time}`;
    let delta=relation==="before_start"?-off:off;
    if(relation==="after_end")delta+=Number(source.duration_minutes||0);
    const at=addMinutesLocal(base,delta,timeZone);const [date,time]=splitLocalDateTime(at);
    targetIndex=intent.items.length;
    intent.items.push({title:String(task||"").trim().slice(0,500),kind:"reminder",date,time,timezone:timeZone,duration_minutes:0,advance_alerts:[]});
  }
  usedTargets.add(targetIndex);
  const target=intent.items[targetIndex];
  // The relative task is itself the reminder. Remove AI-generated duplicate advance alerts
  // that mirror the same relationship offset on the linked cluster.
  for(const item of [source,target]){
    const arr=sanitizeAdvanceAlerts(item.advance_alerts||[]).filter(x=>Number(x)!==off);
    item.advance_alerts=arr;
  }
  return{targetIndex,dep:{source_ref:sourceIndex,target_ref:targetIndex,relation,offset_minutes:off}};
}

function repairV102LinkedEventIntent(intent,base,timeZone=TIME_ZONE){
  if(intent?.action!=="create"||!Array.isArray(intent.items)||!intent.items.length)return;
  const raw=String(base||"");if(!/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى)/iu.test(raw))return;
  if(!/(?:دكتور|طبيب|كشف|موعد|ميعاد|اجتماع|مقابله|مقابلة)/iu.test(raw))return;
  let sourceIndex=intent.items.findIndex(x=>x.kind==="appointment");if(sourceIndex<0)sourceIndex=intent.items.findIndex(x=>/(?:دكتور|طبيب|كشف|موعد|ميعاد|اجتماع|مقابله|مقابلة)/iu.test(String(x.title||"")));if(sourceIndex<0)sourceIndex=0;
  const before=raw.match(/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى)\s+قبلها\s+(.+?)(?=\s+(?:و?بعد(?:ها|\s+ما)?|و?فكرني|و?فكرنى|و?ذكرني|و?ذكرنى|و?نبهني|و?نبهنى)|$)/iu);
  let after=raw.match(/(?:^|\s)و?بعد\s+ما\s+(?:نخلص|اخلص|أخلص)\s+(.+?)(?=\s+(?:و?فكرني|و?فكرنى|و?ذكرني|و?ذكرنى|و?نبهني|و?نبهنى|و?قبلها)|$)/iu);
  if(!after)after=raw.match(/(?:^|\s)و?بعدها\s+(.+?)(?=\s+(?:و?فكرني|و?فكرنى|و?ذكرني|و?ذكرنى|و?نبهني|و?نبهنى|و?قبلها)|$)/iu);
  if(!after)after=raw.match(/(?:^|\s)و?بعد\s+(?:الدكتور|الطبيب|الكشف|الموعد|ميعاد|الاجتماع|المقابلة|المقابله)\s+(.+?)(?=\s+(?:و?فكرني|و?فكرنى|و?ذكرني|و?ذكرنى|و?نبهني|و?نبهنى|و?قبلها)|$)/iu);
  if(!before&&!after)return;

  const original=normalizeV10Dependencies(intent.dependencies);
  const usedTargets=new Set();const canonical=[];const canonicalNodes=new Set([sourceIndex]);
  if(before){const x=parseV102RelationTask(before[1]);if(x.task){const r=createV1033LinkedTarget(intent,sourceIndex,x.task,"before_start",x.offset,timeZone,usedTargets);canonical.push(r.dep);canonicalNodes.add(r.targetIndex);}}
  if(after){const x=parseV102RelationTask(after[1]);if(x.task){const cleaned=x.task.replace(/^(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى)\s+/iu,"").replace(/\s*(?:،|,)?\s*و?(?:ضيف|زود|حط|سجل)\s+.+$/iu,"").trim();const r=createV1033LinkedTarget(intent,sourceIndex,cleaned||x.task,"after_end",x.offset,timeZone,usedTargets);canonical.push(r.dep);canonicalNodes.add(r.targetIndex);}}
  let merged=normalizeV10Dependencies(canonical);
  const extras=original.filter(d=>!(canonicalNodes.has(d.source_ref)&&canonicalNodes.has(d.target_ref)));
  for(const d of extras){const candidate=normalizeV10Dependencies([...merged,d]);if(!dependencyGraphHasCycle(candidate))merged=candidate;}
  intent.dependencies=merged;
}
'''
s=s[:start]+new_block+s[end:]

# Shopping: distinguish newly-added items from items that were already pending.
s=s.replace('const list=await getDefaultShoppingList(env,chatId,true);const now=new Date().toISOString();const ids=[];const added=[];',
            'const list=await getDefaultShoppingList(env,chatId,true);const now=new Date().toISOString();const ids=[];const added=[];const existingPending=[];',1)
s=s.replace("if(exists&&exists.status==='pending')continue;",
            "if(exists&&exists.status==='pending'){existingPending.push(title);continue;}",1)
s=s.replace('return {list,ids,added};','return {list,ids,added,existingPending};',1)
old='const msg=r.added.length?`🛒 ضفت ${r.added.length} للمشتريات: ${r.added.join("، ")}`:"الأصناف دي موجودة بالفعل في المشتريات.";await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,"assistant",msg);'
new='const msg=r.added.length?`🛒 ضفت ${r.added.length} جديد للمشتريات: ${r.added.join("، ")}${r.existingPending?.length?`\\nℹ️ موجود بالفعل: ${r.existingPending.join("، ")}`:""}`:`الأصناف دي موجودة بالفعل في المشتريات${r.existingPending?.length?`: ${r.existingPending.join("، ")}`:"."}`;await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,"assistant",msg);'
if old not in s: raise SystemExit('compound shopping message target not found')
s=s.replace(old,new,1)
old2='if(m){const items=splitShoppingItems(m[1]);const r=await addShoppingItems(env,chatId,items);await sendText(env,chatId,r.added.length?`🛒 ضفت ${r.added.length} للمشتريات: ${r.added.join("، ")}`:"الأصناف دي موجودة بالفعل في المشتريات.");return true;}'
new2='if(m){const items=splitShoppingItems(m[1]);const r=await addShoppingItems(env,chatId,items);const msg=r.added.length?`🛒 ضفت ${r.added.length} جديد للمشتريات: ${r.added.join("، ")}${r.existingPending?.length?`\\nℹ️ موجود بالفعل: ${r.existingPending.join("، ")}`:""}`:`الأصناف دي موجودة بالفعل في المشتريات${r.existingPending?.length?`: ${r.existingPending.join("، ")}`:"."}`;await sendText(env,chatId,msg);return true;}'
if old2 not in s: raise SystemExit('direct shopping message target not found')
s=s.replace(old2,new2,1)

out.write_text(s)
print('built',out,len(out.read_bytes()))
