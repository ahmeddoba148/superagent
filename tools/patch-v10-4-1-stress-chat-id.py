from pathlib import Path
for name in ['tests/v10-4-1-ultra-direct-stress.mjs','tests/v10-4-1-debug-stress-first-case.mjs']:
    p=Path(name);s=p.read_text()
    old="chat:{id,type:'private'}"
    new="chat:{id:chat,type:'private'}"
    if old not in s: raise SystemExit(f'chat-id shadow anchor missing in {name}')
    p.write_text(s.replace(old,new,1))
print('stress Telegram chat ids now use chat parameter, not update id')
