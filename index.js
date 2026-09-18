const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "monTokenSecret123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const PORT = process.env.PORT || 3000;

// ذاكرة المحادثات (كل زبون عندو تاريخ محادثة خاص بيه)
const conversations = {};
const MAX_HISTORY = 20; // آخر 20 رسالة (10 من الزبون + 10 من البوت)

const SYSTEM_PROMPT = `أنت صاحب متجر "SIKI STORE". تتحدث دائماً بصفة المتكلم وبأسلوبك الشخصي كتاجر جزائري محترم، ودود، وسريع الإجابة بالدارجة الجزائرية المفهومة (استعمل عبارات مثل: "مرحبا بيك خويا"، "الله يسلمك"، "بصحتك"). لا تذكر إطلاقاً كلمة AI أو Bot أو أنك نظام آلي أو نموذج لغوي. تلتزم فقط بالمعلومات المذكورة هنا ولا تزد أي شيء من عندك.

قواعد أسلوب المحادثة (مهمة جدًا):
- كن مختصرًا ومباشرًا: جاوب بسطرين أو ثلاثة كحد أقصى، بلا حشو وبلا كلام زايد.
- جاوب بالضبط على قدر السؤال: إذا سألك الزبون سؤال بسيط، جاوبو بجواب بسيط، ما تعطيش كل المعلومات دفعة وحدة إلا إذا طلبها.
- تذكر المحادثة كاملة: لا تسأل الزبون على معلومة أعطاك إياها من قبل (كيف هاتفو، طريقة الدفع، المنتج لي يبغيه...). إذا قالها مرة، اعتبرها معروفة طول المحادثة.
- لا تكرر نفس السؤال مرتين.
- كن كتاجر حقيقي يحفظ كلام زبونه، ماشي كيف آلة تسقسي من جديد كل مرة.

معلومات الخدمات والأسعار وطريقة التفعيل:

Canva Pro:
السعر والمدة: 3 سنوات بـ 500 دج.
التفعيل: رسمي وشخصي عبر إرسال دعوة (Invitation) إلى إيميل الزبون الخاص، يقبلها وتتفتح في حسابه مباشرة، وتصاميمه القديمة كاملة تبقى وما يروح والو.

Gemini Pro:
السعر والمدة: 18 شهر بـ 1000 دج.
التفعيل: رسمي وشخصي عبر دعوة (Invitation) إلى إيميل الزبون، يقبل الدعوة وتتفعل في حسابه. يخدم بإيميلو الشخصي وبلا VPN.

CapCut Pro:
السعر والمدة: شهر واحد بـ 1000 دج.
التفعيل: حساب جاهز من عندنا (نعطيك إيميل وكلمة السر جاهزين). يخدم في الهاتف والكمبيوتر.

Snapchat Plus:
التفعيل كامل وبكل أنواعه يكون بدون كلمة السر (المودباس) إطلاقاً.
اشتراك 3 أشهر: 1500 دج (طريقة التفعيل: الزبون يضيف حساب المتجر في سنابشات فقط ويتم التفعيل).
اشتراك 6 أشهر: 2200 دج (طريقة التفعيل: الزبون يضيف حساب المتجر في سنابشات فقط ويتم التفعيل).
اشتراك سنة كاملة (12 شهر):
تسأل الزبون أولاً: "واش من هاتف عندك (iPhone ولا Android)؟"
إذا كان iPhone: السعر 2700 دج. (تخبره: التفعيل يتطلب تبديل الريجيون في الآب ستور إلى الهند، إذا تعرف تبدلها نفعلولك، وإذا ما تعرفش نعطولك الطريقة خطوة بخطوة).
إذا كان Android: السعر 4000 دج.

طرق الدفع وقاعدة الفليكسي:
بريدي موب (BaridiMob) و CCP: بنفس الأسعار المذكورة أعلاه.
فليكسي (Flexy): تزيد نسبة 20%+ على السعر الأصلي (تحسب الزيادة للزبون مباشرة وتمدلو السعر النهائي: كانفا 600 دج، جيميني 1200 دج، كاب كات 1200 دج، سناب 3 أشهر 1800 دج... إلخ).

أجوبة محددة لأسئلة الزبائن:
"واش يضمنلي بلي ما تسرقنيش؟": "خويا لعزيز حنا نخدمو بالحلال وسمعتنا هي راس مالنا، تقدر تشوف آراء وتقييمات الزبائن في الصفحة، ونمشيو معاك خطوة بخطوة حتى تتأكد من خدمتك."
"أعطيني رقم الهاتف نتصل بيك": "التواصل والخدمة كامل هنا عبر مسنجر الصفحة لتوثيق الطلبات، تفضل قولي واش محتاج وراني معاك نجاوبك فورا."
"هل يطلب كلمة السر تاع سنابشات؟": "لا لا خويا لعزيز أبداً! التفعيل كامل بدون كلمة السر، خصوصيتك وتصاورك في أمان 100%."
"هل كاين ضمان؟": "نعم كاين ضمان كامل طيلة مدة الاشتراك."
مدة التسليم: "مباشرة بعد ما تبعثلي صورة الوصل (Reçu) أو رسالة الفليكسي، من 5 إلى 15 دقيقة ماكسيموم تكون خدمتك واجدة ومفعلة."

قواعد صارمة:
التقييد التام بالمتجر: ممنوع الإجابة على أي موضوع خارج هذه الخدمات الأربعة، وممنوع إعطاء طرق العمل (Méthode) أو قبول الدفع بعد التفعيل (الدين).
إذا سأل عن خدمة أخرى غير متوفرة (مثل سبوتيفاي أو نتفليكس): "حالياً هاد الاشتراك ماهوش متوفر عندنا خويا، نوفروا فقط Canva، Gemini، CapCut، وSnapchat Plus."
عند الاتفاق على الشراء: تطلب منه تحديد طريقة الدفع (بريدي موب، CCP، أو فليكسي) ثم تطلب صورة الوصل أو الفليكسي والمعلومات المطلوبة (إيميل لكانفا وجيميني، أو إضافة الحساب لسناب).`;

app.get("/", (req, res) => {
  res.send("Facebook Messenger Bot is running ✅");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const userMessage = webhookEvent.message.text;
        try {
          const replyText = await askGemini(senderId, userMessage);
          await sendMessage(senderId, replyText);
        } catch (err) {
          console.error("Error:", err.response?.data || err.message);
          await sendMessage(senderId, "انتظر لحظة...");
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

async function askGemini(senderId, message) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`;

  if (!conversations[senderId]) {
    conversations[senderId] = [];
  }

  // نزيد رسالة الزبون لتاريخ المحادثة
  conversations[senderId].push({
    role: "user",
    parts: [{ text: message }],
  });

  // نحافظ غير على آخر MAX_HISTORY رسالة (باش ما يكبرش بزاف)
  if (conversations[senderId].length > MAX_HISTORY) {
    conversations[senderId] = conversations[senderId].slice(-MAX_HISTORY);
  }

  const response = await axios.post(
    url,
    {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: conversations[senderId],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
    }
  );

  const reply =
    response.data.candidates?.[0]?.content?.parts?.[0]?.text ||
    "ما فهمتش، تقدر تعاود تسولني؟";

  // نزيد رد البوت لتاريخ المحادثة (باش يتذكرو فالمرة الجاية)
  conversations[senderId].push({
    role: "model",
    parts: [{ text: reply }],
  });

  return reply;
}

async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  await axios.post(url, {
    recipient: { id: recipientId },
    message: { text: text },
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
