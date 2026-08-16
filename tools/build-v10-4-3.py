from pathlib import Path
import re
src=Path('SuperAgent_V10_4_2_Data_Controls.js')
out=Path('SuperAgent_V10_4_3_Full_Arabic.js')
s=src.read_text(encoding='utf-8')

# Version / branding visible to the user.
s=s.replace('const V10_VERSION="10.4.2";const V10_NAME="Super Agent V10.4.2 — Life OS · Data Controls · Ultra Hardened";',
'''const V10_VERSION="10.4.3";const V10_NAME="سوبر إيجنت 10.4.3 — نظام الحياة · إدارة البيانات · نسخة شديدة التحمل";''',1)
s=s.replace('message:"Super Agent V10.4.2 Data Controls is ready"','message:"سوبر إيجنت 10.4.3 جاهز للعمل"',1)

# Static user-visible product/UI wording.
repls={
'تشغيل Super Agent':'تشغيل سوبر إيجنت',
'🎛️ Super Agent V10 — Life OS':'🎛️ سوبر إيجنت — نظام الحياة',
'📥 Inbox':'📥 صندوق الوارد',
'Inbox:':'صندوق الوارد:',
'الـInbox':'صندوق الوارد',
'للـInbox':'لصندوق الوارد',
'World Model':'نموذج العالم',
'الـWorld Model':'نموذج العالم',
'كيانات في نموذج العالم':'كيانات نموذج العالم',
'🧠 مسح نموذج العالم':'🧠 مسح نموذج العالم',
'Super Agent فاكرها عنك':'سوبر إيجنت فاكرها عنك',
'=== نموذج العالم المترابط (حقائق محفوظة) ===':'=== نموذج العالم المترابط (حقائق محفوظة) ===',
}
for a,b in repls.items(): s=s.replace(a,b)

# Error/setup response strings are also Arabic, even though they are HTTP/admin-facing.
for a,b in {
'"Unauthorized"':'"غير مصرح"',
'"Bad Request"':'"طلب غير صالح"',
'"Not Found"':'"غير موجود"',
'"setWebhook failed"':'"فشل إعداد رابط تيليجرام"',
'"Missing bindings"':'"إعدادات الربط المطلوبة ناقصة"',
'"DB binding missing"':'"ربط قاعدة البيانات غير موجود"',
'"DB probe failed"':'"فشل فحص قاعدة البيانات"',
'"Unknown failure"':'"خطأ غير معروف"',
'"Audit commit failed; shopping list restored: ':'"فشل تسجيل العملية وتمت استعادة قائمة المشتريات: ',
}.items(): s=s.replace(a,b)

