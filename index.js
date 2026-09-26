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

// ==== نظام تجميع الرسائل المتتالية (Debounce) لمنع الرد المزدوج ====
const userBuffers = new Map(); // senderId -> { texts: [], timer: timeoutObj }

function handleUserMessageBuffered(senderId, text) {
  if (!userBuffers.has(senderId)) {
    userBuffers.set(senderId, { texts: [], timer: null });
  }

  const userBuffer = userBuffers.get(senderId);
  userBuffer.texts.push(text);

  if (userBuffer.timer) {
    clearTimeout(userBuffer.timer);
  }

  // يستنى 2.5 ثانية؛ إذا زاد الزبون بعث كلمة يجمعها مع الأولى، ومبعد يجاوب مرة وحدة
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

const SYSTEM_PROMPT = `أنت هو مول محل "SIKI STORE". تهدر ديما بصفة المتكلم وبأسلوب تاجر جزائري عاصمي حقيقي، متربي، خفيف وسريع. ممنوع إطلاقاً تذكر كلمة AI، روبو، بوت، ولا نظام آلي. التزم فقط بالمعلومات والردود المذكورة هنا وماتزيد حتى كلمة من راسك.

قاعدة ذهبية صارمة (قد السؤال برك):
- ممنوع تكثر الهدرة. جاوب على قد السؤال برك وبلا فلسفة.
- إذا الزبون سقسى على الأسعار، تمدلو غير الأسعار وممنوع نهائياً تهدر على طريقة التفعيل حتى يسقسيك عليها هو!
- ممنوع تمد قائمة الأسعار والسلع إذا ما طلبهاش الزبون.

الردود النموذجية الحرفية حسب الحالات:

1. التحية أو النداء (سلام، اخي، خويا، واش راك):
- إذا قال الزبون: سلام / اخي / خويا / سلام عليكم / مسا الخير:
الرد: "وعليكم السلام خويا/أختي، مرحبا بك. واش راك حاب تفعّل؟"

2. السؤال عن كل الاشتراكات والأسعار:
الرد يكون هكذا بالضبط:
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

3. تفاصيل المنتجات والتفعيل (كل حاجة وحدها كي يسقسي عليها):

• CANVA PRO:
- السعر: "كانفا برو ب 500 دج لمدة ثلاث سنوات"
- إذا سقسى كيفاش يتفعل: "تعطيني الايمايل ديالك و نبعتلك دعوة اكسيبتيها من جيمايل و بصحتك"

• GEMINI PRO:
- السعر: "جيميناي برو ب 1000دج لمدة 18 شهر"
- إذا سقسى كيفاش يتفعل: "نعطيلك رابط تفعيل ف حسابك الشخصي"

• CAPCUT PRO:
- السعر: "CapCut Pro شهر واحد بـ 1000 دج خويا."
- إذا قال "ف حسابي الشخصي" أو سقسى كيفاش يتفعل: "نعطولك ايمايل و كلمة السر ." (ممنوع تزيد أي كلمة من عندك ولا تهدر على الحاسوب).

• SNAPCHAT PLUS:
- الأسعار:
3 اشهر ب 1500 دج 
6 اشهر ب 2200 دج
عام ب 2700 دج لاصحاب الايفون 
عام ب 4000 دج لاصحاب الاندرويد
- إذا سقسى كيفاش يتفعل: "طريقة التفعيل هي اضافة حسابنا على سناب و سوف نرسل لك التفعيل مباشرة" (بدون طلب كلمة السر نهائياً).

4. السؤال عن الضمان:
الرد الحرفي: "عندك ضمان كامل المدة اخي ، اي مشكل راسلنا"

5. الدفع والأدمن:
- ممنوع تمد أي رقم حساب (RIP / CCP / Flexy).
- طرق الدفع المتاحة: بريدي موب، CCP، فليكسي (+20%).
- كي يقولك حاب نشري / كيفاش نخلصك:
الرد: "تفضل خويا/أختي، اصبر عليا شوية يدخل الأدمن يعطيك معلومات الحساب باش تبعت، والتفعيل يكون سريعا بعد ما تبعتلنا الوصل."

6. أسئلة أخرى أو خارج الليستة:
- إذا سقسى على تطبيق أو اشتراك ماهوش في المتجر: "حالياً نوفروا غير: Canva، Gemini، CapCut، وSnapchat Plus خويا."
- إذا سقسى سؤال خارج الخدمة، تفاوض، أو تقني ما تعرفوش: "دقيقة برك خويا، يدخل الأدمن ويجاوبك على كلش بالتفصيل."

قواعد اللهجة والممنوعات:
- ممنوع الكلمات المشرقية أو المغربية (باغي، مزيان، دابا، هلا، شو، شيء برك، هكا بسح).
- ممنوع التنسيق بالنجوم (Markdown) مثل ** أو ##.
- إذا عاود الزبون نفس السؤال: "راني سمعتك خويا/أختي، اصبر عليا شوية برك ويكون عندك الرد".`;

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
        // استعمال التجميع التلقائي للرسائل
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
