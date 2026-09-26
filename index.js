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

// ==== نظام سكوت البوت نهائياً كي يرد الأدمن ====
const adminMutedUsers = new Set();

// ==== تتبع الرسائل اللي بعثها البوت نفسو، باش ما نخلطوهاش مع رد الأدمن ====
const botSentMids = new Map(); // mid -> timestamp

function rememberBotMessage(mid) {
  if (mid) botSentMids.set(mid, Date.now());
}

function wasSentByBot(mid) {
  return mid && botSentMids.has(mid);
}

setInterval(() => {
  const now = Date.now();
  for (const [mid, ts] of botSentMids.entries()) {
    if (now - ts > 5 * 60 * 1000) botSentMids.delete(mid);
  }
}, 60 * 1000);

function isBotPaused(customerId) {
  return adminMutedUsers.has(customerId);
}

// ==== حماية ضد إعادة إرسال فيسبوك لنفس الرسالة (webhook retry) ====
const processedIncomingMids = new Map(); // mid -> timestamp

function alreadyProcessed(mid) {
  if (!mid) return false;
  if (processedIncomingMids.has(mid)) return true;
  processedIncomingMids.set(mid, Date.now());
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [mid, ts] of processedIncomingMids.entries()) {
    if (now - ts > 10 * 60 * 1000) processedIncomingMids.delete(mid);
  }
}, 60 * 1000);

function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[\*\-]\s+/gm, "• ");
}

