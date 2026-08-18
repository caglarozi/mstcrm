# CRM → Panel bildirimleri — panel tarafında yapılacaklar

Reklam kartının tersi yönde çalışan köprü. CRM tarafı **hazır ve canlıda**:
CRM'de önemli bir olay olduğunda (ilk olay türü: **sözleşme alındı**)
`panel_events` koleksiyonuna bir olay dokümanı yazılıyor.

Geriye tek iş kaldı: **Yazar yönetim panelinin (app.mstyayincilik.com) bu
koleksiyonu dinleyip olayları işlemesi.** Bu dosya onu tarif eder.

## Neden bu yöntem

CRM tarayıcıda çalışan statik bir uygulama; panele doğrudan HTTP çağrısı
yapması için ortada bir adres/anahtar tutması gerekirdi (tarayıcıya sızardı).
Reklam entegrasyonuyla aynı ilke: **Firestore ortak posta kutusudur.** CRM
olayı bırakır, panel servis hesabıyla alır. Panel zaten `mst-crm` projesinin
servis hesabına sahip olacağı için ek altyapı gerekmez.

## Olay dokümanı

**Yol:** `panel_events/{id}` (koleksiyon `panel_events`, her olay ayrı doküman)

```json
{
  "id": "mabc123xyz",
  "tur": "sozlesme_alindi",
  "tarih": "2026-08-12T14:32:11.000Z",
  "iletildi": false,
  "kaynak": "crm",

  "yazarId": "a1b2c3",
  "yazarAdi": "Ahmet Yılmaz",
  "paket": "pro",
  "gorusmeci": "Ece Uslu"
}
```

### Alan notları

| Alan | Her olayda | Açıklama |
|---|---|---|
| `id` | **evet** | Doküman id'siyle aynı |
| `tur` | **evet** | Olay türü. Şimdilik tek tür: `sozlesme_alindi`. Yeni türler eklenirse bu dosyaya işlenecek — paneliniz bilmediği türleri sessizce `iletildi:true` yapıp geçmeli. |
| `tarih` | **evet** | ISO 8601, olayın CRM'de gerçekleştiği an |
| `iletildi` | **evet** | CRM her zaman `false` yazar; panel işleyince `true` yapar. Kuyruğun tamamı budur. |
| `kaynak` | **evet** | Sabit `"crm"` |
| `yazarAdi`, `paket`, `gorusmeci` | tür bazlı | `sozlesme_alindi` olayında dolu. `paket`: `vip` / `pro` / `standart` / `null` |

## Okuma kodu (panel tarafına)

Panel Node.js ise (reklam entegrasyonundaki servis hesabıyla aynı):

```js
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ credential: cert(require("./mst-crm-service-account.json")) });
const db = getFirestore();

// Canlı dinleme — CRM olayı yazdığı SANİYE panelde tetiklenir:
db.collection("panel_events").where("iletildi", "==", false)
  .onSnapshot(async snap => {
    for (const doc of snap.docs) {
      const ev = doc.data();
      if (ev.tur === "sozlesme_alindi") {
        // Panelin kendi bildirim mekanizması ne ise onu çağırın:
        await panelBildirimGoster(
          `📝 Sözleşme alındı: ${ev.yazarAdi}` +
          (ev.paket ? ` (${ev.paket} paket)` : "") +
          (ev.gorusmeci ? ` — görüşmeci: ${ev.gorusmeci}` : "")
        );
      }
      // Bilinmeyen türler dahil HER olay işaretlenir — kuyruk birikmez.
      await doc.ref.update({ iletildi: true });
    }
  });
```

Canlı dinleme istemiyorsanız aynı sorguyu birkaç dakikada bir `get()` ile
çekmek de olur; `iletildi:true` işaretlemeyi unutmayın.

### Erişim için gereken

Reklam entegrasyonu için zaten planlanan **`mst-crm` servis hesabı anahtarı**
bu iş için de yeterli — servis hesabı Firestore kurallarına tabi olmadığından
`panel_events` üzerinde okuma/yazma yapabilir. Anahtar yalnızca panel
sunucusunda durmalı.

### Güvenlik

Firestore kuralı gereği CRM kullanıcıları bu koleksiyonda yalnızca olay
**oluşturabilir**; okuyamaz, değiştiremez, silemez. Yani bir personel başka
olayları göremez veya kuyruğu bozamaz. Tek okuyucu panel servis hesabıdır.

## Doğrulama

CRM'de bir yazarın durumunu ilk kez "Sözleşme"ye çekin. Firebase konsolunda
`panel_events` altında `iletildi:false` bir doküman belirmeli; panel dinleyici
çalışıyorsa saniyeler içinde bildirimi gösterip dokümanı `iletildi:true`
yapmalı.

## Yeni olay türleri eklemek (CRM tarafı — gelecek için not)

CRM'de `panelEventGonder(tur, veri)` fonksiyonu var (app.js). Yeni bir olayı
haber vermek tek satır: ilgili yere
`panelEventGonder("yeni_tur", { ... })` ekleyin ve bu dosyaya türü işleyin.
