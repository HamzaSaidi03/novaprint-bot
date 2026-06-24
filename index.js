const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

// ==========================================
// 🔑 المفاتيح من السحابة (Environment Variables)
// ==========================================
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ==========================================
// 📊 إعداد الاتصال بجوجل شيت
// ==========================================
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function saveOrderToSheet(phone, name, order, address) {
    try {
        const date = new Date().toLocaleString('ar-MA', { timeZone: 'Africa/Casablanca' });
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:E',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[phone, name, order, address, date]] }
        });
        console.log('✅ تم تسجيل الطلب في جوجل شيت!');
    } catch (error) {
        console.error('❌ خطأ في السيرفر (جوجل شيت):', error.message);
    }
}

// ==========================================
// 🧠 الذكاء الاصطناعي (Gemini)
// ==========================================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const userSessions = new Map();

async function generateSmartResponse(userMessage, phoneNumber) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let chat = userSessions.get(phoneNumber) || model.startChat({ 
            history: [{ role: "user", parts: [{ text: "أنت مساعد ذكي لمتجر NovaPrint Studio. إذا أراد العميل الشراء، اطلب (الاسم، المدينة، نوع الطلب). بعد البيانات، أكد الطلب وأضف حصراً: ORDER_DATA:الاسم|الطلب|العنوان" }] }]
        });
        userSessions.set(phoneNumber, chat);
        const result = await chat.sendMessage(userMessage);
        return result.response.text();
    } catch (error) {
        console.error('❌ خطأ في الذكاء الاصطناعي:', error.message);
        return "عذراً، المتجر يشهد ضغطاً حالياً، يرجى المحاولة بعد قليل.";
    }
}

// ==========================================
// 🛡️ كود التحقق الخاص بواتساب (لربط الرابط بنجاح)
// ==========================================
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = "nova123"; // الكلمة السرية للربط في منصة Meta
    
    let mode = req.query["hub.mode"];
    let token = req.query["hub.verify_token"];
    let challenge = req.query["hub.challenge"];

    if (mode && token) {
        if (mode === "subscribe" && token === VERIFY_TOKEN) {
            console.log("✅ تم التحقق من واتساب بنجاح!");
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// ==========================================
// 🚀 استقبال الرسائل من الزبائن
// ==========================================
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
        try {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0]?.value;
            
            if (changes?.messages) {
                const from = changes.messages[0].from;
                const msgText = changes.messages[0].text.body;
                const phone_number_id = changes.metadata.phone_number_id;

                const botReply = await generateSmartResponse(msgText, from);
                
                // معالجة الطلبات لتسجيلها
                let finalReply = botReply;
                if (botReply.includes("ORDER_DATA:")) {
                    const parts = botReply.split("ORDER_DATA:");
                    finalReply = parts[0]; // النص الذي سيقرأه الزبون
                    const details = parts[1].split("|");
                    if (details.length >= 3) {
                        await saveOrderToSheet(from, details[0].trim(), details[1].trim(), details[2].trim());
                    }
                }

                // إرسال الرد عبر واتساب
                await axios.post(`https://graph.facebook.com/v25.0/${phone_number_id}/messages`, {
                    messaging_product: 'whatsapp',
                    to: from,
                    text: { body: finalReply }
                }, {
                    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
                });
            }
        } catch (error) {
            console.error('❌ خطأ في إرسال الرسالة:', error.message);
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// ==========================================
// 🌐 تشغيل الخادم
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 البوت يعمل الآن على المنفذ ${PORT}!`));