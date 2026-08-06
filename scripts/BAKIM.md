# Bakım araçları

Kurulum (bir kez):

```bash
cd scripts
npm install
npx playwright install chromium   # sadece yayın öncesi kontrol için
```

---

## 1. Yayın öncesi kontrol — `yayin-oncesi-kontrol.js`

**app.js'te değişiklik yaptıysan canlıya çıkmadan ÖNCE bunu çalıştır.**

```bash
node server.js &                        # proje kökünden (port 4599)
cd scripts && npm run kontrol
```

Gerçek `app.js`'i gerçek bir tarayıcıda açar ve şunları doğrular:

- Sayfa JS hatası vermeden yükleniyor mu
- Kritik fonksiyonlar (`saveAuthor`, `saveLog`, `mutateAuthor`, `render`…) yerinde mi
- **Veri varken liste gerçekten doluyor mu** — 2026-08-05'te canlıda yaşanan
  "bütün yazarlar silinmiş göründü" hatası tam olarak buydu
- Hata mesajları doğru sebebi söylüyor mu (kota hatasında interneti suçlamıyor)
- Telefon eşleştirme kuralı webhook'takiyle aynı mı

Çıkış kodu `0` ise yayına alınabilir, `1` ise **alınmamalı**.

---

## 2. Kota nöbetçisi — `kota-nobetci.js`

Firebase ücretsiz planda günlük 50.000 okuma / 20.000 yazma sınırı var. Kota
dolunca Firestore okumayı **ve yazmayı** reddediyor, CRM'de "Veri
kaydedilemedi" çıkıyor. Bu araç kotanın gün içinde ne zaman tükendiğini
kaydeder.

```bash
cd scripts
node kota-nobetci.js "C:/yol/mst-crm-firebase-adminsdk-....json"            # 5 dk'da bir
node kota-nobetci.js "<anahtar>" --aralik 10                               # 10 dk'da bir
node kota-nobetci.js "<anahtar>" --once                                    # tek ölçüm
npm run ozet                                                               # gün sonu özeti
```

Örnek özet çıktısı:

```
=== 2026-08-06 — 173 ölçüm ===
  GÜN BOYU SORUNSUZ — kota hiç dolmadı.
```

Maliyeti ölçüm başına 1 okuma + 1 yazma; 5 dakikada bir çalışsa günde ~288
okuma eder, yani kotanın binde 6'sı.

---

## 3. Telefon alanı taşıma — `backfill-phone-norm.js`

**Tek seferlik, 2026-08-05'te çalıştırıldı.** Yeni yazar kayıtlarına
`phoneNorm` alanını CRM ve webhook zaten kendisi yazıyor. Yalnızca veri
dışarıdan toplu eklenirse tekrar çalıştırılması gerekir.

```bash
node backfill-phone-norm.js "<anahtar>" --dry-run   # önce ne yapacağını göster
node backfill-phone-norm.js "<anahtar>"             # uygula
```

Aynı numaraya kayıtlı birden fazla yazar varsa uyarı listesi basar.
