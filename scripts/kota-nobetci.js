// KOTA NÖBETÇİSİ — Firestore günlük kotasının gün içinde ne zaman
// tükendiğini kaydeder.
//
// Neden: Firebase ücretsiz planda günlük 50.000 okuma / 20.000 yazma var.
// Kota dolunca Firestore okumayı VE yazmayı reddediyor, CRM'de "Veri
// kaydedilemedi" çıkıyor. Cloud Monitoring API'sine erişim izni olmadığı
// için kesin okuma sayacını çekemiyoruz; bunun yerine belirli aralıklarla
// ucuz bir okuma ve ucuz bir yazma deneyip sonucu kaydediyoruz. Böylece
// "kota saat kaçta doldu / gün boyu dayandı mı" sorusunu kesin cevaplarız.
//
// Kullanım (Yazar-CRM/scripts klasöründen):
//   node kota-nobetci.js "C:/yol/mst-crm-firebase-adminsdk-....json"
//   node kota-nobetci.js <anahtar> --aralik 10     # 10 dakikada bir (varsayılan 5)
//   node kota-nobetci.js <anahtar> --once          # tek ölçüm alıp çık
//
// Ctrl+C ile durdurulur. Her ölçüm hem ekrana hem kota-log.csv dosyasına
// yazılır; gün sonunda özet çıkarmak için --ozet ile çalıştırın.
//
// Maliyeti: ölçüm başına 1 okuma + 1 yazma + 1 silme. 5 dakikada bir
// çalışırsa günde ~288 okuma — 50.000'lik kotanın binde 6'sı.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};
const LOG = path.join(__dirname, 'kota-log.csv');

if (flag('ozet', false)) { ozetle(); return; }

const keyPath = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--aralik'));
let credential;
if (keyPath && fs.existsSync(keyPath)) credential = admin.credential.cert(require(path.resolve(keyPath)));
else if (process.env.FIREBASE_SERVICE_ACCOUNT) credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
else { console.error('Servis hesabı JSON yolunu argüman olarak verin.'); process.exit(1); }

admin.initializeApp({ credential });
const db = admin.firestore();
const probeRef = db.collection('crm').doc('_kota_nobetci');

function tr(d) { return d.toLocaleString('tr-TR', { hour12: false }); }

async function olc() {
  const now = new Date();
  let okuma = 'OK', yazma = 'OK';
  // Okuma: tek, küçük bir doküman (1 okuma)
  try { await db.collection('crm').doc('staff').get(); }
  catch (e) { okuma = (e.code === 8 || /RESOURCE_EXHAUSTED/.test(e.message)) ? 'KOTA' : 'HATA:' + e.code; }
  // Yazma: kendi izleme dokümanımıza (gerçek veriye dokunmaz)
  try { await probeRef.set({ son: now.toISOString() }); }
  catch (e) { yazma = (e.code === 8 || /RESOURCE_EXHAUSTED/.test(e.message)) ? 'KOTA' : 'HATA:' + e.code; }

  const satir = `${now.toISOString()},${tr(now)},${okuma},${yazma}`;
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, 'iso,saat,okuma,yazma\n');
  fs.appendFileSync(LOG, satir + '\n');

  const isaret = okuma === 'OK' && yazma === 'OK' ? '✓' : '✗';
  console.log(`${isaret} ${tr(now)}   okuma=${okuma.padEnd(5)} yazma=${yazma}`);
  return okuma === 'OK' && yazma === 'OK';
}

function ozetle() {
  if (!fs.existsSync(LOG)) { console.log('Henüz kayıt yok (kota-log.csv bulunamadı).'); return; }
  const satirlar = fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
  const gunler = {};
  satirlar.forEach(([iso, saat, okuma, yazma]) => {
    const gun = iso.slice(0, 10);
    (gunler[gun] = gunler[gun] || []).push({ saat, okuma, yazma });
  });
  Object.entries(gunler).forEach(([gun, kayitlar]) => {
    const toplam = kayitlar.length;
    const kotaOkuma = kayitlar.filter(k => k.okuma === 'KOTA');
    const kotaYazma = kayitlar.filter(k => k.yazma === 'KOTA');
    console.log(`\n=== ${gun} — ${toplam} ölçüm ===`);
    if (!kotaOkuma.length && !kotaYazma.length) {
      console.log('  GÜN BOYU SORUNSUZ — kota hiç dolmadı.');
      return;
    }
    if (kotaOkuma.length) {
      console.log(`  OKUMA kotası ilk kez doldu : ${kotaOkuma[0].saat}`);
      console.log(`  OKUMA reddedilen ölçüm     : ${kotaOkuma.length}/${toplam} (%${Math.round(kotaOkuma.length/toplam*100)})`);
    }
    if (kotaYazma.length) {
      console.log(`  YAZMA kotası ilk kez doldu : ${kotaYazma[0].saat}`);
      console.log(`  YAZMA reddedilen ölçüm     : ${kotaYazma.length}/${toplam} (%${Math.round(kotaYazma.length/toplam*100)})`);
    } else if (kotaOkuma.length) {
      console.log('  YAZMA kotası gün boyu dolmadı (sorun sadece okumada).');
    }
  });
  console.log('');
}

(async () => {
  if (flag('once', false)) { await olc(); process.exit(0); }
  const dk = parseInt(flag('aralik', '5'), 10) || 5;
  console.log(`Kota nöbetçisi başladı — ${dk} dakikada bir ölçüm. Durdurmak için Ctrl+C.`);
  console.log(`Kayıt dosyası: ${LOG}\n`);
  await olc();
  setInterval(olc, dk * 60 * 1000);
})();
