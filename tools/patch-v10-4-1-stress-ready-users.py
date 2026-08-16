from pathlib import Path
p=Path('tests/v10-4-1-ultra-direct-stress.mjs')
s=p.read_text()
old="async function wh(chat,text,forcedId=null){const id=forcedId??uid++;const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};await worker.fetch(new Request('https://stress.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'S','Content-Type':'application/json'},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:chat,type:'private'},text}})}),env,ctx);await Promise.allSettled(waits);return id}"
new="async function wh(chat,text,forcedId=null){const id=forcedId??uid++;if(text!=='/start'){await env.DB.prepare(`INSERT OR IGNORE INTO agent_settings(chat_id,updated_at) VALUES (?,?)`).bind(String(chat),new Date().toISOString()).run();}const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};await worker.fetch(new Request('https://stress.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'S','Content-Type':'application/json'},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:chat,type:'private'},text}})}),env,ctx);await Promise.allSettled(waits);return id}"
if old not in s: raise SystemExit('wh harness anchor missing after chat-id fix')
p.write_text(s.replace(old,new,1))
print('synthetic users initialized like real /start users')
