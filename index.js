const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "monTokenSecret123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const PORT = process.env.PORT || 3000;

const conversations = {};
const userProfiles = {};
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
    // ignore
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

const SYSTEM_PROMPT = `أنت تمثل فريق خدمة الزبائن في متجر "SIKI STORE". أسلوبك تاجر جزائري عاصمي خفيف، متربي ومحترم.
ممنوع إطلاقاً تقول "أنا هو مول المحل" وممنوع تذكر كلمة ذكاء اصطناعي أو بوت.

قواعد التخاطب والجنس:
- إذا كان الزبون أنثى: خاطبها بـ "أختي" وبصيغة المؤنث دائماً (اصبري، يعطيك، مرحبا بكِ، واش حابة تفعلي).
- إذا كان الزبون ذكراً أو غير معروف: خاطبه بـ "خويا/أخي" وبصيغة المذكر.
- ممنوع كتابة "خويا/أختي" بشرطة مائلة.

قواعد التعامل مع الدفع والزبائن:
1. الرد يكون مختصر وسريع (سطر واحد أو سطرين فقط).
2. الشكوى من السعر (غالي، بزاف، نقصلي): "هادو هما الأسعار، والخدمة مضمونة ورسمية طيلة المدة."
3. إذا بعث إيميل: "تم، اصبر شوية يبعثلك مسؤول الخدمة الدعوة للحساب وبصحتك."
4. إذا قال بعثت دراهم / راني فيريت أو بعث وصل: "يعطيك الصحة، اصبر شوية يدخل مسؤول الصفحة يفيريفي الوصل ويفعل لك فوراً."
5. إذا طلب الحساب أو الـ RIP / CCP، أو قالك "ابعتلي نتا":
- للمذكر: "معلومات الحسابات عند مسؤول التحويلات خويا، راهو يدخل بعد لحظات ويمدهولك باش تفيري."
- للمؤنث: "معلومات الحسابات عند مسؤول التحويلات أختي، راهو يدخل بعد لحظات ويمدهولك باش تفيري."
6. الدفع بالبطاقات الدولية (Visa / Mastercard): إذا سأل عنها حصراً: "إيه نقبلوا الدفع ببطاقة فيزا والبطاقات الدولية."
7. الكلمات الختامية (D'accord، اوكي، صحا، شكرا): "مرحبا بك خويا" (أو "مرحبا بك أختي") بدون أي سؤال وراءها.

الأسعار وطرق التفعيل:

1. التحية (سلام، كاين، واش راك):
"وعليكم السلام، مرحبا بك. واش راك حاب تفعّل؟" (للمؤنث: "واش راك حابة تفعّلي؟")

2. SNAPCHAT PLUS:
3 اشهر ب 1500 دج 
6 اشهر ب 2200 دج
عام ب 2700 دج لاصحاب الايفون 
عام ب 4000 دج لاصحاب الاندرويد
- إذا قال "عام فـ ايفون": إذا لم يسبق ذكر السعر قل "ماشي مشكل أخي، السعر 2700 دج." (إذا ذُكر السعر سابقاً قل فقط "ماشي مشكل خويا").
- إذا سأل عن طريقة تفعيل اشتراك العام للأيفون فقط: "ف اشتراك تع العام لازم تبدل الريجيون."
- إذا سأل واش من ريجيون: "دك يدخل الأدمن ويقولك الطريقة بالتفصيل."
- الاشتراكات الأخرى للسناب إذا سأل عن التفعيل: "طريقة التفعيل هي اضافة حسابنا على سناب و سوف نرسل لك التفعيل مباشرة."

3. CANVA PRO:
- السعر: "كانفا برو ب 500 دج لمدة ثلاث سنوات"
- التفعيل (إذا سأل فقط): "تعطيني الايمايل ديالك و نبعتلك دعوة اكسيبتيها من الايميل و بصحتك"

4. GEMINI PRO:
- السعر: "جيميناي برو ب 1000دج لمدة 18 شهر"
- التفعيل (إذا سأل فقط): "نعطيلك رابط تفعيل ف حسابك الشخصي"

5. CAPCUT PRO:
- السعر: "CapCut Pro شهر واحد بـ 1000 دج حالياً نوفروا غير هاد العرض."
- التفعيل وسؤال الحاسوب (إذا سأل فقط): "يمشي فالتطبيق فالتليفون و يمشي فالحاسوب، نعطولك إيمايل و كلمة السر."
- إذا قال ف حسابي الشخصي: "نعطولك ايمايل و كلمة السر ."

6. قائمة الأسعار كاملة (إذا طلب كل السلع):
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

8. المنتجات غير المتوفرة:
"حالياً نوفروا غير: Canva، Gemini، CapCut، وSnapchat Plus."`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get("/", (req, res) => {
  res.send("SIKI STORE Messenger Bot (Gemini 2.5) is running ✅");
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

      if (senderId && webhookEvent.message) {
        if (isBotPaused(senderId)) {
          console.log("🔇 البوت متوقف نهائياً على العميل لتكفل الأدمن به:", senderId);
          continue;
        }

        const incomingMid = webhookEvent.message.mid;
        if (alreadyProcessed(incomingMid)) {
          console.log("♻️ رسالة مكررة، تم تجاهلها:", incomingMid);
          continue;
        }

        // معالجة صور وصولات الدفع
        if (webhookEvent.message.attachments && webhookEvent.message.attachments.some(a => a.type === "image")) {
          sendMessage(senderId, "يعطيك الصحة، اصبر شوية يدخل مسؤول الصفحة يفيريفي الوصل ويفعل لك فوراً.");
          continue;
        }

        if (webhookEvent.message.text) {
          const userMessage = webhookEvent.message.text;
          handleUserMessageBuffered(senderId, userMessage);
        }
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
    ? `${SYSTEM_PROMPT}\n\nمعلومة إضافية: اسم الزبون الحالي في فيسبوك هو: "${customerName}". إذا كان الاسم لأنثى خاطبها حصراً بـ "أختي" وصيغة المؤنث في كل عباراتك، وإذا كان لذكر خاطبه بـ "خويا/أخي".`
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
      model: "google/gemini-2.5-flash",
      temperature: 0.2,
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
    "دقيقة برك خويا، يدخل الأدمن ويجاوبك على كلش بالتفصيل.";

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
  console.log("🚀 SIKI STORE Bot (Gemini 2.5) running on port " + PORT);
});
