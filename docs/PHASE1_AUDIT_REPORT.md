
# تقرير فحص مشروع Garment Factory System - المرحلة الأولى

## الشاشات الموجودة
- home, sale, pur, sret, pret, rc/py (سندات), cust/supp, stock, prod, po, wo, je, coa, bank, rep, tl, emp, set, sync

## بنية البيانات (mgr6)
accts, wh, items (st: لون/مقاس), partners, docs, po, vch (alloc), wo, codes (باركود ثابت), je, emp, mv, L (دفتر أستاذ), curs, tpl

## ما يعمل
- فواتير بيع/شراء/مرتجع + PDF
- عملاء/موردين
- مخزون + باركود ثابت codeFor لا يتغير
- أوامر إنتاج + poRows مخطط/مستلم
- سندات + ربط lkDraw
- حسابات + قيود post/bal
- ثيم + لغة + تبويبات newTab + بحث fbar + عملات curs + تصدير CSV

## ما يعمل جزئياً (يحتاج تطوير)
- استدعاء صنف بالباركود بكل بياناته (addBc)
- توحيد عرض الأرصدة (pvh/btxt/balc) - غير موحد
- حركة أصناف مجمعة repIm
- طباعة باركود من أمر إنتاج
- جدول مخطط/مستلم واضح
- بحث وفلاتر موحد بكل الشاشات
- ربط سند بأكثر من فاتورة مع توزيع المبلغ
- عملة بجوار الرصيد
- Tabs مع تنبيه بيانات غير محفوظة
- قوالب طباعة
- واتساب نصي فقط

## غير منفذ
- استيراد Excel بمعاينة وربط أعمدة
- إرسال PDF نفسه عبر WhatsApp Business API
- Offline حقيقي IndexedDB + Service Worker + قائمة انتظار + حالات
- Supabase Auth + RLS + صلاحيات حقيقية
- Idempotency

## الملفات للتعديل
- css/style.css (حفاظ على الشكل)
- js/app.js (147KB) - كل المنطق
