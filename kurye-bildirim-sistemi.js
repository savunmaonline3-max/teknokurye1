/**
 * TeknoJet Plus — Kurye Bildirim Servisi
 * ---------------------------------------
 * Ne yapar:
 *  1) Yeni sipariş geldiğinde (webhook/HTTP endpoint) kurye Telegram grubuna/botuna
 *     - Sesli bildirim tetikleyen bir mesaj (Telegram "disable_notification: false" + öncelik)
 *     - Google Maps konum linki
 *     - Sipariş detaylarını (ürünler, adres, ödeme yöntemi, telefon)
 *     içeren bir mesaj gönderir.
 *  2) Kurye Telegram'da inline buton ile "Siparişi Üstlendim" der -> sipariş o kuryeye atanır
 *     ve web sitesindeki canlı takip ekranına "Kuryede / Yolda" durumu + kurye adı düşer.
 *
 * Gereken paketler:
 *   npm install express node-telegram-bot-api dotenv
 *
 * .env dosyası:
 *   TELEGRAM_BOT_TOKEN=xxxxx:yyyyy   (BotFather'dan alınır)
 *   COURIER_CHAT_ID=-1001234567890   (kurye grubunun chat id'si, ya da tek kurye ise onun user id'si)
 *   PORT=3000
 *
 * Kurulum notu:
 *   - BotFather'da /newbot ile bot oluştur, token'ı al.
 *   - Botu kurye grubuna ekle, admin yap.
 *   - Grubun chat_id'sini öğrenmek için: bota grupta bir mesaj attır, sonra
 *     https://api.telegram.org/bot<TOKEN>/getUpdates adresine gidip "chat":{"id":...} alanına bak.
 */

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const COURIER_CHAT_ID = process.env.COURIER_CHAT_ID;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Basit bellek-içi sipariş deposu (gerçek sistemde bir veritabanı — Firestore/Postgres — kullanılmalı)
const orders = {}; // orderId -> { status, courier, ... }

/**
 * 1) YENİ SİPARİŞ GELDİĞİNDE ÇAĞRILAN FONKSİYON
 * Web sitesindeki checkout formu bu bilgiyi backend'e (bu Express sunucusuna) POST eder.
 */
async function notifyCourierOfNewOrder(order) {
  const {
    orderId, customerName, phone, address, note,
    paymentMethod, items, total, lat, lng
  } = order;

  orders[orderId] = { status: 'Hazırlanıyor', ...order };

  const itemLines = items.map(it => `• ${it.qty}x ${it.name}`).join('\n');
  const mapsLink = (lat && lng)
    ? `https://maps.google.com/?q=${lat},${lng}`
    : `https://maps.google.com/?q=${encodeURIComponent(address + ', Gaziantep')}`;

  const text =
`🚨 YENİ SİPARİŞ — #${orderId}

👤 ${customerName}
📞 ${phone}
📍 ${address}
${note ? `📝 Not: ${note}\n` : ''}💳 Ödeme: ${paymentMethod}

${itemLines}
💰 Toplam: ${total} ₺

📍 Konum: ${mapsLink}`;

  // disable_notification: false -> Telegram'da sesli/titreşimli bildirim tetiklenir (varsayılan zaten budur,
  // burada bilinçli olarak belirtiyoruz ki sessiz moda düşmesin).
  await bot.sendMessage(COURIER_CHAT_ID, text, {
    disable_notification: false,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Siparişi Üstlendim', callback_data: `claim:${orderId}` }
      ]]
    }
  });
}

/**
 * 2) KURYE "Siparişi Üstlendim" BUTONUNA BASINCA
 */
bot.on('callback_query', async (query) => {
  const [action, orderId] = query.data.split(':');
  if (action !== 'claim') return;

  const courierName = [query.from.first_name, query.from.last_name].filter(Boolean).join(' ');

  if (!orders[orderId]) {
    return bot.answerCallbackQuery(query.id, { text: 'Sipariş bulunamadı.' });
  }
  if (orders[orderId].courier) {
    return bot.answerCallbackQuery(query.id, { text: `Bu sipariş zaten ${orders[orderId].courier} tarafından alındı.` });
  }

  orders[orderId].courier = courierName;
  orders[orderId].status = 'Kuryede / Yolda';

  await bot.answerCallbackQuery(query.id, { text: 'Sipariş sana atandı, iyi teslimatlar!' });
  await bot.editMessageText(
    `${query.message.text}\n\n✅ Üstlenen kurye: ${courierName}`,
    { chat_id: query.message.chat.id, message_id: query.message.message_id }
  );

  // Burada web sitesine (canlı takip ekranına) durumu iletmek gerekir.
  // En pratik yöntem: bir WebSocket sunucusu (örn. socket.io) ile anlık push,
  // ya da web sitesinin sipariş durumunu birkaç saniyede bir bu backend'den polling ile çekmesi.
  pushStatusToWebsite(orderId, orders[orderId]);
});

/**
 * Web sitesine anlık durum iletimi (örnek — gerçek projede socket.io kullanılabilir)
 */
function pushStatusToWebsite(orderId, orderData) {
  // io.to(orderId).emit('status_update', { status: orderData.status, courier: orderData.courier });
  console.log(`[WEBSITE PUSH] Sipariş #${orderId}: ${orderData.status} — Kurye: ${orderData.courier || '-'}`);
}

/**
 * WEB SİTESİNDEN GELEN SİPARİŞ WEBHOOK'U
 * Checkout formu submit olduğunda frontend bu endpoint'e POST atar.
 */
app.post('/api/orders', async (req, res) => {
  const order = req.body;
  order.orderId = order.orderId || ('TJ' + Math.floor(1000 + Math.random() * 9000));

  try {
    await notifyCourierOfNewOrder(order);
    res.json({ ok: true, orderId: order.orderId });
  } catch (err) {
    console.error('Kurye bildirimi gönderilemedi:', err);
    res.status(500).json({ ok: false, error: 'Bildirim gönderilemedi' });
  }
});

/**
 * Sipariş durumu sorgusu — canlı takip ekranı bu endpoint'i birkaç saniyede
 * bir çağırarak (polling) ya da socket.io ile durumu günceller.
 */
app.get('/api/orders/:orderId/status', (req, res) => {
  const order = orders[req.params.orderId];
  if (!order) return res.status(404).json({ ok: false });
  res.json({ ok: true, status: order.status, courier: order.courier || null });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kurye bildirim servisi ${PORT} portunda çalışıyor.`));

/**
 * ÖRNEK KULLANIM — frontend'den siparişi bu backend'e gönderme:
 *
 * fetch('https://senin-backend-adresin.com/api/orders', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     customerName: 'Ahmet Yılmaz',
 *     phone: '05xx xxx xx xx',
 *     address: 'Şahinbey, ... Sokak No:5',
 *     note: 'Zil çalışmıyor',
 *     paymentMethod: 'Kapıda Nakit',
 *     items: [{ name: '10.000 mAh Powerbank', qty: 1 }],
 *     total: 349,
 *     lat: 37.0662, lng: 37.3833
 *   })
 * });
 */
