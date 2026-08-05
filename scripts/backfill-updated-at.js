// TEK SEFERLİK taşıma betiği: mevcut yazar kayıtlarına "updatedAt"
// (son değişiklik damgası) alanını ekler.
//
// Neden gerekli: CRM artık açılışta yazarların TAMAMINI değil, yalnızca
// damgası ilerlemiş olanları çekiyor (bkz. app.js > loadAuthors). Bunun
// çalışması için alanın mevcut kayıtlarda da dolu olması gerekiyor.
//
// ÖNEMLİ — damgalar neden bugüne değil, kaydın kendi geçmişine göre
// atanıyor: CRM fark sorgusunu son damganın 60 saniye gerisinden
// başlatıyor (saat farkı payı). Bütün kayıtlara aynı damga basılsaydı
// hepsi bu payın içinde kalır ve HER açılışta 800+ kayıt yeniden
// okunurdu — yani kazanç sıfırlanırdı. Bu yüzden her kayda kendi son
// hareket tarihi (en yeni görüşme, yoksa oluşturulma tarihi) yazılıyor;
// damgalar aylara yayılıyor ve payın içinde yalnızca birkaç kayıt kalıyor.
//
// Çalıştırma (Yazar-CRM/scripts klasöründen):
//   node backfill-updated-at.js "C:/yol/mst-crm-firebase-adminsdk-....json" --dry-run
//   node backfill-updated-at.js "C:/yol/mst-crm-firebase-adminsdk-....json"
//
// Betik idempotent: updatedAt'i zaten olan kayda dokunmaz, yarıda kalırsa
// tekrar çalıştırılabilir.

const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keyPath = args.find(a => !a.startsWith('--'));

let credential;
if (keyPath) credential = admin.credential.cert(require(path.resolve(keyPath)));
else if (process.env.FIREBASE_SERVICE_ACCOUNT) credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
else { console.error('Servis hesabı JSON yolunu argüman olarak verin.'); process.exit(1); }

admin.initializeApp({ credential });
const db = admin.firestore();

// Kaydın son hareket tarihi: en yeni görüşme notu, yoksa oluşturulma
// tarihi. "YYYY-MM-DD" biçimindeki tarihi günün ortasına sabitliyoruz ki
// aynı güne düşen kayıtlar da birbirinden ayrışsın diye saat/dakika
// bilgisi varsa o kullanılsın.
function sonHareket(a) {
  const adaylar = [];
  if (a.created) adaylar.push(a.created + 'T12:00:00Z');
  (a.logs || []).forEach(l => {
    if (!l || !l.date) return;
    adaylar.push(l.date + 'T' + (l.time && /^\d{2}:\d{2}$/.test(l.time) ? l.time + ':00Z' : '12:00:00Z'));
  });
  (a.statusHistory || []).forEach(s => { if (s && s.date) adaylar.push(s.date + 'T12:00:00Z'); });
  const zamanlar = adaylar.map(s => new Date(s).getTime()).filter(t => Number.isFinite(t));
  if (!zamanlar.length) return null;
  return new Date(Math.max(...zamanlar));
}

(async () => {
  const snap = await db.collection('authors').get();
  console.log(`${snap.size} yazar okundu.`);

  const guncellenecek = [];
  let zatenVar = 0, tarihsiz = 0;
  snap.forEach(doc => {
    const a = doc.data();
    if (a.updatedAt) { zatenVar++; return; }
    let t = sonHareket(a);
    if (!t) { t = new Date('2020-01-01T12:00:00Z'); tarihsiz++; } // hiç tarihi yoksa çok eskiye at
    guncellenecek.push({ ref: doc.ref, t, ad: a.name });
  });

  console.log(`Zaten damgalı: ${zatenVar} · Damgalanacak: ${guncellenecek.length} (tarihi hiç olmayan: ${tarihsiz})`);

  if (guncellenecek.length) {
    const zamanlar = guncellenecek.map(u => u.t.getTime()).sort((x, y) => x - y);
    const enEski = new Date(zamanlar[0]).toISOString().slice(0, 10);
    const enYeni = new Date(zamanlar[zamanlar.length - 1]).toISOString().slice(0, 10);
    console.log(`Damga aralığı: ${enEski} … ${enYeni}`);
    // En yeni damganın 60 saniyelik payına kaç kayıt düşüyor? Her açılışta
    // gereksiz yere yeniden okunacak kayıt sayısı bu.
    const esik = zamanlar[zamanlar.length - 1] - 60 * 1000;
    const payIcinde = zamanlar.filter(t => t > esik).length;
    console.log(`Güvenlik payı içinde kalan (her açılışta tekrar okunacak): ${payIcinde} kayıt`);
  }

  if (dryRun) { console.log('--dry-run: hiçbir şey yazılmadı.'); return; }
  if (!guncellenecek.length) { console.log('Yapılacak bir şey yok.'); return; }

  let yazilan = 0;
  for (let i = 0; i < guncellenecek.length; i += 400) {
    const batch = db.batch();
    guncellenecek.slice(i, i + 400).forEach(u => batch.update(u.ref, { updatedAt: admin.firestore.Timestamp.fromDate(u.t) }));
    await batch.commit();
    yazilan += Math.min(400, guncellenecek.length - i);
    console.log(`  ${yazilan}/${guncellenecek.length} damgalandı`);
  }
  console.log('Tamamlandı.');
})().catch(e => {
  console.error('HATA:', e.code || '', e.message);
  if (e.code === 8) console.error('\nGünlük kota dolu. Kota sıfırlandıktan sonra tekrar çalıştırın (betik kaldığı yerden devam eder).');
  process.exit(1);
});
