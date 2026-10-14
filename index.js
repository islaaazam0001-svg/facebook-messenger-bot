const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "monTokenSecret123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const PORT = process.env.PORT || 3000;

// ==== الروابط الخاصة بالتقييم والصور المباشرة الرسمية ====
const SNAP_POST_URL = "https://www.facebook.com/share/p/1DDcYqcPb8/";
const SNAP_IMAGE_URL = "https://i.ibb.co/WpvGYkR8/FB-IMG-1790662787547.jpg";

const CREATOR_POST_URL = "https://www.facebook.com/share/p/19YKrrgCvX/";
const CREATOR_IMAGE_URL = "https://i.ibb.co/C5yr7RRk/FB-IMG-1790661747952.jpg";

const conversations = {};
const userProfiles = {};
const MAX_HISTORY = 20;
const MAX_RETRIES = 3;

// ==== نظام سكوت البوت نهائياً في ملف دائم ====
const MUTED_FILE = path.join(__dirname, "muted_users.json");
let adminMutedUsers = new Set();

try {
  if (fs.existsSync(MUTED_FILE)) {
    const data = fs.readFileSync(MUTED_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      adminMutedUsers = new Set(parsed);
    }
  }
} catch (e) {
  console.error("خطأ في قراءة ملف الزبائن المسكوتين:", e.message);
}

function saveMutedUsers() {
  try {
    fs.writeFileSync(MUTED_FILE, JSON.stringify([...adminMutedUsers]), "utf-8");
  } catch (e) {
    console.error("خطأ في حفظ ملف الزبائن المسكوتين:", e.message);
  }
}

function muteCustomer(customerId, reason = "") {
  adminMutedUsers.add(customerId);
  saveMutedUsers();
  if (userBuffers.has(customerId)) {
    clearTimeout(userBuffers.get(customerId).timer);
    userBuffers.delete(customerId);
  }
  console.log(`🔇 تم إسكات البوت للعميل (${customerId}) - السبب: ${reason}`);
}

function isBotPaused(customerId) {
  return adminMutedUsers.has(customerId);
}

// ==== تتبع الرسائل التي بعثها البوت نفسه ====
const botSentMids = new Map();

function rememberBotMessage(mid) {
  if (mid) botSentMids.set(mid, Date.now());
}

function wasSentByBot(mid) {
  return Boolean(mid && botSentMids.has(mid));
}

setInterval(() => {
  const now = Date.now();
  for (const [mid, ts] of botSentMids.entries()) {
    if (now - ts > 5 * 60 * 1000) botSentMids.delete(mid);
  }
}, 60 * 1000);

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
    const res = await axios.get(url, { timeout: 5000 });
    if (res.data && res.data.first_name) {
      userProfiles[senderId] = res.data.first_name;
      return res.data.first_name;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

// ==== دالة كشف نوع المنتج تلقائياً من سياق المحادثة ====
function detectPurchasedCategory(customerId) {
  const history = conversations[customerId] || [];
  const fullText = history.map((m) => m.content).join(" ").toLowerCase();

  const isSnap = /snap|سناب|snp|ايفون|آيفون|iphone/i.test(fullText);
  const isCreator = /canva|كانفا|gemini|جيميناي|capcut|كابكات|تصميم|مونتاج/i.test(fullText);

  if (isSnap && !isCreator) return "snap";
  if (isCreator && !isSnap) return "creator";

  for (let i = history.length - 1; i >= 0; i--) {
    const text = history[i].content.toLowerCase();
    if (/snap|سناب|snp|ايفون|آيفون|iphone/i.test(text)) return "snap";
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
                  webview_height_ratio: "full",
                },
              ],
            },
          ],
        },
      },
    },
  };

  try {
    const res = await axios.post(url, payload, { timeout: 10000 });
    const mid = res.data && res.data.message_id;
    rememberBotMessage(mid);
  } catch (err) {
    console.error("خطأ في إرسال البطاقة التفاعلية:", err.response?.data || err.message);
  }
}

// ==== نظام تجميع الرسائل المتتالية (Debounce) ====
const userBuffers = new Map();

function handleUserMessageBuffered(senderId, text) {
  if (isBotPaused(senderId)) return;

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
    if (!isBotPaused(senderId)) {
      handleMessageWithRetry(senderId, combinedMessage);
    }
  }, 4500);
}

function cleanMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[\*\-]\s+/gm, "• ")
    .trim();
}

