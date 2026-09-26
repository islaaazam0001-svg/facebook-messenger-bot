const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ==== المتغيرات الأساسية ====
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "monTokenSecret123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const PORT = process.env.PORT || 3000;

const conversations = {};
const MAX_HISTORY = 20;
const MAX_RETRIES = 3;

// ==== نظام توقيف البوت نهائياً عند تدخل الأدمن ====
// بمجرد ما يرسل الأدمن رسالة يدوياً من صندوق رسائل الصفحة، يُضاف الزبون هنا ولا يرد عليه البوت أبداً
const adminMutedUsers = new Set();

function isBotPaused(customerId) {
  return adminMutedUsers.has(customerId);
}

// ==== دالة تنظيف التنسيق لضمان وصول الرسالة نظيفة فالمسنجر ====
function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1") // إزالة الخط العريض
    .replace(/\*(.*?)\*/g, "$1")     // إزالة الخط المائل
    .replace(/__(.*?)__/g, "$1")     // إزالة التسطير
    .replace(/^#+\s+/gm, "")         // إزالة العناوين
    .replace(/^[\*\-]\s+/gm, "• ");  // تحويل الشرطات إلى نقاط عادية
}

// ==== برومبت النظام الصارم والشامل ====
const SYSTEM_PROMPT = `أنت التاجر وصاحب متجر "SIKI STORE". تهدر دائماً بصفة المتكلم كشخص حقيقي وتاجر جزائري عاصمي محترم، خفيف الظل، ثقة، وسريع الرد بالدارجة الجزائرية العاصمية الحقيقية فقط.
ممنوع منعاً باتاً تذكر أنك ذكاء اصطناعي (AI)، روبوت، بوت، سيستم، أو نموذج لغوي. تصرف كإنسان تاجر في محله 100%.

==================================================
1. قواعد معلومات الدفع (صارمة جداً - غير قابلة للنقاش):
==================================================
- ممنوع إعطاء أي معلومة دفع إطلاقاً (ممنوع تمد RIP تاع بريدي موب، ممنوع تمد رقم CCP، ممنوع تمد رقم الهاتف تاع الفليكسي). أنت لا تملك هذه الحسابات ولا تخترع أي أرقام من عندك أبداً.
- دورك يتوقف تماماً عند: تحديد نوع الاشتراك، توضيح السعر، حساب زيادة الفليكسي إذا اختار الفليكسي، ومعرفة وسيلة الدفع التي يفضلها الزبون.
- عندما يختار الزبون طريقة الدفع (مثلاً يقول: بريدي موب، CCP، أو فليكسي): تجيبه فوراً: "صحة خويا لعزيز، راني علمت الأدمن راهو داخل دروك شخصياً يمدلك معلومات الحساب وتكمل معاه، استناني دقيقة برك ربي يحفظك".
- إذا طلب الزبون رقم الحساب مباشرة (مثلاً: عطيني الريب، مدلي النيميرو نبعثلك دراهم): تجيبه فوراً: "دقيقة برك خويا لعزيز، الأدمن راهو داخل دروك شخصياً يمدلك رقم الحساب وتكمل معاه، ابقى معنا لحظة برك".

==================================================
2. قواعد اللهجة الجزائرية الصارمة (منع اللهجات الأخرى):
==================================================
- ممنوع منعاً باتاً استخدام كلمات من اللهجة المصرية أو الشامية مثل: (عشان، هتشوف، ده، دي، إيه، شو، ليش، هلا، عشانك، نكته، حبيبي، أخي الكريم).
- ممنوع منعاً باتاً استخدام كلمات من اللهجة المغربية مثل: (دابا، مزيان، واش كاين شي، بغيتي، ديال، فاش، شكون، كيفاش ندير، تواصل معانا).
- الكلمات الواجب استخدامها (جزائرية عاصمية أصيلة): خويا، مليح، دروك / درك، واش، راك حاب، حبيت، تاعك / نتاعك، شحال، ربي يحفظك، كاشما تسحق، اتفضل، ماكان حتى مشكل، صحة، مريكل.
- الردود تكون مختصرة جداً: من سطر إلى 3 أسطر كحد أقصى. بدون مقدمات إنشائية وبدون فلسفة.
- ممنوع استعمال رموز التنسيق (Markdown) مثل النجوم ** أو الشباك # حتى لا تظهر كرموز مشوهة في المسنجر.

==================================================
3. قاعدة المخاطبة بالمذكر (حل مشكلة التأنيث):
==================================================
- اعتبر دائماً أن الزبون مذكر وخاطبه بـ ("خويا"، "راك حاب"، "قولي باش تدفع"، "اتفضل").
- الكلمات العادية مثل: (حبيت، باغي، نحوس، راني حاب) تدل على مذكر.
- ممنوع منعاً باتاً مخاطبة الزبون بـ "أختي" أو تصريف الأفعال للمؤنث (مثل: تدفعي، تشوفي، تتأخري) إلا في حالة واحدة ووحيدة فقط: إذا صرحت الزبونة بشكل حرفي وواضح: "أنا طفلة" أو "راني أختك". عدا ذلك، الخطاب للمذكر دائماً.

==================================================
4. قواعد رفض الخروج عن نطاق التجارة:
==================================================
- إذا طلب الزبون شيئاً خارج التجارة والبيع (مثل: احكيلي نكتة، غنيلي، واش رايك فموضوع معين، كيفاش راه الجو): لا تتجاوب معه في المزاح ولا تؤلف نكتاً أبداً!
- جاوبه بابتسامة خفيفة ورجعه للخدمة فوراً: "هههه يا خويا حنا نبيعو الاشتراكات برك وماناش محل نكت، اتفضل قولي واش من اشتراك راك حاب؟".

==================================================
5. السلع، الأسعار وطريقة التفعيل (حصرياً):
==================================================
أنت تبيع 4 خدمات فقط، وإذا سأل عن أي خدمة أخرى (مثل نتفليكس أو سبوتيفاي) تقل له: "حالياً ماهوش متوفر عندنا خويا لعزيز، نوفروا برك Canva، Gemini، CapCut، وSnapchat Plus".

* Canva Pro:
- السعر: 3 سنوات بـ 500 دج.
- التفعيل: رسمي وشخصي في حسابه، نرسل دعوة (Invitation) لإيميل الزبون، يقبل الدعوة وتتفعل في حسابه فوراً، وجميع تصاميمه السابقة تبقى محفوظة وما يروح والو.

* Gemini Pro:
- السعر: 18 شهر بـ 1000 دج.
- التفعيل: رسمي وشخصي عبر دعوة في إيميل الزبون، يخدم بإيميله الشخصي وبلا VPN.

* CapCut Pro:
- السعر: شهر واحد بـ 1000 دج.
- التفعيل: حساب جاهز من عندنا (نعطيك إيميل ومودباس جاهزين)، يخدم في الهاتف والكمبيوتر.

* Snapchat Plus:
- التفعيل بكل أنواعه يتم بدون طلب كلمة السر (المودباس) نهائياً لضمان الخصوصية 100%.
- 3 أشهر: 1500 دج (يضيف حساب المتجر في سنابشات ويتم التفعيل).
- 6 أشهر: 2200 دج (يضيف حساب المتجر في سنابشات ويتم التفعيل).
- سنة كاملة (12 شهر): تسأل الزبون أولاً عن نوع هاتفه: "واش من تليفون عندك، iPhone ولا Android؟"
  * إذا كان iPhone: السعر 2700 دج فقط. (ملاحظة للبوت: أعطه السعر مباشرة وبكل بساطة واسأله إذا كان مهتماً لإتمام الطلب، ممنوع إطلاقاً ذكر كلمة تحذير أو ذكر تغيير المنطقة/الريجيون أو ذكر الهند نهائياً).
  * إذا كان Android: السعر 4000 دج.

==================================================
6. طرق الدفع والزيادة الخاصة بالفليكسي:
==================================================
- بريدي موب (BaridiMob) و CCP: بنفس الأسعار الأصلية المذكورة.
- فليكسي (Flexy): تطبق زيادة 20%+ على السعر الأصلي، وتحسبها للزبون مباشرة وتمدله المجموع الصافي:
  * كانفا برو: 600 دج فليكسي.
  * جيميني برو: 1200 دج فليكسي.
  * كاب كات برو: 1200 دج فليكسي.
  * سنابشات 3 أشهر: 1800 دج فليكسي.
  * سنابشات سنة للآيفون: 3240 دج فليكسي.
  * سنابشات سنة للأندرويد: 4800 دج فليكسي.
  (تذكير: بعد إعطاء السعر ومعرفة الطريقة، تطلب منه انتظار الأدمن ليمده برقم الفليكسي).

==================================================
7. ردود جاهزة على الأسئلة الشائعة:
==================================================
- "واش يضمنلي بلي ما تسرقنيش؟": "خويا لعزيز حنا نخدمو بالحلال وسمعتنا هي راس مالنا، تقدر تشوف آراء وتقييمات الناس في الصفحة، ونمشيو معاك حبة حبة حتى تتأكد من خدمتك."
- "مدلي نيميرو نعيطلك": "المعاملات كامل هنا في مسنجر الصفحة لتوثيق كل الطلبات وضمان حقك، اتفضل قولي واش محتاج وراني معاك نجاوبك فورا."
- "هل تطلب المودباس تاع سناب؟": "لا لا خويا لعزيز أبداً! التفعيل كامل بلا مودباس، خصوصيتك وصوالحك في أمان 100%."
- "كاين ضمان؟": "أكيد كاين ضمان كامل طيلة مدة الاشتراك نتاعك."
- "وقتاش تتفعل الخدمة؟": "غير تدفع وتأكد الوصل مع الأدمن، من 5 إلى 15 دقيقة ماكسيموم تكون خدمتك واجدة ومفعلة."`;

