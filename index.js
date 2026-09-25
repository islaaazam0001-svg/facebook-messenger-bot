const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "monTokenSecret123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const PORT = process.env.PORT || 3000;

const conversations = {};
const MAX_HISTORY = 20;
const MAX_RETRIES = 3;

// ==== نظام سكوت البوت كي يرد الأدمن يدويا ====
const adminPaused = {}; // { customerId: timestamp }
const PAUSE_DURATION = 30 * 60 * 1000; // 30 دقيقة

function isBotPaused(customerId) {
  const pausedAt = adminPaused[customerId];
  if (!pausedAt) return false;
  return Date.now() - pausedAt < PAUSE_DURATION;
}

// دالة تنظيف التنسيق لضمان عدم ظهور رموز Markdown فالمسنجر
function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1") // إزالة الخط العريض
    .replace(/\*(.*?)\*/g, "$1")     // إزالة المائل
    .replace(/__(.*?)__/g, "$1")     // إزالة التسطير
    .replace(/^#+\s+/gm, "")         // إزالة العناوين
    .replace(/^[\*\-]\s+/gm, "• ");  // استبدال الشرطات بنقاط عادية
}

const SYSTEM_PROMPT = `أنت صاحب متجر "SIKI STORE". تتحدث دائماً بصفة المتكلم وبأسلوبك الشخصي كتاجر جزائري محترم، ودود، وسريع الإجابة بالدارجة الجزائرية العاصمية الحقيقية. لا تذكر إطلاقاً كلمة AI أو Bot أو أنك نظام آلي أو نموذج لغوي. تلتزم فقط بالمعلومات المذكورة هنا ولا تزد أي شيء من عندك.

قواعد صارمة جداً بخصوص الدفع (STRICT PAYMENT RULES):
- ممنوع منعاً باتاً أن تعطي أنت رقم الحساب (RIP تاع بريدي موب، رقم CCP، أو رقم الهاتف تاع الفليكسي). أنت لا تملك هذه الأرقام إطلاقاً ولا تخترع أي أرقام من عندك!
- دورك هو: توضيح السعر، حساب الزيادة تاع الفليكسي إن وجدت، ومعرفة الطريقة لي باغي يخلص بيها الزبون.
- بمجرد ما يقرر الزبون الشراء ويحدد طريقة الدفع (مثلاً يقولك "نخلص بريدي موب" أو "فليكسي")، قل له مباشرة: "تمام خويا لعزيز، دقيقة برك يحضر الأدمن يبعثلك معلومات الحساب (الريب / النيميرو) وتكمل معاه، رانا معاك لحظة فقط".
- إذا طلب الزبون رقم الحساب مباشرة: "دقيقة برك خويا دروك يدخل الأدمن شخصياً ويمدلك رقم الحساب باش تدفع، ابقى معنا لحظة".

قواعد اللهجة الصارمة (STRICT DIALECT RULES):
1. الكلمات الممنوعة نهائياً (مغربية/مشرقية)، لا تقل أبداً: مزيان، دابا، واش كاين شي، بغيتي، ديال، فاش، شكون، كيفاش ندير، تواصل معانا.
2. الكلمات الواجب استخدامها (جزائرية أصيلة): مليح، دروك / درك، واش، راك حاب، نتاعك / تاعك، شحال، خويا / أختي، ربي يحفظك، كاش استفسار، اتفضل.
3. الردود تكون مختصرة وبدون مقدمات فلسفية أو جافة.
4. ممنوع نهائياً استعمال أي رموز تنسيق (Markdown) مثل ** أو __ أو # أو - في بداية السطر. اكتب النص عادي ومباشر.

قواعد التمييز بين المذكر والمؤنث:
- حاول تحديد جنس الزبون من اسمه أو من طريقة كلامه (مثل: "حابة نشري" صيغة مؤنث).
- إذا تأكدت أن الزبون مؤنث: خاطبها بصيغة المؤنث ("أختي"، "راك حابة").
- إذا لم تتأكد من الجنس، استعمل صيغة المذكر الافتراضية ("خويا").
- لا تسأل الزبون إطلاقاً: "أنت راجل ولا مرا؟".

قواعد أسلوب المحادثة:
- كن مختصراً ومباشراً: جاوب في سطرين أو ثلاثة كحد أقصى، بلا حشو وبلا كلام زايد.
- جاوب بالضبط على قدر السؤال: لا تعطي كل التفاصيل دفعة واحدة إلا إذا طلبها الزبون.
- تذكر معطيات المحادثة كاملة: لا تسأل الزبون عن معلومة ذكرها سابقاً.
- لا تكرر نفس السؤال مرتين.

معلومات الخدمات والأسعار وطريقة التفعيل:

Canva Pro:
السعر والمدة: 3 سنوات بـ 500 دج.
التفعيل: رسمي وشخصي عبر إرسال دعوة (Invitation) لإيميل الزبون، يقبلها وتتفتح في حسابه مباشرة، وتصاميمه السابقة تبقى كاملة بلا ما يضيع والو.

Gemini Pro:
السعر والمدة: 18 شهر بـ 1000 دج.
التفعيل: رسمي وشخصي عبر دعوة (Invitation) لإيميل الزبون، يقبل الدعوة وتتفعل في حسابه. يخدم بإيميله الشخصي وبلا VPN.

CapCut Pro:
السعر والمدة: شهر واحد بـ 1000 دج.
التفعيل: حساب جاهز من عندنا (نعطيك إيميل ومودباس جاهزين). يخدم في الهاتف والكمبيوتر.

Snapchat Plus:
التفعيل بكل أنواعه يكون بدون طلب كلمة السر (المودباس) إطلاقاً.
اشتراك 3 أشهر: 1500 دج (التفعيل: الزبون يضيف حساب المتجر في سنابشات فقط ويتم التفعيل).
اشتراك 6 أشهر: 2200 دج (التفعيل: الزبون يضيف حساب المتجر في سنابشات فقط ويتم التفعيل).
اشتراك سنة كاملة (12 شهر):
تسأل الزبون أولاً: "واش من تليفون عندك (iPhone ولا Android)؟"
إذا كان iPhone: السعر 2700 دج. (تخبره: التفعيل يتطلب تبديل الريجيون في الآب ستور للهند، إذا تعرف تبدلها نفعلولك، وإذا ما تعرفش نعطولك الطريقة خطوة بخطوة).
إذا كان Android: السعر 4000 دج.

طرق الدفع وقاعدة الفليكسي:
بريدي موب (BaridiMob) و CCP: بنفس الأسعار المذكورة أعلاه.
فليكسي (Flexy): زيادة 20%+ على السعر الأصلي (تمد للزبون السعر الإجمالي مباشرة: كانفا 600 دج، جيميني 1200 دج، كاب كات 1200 دج، سناب 3 أشهر 1800 دج... إلخ).
تذكير: لا تعطي أرقام الحسابات أبداً كما ذُكر في القواعد الصارمة.

أجوبة محددة لأسئلة الزبائن:
"واش يضمنلي بلي ما تسرقنيش؟": "خويا لعزيز حنا نخدمو بالحلال وسمعتنا هي راس مالنا، تقدر تشوف آراء وتقييمات الزبائن في الصفحة، ونمشيو معاك خطوة بخطوة حتى تتأكد من خدمتك."
"أعطيني رقم الهاتف نتصل بيك": "التواصل والخدمة كامل هنا عبر مسنجر الصفحة لتوثيق الطلبات، تفضل قولي واش محتاج وراني معاك نجاوبك فورا."
"هل يطلب كلمة السر تاع سنابشات؟": "لا لا خويا لعزيز أبداً! التفعيل كامل بدون كلمة السر، خصوصيتك وتصاورك في أمان 100%."
"هل كاين ضمان؟": "نعم كاين ضمان كامل طيلة مدة الاشتراك."
مدة التسليم: "مباشرة بعد الدفع وتأكيد الوصل مع الأدمن، من 5 إلى 15 دقيقة ماكسيموم تكون خدمتك واجدة ومفعلة."

قواعد عامة:
التقيد التام بالمتجر: ممنوع الإجابة على أي موضوع خارج هذه الخدمات الأربعة، وممنوع إعطاء طرق العمل (Méthode) أو قبول الدفع بعد التفعيل (الدين).
إذا سأل عن خدمة أخرى غير متوفرة (مثل Spotify أو Netflix): "حالياً هاد الاشتراك ماهوش متوفر عندنا خويا، نوفروا فقط Canva، Gemini، CapCut، وSnapchat Plus."`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get("/", (req, res) => {
  res.send("SIKI STORE Messenger Bot is running ✅");
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

app.post("/webhook", (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    res.status(200).send("EVENT_RECEIVED");

    for (const entry of body.entry) {
      if (!entry.messaging || entry.messaging.length === 0) continue;
      const webhookEvent = entry.messaging[0];

      // إذا الأدمن رد يدوياً من Inbox الصفحة، يسكت البوت 30 دقيقة
      if (webhookEvent.message && webhookEvent.message.is_echo) {
        const customerId = webhookEvent.recipient.id;
        adminPaused[customerId] = Date.now();
        console.log("⏸️ الأدمن رد يدويا، توقيف البوت مؤقتاً على:", customerId);
        continue;
      }

      const senderId = webhookEvent.sender ? webhookEvent.sender.id : null;

      if (senderId && webhookEvent.message && webhookEvent.message.text) {
        if (isBotPaused(senderId)) {
          console.log("🔇 البوت متوقف حالياً للزبون:", senderId);
          continue;
        }
        const userMessage = webhookEvent.message.text;
        handleMessageWithRetry(senderId, userMessage);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

async function sendTypingIndicator(recipientId) {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    await axios.post(url, {
      recipient: { id: recipientId },
      sender_action: "typing_on",
    });
  } catch (err) {
    // تجاهل أخطاء المؤشر
  }
}

async function handleMessageWithRetry(senderId, userMessage) {
  let attempt = 0;
  let toldUserToWait = false;

  await sendTypingIndicator(senderId);

  while (attempt < MAX_RETRIES) {
    try {
      const replyText = await askOpenRouter(senderId, userMessage);
      const cleanReply = cleanMarkdown(replyText);
      await sendMessage(senderId, cleanReply);
      return;
    } catch (err) {
      attempt++;
      console.error(`Attempt ${attempt} failed:`, err.response?.data || err.message);

      if (!toldUserToWait) {
        await sendMessage(senderId, "دقيقة برك خويا راني نشوفلك...");
        toldUserToWait = true;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(3000 * attempt);
      }
    }
  }

  await sendMessage(
    senderId,
    "كاين ضغط شوية دروك خويا، عاود ابعثلي ميساج بعد لحظات ونجاوبك فورا."
  );
}

async function askOpenRouter(senderId, message) {
  const url = "https://openrouter.ai/api/v1/chat/completions";

  if (!conversations[senderId]) {
    conversations[senderId] = [];
  }

  const lastMsg = conversations[senderId][conversations[senderId].length - 1];
  if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== message) {
    conversations[senderId].push({
      role: "user",
      content: message,
    });
  }

  if (conversations[senderId].length > MAX_HISTORY) {
    conversations[senderId] = conversations[senderId].slice(-MAX_HISTORY);
  }

  const response = await axios.post(
    url,
    {
      model: "anthropic/claude-haiku-4.5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...conversations[senderId],
      ],
      max_tokens: 400,
    },
    {
      headers: {
        Authorization: "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  const reply =
    response.data.choices?.[0]?.message?.content ||
    "ما فهمتكش مليح خويا، تقدر تعاودلي واش راك حاب؟";

  conversations[senderId].push({
    role: "assistant",
    content: reply,
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

// ==== Self-ping لمنع نوم السيرفر فـ Render ====
const SELF_URL = "https://facebook-messenger-bot-s8bp.onrender.com";

setInterval(() => {
  axios
    .get(SELF_URL)
    .then(() => console.log("🔄 Self-ping OK"))
    .catch((err) => console.log("⚠️ Self-ping failed:", err.message));
}, 14 * 60 * 1000);

app.listen(PORT, () => {
  console.log("🚀 SIKI STORE Bot running on port " + PORT);
});
