/* CRM servis worker'ı — iki işi var:
 *   1) Çevrimdışı çalışma ve uygulama olarak kurulabilirlik (install/
 *      activate/fetch dinleyicileri),
 *   2) CRM kapalıyken gelen FCM push bildirimleri (dosyanın sonu).
 *
 * SIRA ÖNEMLİ: fetch dinleyicisi, Firebase'i dışarıdan çeken importScripts
 * çağrısından ÖNCE kaydediliyor. Aksi halde cihaz çevrimdışıyken (ya da
 * gstatic'e erişilemediğinde) importScripts patlar, worker komple ölür ve
 * çevrimdışı desteği push ile birlikte giderdi. Bu sıralamayla push
 * kurulamasa bile çevrimdışı çalışmaya devam eder.
 */

// Sürüm değişince eski önbellek silinir (bkz. activate). Kabuk dosyalarında
// bir sorun çıkarsa sürümü artırmak tüm cihazlarda temiz sayfa açtırır.
const SURUM = "mstcrm-v1";

// Uygulamanın açılması için gereken asgari dosyalar.
const KABUK = [
  "/", "/index.html", "/app.js", "/styles.css", "/manifest.json",
  "/logo.jpeg", "/logo-dark.png", "/icons/icon-192.png", "/icons/icon-512.png"
];

// Bu adreslere ASLA karışma: veritabanı, kimlik doğrulama, push ve CDN
// istekleri worker'dan geçmemeli — önbelleğe alınırlarsa veri tutarsızlığı
// ve bayat oturum sorunları çıkar.
function bizeAitMi(url) {
  return url.origin === self.location.origin;
}
// Kod dosyaları her zaman ağdan tazelenir; resimler önbellekten hızlı gelir.
function kabukDosyasiMi(url) {
  return url.pathname === "/" || /\.(?:html|js|css|json)$/.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(SURUM);
    // Tek tek ekliyoruz: biri 404 verirse kurulumun tamamı çökmesin.
    await Promise.all(KABUK.map(yol =>
      c.add(new Request(yol, { cache: "reload" })).catch(() => {})
    ));
    await self.skipWaiting();   // yeni sürüm beklemeden devralsın
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const adlar = await caches.keys();
    await Promise.all(adlar.filter(a => a !== SURUM).map(a => caches.delete(a)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const istek = event.request;
  if (istek.method !== "GET") return;
  let url;
  try { url = new URL(istek.url); } catch (e) { return; }
  if (!bizeAitMi(url)) return;                  // Firestore/gstatic/worker'a dokunma
  if (url.pathname.startsWith("/__")) return;   // Firebase Hosting iç adresleri

  if (istek.mode === "navigate" || kabukDosyasiMi(url)) {
    // ÖNCE AĞ: çevrimiçiyken kullanıcı HER ZAMAN en güncel kodu alır.
    // Firebase Hosting dosyaları "max-age=3600" ile sunuyor; cache:"no-store"
    // olmadan tarayıcı 1 saate kadar eski app.js'i verebilirdi — telefona
    // kurulu uygulamada kullanıcı sayfayı yenileyerek de kurtulamaz.
    event.respondWith((async () => {
      try {
        const cevap = await fetch(istek, { cache: "no-store" });
        if (cevap && cevap.ok) {
          const kopya = cevap.clone();
          caches.open(SURUM).then(c => c.put(istek, kopya)).catch(() => {});
        }
        return cevap;
      } catch (e) {
        const onbellek = await caches.match(istek, { ignoreSearch: true });
        if (onbellek) return onbellek;
        if (istek.mode === "navigate") {
          const kabuk = (await caches.match("/index.html")) || (await caches.match("/"));
          if (kabuk) return kabuk;
        }
        return new Response(
          "Çevrimdışısınız ve bu sayfanın kopyası cihazda yok. Bağlantı gelince tekrar deneyin.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
    })());
    return;
  }

  // Diğer kendi dosyalarımız (ikon, logo): ÖNCE ÖNBELLEK — hızlı açılır,
  // yoksa ağdan alınıp saklanır.
  event.respondWith((async () => {
    const onbellek = await caches.match(istek);
    if (onbellek) return onbellek;
    try {
      const cevap = await fetch(istek);
      if (cevap && cevap.ok && cevap.type === "basic") {
        const kopya = cevap.clone();
        caches.open(SURUM).then(c => c.put(istek, kopya)).catch(() => {});
      }
      return cevap;
    } catch (e) {
      return new Response("", { status: 504 });
    }
  })());
});

/* ---------- FCM push (buradan sonrası ağ gerektirir) ----------
 * Hata verirse yukarıdaki çevrimdışı desteği etkilenmez.
 */
try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

  firebase.initializeApp({
    apiKey: "AIzaSyDnqNrkeIi7SLHpk8LOXI94BtOU9mXems4",
    authDomain: "mst-crm.firebaseapp.com",
    projectId: "mst-crm",
    storageBucket: "mst-crm.firebasestorage.app",
    messagingSenderId: "796821173721",
    appId: "1:796821173721:web:f3fdef9395f7606e4f95c8"
  });
  firebase.messaging();
} catch (e) {
  // Çevrimdışıyken ya da gstatic engelliyse push kurulamaz; çevrimdışı
  // desteğinin ayakta kalması için sessizce geçiyoruz.
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return clients.openWindow("/");
    })
  );
});
