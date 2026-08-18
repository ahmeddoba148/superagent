from pathlib import Path
import re,sys
p=Path(sys.argv[1] if len(sys.argv)>1 else 'SuperAgent_V10_4_3_Full_Arabic.js')
s=p.read_text(encoding='utf-8')

# Remove the centralized localization map itself: its regexes intentionally name English tokens
# so they can translate them at the final Telegram boundary.
for fn in ['localizeUserFacingArabicV1043','localizeTelegramPayloadV1043']:
    m=re.search(rf'function\s+{fn}\s*\([^)]*\)\s*\{{',s)
    if m:
        i=m.start(); j=m.end(); depth=1
        while j < len(s) and depth:
            if s[j]=='{': depth+=1
            elif s[j]=='}': depth-=1
            j+=1
        s=s[:i]+(' '*(j-i))+s[j:]

# Extract string/template literals. This is conservative but sufficient for UI copy auditing.
pat=re.compile(r'(?P<q>["\'`])(?P<body>(?:\\.|(?!\1).)*?)(?P=q)',re.S)

banned=[
    r'\bSuper Agent\b',r'\bWorld Model\b',r'\bLife OS\b',r'\bData Controls\b',r'\bUltra Hardened\b',
    r'\bInbox\b',r'\bTo[-‑ ]?Do\b',r'\bTelegram\b',r'\bOmniAI\b',r'\bGroq\b',r'Audio Transcription',
    r'\bVerifier\b',r'Undo failed',r'Local datetime',r'Africa/Cairo',r'\bEgypt\b',r'\bCairo\b',r'\(EG\)',
    r'\bis ready\b',r'Unauthorized',r'Bad Request',r'Not Found',r'setWebhook failed'
]
banned_re=[re.compile(x,re.I) for x in banned]

sql_prefix=re.compile(r'^\s*(CREATE\s+(?:TABLE|INDEX)|SELECT\s|INSERT\s+INTO|UPDATE\s|DELETE\s+FROM|PRAGMA\s|ALTER\s+TABLE)',re.I)
internal_exact=re.compile(r'^[A-Za-z0-9_./:@?=&%{}$<>\-]+$')

def plausible_ui(body,near):
    if sql_prefix.search(body): return False
    if 'SELECT ' in body or 'CREATE TABLE ' in body or 'INSERT INTO ' in body or 'UPDATE ' in body or 'DELETE FROM ' in body: return False
    if re.search(r'\\[dDsSwWbB]|RegExp\(|\(\?:|\[A-Za-z',body): return False
    if internal_exact.fullmatch(body.strip()): return False
    # Callback data / provider ids / HTTP endpoints / model ids are implementation details.
    if any(x in body for x in ['callback_data','gemini::','groq::','mistral::','nvidia::','https://','api.telegram.org','omniai-engine']): return False
    has_ar=bool(re.search(r'[\u0600-\u06FF]',body))
    ui_context=any(k in near for k in ['sendText','editOrSend','sendMessage','description:','question','reply','lines.push','lines=[','text:`','text:"','caption'])
    prose=bool(re.search(r'\s',body))
    return has_ar or (ui_context and prose)

fails=[]; checked=0
for m in pat.finditer(s):
    body=m.group('body')
    if len(body)>1200: continue
    near=s[max(0,m.start()-220):min(len(s),m.end()+220)]
    if not plausible_ui(body,near): continue
    checked+=1
    for rx in banned_re:
        if rx.search(body):
            fails.append((rx.pattern,body.replace('\n',' ↵ ').replace('\\n',' ↵ ')[:500]))

print(f'ARABIC_UI_LITERALS_CHECKED {checked}')
if fails:
    print(f'ARABIC_UI_FAILURES {len(fails)}')
    for i,(rx,body) in enumerate(fails[:100],1): print(f'{i:03d} [{rx}] {body}')
    raise SystemExit(1)
print('ARABIC_UI_FAILURES 0')
print('PASS')
