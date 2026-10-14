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
    // تجاهل الخطأ في حال عدم توفر الصلاحية لجلب الاسم
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
    const combinedMessage = userBuffer.texts.join(" | ");
    userBuffers.delete(senderId);
    if (!isBotPaused(senderId)) {
      handleMessageWithRetry(senderId, combinedMessage);
    }
  }, 2500);
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

// ==== التعليمات الصارمة للذكاء الاصطناعي ====
const SYSTEM_PROMPT = `أنت مساعد آلي صارم ومباشر لمتجر "SIKI STORE" في الجزائر. تتحدث بالدارجة الجزائرية المحترمة والمحايدة، وتجيب باختصار شديد دون مقدمات أو ثرثرة.

الخدمات والأسعار المعتمدة في المتجر (حصرياً هذه الأربعة فقط):
• سناب شات بلس (Snapchat Plus): 2700 دج (لمدة 12 شهر، للآيفون فقط، التفعيل في الحساب الشخصي للزبون).
• كانفا برو (Canva Pro): 500 دج (لمدة 3 سنوات).
• جيميناي برو (Gemini Advanced): 1000 دج (لمدة 18 شهر).
• كابكات برو (CapCut Pro): شهر بـ 1000 دج | 6 أشهر بـ 3500 دج.

طرق الدفع المتوفرة فقط:
• باريدي موب (BaridiMob).
• فليكسي (Flexy) مع زيادة 20% على السعر الأصلي.

قواعد صارمة جداً (ممنوع مخالفتها تحت أي ظرف):
1. عند السؤال عن الأسعار (مثل: شحال، Prix، الأسعار): اذكر قائمة الأسعار مباشرة وبدقة. **ممنوع منعاً باتاً** كتابة جملة "اصبر دوك يجي الأدمن يكمل معاك" عند عرض الأسعار أو الإجابة عن استفسار عادي.
2. جملة "اصبر دوك يجي الأدمن يكمل معاك" تُكتب **فقط وحصرياً** في الحالات التالية:
   - إذا قال الزبون أنه يريد الشراء الآن أو طلب رقم الحساب للدفع (RIP / رقم الهاتف).
   - إذا أرسل الزبون إيميل أو معلومات حسابه لتفعيل الخدمة.
3. إذا سأل الزبون عن أي خدمة أخرى غير الخدمات الأربع المذكورة أعلاه (مثل: ChatGPT, Netflix, IPTV, Spotify, سناب للأندرويد...): أجب بهذه الجملة فقط دون أي إضافة: "ما عندناش هذي الخدمة."
4. ممنوع اختراع أسعار أو تخفيضات أو مدد اشتراك غير مذكورة أعلاه.
5. ممنوع طلب الإيميل أو كلمة السر من الزبون.
6. ممنوع تماماً استخدام ألقاب مثل (خويا، أختي، صاحبي، خو، حنون). خاطب الزبون بصيغة محايدة دائماً.
7. ممنوع ذكر CCP أو البطاقة الذهبية أو Visa أو PayPal.`;

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
        // 1. معالجة رسائل الصفحة (Echo) لمعرفة تدخل الأدمن
        if (webhookEvent.message && webhookEvent.message.is_echo) {
          const mid = webhookEvent.message.mid;
          const customerId = webhookEvent.recipient ? webhookEvent.recipient.id : null;
          if (!customerId) continue;

          const rawText = webhookEvent.message.text ? webhookEvent.message.text.trim() : "";
          const adminText = rawText.replace(/\uFE0F/g, "");

          if (wasSentByBot(mid)) {
            botSentMids.delete(mid);
          } else {
            // إلغاء أي رد مؤقت قيد الانتظار لهذا الزبون فوراً
            if (userBuffers.has(customerId)) {
              clearTimeout(userBuffers.get(customerId).timer);
              userBuffers.delete(customerId);
            }

            // السماح للأدمن بإعادة تشغيل البوت للزبون إذا كتب #بوت أو #bot
            if (adminText.toLowerCase() === "#bot" || adminText === "#بوت") {
              adminMutedUsers.delete(customerId);
              saveMutedUsers();
              console.log("🟢 تم إعادة تفعيل البوت للعميل:", customerId);
              continue;
            }

            adminMutedUsers.add(customerId);
            saveMutedUsers();
            console.log("🛑 الأدمن رد يدوياً. تم إيقاف البوت للعميل:", customerId);

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

        // 2. معالجة رسائل الزبون الواردة
        const senderId = webhookEvent.sender ? webhookEvent.sender.id : null;

        if (senderId && webhookEvent.message && !webhookEvent.message.is_echo) {
          if (isBotPaused(senderId)) {
            console.log("🔇 البوت متوقف على العميل لتكفل الأدمن به:", senderId);
            continue;
          }

          const incomingMid = webhookEvent.message.mid;
          if (alreadyProcessed(incomingMid)) {
            console.log("♻️ رسالة مكررة، تم تجاهلها:", incomingMid);
            continue;
          }

          // في حال إرسال صورة (وصل دفع غالباً)
          if (
            webhookEvent.message.attachments &&
            webhookEvent.message.attachments.some((a) => a.type === "image")
          ) {
            await sendMessage(
              senderId,
              "يعطيك الصحة، اصبر دوك يجي الأدمن يفيريفي الوصل ويكمل معاك التفعيل."
            );
            continue;
          }

          // في حال إرسال نص
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
    // تجاهل الخطأ
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
    ? `${SYSTEM_PROMPT}\n\nملاحظة: اسم الزبون هو "${customerName}" (لا تستخدم ألقاب مثل خويا أو أختي).`
    : SYSTEM_PROMPT;

  const historyToSend = [
    ...conversations[senderId],
    { role: "user", content: message }
  ].slice(-MAX_HISTORY);

  const response = await axios.post(
    url,
    {
      model: "google/gemini-2.5-flash",
      temperature: 0.0,
      messages: [
        { role: "system", content: promptWithContext },
        ...historyToSend,
      ],
      max_tokens: 250,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  const reply =
    response.data?.choices?.[0]?.message?.content?.trim() ||
    "اصبر دوك يجي الأدمن يكمل معاك.";

  // حفظ الرسالة والرد فقط بعد نجاح الطلب لمنع تكرار الرسائل عند إعادة المحاولة
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
