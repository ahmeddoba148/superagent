from pathlib import Path
p=Path('SuperAgent_V10_7_Universal_Agent.js')
s=p.read_text(encoding='utf-8')

def rep(old,new):
    global s
    if old not in s: raise SystemExit(f'missing finalizer anchor: {old[:120]!r}')
    s=s.replace(old,new,1)

rep(' V10 نظام الحياة: سكرتير شخصي يفهم حياة المستخدم كحالة مستمرة، وليس مجرد بوت تذكيرات. المستخدم يتكلم غالبًا بالمصري.',
    ' V10.7 نظام الحياة: وكيل شخصي شامل يفهم هدف المستخدم ومعناه وسياقه، وينفذ المشتريات والمواعيد والتذكيرات والقوائم والذاكرة والمحادثة كحالة مستمرة. لا تعتمد على تلقين كلمات مفتاحية. المستخدم يتكلم غالبًا بالمصري.')
rep(" | optional=${m.optional==null?'':m.optional}`});",
    " | optional=${m.optional==null?'':m.optional} | created_at=${r.created_at||''}`});")

# Strong anti-hallucination / execution contract near the semantic rules.
rep('30) target في عمليات shopping يجب أن يكون اسم عنصر موجود كما يظهر في سياق القائمة متى كان التعديل على عنصر سابق. يمكنك استخدام __last__ أو __first__ أو __all__ فقط عندما يقصدها المستخدم بوضوح.',
    '30) target في عمليات shopping يجب أن يكون اسم عنصر موجود كما يظهر في سياق القائمة متى كان التعديل على عنصر سابق. يمكنك استخدام __last__ أو __first__ أو __all__ فقط عندما يقصدها المستخدم بوضوح. لا تعتبر مجرد وجود فعل مثل «حط/ضيف/هات» سببًا كافيًا لتذكير؛ حدّد الدومين من المعنى الكامل.')
rep('32) set_meta للمواصفات/الأولوية/المكان/الاختيارية/الملاحظات دون اختراع قيم. replace للاستبدال. mark_bought وmark_pending لحالة الشراء.',
    '32) set_meta للمواصفات/الأولوية/المكان/الاختيارية/الملاحظات دون اختراع قيم. replace للاستبدال. mark_bought وmark_pending لحالة الشراء.\n33) لا تقل للمستخدم «تم» أو «اتنفذ» من داخل التخطيط. التنفيذ الحقيقي فقط هو الذي يقرر رسالة النجاح بعد التحقق من قاعدة البيانات.\n34) لو الرسالة تحتمل مشتريات وتذكير، وجود وقت تنبيه صريح هو الفاصل: من غير وقت صريح ومعنى الكلام شراء/احتياجات => shopping؛ مع وقت صريح وطلب تذكير => schedule.')

p.write_text(s,encoding='utf-8')
print('Finalized V10.7 semantic context and anti-hallucination contract')
