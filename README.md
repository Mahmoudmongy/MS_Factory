# Factory Manager — مدير المصنع (2.0.1)

تطبيق ويب ثابت (PWA) عربي RTL لإدارة المصنع: فواتير ومرتجعات، سندات، مخزون وباركود، أوامر إنتاج، تقارير، قوالب طباعة، استيراد وتصدير.

> **الحالة:** واجهة فقط. البيانات تُحفظ في المتصفح (`localStorage`) على الجهاز نفسه. **لا يوجد في هذا المشروع** خادم ولا Supabase ولا مزامنة ولا صلاحيات حقيقية. التفاصيل في `docs/AUDIT_AND_FIX_REPORT.md`.

## الهيكل
```
index.html  css/style.css  js/app.js     # التطبيق (نسخة التشغيل الوحيدة)
sw.js  manifest.json  assets/            # PWA (غلاف التطبيق offline)
tests/run.js                             # اختبارات حقيقية على الكود نفسه
docs/                                    # تقرير المراجعة + التقارير السابقة
_archive_duplicates/                     # الملفات المكررة/القديمة (لم يُحذف شيء) + ARCHIVE_MANIFEST.md
```

## التشغيل والاختبار
```bash
npm install
npx playwright install chromium
npm test          # 68 فحصًا (حسابات، مخزون، إنتاج، صلاحيات، تكرار، استيراد، PWA offline، موبايل)
npm run serve     # http://localhost:8080
```
الـ Service Worker يعمل على `localhost` أو HTTPS فقط. لإنشاء `package-lock.json` شغّل `npm install` مرة واحدة.

## ملاحظات
- لا تضع أسرارًا في المستودع؛ `.env.example` قيم فارغة فقط والتطبيق الحالي لا يقرؤه.
- توليد PDF وقراءة ملفات xlsx يحمّلان مكتبات من cdnjs (يحتاجان إنترنت أول مرة).
- الصلاحيات الحالية تخفي الشاشات والأزرار فقط وليست حماية فعلية.
