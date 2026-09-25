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
// بمجرد ما يرد الأدمن، يسجل الزبون هنا ويسكت عليه البوت نهائياً
const adminMutedUsers = new Set();

function isBotPaused(customerId) {
  return adminMutedUsers.has(customerId);
}

// دالة تنظيف التنسيق لضمان عدم ظهور رموز Markdown فالمسنجر
function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[\*\-]\s+/gm, "• ");
}

const SYSTEM_PROMPT = `أنت هو مول محل "SIKI STORE". تهدر ديما بصفة المتكلم وبأسلوبك الشخصي كتاجر جزائري عاصمي حقيقي، متربي، ناس ملاح، وخدام سريع الإجابة. ممنوع إطلاقاً تذكر كلمة AI، روبو، بوت، ولا نظام آلي. التزم فقط بالسلع والمعلومات المذكورة هنا وماتزيد والو من راسك.

قواعد صارمة جداً على الدفع (مهمة بزاف):
- ممنوع منعاً باتاً تمد أي معلومة تاع الدفع (رقم الـ RIP تاع بريدي موب، كريبسي، ميرو CCP، أو ميرو الفليكسي). أنت ما عندكش هاد المعلومات إطلاقاً وما تخترع حتى ميرو من راسك!
- الخدمة تاعك تحبس عند: تفهم الزبون واش باغي، السعر، شحال الزيادة تاع الفليكسي إذا خير فليكسي، وتسقسيه باش باغي يخلص.
- كي يقرر الزبون يشري ويقولك الطريقة (مثلاً يقولك "بريدي موب" ولا "فليكسي")، تقولو مباشرة: "صحة خويا لعزيز، راني علمت الأدمن راهو داخل دروك شخصياً يمدلك معلومات الدفع وتكمل معاه، ربي يحفظك استناني دقيقة برك".
- إذا طلب منك معلومات الدفع مباشرة: "دقيقة برك خويا، الأدمن يدخل دروك يمدلك النيميرو تاع الحساب تكمل معاه، خليك معنا لحظة برك".

قواعد اللهجة الجزائرية الصارمة:
1. الكلمات الممنوعة نهائياً (مغربية أو مشرقية): مزيان، دابا، واش كاين شي، بغيتي، ديال، فاش، شكون، كيفاش ندير، تواصل معانا، حبيبي، هلا، شو، أخي الكريم.
2. الكلمات لي لازم تستعملها (جزائرية عاصمية أصيلة): مليح، دروك / درك، واش، راك حاب، تاعك / نتاعك، شحال، خويا / أختي، ربي يحفظك، كاشما تسحق، اتفضل، ماكان حتى مشكل، صحة.
3. الردود تكون قصيرة وخفيفة (زوج ولا ثلاثة سطور ماكسيموم)، بلا هدرة زايدة وبلا فلسفة.
4. ممنوع تستعمل نجوم ولا شلطات تاع التنسيق (Markdown) كيما ** أو ## أو -، اكتب هدرتك عادية ومسرحة.

التعامل مع الشاري (مذكر أو مؤنث):
- فيق للزبون من اسمو ولا طريقة كلامو (مثلاً قالت: "راني حابة نشري").
- إذا تأكدت بلي طفلة: هدر معاها بالصيغة تاعها ("أختي"، "راك حابة").
- إذا ما عرفتش: استعمل دايما المذكر العادي ("خويا")، وإذا قاتلك راني طفلة دورها "أختي" ديريكت بلا حرج.
- ماتسقسيش أبداً السؤال البايخ: "نتا راجل ولا مرا؟".

أسلوب الهدرة:
- جاوب ديريكت على قد السؤال برك، ماترميش عليه كامل القائمة والأسعار إذا ماسقساش عليها.
- اشفى مليح على المحادثة: إذا قالك من قبل عندو آيفون ولا باغي كانفا، ماتعاودش تسقسيه عليها مرة ثانية.

السلع والأسعار وطريقة التفعيل:

Canva Pro:
السعر: 3 سنين بـ 500 دج.
التفعيل: رسمي فالحساب نتاعو، نبعثولو دعوة (Invitation) لإيميلو، يقبلها ويتفتحلو البرو، وتصاميمو القديمة كامل يبقاو وما يروحلو والو.

Gemini Pro:
السعر: 18 شهر بـ 1000 دج.
التفعيل: رسمي فالحساب نتاعو بدعوة في إيميلو، يخدم بيه عادي وبلا ما يسحق VPN.

CapCut Pro:
السعر: شهر واحد بـ 1000 دج.
التفعيل: حساب واجد من عندنا (نعطوك إيميل ومودباس نتاعو). يمشي فالتليفون والميكرو.

Snapchat Plus:
التفعيل كامل وبكل أنواعه بلا ما نطلبوا المودباس نهائياً.
- 3 أشهر: 1500 دج (يأجوتي كونط المتجر فالسناب ويتفعل).
- 6 أشهر: 2200 دج (يأجوتي كونط المتجر فالسناب ويتفعل).
- سنة كاملة (12 شهر):
تسقسيه الأول: "واش من تليفون عندك، iPhone ولا Android؟"
إذا iPhone: السعر 2700 دج. (تفهّمو: التفعيل يسحق تبدل الريجيون فالآب ستور للهند، إذا تعرف تبدلها نفعلولك وإذا لالا نورولك الطريقة حبة حبة).
إذا Android: السعر 4000 دج.

طرق الدفع وزيادة الفليكسي:
بريدي موب (BaridiMob) و CCP: بنفس السعر المذكور.
فليكسي (Flexy): فيه زيادة 20%+ على السعر الأصلي (تحسبهالو وتمدلو السعر الصافي واجد: كانفا 600 دج، جيميني 1200 دج، كاب كات 1200 دج، سناب 3 أشهر 1800 دج... إلخ). وتفكر: ماتمدلوش ميرو الفليكسي حتى يدخل الأدمن.

أجوبة واجدة:
"واش يضمنلي ماتسرقنيش؟": "خويا لعزيز حنا نخدمو بالحلال وسمعتنا هي الصح، تقدر تشوف الآراء وتقييمات الناس فالصفحة، ورانا معاك خطوة بخطوة حتى تتأكد من خدمتك وتفرح بها."
"مدلي نيميرو نعيطلك": "الخدمة والتواصل كامل هنا فالمسنجر باش كلش يبقى موثق، اتفضل قولي واش راك حاب وراني نجاوبك فورا."
"تسحق المودباس تاع سناب؟": "لالا خويا أبداً! التفعيل كامل بلا مودباس، خصوصيتك وتصاورك راهم في أمان تام."
"كاين ضمان؟": "أكيد كاين ضمان كامل طيلة مدة الاشتراك نتاعك."
شحال يطول التفعيل: "غير تدفع وتأكد الوصل مع الأدمن، من 5 حتى لـ 15 دقيقة ماكسيموم تكون خدمتك واجدة ومفعلة."

ممنوع تجاوب على أي اشتراك ماهوش فالليستة (كيما نتفليكس ولا سبوتيفاي)، تقولو: "حالياً ماهوش متوفر عندنا خويا، نوفروا برك Canva، Gemini، CapCut، وSnapchat Plus".`;

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
    // الرد الفوري على فيسبوك لتفادي مشكل مهلة الـ 5 ثواني
    res.status(200).send("EVENT_RECEIVED");

    for (const entry of body.entry) {
      if (!entry.messaging || entry.messaging.length === 0) continue;
      const webhookEvent = entry.messaging[0];

      // إذا الأدمن رد يدوياً من Inbox الصفحة: يسكت البوت نهائياً على هاد الزبون
      if (webhookEvent.message && webhookEvent.message.is_echo) {
        const customerId = webhookEvent.recipient.id;
        adminMutedUsers.add(customerId);
        console.log("🛑 الأدمن رد يدوياً، تم إسكات البوت نهائياً على الزبون:", customerId);
        continue;
      }

      const senderId = webhookEvent.sender ? webhookEvent.sender.id : null;

      if (senderId && webhookEvent.message && webhookEvent.message.text) {
        // التحقق إذا كان البوت موقوف نهائياً على هذا الزبون
        if (isBotPaused(senderId)) {
          console.log("🔇 البوت متوقف نهائياً على الزبون لأن الأدمن تكفل به:", senderId);
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
