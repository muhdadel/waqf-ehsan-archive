# وقف إحسان — أرشيف الموقع القديم

واجهة أمامية للقراءة فقط، مبنية من تصدير ووردبريس لموقع [وقف إحسان](https://waqfehsan.org.sa).

## الروابط

- المستودع: https://github.com/muhdadel/waqf-ehsan-archive
- الموقع المنشور: https://muhdadel.github.io/waqf-ehsan-archive/

## المحتوى

- تصفح المشاريع والأسعار والخيارات
- المقالات وصفحات التعريف
- ملفات Excel وJSON وTXT في `exports/`
- الوسائط المحلية في `media/uploads/`

## التشغيل محلياً

افتح `index.html`، أو شغّل خادماً بسيطاً:

```bash
npx --yes serve .
```

## إعادة بناء البيانات

```bash
npm install
npm run export
```

## ملاحظات

- لا توجد طلبات حقيقية أو حسابات عملاء في تصدير ووردبريس
- أرقام الطلبات على المنتجات هي عدّاد `total_sales` فقط
