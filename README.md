# Factory Manager — مدير المصنع

تطبيق ويب عربي RTL لإدارة المصنع، يعمل كتطبيق PWA. يشمل الحسابات، العملاء والموردين، الفواتير والمرتجعات، السندات، المخزون، أوامر الإنتاج، التقارير والطباعة.

## البنية
- الواجهة: `index.html`, `css/style.css`, `js/app.js`.
- تسجيل الدخول: Supabase Auth في `auth.html`, `js/auth.js`.
- مزامنة البيانات: `js/cloud-sync.js`.
- الجداول التفصيلية تحفظ العملاء والموردين والفواتير والمنتجات.
- `public.factory_state` تحفظ نسخة كاملة من حالة التطبيق للمدير.
- حماية البيانات عبر RLS وسياسات صلاحيات حسب ملف الموظف.

## ملفات Supabase
```
supabase/schema.sql
supabase/migrations/20261107080100_harden_auth_rls_20261107.sql
supabase/migrations/20261107100000_enforce_employee_permissions_20261107.sql
supabase/functions/create-employee-account/index.ts
supabase/config.toml
```

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
- مزامنة التطبيق المحلي والنسخة الكاملة للمدير تعمل، لكن دمج كل التعديلات المحاسبية التي يجريها الموظفون في نسخة المدير لم يكتمل بعد؛ لا تعتمد على تعدد المستخدمين للكتابة المتزامنة قبل اختباره واستكماله.
