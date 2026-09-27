require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Telegram & Green-API Sabitleri
const BOT_TOKEN = '8771105373:AAHCLCXbuhmUpCPa6EUXaGjRKIjLUURqemw';
const CHAT_ID = '-1003900873538';
const GREEN_ID_INSTANCE = '710722747828';
const GREEN_API_TOKEN = 'ce58288d5c364e0e834dfd39e5fe731320d3ef2712a3402e86';

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

let ordersList = [];

// WhatsApp Otomatik Bildirimi
async function sendWhatsAppNotification(phone, customerName, orderId, total, serviceType, pickupAddress) {
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('0')) cleanPhone = '90' + cleanPhone.substring(1);
        else if (!cleanPhone.startsWith('90')) cleanPhone = '90' + cleanPhone;

        const waUrl = `https://7107.api.greenapi.com/waInstance${GREEN_ID_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`;
        
        const waMessage = 
`🚀 *TEKNOJET & GECE EXPRESS | SIPARISINIZ ALINDI!*

Merhaba *${customerName}*,

*#TJ-${orderId}* numaralı VIP kurye siparişiniz başarıyla alınmıştır. ⚡️

📦 *Hizmet Türü:* ${serviceType}
📍 *Alım Yeri:* ${pickupAddress}
💰 *Kurye Ücreti:* ${total} TL
🛵 *Durum:* Kuryemiz yola çıktı!

Gaziantep içi 7/24 hızlı ve güvenli teslimat garantisi.

_Canlı Destek: 0507 518 8663_`;

        await fetch(waUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: `${cleanPhone}@c.us`, message: waMessage })
        });
    } catch (err) {
        console.error("WhatsApp Gönderim Hatası:", err.message);
    }
}

app.post('/api/orders', async (req, res) => {
    try {
        const { customerName, phone, pickupAddress, deliveryAddress, serviceType, distanceKm, paymentMethod, note, total } = req.body;
        const orderId = Math.floor(100000 + Math.random() * 900000);

        const orderObj = {
            orderId, customerName, phone, pickupAddress, deliveryAddress,
            serviceType, distanceKm, paymentMethod, note, total, createdAt: new Date()
        };
        ordersList.unshift(orderObj);

        const pickupMaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pickupAddress + ' Gaziantep')}`;
        const deliveryMaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(deliveryAddress + ' Gaziantep')}`;
        let cleanPhone = phone ? phone.replace(/\D/g, '') : '';
        if (cleanPhone.startsWith('0')) cleanPhone = '90' + cleanPhone.substring(1);
        else if (!cleanPhone.startsWith('90')) cleanPhone = '90' + cleanPhone;

        // Telegram Kurye Kanal Bildirimi
        const telegramMessage = 
`⚡️ <b>TEKNOJET & GECE EXPRESS | YENİ SİPARİŞ</b>
➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖

🆔 <b>SİPARİŞ NO:</b> <code>#TJ-${orderId}</code>
⏰ <b>SAAT:</b> <code>${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</code>

👤 <b>MÜŞTERİ BİLGİLERİ</b>
• <b>Ad Soyad:</b> <code>${customerName}</code>
• <b>Telefon:</b> <code>${phone}</code>
• <b>Hizmet Türü:</b> <code>${serviceType}</code>
• <b>Ödeme Şekli:</b> <code>${paymentMethod}</code>

🏬 <b>ALIM NOKTASI:</b>
<code>${pickupAddress} / Gaziantep</code>

🏠 <b>TESLİMAT ADRESİ:</b>
<code>${deliveryAddress} / Gaziantep</code>

📝 <b>SİPARİŞ NOTU:</b>
<code>${note || 'Yok'}</code>

💰 <b>KURYE ÜCRETI:</b> <b>${total} TL</b>
➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖`;

        await bot.sendMessage(CHAT_ID, telegramMessage, { 
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📍 Alım Konumu", url: pickupMaps }, { text: "📍 Teslimat Konumu", url: deliveryMaps }],
                    [{ text: "💬 Müşteri WhatsApp", url: `https://wa.me/${cleanPhone}` }]
                ]
            }
        });

        sendWhatsAppNotification(phone, customerName, orderId, total, serviceType, pickupAddress);

        res.status(200).json({ success: true, orderId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/orders/list', (req, res) => res.json(ordersList));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TeknoJet Express Sunucusu ${PORT} portunda aktif!`));
