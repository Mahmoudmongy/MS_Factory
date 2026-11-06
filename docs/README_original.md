# مدير المصنع V4 - Factory Manager

نظام ERP كامل لإدارة المصانع — يشتغل 100% Offline على الكمبيوتر والموبايل الأندرويد.

## ✅ ما الذي تم إصلاحه وتنظيفه؟

### كفريق برمجة كامل اشتغلت على:

#### 1. **Mobile عرض 100%**
- إصلاح Sidebar: كان فيه `function closeSB()` مكررة بتكسر القائمة، حذفت النسخة القديمة وخليت نسخة واحدة مع Overlay + blur + منع scroll للـ body
- تحويل `translateX(100%)` إلى `102%` مع `!important` عند الفتح لضمان الظهور
- إضافة `#sb-overlay` مع `z-index:25` يغلق القائمة عند الضغط خارجها
- كل inputs أصبحت `min-height:48px` و `font-size:16px` لمنع زووم تلقائي في iOS/Android
- جداول: `display:block; overflow-x:auto; -webkit-overflow-scrolling:touch`
- Tabs: scroll أفقي مع `max-width:140px`
- أزرار: `min-height:46px` للمس المريح
- منع double-tap zoom

#### 2. **تنظيف كود**
- حذف `closeSB` المكرر
- دمج كود Mobile UX في مكان واحد
- تنظيم CSS بمتغيرات و shadows موحدة
- فصل الملفات: `index.html` + `css/style.css` + `js/app.js`

#### 3. **PWA للأندرويد**
- `manifest.json` + `sw.js` + أيقونات 72-512
- يشتغل كتطبيق مثبت: Chrome > ⋮ > تثبيت التطبيق
- يعمل Offline تماما

#### 4. **اختبارات**
- `tests.html` يفحص 12 نقطة أساسية

## 📁 هيكلة المشروع الجاهزة لـ GitHub

```
factory-manager/
├── index.html          # الواجهة (RTL, PWA Ready)
├── css/style.css       # ستايل نظيف Responsive
├── js/app.js           # منطق كامل منظف
├── js/modules/         # وحدات مساعدة
├── manifest.json
├── sw.js
├── assets/
│   ├── icon.svg
│   └── icon-*.png
├── tests.html          # صفحة اختبارات
└── README.md
```

## 🚀 الرفع على GitHub

```bash
git init
git add .
git commit -m "Factory Manager V4 - Mobile Ready PWA"
git branch -M main
git remote add origin https://github.com/YOURNAME/factory-manager.git
git push -u origin main
```

لتفعيل GitHub Pages:
Settings > Pages > Source: main / root > Save
رابطك هيبقى: https://YOURNAME.github.io/factory-manager/

## 📱 موبايل أندرويد

1. افتح الرابط في Chrome
2. دوس ⋮ > Install / إضافة إلى الشاشة الرئيسية
3. هيفتح كتطبيق مستقل بدون شريط المتصفح

## 🧪 الاختبار

افتح `tests.html` بعد فتح `index.html` مرة واحدة (عشان يحمل app.js)

## ⚙️ وظائف النظام

- عملاء / موردين + محافظات ومدن مصر + كشف حساب
- فواتير بيع/شراء/مرتجع + PDF
- سندات قبض/دفع مرتبطة بفواتير محددة
- مخزون + مستودعات + باركود + ملصقات
- إنتاج + شحنات + مصروفات + مرتبات
- تقارير + نسخ احتياطي JSON

كل الوظائف شغالة 100% - لم يتم حذف أي شيء.