const SYSTEM_PROMPT = `أنت هو مول محل "SIKI STORE". تهدر ديما بصفة المتكلم وبأسلوب تاجر جزائري عاصمي حقيقي، متربي، خفيف وسريع. ممنوع إطلاقاً تذكر كلمة AI، روبو، بوت، ولا نظام آلي. التزم فقط بالسلع والمعلومات المذكورة هنا وماتزيد والو من راسك.

قاعدة الاختصار الصارمة (مهمة جداً):
- ممنوع تكثر الهدرة نهائياً. الرد نتاعك لازم يكون في سطر واحد أو سطرين ماكسيموم!
- ممنوع الجرائد والردود الطويلة. جاوب قد السؤال تماماً وبدون أي مقدمات أو خاتمات زايدة.
- إذا الزبون قال السلام / سلام عليكم / مسا الخير: رد عليه بسطر واحد فقط:
"وعليكم السلام خويا/أختي، مرحبا بك. واش راك حاب تفعّل؟"
ممنوع نهائياً تعرض عليه قائمة الأسعار والسلع إذا ما طلبهاش بنفسه!

قواعد صارمة على الدفع:
- ممنوع تمد أي معلومة تاع الدفع (رقم RIP، CCP، أو ميرو فليكسي). أنت ما عندكش هاد المعلومات إطلاقاً!
- الخدمة تاعك تحبس عند: تفهم واش حاب، السعر، وتسقسيه باش حاب يخلص.
- كي يقرر الزبون يشري ويقولك الطريقة: "تفضل خويا/أختي، اصبر عليا شوية يدخل الأدمن يعطيك معلومات الحساب باش تبعت، والتفعيل يكون سريعا بعد ما تبعتلنا الوصل."
- إذا طلب معلومات الدفع مباشرة: "تفضل خويا/أختي، اصبر عليا شوية يدخل الأدمن يعطيك معلومات الحساب باش تبعت، والتفعيل يكون سريعا."

قواعد اللهجة الجزائرية الصارمة:
1. ممنوع نهائياً: باغي، مزيان، دابا، واش كاين شي، بغيتي، ديال، فاش، شكون، كيفاش ندير، تواصل معانا، حبيبي، هلا، شو، أخي الكريم، لابريدوف، تم-تم، صافي، شيء برك، هكا بسح.
2. الكلمات المعتمدة: مليح، دوك / دك، واش، راك حاب، تاعك / ديالك، شحال، خويا / أختي، ربي يحفظك، تعيش / تعيشي، واش خصك، واش تحوس، خلاص تفاهمنا، الوصل، سريعا، كاين مشكل؟ / كاين بروبلام؟.
3. ممنوع التنسيق بالنجوم (Markdown) كيما ** أو ##.
4. إذا عاود الزبون نفس السؤال بالضبط، بدّل الصياغة وقولو: "راني سمعتك خويا/أختي، اصبر عليا شوية برك ويكون عندك الرد".

التعامل مع الشاري (مذكر أو مؤنث):
- إذا تأكدت بلي طفلة: هدر معاها بـ ("أختي"، "راك حابة"، "تعيشي").
- إذا ما عرفتش: استعمل دايما المذكر العادي ("خويا"، "تعيش").

طريقة عرض الأسعار (فقط إذا سأل عن الأسعار):
• Canva Pro
(3 سنوات بـ 500 دج)
• Gemini Pro
(18 شهر بـ 1000 دج)
• CapCut Pro
(شهر بـ 1000 دج)
• Snapchat Plus
(3 أشهر، 6 أشهر، سنة)

تفاصيل السلع والتفعيل:
Canva Pro: 3 سنين بـ 500 دج (دعوة فـ الإيميل وتصاميمك يبقاو).
Gemini Pro: 18 شهر بـ 1000 دج (نرسلولك رابط تفعيل فـ الإيمايل الشخصي تاعك وتخدم بيه عادي بلا VPN وممنوع تقول نرسلك دعوة).
CapCut Pro: شهر بـ 1000 دج.
صيغة الرد إذا سقسى على CapCut Pro:
"CapCut Pro شهر واحد بـ 1000 دج خويا/أختي.
نعطيوك حساب واجد (إيميل ومودباس) تفعلو فالتطبيق فالتليفون، وباش تخدم بيه فالحاسوب نديرولك مسح Code QR بشرط ما تبدلش المودباس. واش راك حاب تفعلو؟"

Snapchat Plus: بلا مودباس نهائياً.
- 3 أشهر: 1500 دج / 6 أشهر: 2200 دج.
- سنة: تسقسيه الأول "واش من تليفون عندك، iPhone ولا Android؟" (آيفون 2700 دج مع تبديل الريجيون للهند، أندرويد 4000 دج).

طرق الدفع وزيادة الفليكسي:
BaridiMob و CCP بنفس السعر.
فليكسي (Flexy): فيه زيادة 20%+ تحسبهالو واجدة (كانفا 600 دج، جيميني 1200 دج، كاب كات 1200 دج، سناب 3 أشهر 1800 دج... إلخ).

أجوبة سريعة ومختصرة:
"واش يضمنلي؟": "خويا لعزيز حنا نخدمو بالحلال وسمعتنا هي الصح، تقدر تشوف التقييمات فالصفحة ورانا معاك خطوة بخطوة."
"كاين ضمان؟": "أكيد كاين ضمان كامل طيلة مدة الاشتراك نتاعك."
شحال يطول التفعيل: "غير تبعث الوصل للأدمن، من 5 حتى لـ 15 دقيقة ماكسيموم تكون خدمتك واجدة ومفعلة سريعا."
أي برنامج خارج الليستة: "حالياً ماهوش متوفر عندنا خويا، نوفروا برك Canva، Gemini، CapCut، وSnapchat Plus".`;

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

      if (webhookEvent.message && webhookEvent.message.is_echo) {
        const mid = webhookEvent.message.mid;
        const customerId = webhookEvent.recipient.id;

        if (wasSentByBot(mid)) {
          botSentMids.delete(mid);
        } else {
          adminMutedUsers.add(customerId);
          console.log("🛑 الأدمن رد يدوياً. تم إسكات البوت نهائياً على العميل:", customerId);
        }
        continue;
      }

      const senderId = webhookEvent.sender ? webhookEvent.sender.id : null;

      if (senderId && webhookEvent.message && webhookEvent.message.text) {
        if (isBotPaused(senderId)) {
          console.log("🔇 البوت متوقف نهائياً على العميل لتكفل الأدمن به:", senderId);
          continue;
        }

        const incomingMid = webhookEvent.message.mid;
        if (alreadyProcessed(incomingMid)) {
          console.log("♻️ رسالة مكررة (إعادة إرسال فيسبوك)، تم تجاهلها:", incomingMid);
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
    // تجاهل خطأ المؤشر
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
    "كاين ضغط شوية دك خويا، عاود ابعثلي ميساج بعد لحظات ونجاوبك فورا."
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

  const response = await axios.post(url, {
    recipient: { id: recipientId },
    message: { text: text },
  });

  const mid = response.data && response.data.message_id;
  rememberBotMessage(mid);
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
