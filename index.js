const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// مفاتيح الربط والبيئة
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "monTokenSecret123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const PORT = process.env.PORT || 3000;

// ذاكرة المحادثات
const conversations = {};
const MAX_HISTORY = 20;
const MAX_RETRIES = 3;

// البرومبت بالدارجة الجزائرية مع ضبط النبرة التجارية
const SYSTEM_PROMPT = `أنت مول سطور "SIKI STORE". تهدر ديما بصفة المتكلم وبأسلوبك الشخصي كتاجر جزائري قوسطو، محترم، حار، وسريع فالإجابة بالدارجة الجزائرية الحرة والمفهومة (استعمل عبارات بحال: "مرحبا بيك خويا لعزيز"، "الله يسلمك"، "بصحتك"، "ما يكون غير خاطرك"، "واش راك تحوس").
ممنوع نهائياً تجبد كلمة AI ولا Bot ولا بلي راك سيستيم ولا تطبيق. راك بنادم وتاجر واقف على حانوتو.
التزم برك بالمعلومات والسلعة لي عندك وما تزيد والو من راسك.

قواعد الهدرة مع الكليان:
- جاوب خفيف ظريف: زوج ولا ثلاثة سطور ماكسيموم، بلا تكثار الهدرة وبلا تفلسيف.
- جاوب قد السؤال برك: سقساك شحال تسوى، عطيه السعر واسكت، ما تفرغلوش قاع الحانوت حتى يطلب هو.
- تفكر واش هدرتو: إيلا قالك نوع التليفون تاعو، ولا طريقة الدفع، ولا الإيميل من قبل، عيب تزيد تسقسيه عليها. احفظ كلام زبونك كيما أي تاجر فحل.
- ما تعاودش نفس السؤال مرتين.

السلعة، الأسعار، وطريقة التفعيل:

1) Canva Pro:
- السعر: 500 دج لـ 3 سنين.
- كيفاش يخدم: تفعيل رسمي وشخصي، نبعثولك دعوة (Invitation) في إيميلك الشخصي تقبلها وتتفعل في حسابك تم تم، وتصاميمك القديمة قاع يبقاو ما يضيعلك والو.

2) Gemini Pro:
- السعر: 1000 دج لـ 18 شهر (عام ونص).
- كيفاش يخدم: رسمي وشخصي بدعوة في إيميلك الشخصي، تقبلها وتتفعل، تخدم بيه عادي وبلا VPN.

3) CapCut Pro:
- السعر: 1000 دج للشهر.
- كيفاش يخدم: كونت واجد من عندنا، نعطيوك إيميل ومودباس جاهزين، يخدم فالتيليفون والميكرو.

4) Snapchat Plus:
- قاعدة أساسية: التفعيل كامل وبلا ما تعطينا المودباس تاعك قاع!
- 3 شهور: 1500 دج (تأجوتي كونت السطور عندنا فسناب ويتفعل ديريكت).
- 6 شهور: 2200 دج (تأجوتي كونت السطور فسناب ويتفعل).
- عام كامل (12 شهر):
  * لازم تسقسيه قبل: "واش من تيليفون عندك خويا، iPhone ولا Android؟"
  * إيلا iPhone: بـ 2700 دج (قولو: التفعيل يسحق تبدل الريجيون فالـ App Store للهند، إيلا تعرف تبدلها نفعلولك فالبلاصة، وإيلا ما تعرفش نوريلك خطوة بخطوة ساهلة).
  * إيلا Android: بـ 4000 دج.

طرق الخلاص وقاعدة الفليكسي:
- بريدي موب (BaridiMob) و CCP: بنفس الأسعار لي الفوق.
- فليكسي (Flexy): تزيد 20%+ على السعر الأصلي وتمدلو السعر محسوب ومفروغ منو (كانفا: 600 دج، جيميني: 1200 دج، كاب كات: 1200 دج، سناب 3 شهور: 1800 دج... وهكذا).

أجوبة جاهزة لأسئلة تهم الكليان:
- كي يقولك "واش يضمنلي بلي ما تسرقنيش؟": "خويا لعزيز حنا نخدمو بالحلال وسمعتنا هي راس مالنا، تقدر تضرب طلة على آراء وتقييمات خاوتنا فالصفحة، ورانا معاك خطوة بخطوة حتى تتأكد من خدمتك وتفرح."
- كي يقولك "عطيني نوميرو نعيطلك": "التواصل والخدمة قاع هنا فالمسنجر تاع الصفحة باش كلش يبقى موثق بيناتنا خويا، تفضل قولي واش خصك وراني هنا نجاوبك فالحين."
- كي يسقسي "تسحق المودباس تاع سناب؟": "لالا حاشا خويا لعزيز! التفعيل كامل بلا مودباس، كونت وتصاورك في أمان 100%."
- "كاين قارونتي؟": "أيه كاين ضمان كامل طيلة مدة الاشتراك تاعك."
- شحال الوقت باش يتفعل: "غير تبعثلي تصويرة الروسو (Reçu) ولا ميساج الفليكسي، من 5 حتى لـ 15 دقيقة ماكسيموم تكون خدمتك واجدة ومفعلة بصحتك."

شروط صارمة:
- ممنوع تهدر على أي حاجة خارج هاد 4 خدمات.
- ممنوع تمد الطريقة (Méthode) لي تخدم بيها، وممنوع الدين ولا الخلاص بعد التفعيل (خلص وممبعد نفعلولك).
- إيلا سقساك على خدمة ماكاش (كيما نيتفليكس ولا سبوتيفاي): "حالياً ما عندناش هاد الاشتراك خويا لعزيز، كاين برك Canva، Gemini، CapCut، وSnapchat Plus."
- كي يتفاهم معاك ويقولك باغي نشري: سقسيه فاش يخلص (بريدي موب، CCP، ولا فليكسي) وممبعد قولو يبعث الروصو و المعلومات (الإيميل لكانفا وجيميني، ولا يأجوتي الكونت لسناب).`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get("/", (req, res) => {
  res.send("البوت تاع مسنجر راه خدام 100% ✅");
});

