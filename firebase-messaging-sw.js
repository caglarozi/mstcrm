// Firebase Cloud Messaging service worker — CRM sekmesi (hatta tarayıcı)
// kapalıyken gelen push bildirimlerini bu dosya karşılar. "notification"
// alanlı FCM mesajlarını tarayıcı otomatik görüntüler; aşağıdaki tıklama
// dinleyicisi bildirime tıklanınca CRM'i açar/odaklar.
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
