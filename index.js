const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "monTokenSecret123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const PORT = process.env.PORT || 3000;

// ==== الروابط الخاصة بالتقييم والصور المباشرة الرسمية ====
// 1. خاص بـ سناب شات بلس
const SNAP_POST_URL = "https://www.facebook.com/share/p/1DDcYqcPb8/";
const SNAP_IMAGE_URL = "https://i.ibb.co/WpvGYkR8/FB-IMG-1790662787547.jpg";

// 2. خاص بـ صناع المحتوى (Canva, Gemini, CapCut)
const CREATOR_POST_URL = "https://www.facebook.com/share/p/19YKrrgCvX/";
const CREATOR_IMAGE_URL = "https://i.ibb.co/C5yr7RRk/FB-IMG-1790661747952.jpg";

const conversations = {};
const userProfiles = {};
const MAX_HISTORY = 20;
const MAX_RETRIES = 3;

// ==== نظام سكوت البوت نهائياً كي يرد الأدمن ====
const adminMutedUsers = new Set();

// ==== تتبع الرسائل التي بعثها البوت نفسه ====
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

// ==== دالة كشف نوع المنتج تلقائياً من سياق المحادثة (لحالة #تم) ====
function detectPurchasedCategory(customerId) {
  const history = conversations[customerId] || [];
  const fullText = history.map((m) => m.content).join(" ").toLowerCase();

  const isSnap = /snap|سناب|snp|ايفون|iphone|اندرويد|android|ريجيون|region/i.test(fullText);
  const isCreator = /canva|كانفا|gemini|جيميناي|capcut|كابكات|تصميم|مونتاج/i.test(fullText);

  if (isSnap && !isCreator) return "snap";
  if (isCreator && !isSnap) return "creator";

  for (let i = history.length - 1; i >= 0; i--) {
    const text = history[i].content.toLowerCase();
    if (/snap|سناب|snp|ايفون|iphone|اندرويد|android/i.test(text)) return "snap";
    if (/canva|كانفا|gemini|جيميناي|capcut|كابكات/i.test(text)) return "creator";
  }

  return "snap";
}

// ==== دالة إرسال بطاقة التقييم التفاعلية الاحترافية ====
async function sendFeedbackTemplate(recipientId, type = "snap") {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  
  const isSnap = type === "snap";
  const postUrl = isSnap ? SNAP_POST_URL : CREATOR_POST_URL;
  const imageUrl = isSnap ? SNAP_IMAGE_URL : CREATOR_IMAGE_URL;
  const titleText = isSnap ? "بصحتك تفعيل Snapchat Plus! ⭐" : "بصحتك تفعيل باقة صناع المحتوى! ⭐";
  const subtitleText = isSnap 
    ? "رأيك يهمنا بزاف، اضغط على الزر وشاركنا تجربتك في منشور سناب شات لدعم المصداقية."
    : "رأيك يهمنا بزاف، اضغط على الزر وشاركنا تجربتك في منشور صناع المحتوى لدعم المصداقية.";

  const payload = {
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [
            {
              title: titleText,
              image_url: imageUrl,
              subtitle: subtitleText,
              buttons: [
                {
                  type: "web_url",
                  url: postUrl,
                  title: "اترك تقييمك هنا ⭐",
                  webview_height_ratio: "full"
                }
              ]
            }
          ]
        }
      }
    }
  };

  try {
    const res = await axios.post(url, payload);
    const mid = res.data && res.data.message_id;
    rememberBotMessage(mid);
  } catch (err) {
    console.error("خطأ في إرسال البطاقة التفاعلية:", err.response?.data || err.message);
  }
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