# Arabic rendering for internal status labels if they ever reach UI.
status_map='''
function localizeUserFacingArabicV1043(value){
  let t=String(value??"");
  const pairs=[
    [/\bWorld Model\b/gi,"نموذج العالم"],[/\bLife OS\b/gi,"نظام الحياة"],[/\bInbox\b/gi,"صندوق الوارد"],
    [/\bSuper Agent\b/gi,"سوبر إيجنت"],[/\bData Controls\b/gi,"إدارة البيانات"],[/\bUltra Hardened\b/gi,"شديد التحمل"],
    [/\bpending\b/gi,"قيد الانتظار"],[/\bbought\b/gi,"تم الشراء"],[/\bunavailable\b/gi,"غير متاح"],[/\bskipped\b/gi,"تم التخطي"],
    [/\bwaiting\b/gi,"بانتظار الرد"],[/\bopen\b/gi,"مفتوح"],[/\bactive\b/gi,"نشط"],[/\bpaused\b/gi,"متوقف مؤقتًا"],
    [/\bsafe_auto\b/gi,"تلقائي آمن"],[/\bconfirmed\b/gi,"مؤكد"],[/\bcommitted\b/gi,"تم التنفيذ"],
    [/Prophet Muhammad(?:'|’)?s Birthday/gi,"المولد النبوي الشريف ﷺ"],
    [/Islamic New Year/gi,"رأس السنة الهجرية"],[/Eid al[- ]?Fitr/gi,"عيد الفطر المبارك"],[/Eid al[- ]?Adha/gi,"عيد الأضحى المبارك"]
  ];
  for(const [re,v] of pairs)t=t.replace(re,v);
  return t;
}
function localizeTelegramPayloadV1043(method,payload){
  if(!payload||typeof payload!=="object")return payload;
  const p={...payload};
  if(typeof p.text==="string")p.text=localizeUserFacingArabicV1043(p.text);
  if(typeof p.caption==="string")p.caption=localizeUserFacingArabicV1043(p.caption);
  if(Array.isArray(p.commands))p.commands=p.commands.map(x=>({...x,description:localizeUserFacingArabicV1043(x.description||"")}));
  if(p.reply_markup?.inline_keyboard)p.reply_markup={...p.reply_markup,inline_keyboard:p.reply_markup.inline_keyboard.map(row=>row.map(btn=>({...btn,text:localizeUserFacingArabicV1043(btn.text||"")})))};
  return p;
}
'''
# Insert before Telegram helper so all UI paths can call it.
anchor='async function telegramApi('
pos=s.find(anchor)
if pos<0:
    # Some builds use a normal function declaration; locate broad signature.
    m=re.search(r'(?:async\s+)?function\s+telegramApi\s*\(',s)
    if not m: raise SystemExit('telegramApi function not found')
    pos=m.start()
s=s[:pos]+status_map+'\n'+s[pos:]

# Centralize localization at Telegram API boundary, preserving callback_data / technical ids.
# Handles the common signature telegramApi(env,method,payload,...).
patterns=[
    (r'(async function telegramApi\(env,method,payload[^)]*\)\{)',r'\1payload=localizeTelegramPayloadV1043(method,payload);'),
    (r'(function telegramApi\(env,method,payload[^)]*\)\{)',r'\1payload=localizeTelegramPayloadV1043(method,payload);')
]
changed=False
for pat,rep in patterns:
    s2,n=re.subn(pat,rep,s,count=1)
    if n: s=s2;changed=True;break
if not changed: raise SystemExit('telegramApi signature patch failed')

# Ensure AI system instructions require Arabic-only user replies. Add to every system-prompt marker we know,
# and also introduce a shared rule that builders can interpolate where prompts mention Egyptian dialect.
arabic_rule='''\nقاعدة لغة إلزامية: كل رد مرئي للمستخدم يجب أن يكون بالعربية فقط وبأسلوب مصري طبيعي عند المناسب. لا تستخدم كلمات أو عناوين إنجليزية إذا كان لها مقابل عربي واضح. يُسمح فقط بالأسماء التجارية التي يكتبها المستخدم، الروابط، الأكواد، أو أوامر تيليجرام التقنية مثل /start.\n'''
# Add after prominent Arabic system prompt phrases; dedupe via first relevant marker.
for marker in ['أنت Super Agent','أنت سوبر إيجنت','لهجة مصرية','مصري']:
    idx=s.find(marker)
    if idx>=0:
        end=s.find('`',idx)
        # Safer: append rule globally to prompts by injecting into callAI content later is brittle; replace marker occurrence with rule-bearing Arabic text.
        s=s[:idx]+s[idx:].replace(marker,marker+arabic_rule,1)
        break

# Visible panel labels and confirmations missed by static replacements.
s=s.replace('🧠 World Model','🧠 نموذج العالم')
s=s.replace('✅ امسح World Model','✅ امسح نموذج العالم')
s=s.replace('📥 Inbox','📥 صندوق الوارد')
s=s.replace('📥 تمام، حطيتها في الـInbox.','📥 تمام، حطيتها في صندوق الوارد.')
s=s.replace('إضافة للـInbox:','إضافة لصندوق الوارد:')
s=s.replace('🧠 عالمى وذاكرتي','🧠 عالمي وذاكرتي')

out.write_text(s,encoding='utf-8')
print('built',out,len(out.read_bytes()))
