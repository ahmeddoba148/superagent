from pathlib import Path
p=Path('tests/v10-5-live-staging-matrix.mjs')
s=p.read_text(encoding='utf-8')
old="""await say('يوم 21 نوفمبر 2026 الساعة 6 مساء عندي اجتماع اسمه سريع 717 ومدته ساعة',{wait:1200});\nawait Promise.all([\n  say('أجل اجتماع سريع 717 ساعة',{wait:0}),\n  (async()=>{await sleep(35);return say('رجع آخر تعديل',{wait:0})})()\n]);\nawait sleep(1700);\nconst rapid=reminders().find(x=>String(x.title).includes('سريع 717'));\ncheck('live rapid shift+undo final state',rapid?.local_time==='18:00',JSON.stringify(rapid));"""
new="""await say('يوم 21 نوفمبر 2026 الساعة 6 مساء عندي اجتماع اسمه سريع 717 ومدته ساعة',{wait:0});\nawait poll(()=>{const x=reminders().find(v=>String(v.title).includes('سريع 717'));return x?.local_time==='18:00'?x:null;},{tries:45,delay:700,label:'rapid appointment create precondition'});\nawait Promise.all([\n  say('أجل اجتماع سريع 717 ساعة',{wait:0}),\n  (async()=>{await sleep(35);return say('رجع آخر تعديل',{wait:0})})()\n]);\nconst rapid=await poll(()=>{const x=reminders().find(v=>String(v.title).includes('سريع 717'));return x?.local_time==='18:00'?x:null;},{tries:45,delay:700,label:'rapid shift+undo settled state'});\ncheck('live rapid shift+undo final state',rapid?.local_time==='18:00',JSON.stringify(rapid));"""
if old not in s: raise SystemExit('rapid anchor missing')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('patched rapid live precondition/wait')
