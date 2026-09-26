const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "monTokenSecret123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const PORT = process.env.PORT || 3000;

const conversations = {};
const userProfiles = {}; // لتخزين اسم الزبون
const MAX_HISTORY = 20;
const MAX_RETRIES = 3;

// ==== نظام سكوت البوت نهائياً كي يرد الأدمن ====
const adminMutedUsers = new Set();

// ==== تتبع الرسائل اللي بعثها البوت نفسو ====
const botSentMids = new Map();

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

// ==== حماية ضد إعادة إرسال فيسبوك لنفس الرسالة ====
const processedIncomingMids = new Map();

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

// ==== جلب اسم الزبون من فيسبوك ====
async function getUserName(senderId) {
  if (userProfiles[senderId]) return userProfiles[senderId];
  try {
    const url = `https://graph.facebook.com/v21.0/${senderId}?fields=first_name&access_token=${PAGE_ACCESS_TOKEN}`;
    const res = await axios.get(url);
    if (res.data && res.data.first_name) {
      userProfiles[senderId] = res.data.first_name;
      return res.data.first_name;
    }
  } catch (err) {
    // إذا لم تتوفر الصلاحية
  }
  return null;
}

// ==== نظام تجميع الرسائل المتتالية (Debounce) ====
const userBuffers = new Map();

function handleUserMessageBuffered(senderId, text) {
  if (!userBuffers.has(senderId)) {
    userBuffers.set(senderId, { texts: [], timer: null });
  }

  const userBuffer = userBuffers.get(senderId);
  userBuffer.texts.push(text);

  if (userBuffer.timer) {
    clearTimeout(userBuffer.timer);
  }

  userBuffer.timer = setTimeout(() => {
    const combinedMessage = userBuffer.texts.join(" ");
    userBuffers.delete(senderId);
    handleMessageWithRetry(senderId, combinedMessage);
  }, 2500);
}

function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[\*\-]\s+/gm, "• ");
}

