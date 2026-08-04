// Her gün GitHub Actions tarafından otomatik çalıştırılır (bkz.
// .github/workflows/whatsapp-reminders.yml). Vadesi gelen/geçen
// "Bekliyor" durumundaki ödemeleri tarar ve yazara WhatsApp'tan
// hatırlatma gönderir.
//
// Gerekli ortam değişkenleri (GitHub repo Settings > Secrets and
// variables > Actions altına eklenir, kod içine YAZILMAZ):
//   FIREBASE_SERVICE_ACCOUNT   - Firebase servis hesabı JSON'ı (tek satır)
//   WHATSAPP_ACCESS_TOKEN      - Meta WhatsApp Cloud API erişim anahtarı
//   WHATSAPP_PHONE_NUMBER_ID   - Gönderilecek numaranın Meta phoneNumberId'si
//   WHATSAPP_TEMPLATE_NAME     - (opsiyonel) Meta onaylı şablon adı; yoksa
//                                 serbest metin denenir (sadece son 24 saatte
//                                 size yazan kişilere ulaşır).

const https = require('https');
const admin = require('firebase-admin');

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("0")) p = "90" + p.substring(1);
  else if (p.length === 10 && p.startsWith("5")) p = "90" + p;
  return p;
}

function paymentReminderText(authorName, amount, days) {
  const when = days < 0 ? `${-days} gün önce vadesi geçen` : days === 0 ? "bugün vadesi gelen" : `${days} gün sonra vadesi gelecek`;
  return `Merhaba ${authorName}, ${amount.toLocaleString('tr-TR')} ₺ tutarındaki ${when} ödemenizi hatırlatmak isteriz. Bilgilerinize sunarız, teşekkür ederiz.`;
}

// Her gün değil; 3 gün kala, vade günü, gecikmenin ilk günü ve sonrasında
// haftada bir hatırlatılır — aksi halde aynı kişi günde bir spam mesaj alır.
function shouldRemindToday(days) {
  if (days === 3 || days === 0 || days === -1) return true;
  if (days < -1 && Math.abs(days) % 7 === 0) return true;
  return false;
}

function sendWhatsAppMessage(phoneNumberId, accessToken, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v21.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const required = ['FIREBASE_SERVICE_ACCOUNT', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.log(`⏸  Eksik bilgi: ${missing.join(', ')}. Bunlar GitHub Secrets'a eklenene kadar gönderim atlanıyor (hata değil, sadece bekleniyor).`);
    return;
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
  const db = admin.firestore();

  const snapshot = await db.collection('authors').get();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

  if (!templateName) {
    console.log('⚠️  WHATSAPP_TEMPLATE_NAME ayarlı değil — serbest metin denenecek, bu sadece son 24 saatte size yazan kişilere ulaşır. Meta onaylı bir şablon eklemeniz önerilir.');
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const doc of snapshot.docs) {
    const author = doc.data();
    const payments = author.payments || [];
    for (const payment of payments) {
      if (payment.status !== 'Bekliyor') continue;
      const days = Math.round((new Date(payment.date) - today) / 864e5);
      if (!shouldRemindToday(days)) continue;

      const phone = normalizePhone(author.phone);
      if (!phone) { skipped++; continue; }

      const text = paymentReminderText(author.name, payment.amount, days);

      let payload;
      if (templateName) {
        payload = {
          messaging_product: 'whatsapp',
          to: phone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'tr' },
            components: [{ type: 'body', parameters: [{ type: 'text', text: text }] }]
          }
        };
      } else {
        payload = {
          messaging_product: 'whatsapp',
          to: phone,
          type: 'text',
          text: { preview_url: false, body: text }
        };
      }

      try {
        const result = await sendWhatsAppMessage(process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_ACCESS_TOKEN, payload);
        if (result.status === 200) {
          console.log(`✔ ${author.name} (${phone}) - gönderildi`);
          sent++;
        } else {
          console.error(`✘ ${author.name} (${phone}) - hata:`, JSON.stringify(result.data));
          failed++;
        }
      } catch (e) {
        console.error(`✘ ${author.name} (${phone}) - istek hatası:`, e.message);
        failed++;
      }
    }
  }

  console.log(`\nÖzet: ${sent} gönderildi, ${failed} başarısız, ${skipped} telefon eksik olduğu için atlandı.`);
}

main().catch(e => {
  console.error('Beklenmeyen hata:', e);
  process.exit(1);
});
