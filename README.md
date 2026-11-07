# Factory Manager — مدير المصنع

تطبيق ويب عربي RTL لإدارة المصنع، يعمل كتطبيق PWA. يشمل الحسابات، العملاء والموردين، الفواتير والمرتجعات، السندات، المخزون، أوامر الإنتاج، التقارير والطباعة.

## البنية
- الواجهة: `index.html`, `css/style.css`, `js/app.js`.
- تسجيل الدخول: Supabase Auth في `auth.html`, `js/auth.js`.
- مزامنة البيانات: `js/cloud-sync.js`.
- جداول Supabase التفصيلية تحفظ العملاء والموردين والفواتير والمنتجات.
- النسخة الكاملة لحالة التطبيق تحفظ في `public.factory_state` حتى لا تضيع القيود والسندات والمرتجعات والإنتاج والإعدادات التي لم تُفرد بعد في جداول مستقلة.
- حماية البيانات: RLS في قاعدة البيانات، مع ملكية للمصنع وإتاحة مشاركة بيانات المصنع مع حسابات الفريق التابعة له.
- إنشاء حسابات الموظفين يتم من Edge Function محمية بـ JWT وتتحقق من `profiles.is_admin`.

## ملفات Supabase
```
supabase/schema.sql
supabase/migrations/20261107073709_create_app_tables_with_owner_sharing.sql
supabase/migrations/20261107080100_harden_auth_rls_20261107.sql
supabase/functions/create-employee-account/index.ts
supabase/config.toml
```

## التشغيل والاختبار
```bash
npm install
npx playwright install chromium
npm test
npm run serve
``

## ملاحظات
- مفتاح `sb_publishable_...` أو `anon` مفتاح عام للمتصفح؛ لا تضع مفتاح `service_role` أو أي Secret في ملفات الواجهة أو المستودع.
- وظيفة إنشاء الموظفين تستخدم متغيرات الخادم المدمجة في Supabase Edge Functions.
- حماية كلمات المرور المسربة ما زالت تحتاج تفعيلها من إعدادات Supabase Auth.
- مزامنة الجداول التفصيلية ليست بديلاً عن اختبار كل عملية محاسبية على قاعدة البيانات؛ النسخة الكاملة في `factory_state` تحفظ حالة التطبيق كاملة.
- غلاف PWA يعمل offline، لكن المزامنة تحتاج اتصالاً بالإنترنت.
