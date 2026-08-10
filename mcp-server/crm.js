/* Yazar CRM veri katmani — Firestore'dan SALT OKUNUR erisim.
 *
 * KOTA UYARISI (bu dosyanin var olus sebebi):
 * Proje Firebase ucretsiz (Spark) planinda; gunluk 50.000 okuma siniri var
 * ve authors koleksiyonunda 800+ dokuman duruyor. Her soruda koleksiyonun
 * tamamini okuyan naif bir sunucu, birkac soruda gunluk kotayi bitirir ve
 * CRM'de "veri kaydedilemedi" hatalarina yol acar (2026-08-05'te tam olarak
 * bu yasandi). Bu yuzden burada web uygulamasiyla AYNI yontem kullaniliyor:
 *   - yerel bir kopya (cache dosyasi) tutulur,
 *   - sunucuya sadece "en son gordugumden beri degisenleri ver" diye sorulur
 *     (updatedAt > watermark),
 *   - sayim gereken yerlerde count() toplama sorgusu kullanilir (1000
 *     dokumanda 1 okuma).
 * Ilk calistirmada bir kez tam okuma yapilir (~820), sonrasinda soru basina
 * tipik maliyet 5-20 okumadir.
 */
const fs = require("fs");
const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const KEY_PATH = process.env.MST_CRM_KEY ||
  "C:/Users/Caglar Ozen/Downloads/mst-crm-firebase-adminsdk-fbsvc-e4e77e73e7.json";
const CACHE_DIR = process.env.MST_CRM_CACHE_DIR || path.join(__dirname, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "authors.json");
// Fark sorgusunu damganin bir tik gerisinden baslatiyoruz: webhook'la
// olusan kayitlar sunucu damgasi yerine kendi saatini kullanabiliyor.
const DELTA_SAFETY_MS = 60 * 1000;
// Yerel kopya en fazla 1 gun kullanilir; sonra bastan cekilir. Damgasiz bir
// yazma yolu kalirsa olusacak sessiz eskime en fazla bir gun surer.
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let db = null;
let okumaSayaci = 0;   // bu surecte harcanan tahmini Firestore okumasi
let cache = null;      // { watermark, savedAt, authors }

function baglan() {
  if (db) return db;
  if (!fs.existsSync(KEY_PATH)) {
    throw new Error(
      `Firebase servis hesabi anahtari bulunamadi: ${KEY_PATH}\n` +
      `MST_CRM_KEY ortam degiskeniyle dogru yolu verin.`
    );
  }
  initializeApp({ credential: cert(require(KEY_PATH)) });
  db = getFirestore();
  return db;
}

/* ---------- tarih yardimcilari (Turkiye saati, sabit UTC+3) ---------- */
function bugun() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function gunEkle(tarih, gun) {
  const d = new Date(tarih + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + gun);
  return d.toISOString().slice(0, 10);
}

/* ---------- yerel kopya ---------- */
function cacheOku() {
  try {
    const p = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (!p || !Array.isArray(p.authors) || !p.authors.length) return null;
    if (!p.watermark || !p.savedAt) return null;
    if (Date.now() - p.savedAt > CACHE_MAX_AGE_MS) return null;
    return p;
  } catch (e) { return null; }
}
function cacheYaz(p) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(p));
  } catch (e) { /* kopya yazilamazsa calismaya devam et, sadece pahalilasir */ }
}
function damgaMs(a) {
  const u = a && a.updatedAt;
  if (!u) return 0;
  let ms;
  if (typeof u.toMillis === "function") ms = u.toMillis();
  else if (typeof u._seconds === "number") ms = u._seconds * 1000;
  else if (typeof u.seconds === "number") ms = u.seconds * 1000;
  else ms = new Date(u).getTime();
  if (!Number.isFinite(ms)) return 0;
  // Gelecege dusmus tek bir damga watermark'i ileri firlatip sonraki TUM
  // degisiklikleri gorunmez yapardi; makul ufkun otesini saymiyoruz.
  if (ms > Date.now() + 3600 * 1000) return 0;
  return ms;
}

