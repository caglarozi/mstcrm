// YAYIN ÖNCESİ KONTROL — app.js'te yapılan bir değişikliği canlıya
// çıkarmadan önce çalıştırılır.
//
// Neden var: 2026-08-05'te app.js'e eklenen bir değişiklik (yerel önbellek)
// canlıda yazar listesinin boş görünmesine yol açtı ve ancak kullanıcı
// fark ettiği için anlaşıldı. O gün projede, canlıya çıkmadan önce
// çalıştırılabilecek HİÇBİR otomatik kontrol yoktu. Bu betik o boşluğu
// kapatıyor: gerçek app.js'i gerçek bir tarayıcıda yükleyip temel
// davranışları doğruluyor.
//
// Kurulum (bir kez):  cd scripts && npm install
// Kullanım:
//   node server.js &                     # proje kökünden, port 4599
//   node scripts/yayin-oncesi-kontrol.js
//
// Çıkış kodu 0 = tüm kontroller geçti (yayına alınabilir)
//            1 = en az bir kontrol kaldı (YAYINA ALMA)

const { chromium } = require('playwright');
const URL = process.env.CRM_URL || 'http://localhost:4599/index.html';

let gecen = 0, kalan = 0;
function kontrol(ad, kosul, detay) {
  if (kosul) { gecen++; console.log(`  ✓ ${ad}`); }
  else { kalan++; console.log(`  ✗ ${ad}${detay ? '\n      -> ' + detay : ''}`); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jsHatalari = [];
  page.on('pageerror', e => jsHatalari.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR/i.test(m.text())) jsHatalari.push(m.text()); });

  console.log(`\nKontrol ediliyor: ${URL}\n`);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(3500);

  console.log('1) Sayfa yüklenmesi');
  kontrol('JS hatası yok', jsHatalari.length === 0, jsHatalari.slice(0, 3).join(' | '));
  kontrol('Giriş ekranı var', await page.locator('#loginScreen').count() > 0);

  console.log('\n2) Kritik fonksiyonlar tanımlı');
  const fonksiyonlar = ['render', 'load', 'saveAuthor', 'saveLog', 'mutateAuthor', 'createAuthor',
                        'dbErrorText', 'listen', 'stopAllListeners', 'normalizePhone', 'viewAuthors'];
  const tanimli = await page.evaluate(fs => fs.filter(f => typeof window[f] !== 'function' && typeof eval(`typeof ${f}`) !== 'function'), fonksiyonlar)
    .catch(() => []);
  for (const f of fonksiyonlar) {
    const varMi = await page.evaluate(f => { try { return eval(`typeof ${f}`) === 'function'; } catch (e) { return false; } }, f);
    kontrol(`${f}()`, varMi);
  }

  console.log('\n3) Liste görüntüleme (boş liste hatasını yakalar)');
  const r = await page.evaluate(() => {
    // Gerçek veriyle aynı şekilde iki örnek yazar koy ve gerçek görüntüleme
    // fonksiyonunu çağır. 2026-08-05'teki hatada bu aşamada liste boş
    // kalıyordu — bu kontrol o durumu yakalar.
    currentRole = 'admin';
    db.authors = [
      { id: 't1', name: 'Test Yazar Bir', status: 'aday', phone: '05551112233', genres: ['Roman'],
        created: '2026-08-01', logs: [{ type: 'Telefon', date: '2026-08-01', text: 'ilk görüşme', staffId: '' }],
        temp: 3, work: '', email: '', notes: '', followup: '', interviewDate: '', source: 'Diğer', addedBy: 'admin' },
      { id: 't2', name: 'Test Yazar İki', status: 'gorusuluyor', phone: '05554445566', genres: ['Şiir'],
        created: '2026-08-02', logs: [], temp: 4, work: '', email: '', notes: '', followup: '',
        interviewDate: '', source: 'Diğer', addedBy: 'admin' }
    ];
    const dolu = viewAuthors();
    db.authors = [];
    const bos = viewAuthors();
    return {
      doluIcerikVar: dolu.includes('Test Yazar Bir') && dolu.includes('Test Yazar İki'),
      doluBosMesajiYok: !dolu.includes('Kayıt bulunamadı'),
      bosMesajVar: bos.includes('Kayıt bulunamadı')
    };
  });
  kontrol('2 yazar varken ikisi de listede görünüyor', r.doluIcerikVar);
  kontrol('2 yazar varken "Kayıt bulunamadı" YAZMIYOR', r.doluBosMesajiYok,
    'Veri varken boş liste gösteriliyor — 2026-08-05 hatasının aynısı!');
  kontrol('Gerçekten 0 yazar varken "Kayıt bulunamadı" yazıyor', r.bosMesajVar);

  console.log('\n4) Hata mesajları doğru sebebi söylüyor');
  const m = await page.evaluate(() => ({
    kota: dbErrorText({ code: 'resource-exhausted' }, 'Veri kaydedilemedi'),
    net: dbErrorText({ code: 'unavailable' }, 'Veri kaydedilemedi'),
    yetki: dbErrorText({ code: 'permission-denied' }, 'Veri kaydedilemedi')
  }));
  // NOT: Türkçe büyük "İ" harfinin JS'teki küçüğü düz "i" değildir
  // (İ -> i + birleşen nokta), bu yüzden /internet/i deseni "İnternet"i
  // yakalamaz. Desenlerde her iki harfi de açıkça belirtiyoruz.
  kontrol('Kota hatasında "kota" diyor, interneti suçlamıyor',
    /kota/i.test(m.kota) && !/[iİ]nternet bağlantınızı kontrol/i.test(m.kota), m.kota.slice(0, 80));
  kontrol('Kota hatasında kaydın gitmediğini söylüyor', /GİTMEDİ|kaybolur/i.test(m.kota));
  kontrol('Gerçek bağlantı hatasında internet kontrolü öneriyor', /[iİ]nternet/i.test(m.net), m.net.slice(0, 80));
  kontrol('Yetki hatasında yetkiden bahsediyor', /yetki/i.test(m.yetki));

  console.log('\n5) Telefon eşleştirme (webhook ile aynı kural olmalı)');
  const p = await page.evaluate(() => ['0555 123 45 67', '+90 555 123 45 67', '905551234567', '5551234567']
    .map(x => normalizePhone(x)));
  kontrol('Tüm telefon formatları aynı anahtara indirgeniyor',
    new Set(p).size === 1 && p[0] === '5551234567', p.join(' / '));

  await browser.close();

  console.log(`\n${'='.repeat(46)}`);
  console.log(`GEÇEN: ${gecen}   KALAN: ${kalan}`);
  console.log(kalan === 0 ? 'TÜM KONTROLLER GEÇTİ — yayına alınabilir.' : 'KONTROL KALDI — YAYINA ALMAYIN.');
  console.log(`${'='.repeat(46)}\n`);
  process.exit(kalan === 0 ? 0 : 1);
})().catch(e => { console.error('Kontrol betiği çöktü:', e.message); process.exit(1); });
