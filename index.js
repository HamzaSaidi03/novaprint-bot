const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis'); 

const app = express();
app.use(bodyParser.json());

// ==========================================
// 🔑 المفاتيح السرية
// ==========================================
const VERIFY_TOKEN = "my_secret_token_1234";
const ACCESS_TOKEN = "EAAjTyKrBGQ8BRx5MnMJIQw0QRyNxJxt1rhkj9eCoZAttZCTGnWNnOWyhJQVv56Vwn28qh8vjkN2lVof5qiCKkd9ybF74czO48yD6TPV80ojrzl3K7KKHUtqK5uR3zJvTPkjiQZAw7MX8NnfmZAGE8C3WDvLm3n8urZBYwwwlnS3dpEfZBMYA5LneMx3BleZBcFrkhBYzP3gDBcjMhBvHDCK1brtmRSVZC0cr229z6rBhoFzYJsqFig0xePxm8e6rkUSAdflS9ZAzRiFfVZCzNs4ZBWsY7C7"; 
const GEMINI_API_KEY = "AQ.Ab8RN6JA0L6zA-GUpmDePqSPRCF4QGE1BbNyDNbg1QODIZy0yg"; 
const SPREADSHEET_ID = "1dMncJjORaHEBGLWkGUODWwfTFwrpp_rZjrQt3FPZAa8"; 

// ==========================================
// 📊 إعداد الاتصال بجوجل شيت
// ==========================================
const auth = new google.auth.GoogleAuth({
    keyFile: './credentials.json', 
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
            resource: {
                values: [[phone, name, order, address, date]]
            }
        });
        console.log('✅ تم تسجيل الطلب في جوجل شيت!');
    } catch (error) {
        console.error('❌ خطأ في تسجيل الطلب:', error.message);
    }
}

// ==========================================
// 🧠 الذكاء الاصطناعي (معدل للتعامل مع الضغط)
// ==========================================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const userSessions = new Map();

async function generateSmartResponse(userMessage, phoneNumber) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let chat = userSessions.get(phoneNumber) || model.startChat({ 
            history: [{ role: "user", parts: [{ text: "أنت مساعد ذكي لمتجر NovaPrint Studio. الشحن 5 دولارات، المدة 3-5 أيام. إذا أراد العميل الشراء، اطلب (الاسم، المدينة، نوع الطلب). بعد البيانات، أكد الطلب وأضف حصراً: ORDER_DATA:الاسم|الطلب|العنوان" }] }]
        });
        
        userSessions.set(phoneNumber, chat);
        const result = await chat.sendMessage(userMessage);
        return result.response.text();
    } catch (error) {
        if (error.message.includes("429")) {
            console.warn("⚠️ ضغط طلبات، سيحاول البوت التهدئة.");
            return "عذراً، المتجر يشهد ضغطاً حالياً، يرجى إعادة إرسال رسالتك بعد دقيقة.";
        }
        console.error('❌ خطأ في Gemini:', error.message);
        return "عذراً، هناك مشكلة فنية مؤقتة، حاول مجدداً بعد قليل.";
    }
}

// ==========================================
// 🚀 استقبال الرسائل
// ==========================================
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
        const changes = body.entry[0].changes[0].value;
        if (!changes.messages || changes.messages.length === 0) return res.sendStatus(200);
        
        const message = changes.messages[0];
        const from = message.from; 

        if (message.type !== 'text') return res.sendStatus(200);

        let botReply = await generateSmartResponse(message.text.body, from);
        let finalReply = botReply;
        let orderData = null;

        if (typeof botReply === 'string' && botReply.includes("ORDER_DATA:")) {
            const parts = botReply.split("ORDER_DATA:");
            finalReply = parts[0].trim();
            const details = parts[1] ? parts[1].trim().split("|") : [];
            if (details.length >= 3) {
                orderData = { name: details[0], order: details[1], address: details[2] };
            }
        }

        try {
            await axios.post(`https://graph.facebook.com/v25.0/${changes.metadata.phone_number_id}/messages`, {
                messaging_product: 'whatsapp', to: from, text: { body: finalReply }
            }, { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` } });

            if (orderData) await saveOrderToSheet(from, orderData.name, orderData.order, orderData.address);
        } catch (err) {
            console.error('❌ خطأ في واتساب:', err.message);
        }
        res.sendStatus(200);
    }
});

app.listen(3000, () => console.log(`🚀 النظام يعمل بنظام الحماية ضد ضغط الطلبات!`));