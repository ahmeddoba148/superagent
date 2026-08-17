# سند — Sanad V12

## الهدف
سند ليس بوت أوامر. هو مساعد شخصي Agent يعتمد عليه لإدارة الحياة اليومية من اللغة الطبيعية، مع ذاكرة مستمرة، أدوات فعلية، تنفيذ قابل للتحقق، ومبادرة ذكية.

## المبادئ غير القابلة للتفاوض
1. عقل واحد: كل رسالة تدخل Agent Loop واحد.
2. State is truth: D1 والحالة الفعلية هما الحقيقة.
3. No success without proof: لا نجاح بدون read-back verification.
4. Tool-first agency: الموديل يختار الأدوات حسب الهدف، لا حسب صيغة محفوظة.
5. Plan → Act → Observe → Verify → Repair → Reply.
6. ذاكرة طبقية وسياق طبيعي.
7. Idempotency + receipts + audit.
8. Safety guards حتمية للعمليات الحساسة.
9. Proactive only when useful.
10. لا تعتبر النسخة نهائية إلا بعد اجتياز CI + live state tests.

## تنفيذ V12 الحالي
الملف التنفيذي: `Sanad_V12_WORKER.js`.

طبقة العقل الجديدة تستخدم Agent Loop واحد مع 20 أداة في مجالات المشتريات، التذكيرات، الوقت الفاضي، الذاكرة، المشاريع، الانتظارات والسجل. كل mutation ترجع نتيجة structured وتُقرأ الحالة من D1 بعد التنفيذ قبل السماح برد نجاح.

## قاعدة النجاح
أي mutation لا تعتبر ناجحة إلا إذا `verified=true` بعد قراءة الحالة الحقيقية.

## الموديلات
- Gemini 3.5 Flash-Lite — Primary
- Gemini 3.1 Flash-Lite — Fallback 1
- Gemini 3.5 Flash — Fallback 2

الموديلات خلف Brain API؛ الأدوات والذاكرة والتحقق مستقلون عن الموديل.

## الاعتماد
Workflow: `.github/workflows/sanad-v12-certify.yml`

الـworkflow يفرض:
- Node syntax check
- TypeScript `checkJs`
- Pure gates
- isolated Cloudflare staging deployment
- `/setup`, `/health`, `/ready`, `/selftest`
- Telegram + D1 live natural-language scenarios
- state verification بعد المشتريات والتذكيرات والذاكرة
- multi-tool request في رسالة واحدة
- idempotency
- zero recorded runtime failures during matrix
- zero unverified critical mutation receipts
