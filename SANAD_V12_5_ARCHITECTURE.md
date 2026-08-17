# سند — Sanad V12.5 Full-Life Agent

## الهدف
V12.5 هو دمج **عقل V12 الواحد** مع القدرات العملية التي تراكمت في V11، لكن من غير رجوع لمعمارية regex-first أو layered overrides.

## الدورة الأساسية
**Understand → Plan → Critic → Act → Observe → Verify → Repair → Atomic Commit/Rollback → Reply**

## قواعد لا تقبل التفاوض
1. D1 والحالة الفعلية هي الحقيقة، وليس كلام الموديل.
2. لا نجاح لأي mutation بدون read-back verification.
3. الخطة المركبة ذرية قدر الإمكان: أي خطوة تغيير تفشل أو لا يمكن إثباتها تعيد snapshot ما قبل العملية.
4. كل update له operation id + receipts تمنع التكرار بعد retries/crashes.
5. العمليات الحساسة مثل clear/forget/undo الشامل تحتاج تأكيدًا صريحًا في المحادثة.
6. كل مستخدم معزول بالـchat_id، مع durable inbox وD1 lease للتسلسل عبر isolates.
7. V11 data migration best-effort/idempotent إلى جداول Sanad الجديدة.

## الأدوات — 64 Tool
### المشتريات
read/add/update/remove/clear/session start/session finish/progress.

### المواعيد والتذكيرات
read/create/update/cancel/snooze، advance alerts، appointments durations، conflict guard.

### التكرارات
read/create/update/pause/resume/skip/cancel مع minutes/hours/days/weeks/months/years، weekdays/monthdays/months، start/end/max occurrences، exceptions، advance alerts.

### الجدول
free_time/conflicts/search/shift/bulk_shift، ويشمل recurring occurrences.

### العلاقات
read/create/remove dependencies مع propagation عند تحريك المصدر.

### الذاكرة ونموذج العالم
memory search/remember/forget + world entities/links/forget.

### المشاريع والمتابعة
projects + project tasks + waiting-for lists.

### الملف الشخصي والإعدادات
الموقع، المنطقة الزمنية، المدينة، البلد، autonomy، proactive mode، morning/evening briefs، deep reasoning mode.

### الصلاة والواقع المحلي
prayer times + prayer rules + skip/cancel/update، holidays، weather.

### الواقع الحي
live news + persistent watches.

### المراجعة والنظام
audit/read، undo snapshots، system status، clear all.

## Reliability
- Durable Telegram inbox.
- Cross-isolate D1 lease.
- Retryable inbox مع إعادة فتح update ledger عند المحاولة التالية.
- Idempotent step receipts.
- Pre-mutation durable snapshot قبل أول تغيير.
- Commit marker بعد نجاح الخطة كاملة.
- Rollback على أي mutation فاشلة أو غير verified.
- Rate limiting.
- Runtime failure ledger.

## Scheduler
Scheduled worker يدير:
- one-time reminders + advance alerts
- recurring rules
- prayer-relative rules
- morning/evening briefs
- proactive soon reminders
- overdue waiting items
- live watch polling
- inbox recovery

## External APIs
- AlAdhan Prayer Times API.
- Open-Meteo forecast + geocoding.
- Nager.Date Holiday API v4.
- GDELT DOC 2.0 for live news.

## Release Gate
لا تعتمد النسخة إلا بعد:
- `node --check` = 0
- TypeScript 5.8.3 checkJs = 0 diagnostics
- static/pure invariants
- protected deep deterministic selftest on real D1
- live Telegram natural-language state matrix
- duplicate + same-chat burst tests
- false-success audit = 0
- runtime failures = 0 within certification run
