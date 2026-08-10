# Yazar CRM — MCP sunucusu

Claude'un CRM verisini (Firestore `authors` koleksiyonu) okuyabilmesi için
küçük bir MCP sunucusu. Böylece Claude'a doğrudan şunlar sorulabilir:

- "Bugün kaç aday eklendi, kimlerle görüşüldü?"
- "Nilay dün kimlerle görüştü, ne konuşulmuş?"
- "Takibi gecikmiş kimler var?"
- "Bekleyen tahsilat ne kadar?"
- "Cenk Güner'le şimdiye kadar ne konuşulmuş?"
- "Firebase kotası ne durumda?"

## SALT OKUNUR

Hiçbir araç Firestore'a yazmaz veya silmez — yalnızca `.get()` ve `count()`
çağrılır. Kayıt değiştirmek CRM arayüzünden yapılır. Bu bilinçli bir karar:
üretim verisine yapay zekâ üzerinden yazma yolu açılmadı.

## Kota (bu sunucunun en önemli tasarım kısıtı)

Proje Firebase **ücretsiz (Spark)** planında: günde 50.000 okuma sınırı var ve
`authors` koleksiyonunda 800+ doküman duruyor. Her soruda koleksiyonun
tamamını okuyan naif bir sunucu birkaç soruda günlük kotayı bitirir ve CRM'de
"veri kaydedilemedi" hatalarına yol açar — 2026-08-05'te tam olarak bu yaşandı
(o gün 96.000 okuma, limitin iki katı).

Bu yüzden web uygulamasıyla **aynı** yöntem kullanılıyor:

- yerel bir kopya tutulur (`.cache/authors.json`),
- sunucuya sadece "en son gördüğümden beri değişenleri ver" diye sorulur
  (`updatedAt > watermark`),
- kopya en fazla 1 gün kullanılır, sonra baştan çekilir.

Ölçülen maliyet (uçtan uca testten):

| | Okuma |
|---|---|
| İlk çağrı (tek seferlik tam tarama) | 844 |
| Sonraki 14 çağrı, **toplam** | 17 |

Her aracın cevabına `_firestoreOkuma` alanı eklenir — o ana kadar harcanan
tahmini okuma sayısı. Kota dolarsa araç bunu açıkça söyler ("bu bir internet
sorunu değil").

## Araçlar

| Araç | Ne yapar |
|---|---|
| `crm_ozet` | Genel durum: toplam kayıt, durum dağılımı, bugün eklenenler, bekleyen tahsilat |
| `crm_gun_raporu` | Bir günün raporu: personel bazlı sayılar + kimle ne konuşulduğunun tam dökümü |
| `crm_yazar_ara` | Ad, telefon veya not içeriğine göre arama (en fazla 25 sonuç) |
| `crm_yazar_detay` | Tek kaydın tamamı: görüşme notları, ödemeler, durum geçmişi |
| `crm_gecikmis_takipler` | Takip tarihi geçmiş, aranmamış adaylar |
| `crm_odemeler` | Ödeme listesi, bekleyen/tahsil edilen toplamlar |
| `crm_personel_performans` | Son N günde personel bazlı özet |
| `crm_kota` | Firebase günlük kota durumu — "veri kaydedilemedi" şikâyetinde İLK bakılacak yer |

## Kurulum

```bash
cd mcp-server
npm install
```

Sonra Claude Code yapılandırmasına (`~/.claude.json` içindeki `mcpServers`)
ekleyin:

```json
"mst-crm": {
  "type": "stdio",
  "command": "node",
  "args": ["C:/.../mcp-server/index.js"],
  "env": {
    "MST_CRM_KEY": "C:/.../mst-crm-firebase-adminsdk-fbsvc-XXXX.json"
  }
}
```

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `MST_CRM_KEY` | Downloads'taki anahtar | Firebase servis hesabı JSON yolu |
| `MST_CRM_CACHE_DIR` | `mcp-server/.cache` | Yerel kopyanın tutulduğu klasör |
| `MST_CRM_PROJECT` | `mst-crm` | Firebase proje kimliği |

`crm_kota` aracı, kullanıcının `firebase login` oturumundaki jetonu kullanır
(servis hesabının Monitoring yetkisi yok). Oturum yoksa araç çökmez, sadece
"ölçülemedi" der.

## Güvenlik

- Servis hesabı anahtarı **depoya konmaz**, dışarıdan yol olarak verilir.
- `.cache/` gitignore'da — içinde yazar adları, telefonlar ve görüşme notları
  (kişisel veri) bulunur, depoya girmemeli.

## Test

```bash
npm test
```

Gerçek bir MCP istemcisi açıp sunucuyu stdio üzerinden çalıştırır ve canlı
veriye karşı doğrular. Salt okunur olduğu için üretim verisini değiştirmez.
