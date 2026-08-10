#!/usr/bin/env node
/* Yazar CRM MCP sunucusu — Claude'un CRM verisini okuyabilmesi icin.
 *
 * SALT OKUNUR. Hicbir arac Firestore'a yazmaz/silmez; sadece .get() ve
 * count() cagrilir. Kayit degistirmek isteyen bir istek gelirse CRM
 * arayuzunden yapilmali.
 *
 * stdio uzerinden konusur: STDOUT SADECE protokol mesajlari icindir,
 * teshis ciktilari stderr'e yazilir (console.log kullanmayin).
 */
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const crm = require("./crm.js");
const kota = require("./kota.js");

const ARACLAR = [
  {
    name: "crm_ozet",
    description: "CRM'in genel durumu: toplam kayit, duruma gore dagilim, bugun eklenenler, bugunku gorusme sayisi, bekleyen tahsilat toplami. 'CRM'de durum ne', 'kac aday var' gibi sorularda ilk buraya bak.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "crm_gun_raporu",
    description: "Belirli bir gunun raporu: her personel icin gorusme/kacirilan arama/olumlu/olumsuz sayilari VE o gun kimle ne konusuldugunun tam dokumu (gorusme notlari). 'Bugun ne yapildi', 'dun Nilay kimlerle gorustu' sorularinin cevabi.",
    inputSchema: {
      type: "object",
      properties: {
        tarih: { type: "string", description: "YYYY-AA-GG. Bos birakilirsa bugun." },
        personel: { type: "string", description: "Personel adi (ornegin 'Nilay'). Bos birakilirsa herkes." }
      }
    }
  },
  {
    name: "crm_yazar_ara",
    description: "Yazar/aday arar: ad, telefon ya da not icerigine gore. Ozet bilgi doner (en fazla 25 sonuc). Bir kisi hakkinda soru sorulunca once bunu cagirip kimligini bul.",
    inputSchema: {
      type: "object",
      properties: { sorgu: { type: "string", description: "Aranacak ad, telefon parcasi ya da kelime" } },
      required: ["sorgu"]
    }
  },
  {
    name: "crm_yazar_detay",
    description: "Tek bir yazarin TAM kaydi: durum gecmisi, butun gorusme notlari, odemeleri, dosyalari, kimin ekledigi. Once crm_yazar_ara ile kimligi bulun.",
    inputSchema: {
      type: "object",
      properties: { sorgu: { type: "string", description: "Yazar adi ya da telefonu (tam veya parca)" } },
      required: ["sorgu"]
    }
  },
  {
    name: "crm_gecikmis_takipler",
    description: "Takip tarihi gecmis ama hala aranmamis adaylar — 'kimler unutulmus', 'gecikmis is var mi' sorusunun cevabi. En cok gecikenden basa dogru siralar.",
    inputSchema: {
      type: "object",
      properties: {
        personel: { type: "string", description: "Personel adi. Bos birakilirsa herkes." },
        limit: { type: "number", description: "Kac kayit donsun (varsayilan 30)" }
      }
    }
  },
  {
    name: "crm_odemeler",
    description: "Odeme/tahsilat listesi ve toplamlari. Bekleyen tutar, tahsil edilen tutar, taksitler.",
    inputSchema: {
      type: "object",
      properties: {
        durum: { type: "string", enum: ["hepsi", "bekleyen", "odendi"], description: "Varsayilan 'bekleyen'" },
        limit: { type: "number", description: "Kac kayit donsun (varsayilan 40)" }
      }
    }
  },
  {
    name: "crm_personel_performans",
    description: "Son N gunde personel bazli performans: gorusme, kacirilan arama, sozlesmeye donen, arsivlenen sayilari.",
    inputSchema: {
      type: "object",
      properties: { gun: { type: "number", description: "Kac gun geriye bakilsin (varsayilan 7)" } }
    }
  },
  {
    name: "crm_kota",
    description: "Firebase gunluk kota durumu: bugun kac okuma/yazma kullanilmis, ne kadar kalmis. CRM'de 'veri kaydedilemedi' hatasi bildirildiginde ONCE buraya bak — bu hatanin en sik sebebi kotanin dolmasidir, internet degil.",
    inputSchema: { type: "object", properties: {} }
  }
];