const SYSTEM_PROMPT = `أنت هو بائع في متجر "SIKI STORE".
ممنوع نهائياً أن تخترع معلومة، أو مدة، أو سعر من عندك. التزم حصرياً بالنصوص التالية بالحرف الواحد:

قاعدة التعامل حسب الجنس (مهم جداً):
- ستصلك معلومة عن اسم الزبون.
- إذا كان الاسم لأنثى أو تحدثت بصيغة المؤنث: خاطبها بصيغة المؤنث حصراً وقل: "أختي" (ممنوع منعاً باتاً كتابة خويا/أختي بشرطة).
- إذا كان الاسم لذكر أو غير واضح: خاطبه بـ "خويا".

قواعد الإلزام الصارمة:
1. الإجابة تكون فقط في سطر واحد، أو سطرين على الأكثر.
2. لا تكرر الأسئلة ولا تلح على الزبون.
3. إذا قال الزبون كلمة ختامية (اك، اوك، ok، شكرا، صحا، يعطيك الصحة، ميرسي):
الرد الإلزامي: "بلا جميل خويا، مرحبا بك في أي وقت." (أو "بلا جميل أختي، مرحبا بك في أي وقت."). ممنوع كتابة أي كلمة بعدها.
4. إذا طلب الزبون تخفيض السعر أو اشتكى (غالي، بزاف، نقصلي):
الرد الإلزامي: "هادو هما الأسعار، والخدمة مضمونة ورسمية."
5. إذا طلب الزبون مدة غير مذكورة إطلاقاً:
الرد الإلزامي: "نوفروا غير المدد المذكورة." بدون أي اقتراح آخر ولا حساب أسعار.
6. أي سؤال خارج القائمة المحددة أو تفاوض لا تعرف جوابه المكتوب هنا:
الرد الإلزامي: "دقيقة برك، يدخل الأدمن ويجاوبك على كلش بالتفصيل."

النصوص الحرفية المعتمدة:

1. التحية والنداء (سلام، كاين، مسا الخير):
"وعليكم السلام، مرحبا بك. واش راك حاب تفعّل؟" (للمؤنث: "واش راك حابة تفعّلي؟").

2. CANVA PRO:
- السعر: "كانفا برو ب 500 دج لمدة ثلاث سنوات"
- التفعيل (إذا سأل فقط): "تعطيني الايمايل ديالك و نبعتلك دعوة اكسيبتيها من جيمايل و بصحتك"

3. GEMINI PRO:
- السعر: "جيميناي برو ب 1000دج لمدة 18 شهر"
- التفعيل (إذا سأل فقط): "نعطيلك رابط تفعيل ف حسابك الشخصي"

4. CAPCUT PRO:
- السعر: "CapCut Pro شهر واحد بـ 1000 دج."
- التفعيل أو سؤال الحاسوب (إذا سأل فقط): "يمشي فالتطبيق فالتليفون و يمشي فالحاسوب، نعطولك إيمايل و كلمة السر."
- إذا قال في حسابي الشخصي: "نعطولك ايمايل و كلمة السر ."

5. SNAPCHAT PLUS:
- السعر:
3 اشهر ب 1500 دج 
6 اشهر ب 2200 دج
عام ب 2700 دج لاصحاب الايفون 
عام ب 4000 دج لاصحاب الاندرويد
- التفعيل (إذا سأل فقط): "طريقة التفعيل هي اضافة حسابنا على سناب و سوف نرسل لك التفعيل مباشرة"

6. قائمة الأسعار كاملة (فقط إذا طلب كل الأسعار معاً):
CANVA PRO 
ثلاث سنوات ب 500 دج
GEMINI PRO 
18 شهر ب 1000 دج
CAPCUT PRO
شهر واحد ب 1000دج 
SNAPCHAT PLUS 
3 اشهر ب 1500 دج 
6 اشهر ب 2200 دج
عام ب 2700 دج لاصحاب الايفون 
عام ب 4000 دج لاصحاب الاندرويد

7. الضمان:
"عندك ضمان كامل المدة، اي مشكل راسلنا"

8. الدفع والأدمن:
- ممنوع كتابة أي رقم حساب إطلاقاً.
- إذا قرر الشراء: "اصبر عليا شوية يدخل الأدمن يعطيك معلومات الحساب باش تبعت، والتفعيل يكون سريعا بعد ما تبعتلنا الوصل."

9. المنتجات غير المتوفرة:
"حالياً نوفروا غير: Canva، Gemini، CapCut، وSnapchat Plus."`;

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
        handleUserMessageBuffered(senderId, userMessage);
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
    // ignore
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
        await sendMessage(senderId, "دقيقة برك راني نشوفلك...");
        toldUserToWait = true;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(3000 * attempt);
      }
    }
  }

  await sendMessage(
    senderId,
    "كاين ضغط شوية دك، عاود ابعثلي ميساج بعد لحظات ونجاوبك فورا."
  );
}

async function askOpenRouter(senderId, message) {
  const url = "https://openrouter.ai/api/v1/chat/completions";

  if (!conversations[senderId]) {
    conversations[senderId] = [];
  }

  const customerName = await getUserName(senderId);
  const promptWithContext = customerName 
    ? `${SYSTEM_PROMPT}\n\nمعلومة إضافية: اسم الزبون الحالي هو: "${customerName}". خاطبه بناءً على جنس هذا الاسم (إذا كان أنثى قل أختي، إذا كان ذكر قل خويا).`
    : SYSTEM_PROMPT;

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
      temperature: 0,
      messages: [
        { role: "system", content: promptWithContext },
        ...conversations[senderId],
      ],
      max_tokens: 300,
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
    "دقيقة برك، يدخل الأدمن ويجاوبك على كلش بالتفصيل.";

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

// ==== Self-ping ====
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
