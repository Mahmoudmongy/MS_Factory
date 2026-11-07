# Factory Manager — مدير المصنع

تطبيق ويب عربي RTL لإدارة المصنع، يعمل كتطبيق PWA. يشمل الحسابات، العملاء والموردين، الفواتير والمرتجعات، السندات، المخزون، أوامر الإنتاج، التقارير والطباعة.

## البنية
- الواجهة: `index.html`, `css/style.css`, `js/app.js`.
- تسجيل الدخول: Supabase Auth في `auth.html`, `js/auth.js`.
- مزامنة البيانات: `js/cloud-sync.js`.
- `public.factory_state` تحفظ نسخة كاملة من حالة التطبيق للمدير.
- حماية البيانات عبر RLS وسياسات صلاحيات حسب ملف الموظف.

## ملفات Supabase
- `supabase/schema.sql`: مخطط الأساس الذي تم تطبيقه على المشروع قبل ربط سجل migrations.
- `supabase/migrations/20261107080100_harden_auth_rls_20261107.sql`: تشديد تسجيل الدخول وRLS.
- `supabase/migrations/20261107081648_enforce_employee_permissions_20261107.sql`: صلاحيات الموظفين على مستوى قاعدة البيانات.
- `supabase/legacy/`: نسخة تاريخية من migration الأساس؛ ليست ضمن مسار migrations النشط.
- `supabase/functions/create-employee-account/index.ts`: إنشاء حسابات الفريق.

## التشغيل والاختبار
```bash
npm install
npx playwright install chromium
npm test
npm run serve
```

## ملاحظات تشغيلية
- استخدم مفتاح `anon` أو `publishable` العام في المتصفح فقط. لا تضع مفتاح `service_role` أو أي Secret في ملفات الواجهة.
- وظيفة إنشاء حسابات الموظفين تستخدم متغيرات Supabase Edge Functions السرية.
- حماية كلمات المرور المسربة ما زالت تحتاج تفعيلها من إعدادات Supabase Auth.
- النسخة الكاملة للمدير متزامنة، لكن دمج كل التعديلات المحاسبية التي يجريها الموظفون في نسخة المدير لم يكتمل بعد؛ لا تعتمد على تعدد المستخدمين للكتابة المتزامنة قبل استكمال هذا الجزء واختباره.