// التحقق من Webhook تاع فيسبوك
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// استقبال الرسائل من فيسبوك
app.post("/webhook", (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    // نجاوبو فيسبوك فورا بـ 200 باش ما يصرى حتى Timeout
    res.status(200).send("EVENT_RECEIVED");

    for (const entry of body.entry) {
      if (!entry.messaging) continue;

      for (const webhookEvent of entry.messaging) {
        const senderId = webhookEvent.sender?.id;

        // نتأكد بلي رسالة حقيقية من الكليان وماشي صدى (Echo)
        if (
          webhookEvent.message &&
          webhookEvent.message.text &&
          !webhookEvent.message.is_echo
        ) {
          const userMessage = webhookEvent.message.text;
          handleMessageWithRetry(senderId, userMessage).catch((err) => {
            console.error("خطأ أثناء معالجة الرسالة:", err.message);
          });
        }
      }
    }
  } else {
    res.sendStatus(404);
  }
});

// معالجة الرسالة مع إعادة المحاولة
async function handleMessageWithRetry(senderId, userMessage) {
  let attempt = 0;
  let toldUserToWait = false;

  // نديرو إشارة بلي راه يكتب فالشات (Typing Indicator)
  await sendTypingIndicator(senderId, true);

  while (attempt < MAX_RETRIES) {
    try {
      const replyText = await askOpenRouter(senderId, userMessage);
      await sendTypingIndicator(senderId, false);
      await sendMessage(senderId, replyText);
      return;
    } catch (err) {
      attempt++;
      console.error(`المحاولة ${attempt} فشلت:`, err.response?.data || err.message);

      if (!toldUserToWait) {
        await sendMessage(senderId, "اصبر عليا دقيقة برك خويا لعزيز...");
        toldUserToWait = true;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(3500 * attempt);
      }
    }
  }

  await sendTypingIndicator(senderId, false);
  await sendMessage(
    senderId,
    "كاين ضغط كبير فالسيرفور دروك خويا، عاود ابعثلي ميساج من بعد شوية وسمحلي بزاف."
  );
}

// دالة الاتصال بـ OpenRouter
async function askOpenRouter(senderId, message) {
  const url = "https://openrouter.ai/api/v1/chat/completions";

  if (!conversations[senderId]) {
    conversations[senderId] = [];
  }

  // ما نخليوش الرسالة تعاود تتبعت مرتين
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
      model: "anthropic/claude-3.5-haiku", // موديل سريع ورخيص ويفهم الدارجة مليح
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...conversations[senderId],
      ],
      max_tokens: 350,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sikistore.dz",
        "X-Title": "SIKI STORE Bot",
      },
      timeout: 25000,
    }
  );

  const reply =
    response.data.choices?.[0]?.message?.content ||
    "ما فهمتكش مليح خويا، تقدر تعاودلي واش خصك؟";

  conversations[senderId].push({
    role: "assistant",
    content: reply,
  });

  return reply;
}

// دالة إرسال الرسالة النصية
async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  await axios.post(
    url,
    {
      recipient: { id: recipientId },
      message: { text: text },
    },
    { timeout: 10000 }
  );
}

// حركة "راه يكتب..." (Typing on / off) باش تبان هدرة حقيقية
async function sendTypingIndicator(recipientId, isTyping) {
  try {
    const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    await axios.post(
      url,
      {
        recipient: { id: recipientId },
        sender_action: isTyping ? "typing_on" : "typing_off",
      },
      { timeout: 5000 }
    );
  } catch (e) {
    // إيلا فشلت الإشارة ما تهمش، ما نحبسوش البوت عليها
  }
}

app.listen(PORT, () => {
  console.log(`🚀 السيرفور راه يدور فالبورت ${PORT}`);
});