const SYSTEM_PROMPT = `أنت تعمل في خدمة الزبائن لمتجر "SIKI STORE".
شخصيتك: تاجر جزائري شاطر، خفيف، متربي ومحترم، تفهم الكلام بالمعنى والسياق وتجاوب باختصار مفيد وبترتيب منظم بدون خلط الكلمات.

معلومات المتجر الثابتة (ممنوع اختراع أي سعر أو عرض آخر):
- CANVA PRO: ثلاث سنوات بـ 500 دج (التفعيل: يبعث إيميله ونبعتولوا دعوة).
- GEMINI PRO: 18 شهر بـ 1000 دج (التفعيل: رابط تفعيل في حسابه الشخصي).
- CAPCUT PRO:
  عند السؤال عن سعر CapCut Pro، اعرض الأسعار منظمة في أسطر منفصلة هكذا تماماً:
  CapCut Pro:
  - شهر واحد بـ 1000 دج
  - 6 أشهر بـ 3500 دج
  (التفعيل: يمشي في التطبيق فالهاتف وفالحاسوب عبر إيميل وكلمة سر من عندنا).
- SNAPCHAT PLUS: 
  * 3 أشهر بـ 1500 دج
  * 6 أشهر بـ 2200 دج
  * عام بـ 2700 دج (للآيفون) - يتطلب تغيير المنطقة (Région)، وإذا سأل كيفاش قولو الأدمن يوريلك.
  * عام بـ 4000 دج (للأندرويد).
- الضمان: كامل المدة، أي مشكل يراسلنا.
- الدفع: بريدي موب، CCP، فليكسي (+20%)، ونقبل فيزا/ماستركارد إذا سأل عنها حصراً.

منطق التعامل مع المحادثة:
1. الجنس: إذا كان الاسم لأنثى خاطبها بـ "أختي" وبصيغة المؤنث، وإذا لذكر خاطبه بـ "خويا/أخي" (ممنوع الشرطة خويا/أختي نهائياً). وإذا كان الاسم رمزياً أو غير واضح لا تقل خويا ولا أختي ورد بأسلوب محايد وراقي.
2. لا تشرح طريقة التفعيل من تلقاء نفسك إلا إذا سأل الزبون كيفاش يتفعل.
3. إذا قال الزبون شكراً، أوكي، أو كلمة ختامية: رد بـ "مرحبا بك خويا/أختي" فقط وتوقف عن طرح الأسئلة ولا تلح عليه.
4. مرحلة الدفع والإيميل:
   - أنت لا تملك أرقام الحسابات البنكية (RIP/CCP). إذا طلب الدفع أو الـ RIP أو الحساب، قل له أن مسؤول التحويلات (الأدمن) يدخل بعد لحظات يمدلك الحساب باش تفيري والتفعيل سريع بعد ما تبعت الوصل.
   - أي إيميل يرسله الزبون (Gmail, Hotmail, Outlook, Yahoo...) هو صالح ومقبول، اشكره وقل له ينتظر دعوة الأدمن.`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get("/", (req, res) => {
  res.send("SIKI STORE Bot running ✅");
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
    res.status(200).send("EVENT_RECEIVED");

    for (const entry of body.entry) {
      if (!entry.messaging || entry.messaging.length === 0) continue;
      const webhookEvent = entry.messaging[0];

      // فحص الرسائل الصادرة من الأدمن
      if (webhookEvent.message && webhookEvent.message.is_echo) {
        const mid = webhookEvent.message.mid;
        const customerId = webhookEvent.recipient.id;
        const rawText = webhookEvent.message.text ? webhookEvent.message.text.trim() : "";
        const adminText = rawText.replace(/\uFE0F/g, "");

        if (wasSentByBot(mid)) {
          botSentMids.delete(mid);
        } else {
          adminMutedUsers.add(customerId);
          console.log("🛑 الأدمن رد يدوياً. تم إسكات البوت على العميل:", customerId);

          // 1. إيموجي مضاعف: صناع المحتوى (Gemini, Canva, CapCut)
          if (adminText === "✅✅") {
            console.log(`🎯 تم إرسال تقييم صناع المحتوى للعميل (${customerId}) عبر ✅✅`);
            await sendFeedbackTemplate(customerId, "creator");
          }
          // 2. إيموجي مفرد: سناب شات بلس
          else if (adminText === "✅") {
            console.log(`🎯 تم إرسال تقييم سناب شات للعميل (${customerId}) عبر ✅`);
            await sendFeedbackTemplate(customerId, "snap");
          }
          // 3. خيار #تم التلقائي
          else if (adminText.toLowerCase() === "#تم" || adminText.toLowerCase() === "#feedback") {
            const detectedType = detectPurchasedCategory(customerId);
            console.log(`🎯 تم التعرف تلقائياً (${customerId}): ${detectedType}`);
            await sendFeedbackTemplate(customerId, detectedType);
          }
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
    ? `${SYSTEM_PROMPT}\n\nمعلومة إضافية: اسم الزبون الحالي في فيسبوك هو: "${customerName}". إذا كان الاسم لأنثى خاطبها حصراً بـ "أختي" وصيغة المؤنث، وإذا كان لذكر خاطبه بـ "خويا/أخي". وإذا كان الاسم غير محدد أو رمزي لا تقل خويا ولا أختي.`
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
      temperature: 0.35,
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
