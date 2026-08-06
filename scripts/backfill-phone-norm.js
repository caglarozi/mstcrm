// TEK SEFERLİK taşıma betiği: mevcut tüm yazar kayıtlarına "phoneNorm"
// (telefonun sadeleştirilmiş hali — son 10 hane) alanını ekler.
//
// Neden gerekli: WhatsApp/arama webhook'u (whatsapp-webhook/src/index.js)
// gelen numarayı eskiden yazarların TAMAMINI tarayarak arıyordu; her
// arama/mesaj 800'den fazla doküman okuması demekti ve Firebase ücretsiz
// paketinin günlük 50.000 okuma kotasını tek başına bitiriyordu. Webhook
// artık "phoneNorm" alanına indeksli eşitlik sorgusu atıyor (istek başına
// 1 okuma) — ama bunun çalışması için alanın MEVCUT kayıtlarda da dolu
// olması gerekiyor. Bu betik onu bir kez doldurur; sonrasında hem CRM
// (app.js > saveAuthor) hem webhook (createLead) alanı kendisi yazar.
//
// Çalıştırma (Yazar-CRM/scripts klasöründen):
//   npm install
//   node backfill-phone-norm.js "C:/yol/mst-crm-firebase-adminsdk-....json"
// ya da servis hesabı JSON'ını FIREBASE_SERVICE_ACCOUNT ortam değişkenine
// koyarak argümansız çalıştırın.
//
// Önce ne yapacağını göstermesi (hiçbir şey yazmadan) için:
//   node backfill-phone-norm.js <anahtar> --dry-run

const admin = require('firebase-admin');

// app.js > normalizePhone ve worker > phoneKey ile BİREBİR aynı kural.
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keyPath = args.find(a => !a.startsWith('--'));

let credential;
if (keyPath) {
  credential = admin.credential.cert(require(require('path').resolve(keyPath)));
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
} else {
  console.error('Servis hesabı bulunamadı. JSON dosyasının yolunu argüman olarak verin ya da FIREBASE_SERVICE_ACCOUNT ortam değişkenini ayarlayın.');
  process.exit(1);
}

admin.initializeApp({ credential });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('authors').get();
  console.log(`${snap.size} yazar okundu.`);

  const updates = [];
  let alreadyOk = 0, noPhone = 0;
  const byKey = new Map();

  snap.forEach(doc => {
    const data = doc.data();
    const key = phoneKey(data.phone);
    if (!key) { noPhone++; return; }
    // Aynı numaraya sahip birden fazla kayıt varsa uyaralım: webhook
    // eşitlik sorgusunda ilk bulduğunu kullanır, hangisi olacağı garanti
    // değildir. (CRM zaten mükerrer numarayı engelliyor, ama webhook'un
    // eskiden oluşturduğu kayıtlar bu kontrolden geçmemiş olabilir.)
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(`${data.name || '(isimsiz)'} [${doc.id}]`);

    if (data.phoneNorm === key) { alreadyOk++; return; }
    updates.push({ ref: doc.ref, key, name: data.name });
  });

  const duplicates = [...byKey.entries()].filter(([, list]) => list.length > 1);
  if (duplicates.length) {
    console.log(`\nUYARI — aynı numaraya sahip ${duplicates.length} numara grubu var:`);
    duplicates.forEach(([key, list]) => console.log(`  ...${key}: ${list.join(' / ')}`));
    console.log('');
  }

  console.log(`Telefonu olmayan: ${noPhone} · Zaten doğru: ${alreadyOk} · Güncellenecek: ${updates.length}`);
  if (dryRun) { console.log('--dry-run: hiçbir şey yazılmadı.'); return; }
  if (!updates.length) { console.log('Yapılacak bir şey yok.'); return; }

  // Firestore toplu yazma sınırı 500 işlem/batch.
  let written = 0;
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    updates.slice(i, i + 400).forEach(u => batch.update(u.ref, { phoneNorm: u.key }));
    await batch.commit();
    written += Math.min(400, updates.length - i);
    console.log(`  ${written}/${updates.length} güncellendi`);
  }
  console.log('Tamamlandı.');
})().catch(e => {
  console.error('HATA:', e.code || '', e.message);
  if (String(e.message).includes('RESOURCE_EXHAUSTED') || e.code === 8) {
    console.error('\nFirebase günlük kotası dolu görünüyor. Kota sıfırlandıktan sonra tekrar çalıştırın ' +
      '(ya da projeyi Blaze planına yükseltin).');
  }
  process.exit(1);
});
