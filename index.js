const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

// ==========================================
// 🔑 المفاتيح تُقرأ الآن من السحابة مباشرة
// ==========================================
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// ==========================================
// 📊 إعداد الاتصال بجوجل شيت (معدل للسحابة)
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
        console.log('✅ تم تسجيل الطلب!');
    } catch (error) {
        console.error('❌ خطأ في السيرفر:', error.message);
    }
}

// ==========================================
// 🧠 الذكاء الاصطناعي (مع نظام الصبر)
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
        return "عذراً، المتجر يشهد ضغطاً حالياً، يرجى المحاولة بعد قليل.";
    }
}

// ==========================================
// 🚀 استقبال الرسائل
// ==========================================
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
        const changes = body.entry[0].changes[0].value;
        if (!changes.messages) return res.sendStatus(200);
        
        const from = changes.messages[0].from;
        const msgText = changes.messages[0].text.body;

        const botReply = await generateSmartResponse(msgText, from);
        
        // معالجة الطلبات
        if (botReply.includes("ORDER_DATA:")) {
            const parts = botReply.split("ORDER_DATA:");
            const details = parts[1].split("|");
            await saveOrderToSheet(from, details[0], details[1], details[2]);
        }

        await axios.post(`https://graph.facebook.com/v25.0/${changes.metadata.phone_number_id}/messages`, {
            messaging_product: 'whatsapp', to: from, text: { body: botReply.split("ORDER_DATA:")[0] }
        }, { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` } });

        res.sendStatus(200);
    }
});

// هذا المنفذ (Port) ضروري لـ Render
app.listen(process.env.PORT || 3000, () => console.log('🚀 البوت يعمل في السحابة!'));