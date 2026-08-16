from pathlib import Path
p=Path('SuperAgent_V10_4_1_Ultra_Hardened.js')
s=p.read_text()
anchor='async function updateScheduleItem(env,chatId,intent,options={}){'
pos=s.find(anchor)
if pos<0: raise SystemExit('updateScheduleItem anchor missing')
helper=r'''async function projectLinkedReminderChainV1041(env,chatId,sourceId,rootCandidate){
  const out=[];const seen=new Set();
  async function walk(id,candidate,depth){
    id=Number(id);if(!id||depth>12||seen.has(id))return;seen.add(id);
    out.push({id,candidate});
    const deps=(await env.DB.prepare(`SELECT * FROM event_dependencies WHERE chat_id=? AND source_type='reminder' AND source_id=? AND active=1`).bind(chatId,id).all())?.results||[];
    for(const d of deps){
      const tid=Number(d.target_id);if(!tid||seen.has(tid))continue;
      const child=await env.DB.prepare(`SELECT * FROM reminders WHERE id=? AND chat_id=? AND cancelled=0 AND sent=0 LIMIT 1`).bind(tid,chatId).first();if(!child)continue;
      let delta=Number(d.offset_minutes||0);if(d.relation==='after_end')delta+=Number(candidate.duration_minutes||0);else if(d.relation==='before_start')delta=-delta;
      const tz=String(candidate.timezone||child.timezone||TIME_ZONE);const at=addMinutesLocal(`${candidate.date} ${candidate.time}`,delta,tz);const [date,time]=splitLocalDateTime(at);
      const cc={title:child.title,kind:child.kind,date,time,timezone:tz,duration_minutes:Number(child.duration_minutes||0),advance_alerts:sanitizeAdvanceAlerts(parseJsonArray(child.advance_alerts_json))};
      await walk(tid,cc,depth+1);
    }
  }
  await walk(sourceId,rootCandidate,0);return out;
}

async function findProjectedChainConflictsV1041(env,chatId,sourceId,rootCandidate){
  const projected=await projectLinkedReminderChainV1041(env,chatId,sourceId,rootCandidate);const ids=projected.map(x=>x.id);let conflicts=[];
  for(const x of projected){conflicts.push(...await findOneTimeCandidateConflicts(env,chatId,x.candidate,{ignoreOneTimeIds:ids}));}
  return dedupeConflicts(conflicts);
}

'''
s=s[:pos]+helper+s[pos:]
old='''if(!options.skipConflictCheck){
const conflicts=await findOneTimeCandidateConflicts(env,chatId,next,{ignoreOneTimeId:id});
if(conflicts.length){
await presentConflictWarning(env,chatId,intent,conflicts,{actionLabel:"تعديل الموعد"});
return;
}
}'''
new='''if(!options.skipConflictCheck){
const conflicts=await findProjectedChainConflictsV1041(env,chatId,id,next);
if(conflicts.length){
await presentConflictWarning(env,chatId,intent,conflicts,{actionLabel:"تعديل الموعد"});
return;
}
}'''
if old not in s: raise SystemExit('one-time conflict block missing')
s=s.replace(old,new,1)
p.write_text(s)
print('projected chain conflict hardening applied',len(p.read_bytes()))
