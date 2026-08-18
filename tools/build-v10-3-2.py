from pathlib import Path

src=Path('SuperAgent_V10_3_Reliability_Lock.js')
out=Path('SuperAgent_V10_3_2_Dependency_Canonical.js')
s=src.read_text()

s=s.replace('const V10_VERSION="10.3.1";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Diagnostics";',
            'const V10_VERSION="10.3.2";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Dependency Canonical";',1)
s=s.replace('dependency_repair:true,reliability_lock:true',
            'dependency_repair:true,dependency_canonicalization:true,reliability_lock:true',1)

start=s.find('function repairV102LinkedEventIntent(intent,base,timeZone=TIME_ZONE){')
end=s.find('\nfunction applyV102SemanticRepairs(',start)
if start<0 or end<0:
    raise SystemExit('repairV102LinkedEventIntent block not found')

new_func=r'''function repairV102LinkedEventIntent(intent,base,timeZone=TIME_ZONE){
  if(intent?.action!=="create"||!Array.isArray(intent.items)||!intent.items.length)return;
  const raw=String(base||"");if(!/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى)/iu.test(raw))return;
  if(!/(?:دكتور|طبيب|كشف|موعد|ميعاد|اجتماع|مقابله|مقابلة)/iu.test(raw))return;
  let sourceIndex=intent.items.findIndex(x=>x.kind==="appointment");if(sourceIndex<0)sourceIndex=intent.items.findIndex(x=>/(?:دكتور|طبيب|كشف|موعد|ميعاد|اجتماع|مقابله|مقابلة)/iu.test(String(x.title||"")));if(sourceIndex<0)sourceIndex=0;
  const before=raw.match(/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى)\s+قبلها\s+(.+?)(?=\s+(?:و?بعد(?:ها|\s+ما)?|و?فكرني|و?فكرنى|و?ذكرني|و?ذكرنى|و?نبهني|و?نبهنى)|$)/iu);
  let after=raw.match(/(?:^|\s)و?بعد\s+ما\s+(?:نخلص|اخلص|أخلص)\s+(.+?)(?=\s+(?:و?فكرني|و?فكرنى|و?ذكرني|و?ذكرنى|و?نبهني|و?نبهنى|و?قبلها)|$)/iu);
  if(!after)after=raw.match(/(?:^|\s)و?بعدها\s+(.+?)(?=\s+(?:و?فكرني|و?فكرنى|و?ذكرني|و?ذكرنى|و?نبهني|و?نبهنى|و?قبلها)|$)/iu);
  if(!after)after=raw.match(/(?:^|\s)و?بعد\s+(?:الدكتور|الطبيب|الكشف|الموعد|ميعاد|الاجتماع|المقابلة|المقابله)\s+(.+?)(?=\s+(?:و?فكرني|و?فكرنى|و?ذكرني|و?ذكرنى|و?نبهني|و?نبهنى|و?قبلها)|$)/iu);
  if(!before&&!after)return;

  // Explicit Arabic relationship wording is authoritative. Build those links first,
  // then re-add only AI-suggested links that cannot create a cycle.
  const original=normalizeV10Dependencies(intent.dependencies);
  intent.dependencies=[];
  const canonicalNodes=new Set([sourceIndex]);
  if(before){const x=parseV102RelationTask(before[1]);if(x.task){const idx=ensureV102LinkedTarget(intent,sourceIndex,x.task,"before_start",x.offset,timeZone);if(Number.isInteger(idx)&&idx>=0)canonicalNodes.add(idx);}}
  if(after){const x=parseV102RelationTask(after[1]);if(x.task){const idx=ensureV102LinkedTarget(intent,sourceIndex,x.task,"after_end",x.offset,timeZone);if(Number.isInteger(idx)&&idx>=0)canonicalNodes.add(idx);}}
  let merged=normalizeV10Dependencies(intent.dependencies);

  // Discard AI edges between the explicitly linked cluster (including reverse edges).
  // Preserve unrelated AI edges only when they keep the full graph acyclic.
  const extras=original.filter(d=>!(canonicalNodes.has(d.source_ref)&&canonicalNodes.has(d.target_ref)));
  for(const d of extras){
    const candidate=normalizeV10Dependencies([...merged,d]);
    if(!dependencyGraphHasCycle(candidate))merged=candidate;
  }
  intent.dependencies=merged;
}
'''
s=s[:start]+new_func+s[end:]

# Setup/root flags expose the protection state.
s=s.replace('dependency_repair:true,reliability_lock:true,operation_receipts:true',
            'dependency_repair:true,dependency_canonicalization:true,reliability_lock:true,operation_receipts:true')
s=s.replace('message:"Super Agent V10.3 Reliability Lock is ready"',
            'message:"Super Agent V10.3.2 Dependency Canonical is ready"')

out.write_text(s)
print('built',out,len(out.read_bytes()))