// Tum yazar kayitlarini dondurur. Ilk cagride yerel kopyayi tazeler.
async function yazarlar() {
  if (cache && cache.tazelendi) return cache.authors;
  baglan();
  const col = db.collection("authors");
  const eski = cache || cacheOku();

  if (eski) {
    const esik = Timestamp.fromMillis(Math.max(0, eski.watermark - DELTA_SAFETY_MS));
    const snap = await col.where("updatedAt", ">", esik).get();
    okumaSayaci += snap.size;
    const harita = new Map(eski.authors.map(a => [a.id, a]));
    let wm = eski.watermark;
    snap.forEach(d => {
      const a = d.data();
      wm = Math.max(wm, damgaMs(a));
      if (a.deleted === true) harita.delete(a.id); else harita.set(a.id, a);
    });
    cache = { watermark: wm, savedAt: Date.now(), authors: [...harita.values()], tazelendi: true };
  } else {
    const snap = await col.get();                 // ilk kurulum: tek seferlik tam okuma
    okumaSayaci += snap.size;
    let wm = 0;
    const list = [];
    snap.forEach(d => {
      const a = d.data();
      wm = Math.max(wm, damgaMs(a));
      if (a.deleted !== true) list.push(a);
    });
    cache = { watermark: wm, savedAt: Date.now(), authors: list, tazelendi: true };
  }
  cacheYaz({ watermark: cache.watermark, savedAt: cache.savedAt, authors: cache.authors });
  return cache.authors;
}

async function personel() {
  baglan();
  const d = await db.collection("crm").doc("staff").get();
  okumaSayaci += 1;
  return d.exists ? (d.data().staff || []) : [];
}
function personelAdi(liste, id) {
  if (id === "admin") return "Sistem Yöneticisi";
  if (id === "onenote-import") return "OneNote aktarımı";
  const s = liste.find(x => x.id === id);
  return s ? s.name : (id || "—");
}

const DURUM = {
  aday: "Aday", gorusuluyor: "Görüşülüyor", degerlendirme: "Değerlendirme",
  eseryaziyor: "Eser Yazıyor", sozlesme: "Sözleşme", yayinda: "Yayında", arsiv: "Arşiv"
};
const AKTIF_DURUMLAR = ["aday", "gorusuluyor", "degerlendirme", "eseryaziyor"];

/* ---------- gun raporu (app.js'teki mantigin AYNISI) ---------- */
function gunIstatistigi(list, staffKey, tarih) {
  const kayitlar = list.filter(a => {
    const bugunEklendi = a.created === tarih && (a.addedBy || "admin") === staffKey;
    const bugunNot = (a.logs || []).some(l => l.date === tarih && (l.staffId || "admin") === staffKey);
    return bugunEklendi || bugunNot;
  });
  const olumlu = kayitlar.filter(a => a.status === "sozlesme" || a.status === "yayinda").length;
  const olumsuz = kayitlar.filter(a => a.status === "arsiv").length;
  const kacirilan = list.filter(a => {
    if (!AKTIF_DURUMLAR.includes(a.status)) return false;
    if ((a.addedBy || "admin") !== staffKey) return false;
    const aranmaliydi = (a.followup && a.followup <= tarih) || (a.interviewDate === tarih);
    if (!aranmaliydi) return false;
    return !(a.logs || []).some(l => l.date === tarih);
  }).length;
  const sonuclanan = olumlu + olumsuz;
  return {
    gorusme: kayitlar.length, kacirilan, olumlu, olumsuz,
    devamEden: kayitlar.length - olumlu - olumsuz,
    basariYuzde: sonuclanan > 0 ? Math.round(olumlu / sonuclanan * 100) : null
  };
}
function gunDokumu(list, staffKey, tarih) {
  return list.map(a => {
    const notlar = (a.logs || []).filter(l => l.date === tarih && (l.staffId || "admin") === staffKey);
    const bugunEklendi = a.created === tarih && (a.addedBy || "admin") === staffKey;
    if (!notlar.length && !bugunEklendi) return null;
    return {
      yazar: a.name, telefon: a.phone || null,
      durum: DURUM[a.status] || a.status,
      bugunEklendi,
      notlar: notlar.map(l => ({ tur: l.type || "Not", metin: (l.text || "").trim() }))
    };
  }).filter(Boolean).sort((x, y) => y.notlar.length - x.notlar.length);
}

/* ---------- odeme yardimcilari ---------- */
function odemeleri(a) {
  return (a.payments || []).map(p => ({ ...p, yazar: a.name, yazarId: a.id }));
}

module.exports = {
  baglan, yazarlar, personel, personelAdi, odemeleri,
  gunIstatistigi, gunDokumu, gunEkle, bugun,
  DURUM, AKTIF_DURUMLAR,
  okuma: () => okumaSayaci,
  cacheDurumu: () => cache ? { kayit: cache.authors.length, damga: new Date(cache.watermark).toISOString() } : null,
  KEY_PATH, CACHE_FILE,
  _db: () => baglan()
};