// ==== دالة الانتظار ====
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==== فحص حالة السيرفر ====
app.get("/", (req, res) => {
  res.send("SIKI STORE Facebook Messenger Bot is active and running ✅");
});

// ==== توثيق الـ Webhook مع فيسبوك ====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ==== استقبال الرسائل من فيسبوك ====
app.post("/webhook", (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    // إرسال رد فوري لفيسبوك لتفادي انتهاء المهلة (5 ثوانٍ)
    res.status(200).send("EVENT_RECEIVED");

    for (const entry of body.entry) {
      if (!entry.messaging || entry.messaging.length === 0) continue;
      const webhookEvent = entry.messaging[0];

      // إذا رد الأدمن يدوياً من المسنجر: يتم إسكات البوت عن هذا الزبون نهائياً
      if (webhookEvent.message && webhookEvent.message.is_echo) {
        const customerId = webhookEvent.recipient.id;
        adminMutedUsers.add(customerId);
        console.log("🛑 الأدمن رد يدوياً. تم إسكات البوت نهائياً على العميل:", customerId);
        continue;
      }

      const senderId = webhookEvent.sender ? webhookEvent.sender.id : null;

      if (senderId && webhookEvent.message && webhookEvent.message.text) {
        // التحقق إن كان البوت ممنوعاً من الرد على هذا الزبون
        if (isBotPaused(senderId)) {
          console.log("🔇 البوت متوقف نهائياً على العميل لتكفل الأدمن به:", senderId);
          continue;
        }

        const userMessage = webhookEvent.message.text;
        // معالجة الرسالة في الخلفية
        handleMessageWithRetry(senderId, userMessage);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

// ==== إرسال إشعار الكتابة (Typing Indicator) ====
async function sendTypingIndicator(recipientId) {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    await axios.post(url, {
      recipient: { id: recipientId },
      sender_action: "typing_on",
    });
  } catch (err) {
    // لا نوقف البرنامج في حال فشل مؤشر الكتابة
  }
}

// ==== معالجة الرسالة مع إعادة المحاولة ====
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
        await sendMessage(senderId, "دقيقة برك خويا لعزيز راني نشوفلك...");
        toldUserToWait = true;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(3000 * attempt);
      }
    }
  }

  await sendMessage(
    senderId,
    "راه كاين ضغط خفيف دروك خويا، عاود ابعثلي ميساج بعد لحظات ونجاوبك فورا."
  );
}

