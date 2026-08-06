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

  console.log('\n5) Yalnızca değişenleri çekme (delta) mantığı');
  const d = await page.evaluate(() => {
    const s = {};
    // 5a. Damga okuma: canlı Timestamp, yerel kopyadan gelen düz nesne,
    //     ISO metin ve damgasız kayıt — dördü de doğru okunmalı.
    s.msTimestamp = authorUpdatedMs({ updatedAt: { toMillis: () => 1700000000000 } });
    s.msPlain     = authorUpdatedMs({ updatedAt: { seconds: 1700000000, nanoseconds: 0 } });
    s.msIso       = authorUpdatedMs({ updatedAt: '2026-08-05T10:00:00.000Z' });
    s.msYok       = authorUpdatedMs({});
    // Geleceğe düşen damga watermark'ı ilerletMEmeli. 2026-08-06'da
    // canlıda tam bu oldu: taşıma betiği bugün tarihli kayda 15:00
    // damgası bastı, saat 10:05'ti; watermark geleceğe sıçrayınca o
    // andan sonraki tüm gerçek değişiklikler görünmez oldu.
    s.msGelecek   = authorUpdatedMs({ updatedAt: { seconds: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 } });
    s.msYakinGelecek = authorUpdatedMs({ updatedAt: { seconds: Math.floor(Date.now() / 1000) + 60 } });

    // 5b. Değişiklik uygulama: ekleme / güncelleme / yumuşak silme / gerçek silme
    const sahte = (id, ad, extra) => ({ type: 'added', doc: { data: () => Object.assign({ id, name: ad, updatedAt: { seconds: 1700000001 } }, extra || {}) } });
    db.authors = [];
    authorWatermark = 0;

    applyAuthorChanges([sahte('a1', 'Bir'), sahte('a2', 'İki')]);
    s.eklendi = db.authors.length === 2;
    s.damgaIlerledi = authorWatermark === 1700000001000;

    applyAuthorChanges([sahte('a1', 'Bir GÜNCEL')]);
    s.guncellendi = db.authors.length === 2 && db.authors.find(x => x.id === 'a1').name === 'Bir GÜNCEL';

    applyAuthorChanges([sahte('a2', 'İki', { deleted: true })]);
    s.yumusakSilindi = db.authors.length === 1 && !db.authors.some(x => x.id === 'a2');

    applyAuthorChanges([{ type: 'removed', doc: { data: () => ({ id: 'a1', updatedAt: { seconds: 1700000002 } }) } }]);
    s.gercekSilindi = db.authors.length === 0;

    // 5c. Silinen kayıt yerel kopyaya SIZMAMALI
    db.authors = [];
    applyAuthorChanges([sahte('a3', 'Silik', { deleted: true })]);
    s.silinenEklenmedi = db.authors.length === 0;

    db.authors = [];
    authorWatermark = 0;
    return s;
  });
  kontrol('Canlı damga (Timestamp) okunuyor', d.msTimestamp === 1700000000000);
  kontrol('Yerel kopyadaki damga okunuyor', d.msPlain === 1700000000000, 'okunan: ' + d.msPlain);
  kontrol('Metin damga okunuyor', d.msIso === new Date('2026-08-05T10:00:00.000Z').getTime());
  kontrol('Damgasız kayıt 0 dönüyor (tam liste çekmeye zorlar)', d.msYok === 0);
  kontrol('Geleceğe düşen damga watermark ilerletmiyor', d.msGelecek === 0,
    'Watermark geleceğe sıçrarsa sonraki tüm değişiklikler görünmez olur — 06.08.2026 canlı hatası!');
  kontrol('Saat farkı payı (1 saat) içindeki damga kabul ediliyor', d.msYakinGelecek > 0);
  kontrol('Yeni kayıtlar listeye ekleniyor', d.eklendi);
  kontrol('En yeni damga takip ediliyor', d.damgaIlerledi);
  kontrol('Değişen kayıt güncelleniyor, kopyası oluşmuyor', d.guncellendi);
  kontrol('Yumuşak silinen (deleted:true) listeden çıkıyor', d.yumusakSilindi,
    'Silinen yazar diğer kullanıcıların ekranında kalırdı!');
  kontrol('Gerçekten silinen kayıt listeden çıkıyor', d.gercekSilindi);
  kontrol('Silinmiş kayıt listeye hiç eklenmiyor', d.silinenEklenmedi);

  console.log('\n6) Telefon eşleştirme (webhook ile aynı kural olmalı)');
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
