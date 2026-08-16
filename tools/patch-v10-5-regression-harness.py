from pathlib import Path
p=Path('tests/v10-5-manual-bugs-regression.mjs')
s=p.read_text(encoding='utf-8')
old="chat:{id,type:'private'}"
new="chat:{id:chat,type:'private'}"
if old not in s:
    raise SystemExit('V10.5 harness shadow anchor missing')
p.write_text(s.replace(old,new,1),encoding='utf-8')
print('patched V10.5 regression harness chat id')
