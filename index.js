const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// تخزين مؤقت لرسائل البوت والزبائن وحالة الأدمن
const sentByBotMids = new Set();
const userLastMessages = new Map(); // لمراقبة تكرار السؤال
const adminPausedUsers = new Set(); // الزبائن المعلقين بسبب تدخل أدمن

// الـ System Prompt المعدل بجميع شروطك ولهجتك الصافية
const SYSTEM_PROMPT = `أنت "مساعد ذكي SIKI" الخاص بمتجر SIKI STORE الجزائري لبيع الاشتراكات الرقمية.
مهمتك: الرد على الزبائن بالدارجة الجزائرية المباشرة والمحترمة، بدون إطالة أو فلسفة زائدة.

[قواعد اللهجة والمفردات الصارمة]
- التخاطب: استعمل "خويا" للمذكر، و"أختي" للمؤنث حسب الاسم.
- ممنوع منعاً باتاً: (باغي، مزيان، دابا، عافاك، صافي، لابريدوف، تم-تم، نرسلك دعوة).
- استعمل حصراً هذه البدائل الجزائرية:
  1. الإيجاب: مليح.
  2. التوقيت الحاضر: دوك، دك.
  3. الملكية: تاعك أو ديالك.
  4. السؤال عن الحاجة: واش راك حاب، واش تحوس، واش خصك.
  5. الشكر: ربي يحفظك، تعيش (للمذكر) / تعيشي (للمؤنث).
  6. الدفع: كيفاش نخلصك، كيفاش نبعتلك.
  7. الاتفاق: خلاص تفاهمنا.
  8. إثبات الدفع: الوصل.
  9. السرعة: سريعا.
  10. المشاكل: كاين مشكل؟ / كاين بروبلام؟

[قواعد التنسيق والمنتجات]
عند إعطاء الأسعار، اعرضها حصراً بهذا التنسيق وبأسطر منفصلة تماماً:
• Canva Pro
 (3 سنوات بـ 500 دج)
• Gemini Pro
 (18 شهر بـ 1000 دج)
• CapCut Pro
 (شهر بـ 1000 دج)
• Snapchat Plus 
(3 أشهر، 6 أشهر، سنة)

[شروط وطرق التفعيل]
- CapCut Pro:
  * نعطيوك حساب جاهز (إيمايل وكلمة السر) بشرط عدم تغيير كلمة السر إطلاقاً.
  * التفعيل يكون فالهاتف أولاً داخل التطبيق.
  * وإذا حبيت ديرو فالحاسوب، لازم تكون مثبت برنامج كابكات على الحاسوب وتتواصل معانا باش نديرولك مسح Code QR.
- Gemini Pro:
  * نرسلولك رابط تفعيل فـ الإيمايل الشخصي تاعك (ممنوع نهائياً تقول نرسلك دعوة).

[قواعد التعامل مع الدفع والأدمن]
- طرق الدفع: BARIDIMOB، CCP، FLEXY (+20%).
- البوت لا يرسل أرقام الحسابات نهائياً، الرد يكون دائماً:
  "تفضل خويا/أختي، اصبر عليا شوية يدخل الأدمن يعطيك معلومات الحساب باش تبعت، والتفعيل يكون سريعا بعد ما تبعتلنا الوصل."
`;

// Webhook Verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// استقبال الرسائل ومعالجتها
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;
            const recipient_psid = webhook_event.recipient.id;

            // 1. معالجة الـ echo لحل مشكلة توقف البوت
            if (webhook_event.message && webhook_event.message.is_echo) {
                const messageMid = webhook_event.message.mid;
                const appId = webhook_event.message.app_id;

                // إذا كانت الرسالة خرجت من البوت نفسه (عبر الـ API) نتجاهلها
                if (sentByBotMids.has(messageMid) || appId) {
                    continue;
                }

                // إذا كانت الرسالة مبعوثة من الصفحة يدوياً (أدمن حقيقي من تطبيق Meta Business أو الهاتف)
                // هنا فقط نسكت البوت عن هذا الزبون
                adminPausedUsers.add(recipient_psid);
                continue;
            }

            // إذا كان الأدمن قد تدخل مسبقاً، لا يرد البوت
            if (adminPausedUsers.has(sender_psid)) {
                continue;
            }

            // 2. معالجة رسائل الزبون
            if (webhook_event.message && webhook_event.message.text) {
                const incomingText = webhook_event.message.text.trim();

                // شرط: إذا سأل الزبون مرتين بنفس السؤال، لا ترد عليه بنفس الجواب مرتين
                const lastData = userLastMessages.get(sender_psid);
                if (lastData && lastData.text.toLowerCase() === incomingText.toLowerCase()) {
                    // رسالة تنبيه خفيفة بدل تكرار نفس الرد الطويل السابق
                    await callSendAPI(sender_psid, "راني سمعتك خويا/أختي، اصبر عليا شوية برك ويكون عندك الرد.");
                    continue;
                }

                // استدعاء Claude API
                const botReply = await askClaude(incomingText);

                // حفظ آخر رسالة سألها الزبون
                userLastMessages.set(sender_psid, { text: incomingText, reply: botReply });

                // إرسال الرد
                await callSendAPI(sender_psid, botReply);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// دالة الاتصال بـ Claude
async function askClaude(userText) {
    try {
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 500,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userText }]
        }, {
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            }
        });

        return response.data.content[0].text;
    } catch (error) {
        console.error('Claude API Error:', error.response?.data || error.message);
        return "مرحبا بك خويا/أختي في SIKI STORE، ثواني ويدخل الأدمن يجاوبك.";
    }
}

// دالة إرسال الرسالة إلى مسنجر وحفظ الـ mid
async function callSendAPI(recipientId, messageText) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            {
                recipient: { id: recipientId },
                message: { text: messageText }
            }
        );

        // نسجل الـ mid تاع الرسالة اللي بعثها البوت حتى لا يحسبها أدمن في الـ echo
        if (response.data && response.data.message_id) {
            sentByBotMids.add(response.data.message_id);
            // تفريغ الذاكرة بعد دقيقة لتفادي التراكم
            setTimeout(() => sentByBotMids.delete(response.data.message_id), 60000);
        }
    } catch (error) {
        console.error('Send API Error:', error.response?.data || error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
