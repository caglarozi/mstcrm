# Reklam iyileştirmeleri — panel tarafında yapılacaklar

CRM tarafı **hazır ve canlıda**: yönetici panoyu açtığında "Reklam
İyileştirmeleri" kartı `crm/reklam_durumu` dokümanını okuyup gösteriyor.

> **UYGULANDI (2026-08-10):** Yazma işi panelin kendisine değil, Cloudflare
> Worker'a verildi — `whatsapp-webhook` içindeki `handleReklamSync` 6 saatte
> bir panelin MCP ucundaki `reklam_durumu` denetimini çağırıp sonucu bu
> dokümana yazıyor. Denetim motoru yine panelde; worker yalnızca kurye.
> Panel tarafında hiçbir değişiklik gerekmedi. Devreye almak için:
> `npx wrangler secret put MST_PANEL_MCP_URL` (panelin ?key='li MCP adresi)
> ve `npx wrangler deploy`. Aşağısı, tarihçe ve şema başvurusu olarak durur.

Geriye tek iş kalmıştı: **Yazar yönetim panelinin (app.mstyayincilik.com) bu
dokümanı belirli aralıklarla yazması.** Bu dosya onu tarif eder.

## Neden bu yöntem

CRM tarayıcıda çalışan statik bir uygulama; Meta'ya bağlanamaz, reklam jetonu
tutamaz (tutsa tarayıcıya sızardı) ve 115 kuralı ikinci kez uygulaması
anlamsız olurdu. Denetim motoru panelde kalıyor, CRM sadece sonucu okuyor.

Maliyet tarafı da bu yüzden seçildi: CRM ücretsiz Firebase planında ve günlük
okuma sınırı sert. Bu tasarımda kart **sayfa başına 1 okuma** ediyor ve
yalnızca yönetici panoyu açtığında çekiliyor — personel bu maliyeti hiç
ödemiyor.

## Yazılacak doküman

**Yol:** `crm/reklam_durumu` (koleksiyon `crm`, doküman `reklam_durumu`)

```json
{
  "guncellenme": "2026-08-10T09:00:00.000Z",
  "donem": "son 7 gün",

  "ozet": {
    "harcama": 3304.78,
    "erisim": 7920,
    "tiklama": 426,
    "cpm": 195.32,
    "ctr": 2.52,
    "frekans": 2.14
  },

  "trend": {
    "simdikiCTR": 2.54,
    "oncekiCTR": 2.79,
    "simdikiCPM": 202.17,
    "oncekiCPM": 232.68
  },

  "sayilar": {
    "toplamKural": 115,
    "kontrolEdilen": 26,
    "ihlal": 11,
    "temiz": 15,
    "uygulanabilir": 3
  },

  "bulgular": [
    {
      "no": 63,
      "grup": "Bütçe",
      "aksiyon": "Kazanan setin bütçesini %18 artır",
      "olcum": "Set A 11.05 ₺/tıklama · Set B 6.48 ₺ — %71 fark",
      "neden": "Aynı para ucuz sete gitseydi daha çok tıklama alınırdı.",
      "etki": "Aynı bütçeyle ~%71 daha fazla tıklama"
    }
  ]
}
```

### Alan notları

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `guncellenme` | **evet** | ISO 8601. CRM bunu "kaç saat önce" diye gösterir ve **36 saatten eskiyse ekranda uyarı çıkarır**. Yazmayı unutan bir panel sessizce eski veri göstermez. |
| `donem` | hayır | Kartın altında yazar ("son 7 gün") |
| `ozet` | hayır | Eksik alan sorun değil, `—` gösterilir |
| `trend` | hayır | CTR'de artış yeşil, CPM'de **düşüş** yeşil — yön otomatik yorumlanır |
| `sayilar` | hayır | "115 kuralın 26'sı ölçülebildi · 11 bulgu" satırı |
| `bulgular` | hayır | **Yalnızca `uygulanabilir: true` olanları yazın.** Kart 3-5 öneri gösterecek şekilde tasarlandı; 11 bulgunun tamamı konursa panoyu boğar. |

`bulgular` içindeki `aksiyon` başlık olarak, `olcum` ve `neden` açıklama
olarak, `etki` yeşil satır olarak gösterilir. Hepsi HTML kaçışından geçer —
metin içinde `<` `>` olması güvenlik sorunu yaratmaz.

## Yazma kodu (panel tarafına)

Panel Node.js ise, denetimi çalıştırdıktan sonra şunu çağırmanız yeterli:

```js
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ credential: cert(require("./mst-crm-service-account.json")) });
const db = getFirestore();

// denetim = reklam denetim motorunuzun ciktisi
async function crmeYaz(denetim) {
  await db.collection("crm").doc("reklam_durumu").set({
    guncellenme: new Date().toISOString(),
    donem: denetim.donem,
    ozet: denetim.ozet,
    trend: denetim.trend,
    sayilar: {
      toplamKural: denetim.toplamKural,
      kontrolEdilen: denetim.kontrolEdilen,
      ihlal: denetim.ihlalSayisi,
      temiz: denetim.temizSayisi,
      uygulanabilir: denetim.uygulanabilirSayi
    },
    // SADECE uygulanabilir olanlar, en fazla 5 tane
    bulgular: denetim.ihlaller
      .filter(x => x.uygulanabilir)
      .slice(0, 5)
      .map(x => ({
        no: x.no, grup: x.grup, aksiyon: x.aksiyon,
        olcum: x.olcum, neden: x.neden, etki: x.etki
      }))
  });
}
```

`set()` kullanın (`update()` değil) — doküman yoksa oluşturur.

### Ne sıklıkta

Saatte bir fazlasıyla yeterli; reklam metrikleri o hızda değişmiyor. Günde
2-4 kez de olur — CRM 36 saate kadar şikâyet etmez.

### Erişim için gereken

Panele MST CRM projesinin (`mst-crm`) bir **Firebase servis hesabı anahtarı**
verilmeli. Bu anahtar yalnızca panelin sunucusunda durmalı, tarayıcıya
gönderilmemeli.

## Doğrulama

Panel yazmaya başladıktan sonra CRM'de yönetici hesabıyla panoya bakın. Üç
durumdan birini görürsünüz:

| Görünen | Anlamı |
|---|---|
| Rakamlar ve öneriler | Çalışıyor |
| "Yönetim paneli henüz reklam verisi yazmamış" | Doküman hiç oluşmamış — yol yanlış olabilir |
| Sarı "Veri güncel değil" uyarısı | Doküman var ama `guncellenme` 36 saatten eski — panel yazmayı durdurmuş |