/* ---------- arac govdeleri ---------- */
const islem = {
  async crm_ozet() {
    const [list, staff] = await Promise.all([crm.yazarlar(), crm.personel()]);
    const bugun = crm.bugun();
    const durumlar = {};
    list.forEach(a => {
      const d = crm.DURUM[a.status] || a.status || "—";
      durumlar[d] = (durumlar[d] || 0) + 1;
    });
    let bekleyenTutar = 0, tahsilEdilen = 0;
    list.forEach(a => (a.payments || []).forEach(p => {
      const t = Number(p.amount) || 0;
      if (p.status === "Bekliyor") bekleyenTutar += t; else tahsilEdilen += t;
    }));
    const bugunEklenen = list.filter(a => a.created === bugun).length;
    const bugunGorusme = list.filter(a => (a.logs || []).some(l => l.date === bugun)).length;
    const gecikmis = list.filter(a =>
      crm.AKTIF_DURUMLAR.includes(a.status) && a.followup && a.followup < bugun).length;
    return {
      tarih: bugun,
      toplamKayit: list.length,
      durumDagilimi: durumlar,
      bugunEklenenKayit: bugunEklenen,
      bugunGorusulenKayit: bugunGorusme,
      gecikmisTakip: gecikmis,
      bekleyenTahsilat: Math.round(bekleyenTutar),
      tahsilEdilenToplam: Math.round(tahsilEdilen),
      personelSayisi: staff.length
    };
  },

  async crm_gun_raporu({ tarih, personel: kisi } = {}) {
    const t = tarih || crm.bugun();
    const [list, staff] = await Promise.all([crm.yazarlar(), crm.personel()]);
    let anahtarlar = staff.map(s => s.id).concat(["admin"]);
    if (kisi) {
      const bulunan = staff.filter(s => (s.name || "").toLowerCase().includes(kisi.toLowerCase()));
      if (!bulunan.length) return { hata: `"${kisi}" adinda personel bulunamadi.`, personeller: staff.map(s => s.name) };
      anahtarlar = bulunan.map(s => s.id);
    }
    const satirlar = anahtarlar.map(k => ({
      personel: crm.personelAdi(staff, k),
      ...crm.gunIstatistigi(list, k, t),
      dokum: crm.gunDokumu(list, k, t)
    })).filter(r => r.gorusme > 0 || r.kacirilan > 0);
    return {
      tarih: t,
      not: satirlar.length ? undefined : "Bu tarihte hicbir personelin kaydi yok.",
      personeller: satirlar
    };
  },

  async crm_yazar_ara({ sorgu }) {
    const [list, staff] = await Promise.all([crm.yazarlar(), crm.personel()]);
    const q = String(sorgu || "").toLowerCase().trim();
    const rakam = q.replace(/\D/g, "");
    const bulunan = list.filter(a => {
      const ad = (a.name || "").toLowerCase();
      const tel = String(a.phone || "").replace(/\D/g, "");
      const notlar = (a.logs || []).map(l => l.text || "").join(" ").toLowerCase();
      return ad.includes(q) ||
        (rakam.length >= 4 && tel.includes(rakam)) ||
        (q.length >= 4 && notlar.includes(q));
    });
    return {
      bulunan: bulunan.length,
      gosterilen: Math.min(bulunan.length, 25),
      sonuclar: bulunan.slice(0, 25).map(a => ({
        ad: a.name, telefon: a.phone || null,
        durum: crm.DURUM[a.status] || a.status,
        gorusmeSayisi: (a.logs || []).length,
        sonGorusme: (a.logs || []).map(l => l.date).sort().pop() || null,
        kayitTarihi: a.created,
        gorusmeci: crm.personelAdi(staff, a.addedBy)
      }))
    };
  },

  async crm_yazar_detay({ sorgu }) {
    const r = await islem.crm_yazar_ara({ sorgu });
    if (!r.bulunan) return { hata: `"${sorgu}" icin kayit bulunamadi.` };
    const [list, staff] = await Promise.all([crm.yazarlar(), crm.personel()]);
    const q = String(sorgu).toLowerCase().trim();
    const rakam = q.replace(/\D/g, "");
    const a = list.find(x => (x.name || "").toLowerCase() === q) ||
      list.find(x => rakam.length >= 7 && String(x.phone || "").replace(/\D/g, "").includes(rakam)) ||
      list.find(x => (x.name || "").toLowerCase().includes(q));
    if (!a) return { hata: "Kayit secilemedi.", adaylar: r.sonuclar.map(s => s.ad) };
    if (r.bulunan > 1) r.digerEslesmeler = r.sonuclar.map(s => s.ad).filter(n => n !== a.name).slice(0, 8);
    return {
      ad: a.name, telefon: a.phone || null, eposta: a.email || null,
      durum: crm.DURUM[a.status] || a.status,
      kayitTarihi: a.created,
      gorusmeci: crm.personelAdi(staff, a.addedBy),
      kaynak: a.source || null, paket: a.package || null,
      sozlesmeTarihi: a.contractDate || null,
      takipTarihi: a.followup || null,
      randevu: a.interviewDate ? `${a.interviewDate}${a.interviewTime ? " " + a.interviewTime : ""}` : null,
      notlar: a.notes || null,
      durumGecmisi: (a.statusHistory || []).map(h => `${h.date}: ${crm.DURUM[h.status] || h.status}`),
      gorusmeler: (a.logs || []).map(l => ({
        tarih: l.date, tur: l.type || "Not",
        gorusmeci: crm.personelAdi(staff, l.staffId || "admin"),
        metin: (l.text || "").trim()
      })),
      odemeler: (a.payments || []).map(p => ({
        tutar: p.amount, tarih: p.date, durum: p.status,
        aciklama: p.notes || null, ekleyen: crm.personelAdi(staff, p.addedBy)
      })),
      dosyalar: (a.files || []).map(f => ({ ad: f.name, tur: f.type, tarih: f.date })),
      digerEslesmeler: r.digerEslesmeler
    };
  },

  async crm_gecikmis_takipler({ personel: kisi, limit } = {}) {
    const [list, staff] = await Promise.all([crm.yazarlar(), crm.personel()]);
    const bugun = crm.bugun();
    let sonuc = list.filter(a =>
      crm.AKTIF_DURUMLAR.includes(a.status) && a.followup && a.followup < bugun);
    if (kisi) {
      const p = staff.filter(s => (s.name || "").toLowerCase().includes(kisi.toLowerCase())).map(s => s.id);
      if (!p.length) return { hata: `"${kisi}" adinda personel bulunamadi.` };
      sonuc = sonuc.filter(a => p.includes(a.addedBy));
    }
    sonuc.sort((x, y) => String(x.followup).localeCompare(String(y.followup)));
    const n = limit || 30;
    return {
      toplamGecikmis: sonuc.length,
      gosterilen: Math.min(sonuc.length, n),
      kayitlar: sonuc.slice(0, n).map(a => ({
        ad: a.name, telefon: a.phone || null,
        durum: crm.DURUM[a.status] || a.status,
        takipTarihi: a.followup,
        gecikmeGun: Math.round((new Date(bugun) - new Date(a.followup)) / 864e5),
        gorusmeci: crm.personelAdi(staff, a.addedBy),
        sonGorusme: (a.logs || []).map(l => l.date).sort().pop() || null
      }))
    };
  },

  async crm_odemeler({ durum, limit } = {}) {
    const [list, staff] = await Promise.all([crm.yazarlar(), crm.personel()]);
    const hepsi = list.flatMap(a => crm.odemeleri(a));
    const d = durum || "bekleyen";
    let sec = hepsi;
    if (d === "bekleyen") sec = hepsi.filter(p => p.status === "Bekliyor");
    else if (d === "odendi") sec = hepsi.filter(p => p.status !== "Bekliyor");
    sec.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    const n = limit || 40;
    const topla = arr => Math.round(arr.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    return {
      filtre: d,
      toplamKayit: sec.length,
      toplamTutar: topla(sec),
      genelBekleyen: topla(hepsi.filter(p => p.status === "Bekliyor")),
      genelTahsilEdilen: topla(hepsi.filter(p => p.status !== "Bekliyor")),
      gosterilen: Math.min(sec.length, n),
      odemeler: sec.slice(0, n).map(p => ({
        yazar: p.yazar, tutar: p.amount, tarih: p.date, durum: p.status,
        aciklama: p.notes || null, ekleyen: crm.personelAdi(staff, p.addedBy)
      }))
    };
  },

  async crm_personel_performans({ gun } = {}) {
    const n = gun || 7;
    const [list, staff] = await Promise.all([crm.yazarlar(), crm.personel()]);
    const bugun = crm.bugun();
    const gunler = [];
    for (let i = 0; i < n; i++) gunler.push(crm.gunEkle(bugun, -i));
    const anahtarlar = staff.map(s => s.id).concat(["admin"]);
    const satirlar = anahtarlar.map(k => {
      const top = { gorusme: 0, kacirilan: 0, olumlu: 0, olumsuz: 0 };
      gunler.forEach(g => {
        const s = crm.gunIstatistigi(list, k, g);
        top.gorusme += s.gorusme; top.kacirilan += s.kacirilan;
        top.olumlu += s.olumlu; top.olumsuz += s.olumsuz;
      });
      return { personel: crm.personelAdi(staff, k), ...top };
    }).filter(r => r.gorusme > 0 || r.kacirilan > 0)
      .sort((a, b) => b.gorusme - a.gorusme);
    return { donem: `${gunler[gunler.length - 1]} → ${bugun} (${n} gun)`, personeller: satirlar };
  },

  async crm_kota() {
    return await kota.durum();
  }
};

/* ---------- MCP sunucusu ---------- */
const server = new Server(
  { name: "mst-crm", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ARACLAR }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const ad = req.params.name;
  const fn = islem[ad];
  if (!fn) {
    return { isError: true, content: [{ type: "text", text: `Bilinmeyen arac: ${ad}` }] };
  }
  try {
    const sonuc = await fn(req.params.arguments || {});
    // Her cevaba o ana kadarki okuma maliyetini iliştiriyoruz — kota
    // ucretsiz planda sert bir sinir, gorunur olmasi lazim.
    const meta = { _firestoreOkuma: crm.okuma() };
    return { content: [{ type: "text", text: JSON.stringify({ ...sonuc, ...meta }, null, 2) }] };
  } catch (e) {
    const kotaHatasi = e && (e.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(e.message)));
    return {
      isError: true,
      content: [{
        type: "text",
        text: kotaHatasi
          ? `Firestore gunluk kotasi dolmus (RESOURCE_EXHAUSTED). Bu bir internet sorunu DEGIL. Kota her gun 10:00'da (TR) sifirlanir. crm_kota aracini cagirip durumu gorebilirsiniz.`
          : `Hata: ${e.message}`
      }]
    };
  }
});

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("[mst-crm] MCP sunucusu hazir (salt okunur). Anahtar:", crm.KEY_PATH);
}
main().catch(e => { console.error("[mst-crm] baslatilamadi:", e.message); process.exit(1); });
