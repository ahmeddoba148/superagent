from pathlib import Path
p=Path('tests/v10-5-manual-bugs-regression.mjs')
s=p.read_text(encoding='utf-8')
repls=[
    ("chat:{id,type:'private'}","chat:{id:chat,type:'private'}"),
    ("Number(rule?.duration_minutes||-1)===0","Number(rule?.duration_minutes??-1)===0"),
]
for old,new in repls:
    if old not in s:
        raise SystemExit(f'V10.5 harness anchor missing: {old}')
    s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('patched V10.5 regression harness')