const SYSTEM_PROMPT = `أنت ممثل متجر "SIKI STORE" في الجزائر. أجب باختصار شديد وبالدارجة الجزائرية.

الخدمات والأسعار المتاحة حصراً في المتجر (ممنوع منعاً باتاً ذكر أو بيع أي خدمة أخرى غير هذه الأربعة):
1. سناب شات بلس: 2700 دج (12 شهر، للآيفون فقط، يتفعل في حساب الزبون الشخصي).
2. كانفا برو: 500 دج (3 سنوات).
3. جيميناي برو: 1000 دج (18 شهر).
4. كابكات برو: شهر بـ 1000 دج | 6 أشهر بـ 3500 دج.

قواعد صارمة جداً:
- عندما يطلب الزبون الأسعار أو يسأل عن خدمة متوفرة: اعطه السعر والتفاصيل مباشرة وبكل بساطة. ممنوع تماماً إضافة جملة "اصبر دوك يجي الأدمن يكمل معاك" عند مجرد السؤال أو الاستفسار.
- أضف جملة "اصبر دوك يجي الأدمن يكمل معاك" فقط إذا قال الزبون صراحة أنه يريد الشراء والدفع الآن (مثلاً: عطيني بريدي موب، كيفاش نخلص، راني حاب نشري درك) أو إذا كانت لديه مشكلة تقنية معقدة في حسابه.
- إذا سأل الزبون عن خدمة أخرى غير موجودة في القائمة أعلاه: قل له باختصار: "ما عندناش هذي الخدمة، متوفر عندنا غير سناب بلس، كانفا، جيميناي وكابكات."
- إذا أرسل الزبون تحية أو كلمات قصيرة أو غير واضحة: رد عليه بلطف واسأله واش من خدمة راه يحوس عليها من خدمات المتجر.
- ممنوع اختراع الأسعار نهائياً.
- ممنوع طلب كلمات السر أو إيميل الحساب من الزبون.
- ممنوع استخدام الألقاب (لا خويا ولا أختي). تحدث بصيغة محايدة تماماً.
- طرق الدفع: باريدي موب أو فليكسي (زائد 20%). ممنوع ذكر CCP أو فيزا.`;

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

    if (!body.entry || !Array.isArray(body.entry)) return;

    for (const entry of body.entry) {
      if (!entry.messaging || !Array.isArray(entry.messaging)) continue;

      for (const webhookEvent of entry.messaging) {
        // 1. رسائل الصفحة (Echo)
        if (webhookEvent.message && webhookEvent.message.is_echo) {
          const mid = webhookEvent.message.mid;
          const customerId = webhookEvent.recipient ? webhookEvent.recipient.id : null;
          if (!customerId) continue;

          const rawText = webhookEvent.message.text ? webhookEvent.message.text.trim() : "";
          const adminText = rawText.replace(/\uFE0F/g, "");

          if (wasSentByBot(mid)) {
            botSentMids.delete(mid);
          } else {
            // أمر خاص للأدمن لإعادة تشغيل البوت للزبون إذا لزم الأمر
            if (adminText.toLowerCase() === "#bot" || adminText === "#بوت") {
              adminMutedUsers.delete(customerId);
              saveMutedUsers();
              console.log("🟢 تم إعادة تفعيل البوت للعميل:", customerId);
              continue;
            }

            muteCustomer(customerId, "تدخل الأدمن يدوياً");

            if (adminText === "✅✅") {
              await sendFeedbackTemplate(customerId, "creator");
            } else if (adminText === "✅") {
              await sendFeedbackTemplate(customerId, "snap");
            } else if (adminText.toLowerCase() === "#تم" || adminText.toLowerCase() === "#feedback") {
              const detectedType = detectPurchasedCategory(customerId);
              await sendFeedbackTemplate(customerId, detectedType);
            }
          }
          continue;
        }

        const senderId = webhookEvent.sender ? webhookEvent.sender.id : null;

        // 2. معالجة أزرار الإعلانات (مثل: طلب الاشتراك)
        if (senderId && webhookEvent.postback) {
          if (isBotPaused(senderId)) continue;
          const postbackTitle = webhookEvent.postback.title || "سلام، حاب نشترك، شحال الأسعار؟";
          handleUserMessageBuffered(senderId, postbackTitle);
          continue;
        }

        // 3. معالجة رسائل الزبون
        if (senderId && webhookEvent.message && !webhookEvent.message.is_echo) {
          if (isBotPaused(senderId)) {
            console.log("🔇 البوت متوقف على العميل:", senderId);
            continue;
          }

          const incomingMid = webhookEvent.message.mid;
          if (alreadyProcessed(incomingMid)) {
            continue;
          }

          // التفريق بين اللايك/الملصقات وبين صور الوصل الحقيقية
          if (webhookEvent.message.attachments) {
            const isSticker = webhookEvent.message.attachments.some(
              (a) => a.payload && a.payload.sticker_id
            );

            if (isSticker) {
              handleUserMessageBuffered(senderId, "سلام، شحال الأسعار؟");
              continue;
            }

            const isRealImage = webhookEvent.message.attachments.some(
              (a) => a.type === "image" && (!a.payload || !a.payload.sticker_id)
            );

            if (isRealImage) {
              await sendMessage(
                senderId,
                "يعطيك الصحة، اصبر شوية يدخل مسؤول الصفحة يفيريفي الوصل ويفعل لك فوراً."
              );
              // إسكات البوت فوراً بعد استلام صورة الوصل حتى لا يزعج الزبون
              muteCustomer(senderId, "أرسل صورة وصل");
              continue;
            }
          }

          if (webhookEvent.message.text) {
            const userMessage = webhookEvent.message.text.trim();
            if (userMessage) {
              handleUserMessageBuffered(senderId, userMessage);
            }
          }
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
    await axios.post(
      url,
      {
        recipient: { id: recipientId },
        sender_action: "typing_on",
      },
      { timeout: 5000 }
    );
  } catch (err) {
    // ignore
  }
}

async function handleMessageWithRetry(senderId, userMessage) {
  if (isBotPaused(senderId)) return;

  let attempt = 0;
  let toldUserToWait = false;

  await sendTypingIndicator(senderId);

  while (attempt < MAX_RETRIES) {
    if (isBotPaused(senderId)) return;

    try {
      const replyText = await askOpenRouter(senderId, userMessage);
      const cleanReply = cleanMarkdown(replyText);

      if (!isBotPaused(senderId) && cleanReply) {
        await sendMessage(senderId, cleanReply);

        // 🔥 الحل السحري: إذا قال البوت للزبون "اصبر دوك يجي الأدمن"، يسكت البوت فوراً ولا يكررها أبداً!
        if (/يجي الأدمن|يدخل الأدمن|مسؤول الصفحة/.test(cleanReply)) {
          muteCustomer(senderId, "تم تحويل الزبون للأدمن");
        }
      }
      return;
    } catch (err) {
      attempt++;
      console.error(`Attempt ${attempt} failed:`, err.response?.data || err.message);

      if (!toldUserToWait && !isBotPaused(senderId)) {
        await sendMessage(senderId, "دقيقة برك راني نشوفلك...");
        toldUserToWait = true;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(3000 * attempt);
      }
    }
  }

  if (!isBotPaused(senderId)) {
    await sendMessage(
      senderId,
      "كاين ضغط شوية دك، عاود ابعثلي ميساج بعد لحظات ونجاوبك فوراً."
    );
  }
}

async function askOpenRouter(senderId, message) {
  const url = "https://openrouter.ai/api/v1/chat/completions";

  if (!conversations[senderId]) {
    conversations[senderId] = [];
  }

  const customerName = await getUserName(senderId);
  const promptWithContext = customerName
    ? `${SYSTEM_PROMPT}\n\nاسم الزبون: "${customerName}".`
    : SYSTEM_PROMPT;

  const historyToSend = [
    ...conversations[senderId],
    { role: "user", content: message },
  ].slice(-MAX_HISTORY);

  const response = await axios.post(
    url,
    {
      model: "google/gemini-2.5-flash",
      temperature: 0.2,
      messages: [
        { role: "system", content: promptWithContext },
        ...historyToSend,
      ],
      max_tokens: 250,
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
    response.data?.choices?.[0]?.message?.content?.trim() ||
    "اصبر دوك يجي الأدمن يكمل معاك.";

  conversations[senderId].push({ role: "user", content: message });
  conversations[senderId].push({ role: "assistant", content: reply });

  if (conversations[senderId].length > MAX_HISTORY) {
    conversations[senderId] = conversations[senderId].slice(-MAX_HISTORY);
  }

  return reply;
}

async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  try {
    const response = await axios.post(
      url,
      {
        recipient: { id: recipientId },
        message: { text: text },
      },
      { timeout: 10000 }
    );

    const mid = response.data && response.data.message_id;
    rememberBotMessage(mid);
  } catch (err) {
    console.error("خطأ في إرسال الرسالة لفيسبوك:", err.response?.data || err.message);
  }
}

// ==== Self-ping لمنع نوم السيرفر فـ Render ====
const SELF_URL = process.env.RENDER_EXTERNAL_URL || "https://facebook-messenger-bot-s8bp.onrender.com";

setInterval(() => {
  axios
    .get(SELF_URL, { timeout: 10000 })
    .then(() => console.log("🔄 Self-ping OK"))
    .catch((err) => console.log("⚠️ Self-ping failed:", err.message));
}, 14 * 60 * 1000);

app.listen(PORT, () => {
  console.log("🚀 SIKI STORE Bot running on port " + PORT);
});
