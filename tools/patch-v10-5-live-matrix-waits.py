from pathlib import Path
p=Path('tests/v10-5-live-staging-matrix.mjs')
s=p.read_text(encoding='utf-8')
old="""const dup=++seq;\nawait say('فكرني يوم 22 أكتوبر 2026 الساعة 3:17 مساء أراجع اختبار التكرار',{updateId:dup,wait:0});\nawait say('فكرني يوم 22 أكتوبر 2026 الساعة 3:17 مساء أراجع اختبار التكرار',{updateId:dup,wait:1300});\nconst dupRows=reminders().filter(x=>String(x.title).includes('أراجع اختبار التكرار'));\ncheck('live Telegram update idempotency',dupRows.length===1,JSON.stringify(dupRows));"""
new="""const dup=++seq;\nawait say('فكرني يوم 22 أكتوبر 2026 الساعة 3:17 مساء أراجع اختبار التكرار',{updateId:dup,wait:0});\nawait say('فكرني يوم 22 أكتوبر 2026 الساعة 3:17 مساء أراجع اختبار التكرار',{updateId:dup,wait:0});\nconst dupRows=await poll(()=>{const rows=reminders().filter(x=>String(x.title).includes('أراجع اختبار التكرار'));return rows.length===1?rows:null;},{tries:45,delay:700,label:'duplicate update first completion'});\nawait sleep(1800);\nconst dupRowsFinal=reminders().filter(x=>String(x.title).includes('أراجع اختبار التكرار'));\ncheck('live Telegram update idempotency',dupRowsFinal.length===1,JSON.stringify(dupRowsFinal));"""
if old not in s: raise SystemExit('duplicate anchor missing')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('patched live matrix wait')