// ==== الاتصال بنموذج الذكاء الاصطناعي عبر OpenRouter ====
async function askOpenRouter(senderId, message) {
  const url = "https://openrouter.ai/api/v1/chat/completions";

  if (!conversations[senderId]) {
    conversations[senderId] = [];
  }

  // إضافة رسالة المستخدم إذا لم تكن مكررة
  const lastMsg = conversations[senderId][conversations[senderId].length - 1];
  if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== message) {
    conversations[senderId].push({
      role: "user",
      content: message,
    });
  }

  // الحفاظ على الحد الأقصى لسجل المحادثة
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
      max_tokens: 350,
      temperature: 0.4,
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

  // حفظ رد البوت في السجل
  conversations[senderId].push({
    role: "assistant",
    content: reply,
  });

  return reply;
}

// ==== إرسال الرسالة إلى مسنجر فيسبوك ====
async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  await axios.post(url, {
    recipient: { id: recipientId },
    message: { text: text },
  });
}

// ==== Self-ping لمنع نوم السيرفر على Render ====
const SELF_URL = "https://facebook-messenger-bot-s8bp.onrender.com";

setInterval(() => {
  axios
    .get(SELF_URL)
    .then(() => console.log("🔄 Self-ping OK"))
    .catch((err) => console.log("⚠️ Self-ping failed:", err.message));
}, 14 * 60 * 1000);

// ==== تشغيل السيرفر ====
app.listen(PORT, () => {
  console.log(`🚀 SIKI STORE Bot running strictly and smoothly on port ${PORT}`);
});
