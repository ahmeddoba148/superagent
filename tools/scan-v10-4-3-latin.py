from pathlib import Path
import re,sys
p=Path(sys.argv[1] if len(sys.argv)>1 else 'SuperAgent_V10_4_2_Data_Controls.js')
s=p.read_text(encoding='utf-8')
pat=re.compile(r'(?P<q>["\'`])(?P<body>(?:\\.|(?!\1).)*?)(?P=q)',re.S)
seen=[]
for m in pat.finditer(s):
    body=m.group('body')
    if not re.search(r'[A-Za-z]',body) or len(body)>600: continue
    near=s[max(0,m.start()-160):min(len(s),m.end()+160)]
    mixed=bool(re.search(r'[\u0600-\u06FF]',body))
    prose=bool(re.search(r'\s',body)) and not re.fullmatch(r'[A-Za-z0-9_./:@?=&%{}$<>\-]+',body)
    ui=any(k in near for k in ['sendText','editOrSend','description:','text:','question','reply','return "','return `','lines.push','lines=['])
    if mixed or (prose and ui):
        norm=body.replace('\\n',' ↵ ').replace('\n',' ↵ ')
        if norm not in seen: seen.append(norm)
print('FILE',p)
print('USER_FACING_LATIN_CANDIDATES',len(seen))
for i,x in enumerate(seen,1): print(f'{i:03d}: {x}')
