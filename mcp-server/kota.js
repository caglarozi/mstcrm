/* Firebase gunluk kota durumu (Cloud Monitoring uzerinden).
 *
 * Servis hesabinin monitoring yetkisi YOK; bunun yerine kullanicinin
 * firebase-tools CLI oturumundaki refresh token'i kullaniliyor (cloud-platform
 * kapsami monitoring.read'i icerir). Oturum yoksa arac cokmez, sadece
 * "olculemedi" der.
 *
 * ALIGNMENT TUZAGI: Cloud Monitoring kovalari sorgunun BITISINE gore
 * hizalanir, baslangicina gore degil. 86400sn'lik hizalama ile 2 saatlik bir
 * sorgu bile tam 24 saati doner ve "bugun" 3 kat sisik cikar. Bu yuzden
 * saatlik/5-dakikalik kovalarla sorulup toplam elle hesaplaniyor.
 */
const fs = require("fs");
const path = require("path");

const CONF = process.env.FIREBASE_TOOLS_CONFIG ||
  path.join(process.env.USERPROFILE || process.env.HOME || "", ".config", "configstore", "firebase-tools.json");
// firebase-tools'un herkese acik OAuth istemcisi
const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const PROJECT = process.env.MST_CRM_PROJECT || "mst-crm";
const LIMIT = { read_count: 50000, write_count: 20000, delete_count: 20000 };

// Kota gunu Pasifik gece yarisinda (yaz saatinde 10:00 TR) sifirlanir.
function kotaGunuBasi(now) {
  const pac = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const fark = now.getTime() - pac.getTime();
  return new Date(new Date(pac.getFullYear(), pac.getMonth(), pac.getDate()).getTime() + fark);
}

async function token() {
  if (!fs.existsSync(CONF)) throw new Error("firebase-tools oturumu bulunamadi: " + CONF);
  const c = JSON.parse(fs.readFileSync(CONF, "utf8"));
  const rt = c.tokens && c.tokens.refresh_token;
  if (!rt) throw new Error("firebase-tools oturumunda refresh_token yok ('firebase login' calistirin)");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" })
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Google erisim jetonu alinamadi");
  return j.access_token;
}

async function seri(tk, metrik, bas, bit, hizalama) {
  const filtre = `metric.type="firestore.googleapis.com/document/${metrik}"`;
  const url = `https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?` +
    `filter=${encodeURIComponent(filtre)}` +
    `&interval.startTime=${bas.toISOString()}&interval.endTime=${bit.toISOString()}` +
    `&aggregation.alignmentPeriod=${hizalama}s&aggregation.perSeriesAligner=ALIGN_SUM` +
    `&aggregation.crossSeriesReducer=REDUCE_SUM`;
  const j = await (await fetch(url, { headers: { Authorization: "Bearer " + tk } })).json();
  if (j.error) throw new Error(j.error.message);
  let toplam = 0;
  (j.timeSeries || []).forEach(ts => (ts.points || []).forEach(p => {
    toplam += Number(p.value.int64Value || p.value.doubleValue || 0);
  }));
  return toplam;
}

async function durum() {
  let tk;
  try { tk = await token(); }
  catch (e) { return { olculemedi: true, sebep: e.message, ipucu: "Terminalde 'firebase login' calistirin." }; }

  const now = new Date();
  const bas = kotaGunuBasi(now);
  const bit = new Date(Math.floor(now.getTime() / 300000) * 300000);   // 5 dk'ya yuvarla
  const gecen = (now - bas) / 3600000;

  const sonuc = { kotaGunuBasladi: bas.toISOString(), gecenSaat: +gecen.toFixed(1) };
  for (const m of Object.keys(LIMIT)) {
    const kullanilan = await seri(tk, m, bas, bit, 300);
    const ad = { read_count: "okuma", write_count: "yazma", delete_count: "silme" }[m];
    sonuc[ad] = {
      kullanilan, limit: LIMIT[m], kalan: Math.max(0, LIMIT[m] - kullanilan),
      yuzde: +(kullanilan / LIMIT[m] * 100).toFixed(1)
    };
  }
  const hiz = gecen > 0 ? sonuc.okuma.kullanilan / gecen : 0;
  sonuc.okumaHiziSaatlik = Math.round(hiz);
  sonuc.tahminiTukenme = (hiz > 0 && sonuc.okuma.kalan > 0)
    ? `${(sonuc.okuma.kalan / hiz).toFixed(1)} saat sonra`
    : "bu hizla dolmaz";
  sonuc.degerlendirme = sonuc.okuma.yuzde >= 90 ? "KRITIK — kota dolmak uzere, 'veri kaydedilemedi' hatalari baslayabilir"
    : sonuc.okuma.yuzde >= 60 ? "Dikkat — tuketim yuksek"
      : "Normal";
  return sonuc;
}

module.exports = { durum };
