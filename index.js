const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ==========================================
// خاصك تبدل هاد القيم بـ Environment Variables فـ Render
// ==========================================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "monTokenSecret123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const PORT = process.env.PORT || 3000;

// صفحة بسيطة باش تتأكد أن السيرفر خدام
app.get("/", (req, res) => {
  res.send("Facebook Messenger Bot is running ✅");
});

// ==========================================
// 1) التحقق من الـ Webhook (Facebook يبعث GET)
// ==========================================
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

// ==========================================
// 2) استقبال الرسائل (Facebook يبعث POST)
// ==========================================
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const userMessage = webhookEvent.message.text;
        try {
          const replyText = await askGemini(userMessage);
          await sendMessage(senderId, replyText);
        } catch (err) {
          console.error("Error:", err.message);
          await sendMessage(
            senderId,
            "عذرًا، صرا مشكل تقني، عاود جرب من بعد."
          );
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// ==========================================
// دالة: بعث السؤال لـ Gemini وجيب الجواب
// ==========================================
async function askGemini(message) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await axios.post(url, {
    contents: [
      {
        parts: [{ text: message }],
      },
    ],
  });

  const reply =
    response.data.candidates?.[0]?.content?.parts?.[0]?.text ||
    "ما فهمتش، تقدر تعاود تسولني؟";

  return reply;
}

// ==========================================
// دالة: بعث الرد للمستخدم عبر Messenger
// ==========================================
async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  await axios.post(url, {
    recipient: { id: recipientId },
    message: { text: text },
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
