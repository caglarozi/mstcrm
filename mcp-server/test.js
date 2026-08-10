/* MCP sunucusunun uctan uca testi: gercek bir MCP istemcisi acar, sunucuyu
 * stdio uzerinden calistirir, araclari cagirir ve CANLI veriye karsi dogrular.
 * Sunucu salt okunur oldugu icin bu test uretim verisini DEGISTIRMEZ.
 */
const fsx = require("fs");
const path = require("path");

let gecti = 0, kaldi = 0;
const kontrol = (ad, sart, detay) => {
  if (sart) { gecti++; console.log(`  OK   ${ad}`); }
  else { kaldi++; console.log(`  HATA ${ad}${detay ? "\n         -> " + detay : ""}`); }
};

(async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  // Onbellegi temizle ki ilk cagrinin gercek maliyetini olcebilelim
  const cacheFile = path.join(__dirname, ".cache", "authors.json");
  if (fsx.existsSync(cacheFile)) fsx.unlinkSync(cacheFile);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, "index.js")]
  });
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const cagir = async (ad, args) => {
    const r = await client.callTool({ name: ad, arguments: args || {} });
    const metin = r.content.map(c => c.text).join("\n");
    if (r.isError) throw new Error(`${ad} hata verdi: ${metin}`);
    return JSON.parse(metin);
  };

  console.log("\n=== 1) BAGLANTI VE ARAC LISTESI ===");
  const { tools } = await client.listTools();
  kontrol("sunucu baglandi ve arac listesi dondu", tools.length > 0, `${tools.length}`);
  const beklenen = ["crm_ozet", "crm_gun_raporu", "crm_yazar_ara", "crm_yazar_detay",
    "crm_gecikmis_takipler", "crm_odemeler", "crm_personel_performans", "crm_kota"];
  const eksik = beklenen.filter(b => !tools.find(t => t.name === b));
  kontrol("8 aracin hepsi kayitli", eksik.length === 0, "eksik: " + eksik.join(", "));
  kontrol("her aracin aciklamasi var", tools.every(t => t.description && t.description.length > 20));

  console.log("\n=== 2) crm_ozet ===");
  const ozet = await cagir("crm_ozet");
  kontrol("toplam kayit 800'den fazla", ozet.toplamKayit > 800, `${ozet.toplamKayit}`);
  kontrol("durum dagilimi dolu", Object.keys(ozet.durumDagilimi).length >= 3, JSON.stringify(ozet.durumDagilimi));
  kontrol("Aday durumu en kalabalik grup", (ozet.durumDagilimi["Aday"] || 0) > 100, `${ozet.durumDagilimi["Aday"]}`);
  kontrol("bekleyen tahsilat sayisal", typeof ozet.bekleyenTahsilat === "number", `${ozet.bekleyenTahsilat}`);
  kontrol("personel sayisi 5", ozet.personelSayisi === 5, `${ozet.personelSayisi}`);
  const ilkOkuma = ozet._firestoreOkuma;
  console.log(`       (ilk cagri maliyeti: ${ilkOkuma} okuma — tek seferlik tam tarama)`);

  console.log("\n=== 3) crm_yazar_ara ===");
  const ara = await cagir("crm_yazar_ara", { sorgu: "Cenk Güner" });
  kontrol("ada gore buluyor", ara.bulunan >= 1, JSON.stringify(ara.sonuclar && ara.sonuclar[0]));
  kontrol("telefonu donduruyor", !!(ara.sonuclar[0] && ara.sonuclar[0].telefon));
  kontrol("gorusmeci adi cozuluyor (id degil)", ara.sonuclar[0].gorusmeci && !/^m[a-z0-9]{10,}$/.test(ara.sonuclar[0].gorusmeci), ara.sonuclar[0].gorusmeci);
  const telAra = await cagir("crm_yazar_ara", { sorgu: "0537 454 48 00" });
  kontrol("telefonla da buluyor", telAra.bulunan >= 1, `${telAra.bulunan}`);
  const cokAra = await cagir("crm_yazar_ara", { sorgu: "a" });
  kontrol("sonuc sayisi 25 ile sinirli (baglam sismesin)", cokAra.sonuclar.length <= 25, `${cokAra.sonuclar.length}`);

  console.log("\n=== 4) crm_yazar_detay ===");
  const detay = await cagir("crm_yazar_detay", { sorgu: "Cenk Güner" });
  kontrol("gorusme notlari geliyor", Array.isArray(detay.gorusmeler) && detay.gorusmeler.length >= 4, `${detay.gorusmeler && detay.gorusmeler.length}`);
  kontrol("not metni dolu", detay.gorusmeler[0].metin && detay.gorusmeler[0].metin.length > 10);
  kontrol("notta gorusmeci adi var", !!detay.gorusmeler[0].gorusmeci);
  kontrol("durum gecmisi var", Array.isArray(detay.durumGecmisi));
  const yokDetay = await cagir("crm_yazar_detay", { sorgu: "zzzz-olmayan-kayit-zzzz" });
  kontrol("olmayan kayitta duzgun hata mesaji", !!yokDetay.hata, JSON.stringify(yokDetay).slice(0, 80));

  console.log("\n=== 5) crm_gun_raporu (5 Agustos — bilinen gun) ===");
  const rapor = await cagir("crm_gun_raporu", { tarih: "2026-08-05" });
  const nilay = (rapor.personeller || []).find(p => /Nilay/i.test(p.personel));
  kontrol("5 Agustos raporu personel donduruyor", (rapor.personeller || []).length >= 2, `${(rapor.personeller || []).length}`);
  // "gorusme" = o gun DOKUNULAN kayit sayisi (acilan + not girilen), app.js'teki
  // gun sonu raporuyla ayni tanim. Nilay 5 Agustos'ta 7 kayit ACMIS ama toplam
  // 29 kayda not girmis (baskalarinin/onenote'tan gelen kayitlar dahil).
  kontrol("Nilay o gun 29 kayda dokunmus", nilay && nilay.gorusme === 29, nilay && `${nilay.gorusme}`);
  kontrol("dokum sayisi sayacla birebir tutuyor", nilay && nilay.dokum.length === nilay.gorusme,
    nilay && `dokum=${nilay.dokum.length} sayac=${nilay.gorusme}`);
  const oGunAcilan = nilay && nilay.dokum.filter(d => d.bugunEklendi).length;
  kontrol("bunlarin 7'si o gun ACILAN kayit", oGunAcilan === 7, `${oGunAcilan}`);
  kontrol("dokumde not metinleri var", nilay && nilay.dokum.some(d => d.notlar.some(n => n.metin.length > 20)));
  kontrol("dokumde yazar adi ve telefon var", nilay && nilay.dokum[0].yazar && nilay.dokum[0].telefon);
  const tekKisi = await cagir("crm_gun_raporu", { tarih: "2026-08-05", personel: "Nilay" });
  kontrol("personel suzgeci calisiyor", tekKisi.personeller.length === 1, `${tekKisi.personeller.length}`);
  const olmayanKisi = await cagir("crm_gun_raporu", { tarih: "2026-08-05", personel: "Olmayan Kisi" });
  kontrol("olmayan personelde duzgun hata", !!olmayanKisi.hata);

  console.log("\n=== 6) crm_gecikmis_takipler ===");
  const gec = await cagir("crm_gecikmis_takipler", { limit: 5 });
  kontrol("gecikmis takip sorgusu calisiyor", typeof gec.toplamGecikmis === "number", `${gec.toplamGecikmis}`);
  kontrol("limit uygulaniyor", gec.kayitlar.length <= 5, `${gec.kayitlar.length}`);
  if (gec.kayitlar.length) {
    kontrol("gecikme gun sayisi hesaplaniyor", gec.kayitlar[0].gecikmeGun > 0, `${gec.kayitlar[0].gecikmeGun}`);
    kontrol("en cok geciken basta", gec.kayitlar[0].gecikmeGun >= gec.kayitlar[gec.kayitlar.length - 1].gecikmeGun);
  }

  console.log("\n=== 7) crm_odemeler ===");
  const od = await cagir("crm_odemeler", { durum: "bekleyen", limit: 5 });
  kontrol("bekleyen odeme sorgusu calisiyor", typeof od.genelBekleyen === "number", `${od.genelBekleyen}`);
  kontrol("odenmis toplami da geliyor", typeof od.genelTahsilEdilen === "number", `${od.genelTahsilEdilen}`);
  kontrol("sadece Bekliyor kayitlari geldi", od.odemeler.every(p => p.durum === "Bekliyor"));
  kontrol("ekleyen adi cozuluyor", od.odemeler.length === 0 || !!od.odemeler[0].ekleyen);

  console.log("\n=== 8) crm_personel_performans ===");
  const perf = await cagir("crm_personel_performans", { gun: 7 });
  kontrol("donem bilgisi var", !!perf.donem, perf.donem);
  kontrol("personel satirlari geldi", Array.isArray(perf.personeller));
  kontrol("gorusmeye gore azalan sirali", perf.personeller.length < 2 ||
    perf.personeller[0].gorusme >= perf.personeller[1].gorusme);

  console.log("\n=== 9) crm_kota ===");
  const kt = await cagir("crm_kota");
  if (kt.olculemedi) {
    kontrol("kota olculemediginde duzgun aciklama", !!kt.sebep && !!kt.ipucu, kt.sebep);
  } else {
    kontrol("okuma kotasi olculuyor", kt.okuma && typeof kt.okuma.kullanilan === "number", JSON.stringify(kt.okuma));
    kontrol("kalan hesaplaniyor", kt.okuma.kalan === Math.max(0, 50000 - kt.okuma.kullanilan));
    kontrol("degerlendirme metni var", !!kt.degerlendirme, kt.degerlendirme);
  }

  console.log("\n=== 10) KOTA GUVENLIGI (bu sunucunun asil sinavi) ===");
  const oncekiOkuma = kt._firestoreOkuma;
  await cagir("crm_ozet"); await cagir("crm_yazar_ara", { sorgu: "Ece" });
  await cagir("crm_gecikmis_takipler"); await cagir("crm_odemeler");
  const son = await cagir("crm_personel_performans");
  const ekMaliyet = son._firestoreOkuma - oncekiOkuma;
  console.log(`       ilk cagri: ${ilkOkuma} okuma | sonraki 14 cagri toplam: ${son._firestoreOkuma - ilkOkuma} okuma`);
  kontrol("ilk cagri tam tarama yapti (~820)", ilkOkuma > 700, `${ilkOkuma}`);
  kontrol("sonraki 5 cagri 50 okumadan az harcadi", ekMaliyet < 50, `${ekMaliyet} okuma`);
  kontrol("14 cagrinin toplami tek tam taramadan ucuz", (son._firestoreOkuma - ilkOkuma) < ilkOkuma,
    `${son._firestoreOkuma - ilkOkuma} < ${ilkOkuma}`);
  kontrol("onbellek dosyasi olustu", fsx.existsSync(cacheFile));

  console.log("\n=== 11) HATALI GIRDI ===");
  const r = await client.callTool({ name: "olmayan_arac", arguments: {} });
  kontrol("bilinmeyen arac cokmeden hata donuyor", r.isError === true);

  await client.close();
  console.log(`\n${"=".repeat(50)}\nSONUC: ${gecti} gecti, ${kaldi} kaldi`);
  process.exit(kaldi ? 1 : 0);
})().catch(e => { console.error("TEST CALISTIRILAMADI:", e.message); process.exit(2); });
