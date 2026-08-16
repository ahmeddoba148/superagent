from pathlib import Path
import re
p=Path('tests/v10-7-discovered-live.mjs')
s=p.read_text(encoding='utf-8')

reset_new=r'''function reset(){
  const statements=[
    `DELETE FROM event_dependencies WHERE chat_id='${C}'`,`DELETE FROM reminder_fires WHERE chat_id='${C}'`,`DELETE FROM schedule_fires WHERE chat_id='${C}'`,`DELETE FROM reminders WHERE chat_id='${C}'`,`DELETE FROM schedule_rules WHERE chat_id='${C}'`,`DELETE FROM prayer_rules WHERE chat_id='${C}'`,`DELETE FROM shopping_sessions WHERE chat_id='${C}'`,`DELETE FROM smart_list_items WHERE chat_id='${C}'`,`DELETE FROM smart_lists WHERE chat_id='${C}'`,`DELETE FROM conversation_messages WHERE chat_id='${C}'`,`DELETE FROM pending_dialogs WHERE chat_id='${C}'`,`DELETE FROM pending_conflicts WHERE chat_id='${C}'`,`DELETE FROM pending_requests WHERE chat_id='${C}'`,`DELETE FROM action_audit WHERE chat_id='${C}'`,`DELETE FROM operation_receipts WHERE chat_id='${C}'`,`DELETE FROM telegram_inbox_v106 WHERE chat_id='${C}'`,`DELETE FROM telegram_chat_leases_v106 WHERE chat_id='${C}'`,`DELETE FROM telegram_updates WHERE chat_id='${C}'`,`DELETE FROM runtime_failures WHERE chat_id='${C}' OR chat_id IS NULL`
  ];
  d1(statements.join(';'));
}
function state(){'''
s,n=re.subn(r"function reset\(\)\{.*?\}\nfunction state\(\)\{",reset_new,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'reset patch count={n}')

seed_new=r'''function seed(rows){
  const now=new Date().toISOString();
  const listId=880000000+(++seq%90000000);
  const statements=[`INSERT INTO smart_lists(id,chat_id,name,normalized_name,list_type,active,created_at,updated_at) VALUES (${listId},'${C}','مشتريات','مشتريات','shopping',1,'${now}','${now}')`];
  let pos=0;
  for(const x of rows){pos++;const meta={quantity_value:x.v??null,quantity_unit:x.u||'',quantity_exact:x.v!=null,quantity_text:x.qt||'',category:x.category||'',brand:x.brand||'',size:x.size||''};const qty=x.qt||(x.v!=null?`${x.v}${x.u?` ${x.u}`:''}`:'');statements.push(`INSERT INTO smart_list_items(list_id,chat_id,title,normalized_title,quantity,status,position,created_at,updated_at,meta_json) VALUES (${listId},'${C}','${q(x.t)}','${q(x.t)}','${q(qty)}','pending',${pos},'${now}','${now}','${q(JSON.stringify(meta))}')`)}
  d1(statements.join(';'));
}
function failRuntime(){'''
s,n=re.subn(r"function seed\(rows\)\{.*?\}\nfunction failRuntime\(\)\{",seed_new,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'seed patch count={n}')

p.write_text(s,encoding='utf-8')
print('Optimized V10.7 live test reset/seed remote calls')
