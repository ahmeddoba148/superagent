from pathlib import Path
import re
src=Path('SuperAgent_V10_4_2_Data_Controls.js')
out=Path('SuperAgent_V10_4_3_Full_Arabic.js')
s=src.read_text(encoding='utf-8')

s=s.replace('const V10_VERSION="10.4.2";const V10_NAME="Super Agent V10.4.2 — Life OS · Data Controls · Ultra Hardened";',
'''const V10_VERSION="10.4.3";const V10_NAME="سوبر إيجنت 10.4.3 — نظام الحياة · إدارة البيانات · نسخة شديدة التحمل";''',1)
s=s.replace('message:"Super Agent V10.4.2 Data Controls is ready"','message:"سوبر إيجنت 10.4.3 جاهز للعمل"',1)

repls={
'تشغيل Super Agent':'تشغيل سوبر إيجنت','🎛️ Super Agent V10 — Life OS':'🎛️ سوبر إيجنت — نظام الحياة',
'📥 Inbox':'📥 صندوق الوارد','Inbox:':'صندوق الوارد:','الـInbox':'صندوق الوارد','للـInbox':'لصندوق الوارد',
'World Model':'نموذج العالم','الـWorld Model':'نموذج العالم','كيانات في نموذج العالم':'كيانات نموذج العالم',
'Super Agent فاكرها عنك':'سوبر إيجنت فاكرها عنك','🛒 افتح To‑Do':'🛒 افتح قائمة التسوق',
'Undo failed':'فشل التراجع','Verifier رفض':'المتحقق رفض','Local datetime غير صالح':'التاريخ والوقت المحليان غير صالحين',
'Telegram request failed':'فشل طلب تيليجرام','Telegram returned non-JSON':'أعاد تيليجرام استجابة غير صالحة',
'مقدرتش أحمل الفويس من Telegram.':'مقدرتش أحمل الرسالة الصوتية من تيليجرام.',
'محرك OmniAI لم ينجح في تفريغ الفويس. تأكد إن Groq/مزود Audio Transcription مفعّل داخل OmniAI.':'محرك الذكاء لم ينجح في تحويل الرسالة الصوتية إلى نص. تأكد إن مزود تحويل الصوت إلى نص مفعّل.',
'V10.4 compound shopping rollback failed':'فشل التراجع عن عملية المشتريات المركبة',
'V10.4 confirmed compound rollback failed':'فشل التراجع عن العملية المركبة المؤكدة',
'world model noncritical':'نموذج العالم غير الحرج',
}
for a,b in repls.items(): s=s.replace(a,b)
for a,b in {
'"Unauthorized"':'"غير مصرح"','"Bad Request"':'"طلب غير صالح"','"Not Found"':'"غير موجود"',
'"setWebhook failed"':'"فشل إعداد رابط تيليجرام"','"Missing bindings"':'"إعدادات الربط المطلوبة ناقصة"',
'"DB binding missing"':'"ربط قاعدة البيانات غير موجود"','"DB probe failed"':'"فشل فحص قاعدة البيانات"',
'"Unknown failure"':'"خطأ غير معروف"','"Audit commit failed; shopping list restored: ':'"فشل تسجيل العملية وتمت استعادة قائمة المشتريات: '
}.items(): s=s.replace(a,b)

status_map='''
function localizeUserFacingArabicV1043(value){
  let t=String(value??"");
  const pairs=[
    [/\\bWorld Model\\b/gi,"نموذج العالم"],[/\\bLife OS\\b/gi,"نظام الحياة"],[/\\bInbox\\b/gi,"صندوق الوارد"],
    [/\\bSuper Agent\\b/gi,"سوبر إيجنت"],[/\\bData Controls\\b/gi,"إدارة البيانات"],[/\\bUltra Hardened\\b/gi,"شديد التحمل"],
    [/\\bTo[-‑ ]?Do\\b/gi,"قائمة التسوق"],[/\\bTelegram\\b/gi,"تيليجرام"],[/\\bVerifier\\b/gi,"المتحقق"],
    [/\\bUndo failed\\b/gi,"فشل التراجع"],[/\\bLocal datetime\\b/gi,"التاريخ والوقت المحليان"],
    [/\\bOmniAI\\b/gi,"محرك الذكاء"],[/\\bGroq\\b/gi,"مزود الصوت"],[/Audio Transcription/gi,"تحويل الصوت إلى نص"],
    [/\\bpending\\b/gi,"قيد الانتظار"],[/\\bbought\\b/gi,"تم الشراء"],[/\\bunavailable\\b/gi,"غير متاح"],[/\\bskipped\\b/gi,"تم التخطي"],
    [/\\bwaiting\\b/gi,"بانتظار الرد"],[/\\bopen\\b/gi,"مفتوح"],[/\\bactive\\b/gi,"نشط"],[/\\bpaused\\b/gi,"متوقف مؤقتًا"],
    [/\\bsafe_auto\\b/gi,"تلقائي آمن"],[/\\bconfirmed\\b/gi,"مؤكد"],[/\\bcommitted\\b/gi,"تم التنفيذ"],
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

m=re.search(r'async\s+function\s+telegramApi\s*\(([^)]*)\)\s*\{',s)
if not m: raise SystemExit('telegramApi function not found')
pos=m.start();s=s[:pos]+status_map+'\n'+s[pos:]
m=re.search(r'(async\s+function\s+telegramApi\s*\(([^)]*)\)\s*\{)',s)
params=[x.strip() for x in m.group(2).split(',')]
if len(params)<3: raise SystemExit('telegramApi has fewer than 3 params')
method_name=params[1].split('=')[0].strip(); payload_name=params[2].split('=')[0].strip()
s=s[:m.start()]+m.group(1)+f'{payload_name}=localizeTelegramPayloadV1043({method_name},{payload_name});'+s[m.end():]

arabic_rule='''\nقاعدة لغة إلزامية: كل رد مرئي للمستخدم يجب أن يكون بالعربية فقط وبأسلوب مصري طبيعي عند المناسب. لا تستخدم كلمات أو عناوين إنجليزية إذا كان لها مقابل عربي واضح. يُسمح فقط بالأسماء التي يكتبها المستخدم، الروابط، الأكواد، أو أوامر تيليجرام التقنية مثل /start.\n'''
for marker in ['أنت Super Agent','أنت سوبر إيجنت','لهجة مصرية','مصري']:
    idx=s.find(marker)
    if idx>=0:
        s=s[:idx]+s[idx:].replace(marker,marker+arabic_rule,1);break

for a,b in {
'🧠 World Model':'🧠 نموذج العالم','✅ امسح World Model':'✅ امسح نموذج العالم','📥 Inbox':'📥 صندوق الوارد',
'📥 تمام، حطيتها في الـInbox.':'📥 تمام، حطيتها في صندوق الوارد.','إضافة للـInbox:':'إضافة لصندوق الوارد:',
'🧠 عالمى وذاكرتي':'🧠 عالمي وذاكرتي','Super Agent':'سوبر إيجنت','Life OS':'نظام الحياة','Data Controls':'إدارة البيانات','Ultra Hardened':'شديد التحمل',
'الـنموذج العالم':'نموذج العالم','للـصندوق الوارد':'لصندوق الوارد','إضافة للـصندوق الوارد':'إضافة لصندوق الوارد'
}.items(): s=s.replace(a,b)

out.write_text(s,encoding='utf-8')
print('built',out,len(out.read_bytes()),'telegram payload param',payload_name)
