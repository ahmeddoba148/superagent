# سند — Sanad V12

## الهدف
سند ليس بوت أوامر. هو مساعد شخصي Agent يعتمد عليه لإدارة الحياة اليومية من اللغة الطبيعية، مع ذاكرة مستمرة، أدوات فعلية، تنفيذ قابل للتحقق، ومبادرة ذكية.

## المبادئ غير القابلة للتفاوض

1. **عقل واحد**: كل رسالة تدخل Agent Loop واحد. لا يوجد سباق بين Regex handlers أو مسارات متوازية متضاربة.
2. **State is truth**: D1 والحالة الفعلية هما الحقيقة. كلام الموديل لا يثبت أن عملية تمت.
3. **No success without proof**: أي create/update/delete/move/add لا يقال عنه "تم" إلا بعد تنفيذ الأداة ثم قراءة الحالة والتحقق منها.
4. **Tool-first agency**: الموديل يختار الأدوات ويستدعيها حسب الهدف، وليس حسب صيغة محفوظة من المستخدم.
5. **Plan → Act → Observe → Verify → Repair → Reply**: حلقة تنفيذ متعددة الخطوات، مع إصلاح ذاتي قبل الرد.
6. **ذاكرة طبقية**: working memory + episodic memory + semantic memory + preferences + people/entities + commitments.
7. **سياق طبيعي**: دعم المراجع مثل "اللي قولتلك عليه امبارح"، "ضيف كمان اتنين"، "بعدها بيوم" بدون تلقين صيغة ثابتة.
8. **Idempotency & transactions**: كل mutation لها operation id، receipt، rollback/compensation عند الحاجة، ومنع false-success والتكرار.
9. **Safety خارج الموديل**: السياسات الحساسة والحذف الكبير والصلاحيات تحكمها guards حتمية، وليس اجتهاد الموديل.
10. **Proactive but useful**: سند يبادر فقط عند وجود قيمة حقيقية: موعد، تعارض، انتظار، نقص، التزام، حدث متوقع أو معلومة لازمة للقرار.

## المعمارية

User/Telegram
→ Durable Inbox + Per-Chat Serialization
→ Context Builder
→ Sanad Brain
→ Planner
→ Tool Calls
→ Tool Runtime
→ D1 / APIs / Memory
→ State Verifier
→ Repair Loop (عند الفشل أو عدم التطابق)
→ Response Composer
→ Telegram

## Sanad Brain

### 1) Context Builder
يبني سياقًا قصيرًا ودقيقًا لكل رسالة من:
- آخر المحادثة ذات الصلة فقط
- الحالة الحالية: المواعيد، المشتريات، المشاريع، الانتظارات
- ذكريات مرتبطة بالسؤال
- الأشخاص/الأماكن/العلاقات ذات الصلة
- الوقت والمكان الحاليان عند الحاجة

### 2) Planner
يعيد خطة structured لا نصًا حرًا فقط:
- goal
- assumptions
- steps
- tools
- expected state changes
- verification requirements
- risk level
- whether clarification is truly required

### 3) Tool Runtime
أدوات صغيرة وواضحة، منها:
- shopping.read / add / update / remove / mark / clear
- reminders.read / create / update / cancel / snooze
- schedule.read / create / move / free_time / conflicts
- memory.search / remember / forget
- people.resolve / relationships.read
- projects.read / create / update
- waiting.read / create / close
- live.lookup
- prayer.read
- holidays.read
- audit.read / undo

كل tool ترجع نتيجة machine-readable تشمل:
- ok
- changed
- before
- after
- entity ids
- verification hints
- retryable
- error class

### 4) Verifier
بعد أي mutation:
- يعمل read-back من المصدر الحقيقي
- يقارن expected state بالـactual state
- يمنع الرد بنجاح لو غير متطابق
- يعيد التخطيط أو rollback عند الحاجة

## قاعدة النجاح

**لا توجد جملة "تم" أو "ضفت" أو "اتعدل" إلا إذا verifier=PASS.**

مثال مشتريات:
المستخدم: "بكره هات لبن وعيش وتورتيلا وخلي القهوة اتنين"

سند:
1. يفهم أن المطلوب mutation للمشتريات.
2. يقرأ القائمة الحالية.
3. يحل المراجع والكميات.
4. ينفذ transaction.
5. يقرأ القائمة من D1 مرة أخرى.
6. يتحقق من وجود لبن + عيش + تورتيلا وأن القهوة=2.
7. فقط بعدها يرد بالنتيجة.

## الذاكرة

### Working Memory
سياق الجلسة الحالية.

### Episodic Memory
أحداث فعلية حدثت: طلبات، قرارات، تغييرات، متابعات.

### Semantic Memory
حقائق مستقرة عن المستخدم، الأشخاص، الأماكن، الأشياء، التفضيلات.

### Commitments
كل ما "لازم يحصل": موعد، تذكير، انتظار رد، مشتريات، مهمة، وعد، متابعة.

### Memory Confidence
كل ذاكرة لها source + confidence + last_confirmed_at، ولا يتم تحويل استنتاج ضعيف إلى حقيقة ثابتة.

## الشخصية

الاسم: **سند (Sanad)**

الطابع:
- مصري طبيعي، بدون لغة روبوتية
- مختصر افتراضيًا، ويتوسع عند الحاجة
- لا يكرر كلام المستخدم
- لا يعلن تفاصيل داخلية مثل أسماء الموديلات أو الـplanner
- لا يدعي نجاحًا غير مثبت
- يتصرف كمساعد شخصي مسؤول لا كواجهة أوامر

## الموديلات

الموديلات ليست هي المنتج. Sanad يستخدم model chain قابلة للتبديل خلف Brain API. الهدف هو أن تغيير الموديل لا يغير الأدوات أو الذاكرة أو قواعد التحقق.

## ما سنحتفظ به من V11

- Cloudflare Worker/D1 foundation
- Durable Telegram inbox
- per-chat serialization
- idempotency ledger
- leases/recovery
- audit/undo primitives المفيدة
- Telegram auth/admin boundaries

## ما سيتم إلغاؤه من العقل القديم

- Regex-first intent routing
- تعدد direct-command brains
- layered function overrides كطريقة تطوير أساسية
- success messages قبل read-back verification
- الاعتماد على prompt لصحة state mutation
- مسارات مشتريات متعددة غير موحدة

## بوابات الاعتماد لـ V12

لا تسمى النسخة Final إلا عند اجتياز:
- Syntax: 0
- TypeScript/JS diagnostics: 0
- Unit tests
- State-machine tests
- transaction rollback tests
- idempotency tests
- concurrency/lease tests
- memory retrieval tests
- reference-resolution tests
- multi-step agent tests
- false-success tests: 0
- live Telegram + D1 matrix
- adversarial Egyptian-Arabic tests
- shopping: natural phrasing / corrections / quantities / follow-ups / undo / simultaneous requests

## معيار النجاح الحقيقي

المعيار ليس "فهم الجملة" فقط. المعيار:

**هل يقدر المستخدم يتكلم بطبيعته، وسند يفهم الهدف، ينفذ بالترتيب الصحيح، يتحقق من الحقيقة، يصلح نفسه إن لزم، ويتذكر ما ينبغي تذكره — بدون تلقين؟**

إذا لم يتحقق ذلك، فالنسخة ليست V12 Final.
