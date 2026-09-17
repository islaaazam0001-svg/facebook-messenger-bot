# بوت فيسبوك ماسنجر - Gemini AI

## المتغيرات (Environment Variables) اللي خاصك تحط فـ Render

| الاسم | وين تجيبو |
|---|---|
| `VERIFY_TOKEN` | اختار كلمة سر بروحك (مثلاً: monBot2026) - غادي تحطها هي هي فـ Meta Developer Console |
| `PAGE_ACCESS_TOKEN` | من Meta for Developers > صفحتك > Messenger > Access Tokens |
| `GEMINI_API_KEY` | من aistudio.google.com > Get API Key |

## خطوات النشر على Render

1. حط هاد الملفات فـ GitHub repo جديد (أو ارفعهم مباشرة إذا Render يسمح بالـ zip)
2. فـ Render: New > Web Service > اربطو بـ GitHub repo ديالك
3. Build Command: `npm install`
4. Start Command: `npm start`
5. زيد الـ 3 Environment Variables فوق
6. Deploy

## ربط Meta for Developers

1. روح لـ developers.facebook.com > App ديالك > Messenger > Settings
2. فـ "Webhook" حط:
   - Callback URL: `https://your-app-name.onrender.com/webhook`
   - Verify Token: نفس القيمة اللي حطيتي فـ VERIFY_TOKEN
3. فـ "Webhook Fields" فعل: `messages`, `messaging_postbacks`
4. اربط الصفحة ديالك (Page Subscriptions)

## تجربة محلية (اختياري)

```bash
npm install
PORT=3000 VERIFY_TOKEN=test PAGE_ACCESS_TOKEN=xxx GEMINI_API_KEY=xxx npm start
```
