    const firebaseConfig = {
      apiKey: "AIzaSyDnqNrkeIi7SLHpk8LOXI94BtOU9mXems4",
      authDomain: "mst-crm.firebaseapp.com",
      projectId: "mst-crm",
      storageBucket: "mst-crm.firebasestorage.app",
      messagingSenderId: "796821173721",
      appId: "1:796821173721:web:f3fdef9395f7606e4f95c8",
      measurementId: "G-R6EXXCECYC"
    };
    firebase.initializeApp(firebaseConfig);
    const firestore = firebase.firestore();
    // Önceden burada "experimentalForceLongPolling: true" vardı — bu,
    // file:/// yerelde test ederken WebSocket sorununu çözmek için
    // eklenmişti ama CANLI sitede de zorunlu kılındığı için normal
    // WebSocket bağlantısı yerine her zaman daha yavaş/kararsız "long
    // polling" kullanılıyordu — mobil ağ geçişlerinde (wifi<->hücresel)
    // ve bazı ağlarda "ağ bağlantısı hatası" / "kaydedilemedi" hatalarının
    // asıl sebebi muhtemelen buydu. "Auto detect" sadece gerçekten
    // gerektiğinde (ör. WebSocket'i engelleyen bir ağ/proxy) long polling'e
    // düşer, aksi halde normal (daha hızlı ve güvenilir) bağlantıyı kullanır.
    firestore.settings({ experimentalAutoDetectLongPolling: true });
    const auth = firebase.auth();
    const storage = firebase.storage();
    storage.setMaxUploadRetryTime(15000); // 15 saniye sonra sonsuz döngüyü kır ve hata ver
    /* ---------- Ağırlıklı Smooth Scroll (caglarozen.com.tr tarzı) ---------- */
    (function initInertialScroll() {
      let bound = false;
      function setup() {
        const el = document.querySelector('.main');
        if (!el || bound) return;
        bound = true;

        let target = 0;
        let current = 0;
        let running = false;
        const ease = 0.09;
        const multiplier = 0.75;

        el.addEventListener('wheel', function(e) {
          // Login ekranı açıkken dokunma
          const login = document.getElementById('loginScreen');
          if (login && getComputedStyle(login).display !== 'none') return;

          // İç içe scroll edilebilir eleman varsa (drawer, liste vs.) ona izin ver
          let node = e.target;
          while (node && node !== el) {
            if (node.scrollHeight > node.clientHeight + 2) {
              const s = getComputedStyle(node);
              if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
                // Eleman en üstte veya en alttaysa bile native'e bırak
                const atTop = node.scrollTop <= 0 && e.deltaY < 0;
                const atBot = node.scrollTop + node.clientHeight >= node.scrollHeight - 1 && e.deltaY > 0;
                if (!atTop && !atBot) return; // iç eleman scroll edebilir, karışma
              }
            }
            node = node.parentElement;
          }

          e.preventDefault();
          if (!running) {
            current = el.scrollTop;
            target = current;
          }
          target += e.deltaY * multiplier;
          const max = el.scrollHeight - el.clientHeight;
          target = Math.max(0, Math.min(target, max));
          if (!running) tick();
        }, { passive: false });

        function tick() {
          running = true;
          current += (target - current) * ease;
          if (Math.abs(target - current) < 0.5) {
            current = target;
            el.scrollTop = Math.round(current);
            running = false;
            return;
          }
          el.scrollTop = Math.round(current);
          requestAnimationFrame(tick);
        }
      }

      // .main DOM'da hazır olduğunda bağla
      const timer = setInterval(() => {
        if (document.querySelector('.main')) {
          clearInterval(timer);
          setup();
        }
      }, 200);
    })();

    /* ---------- Veri katmanı (Firebase) ---------- */
    const KEY = "kalem_crm_v1";
    const STATUS = {
      aday: { label: "Aday", color: "#9aa1b2" },
      gorusuluyor: { label: "Görüşülüyor", color: "#4aa8ff" },
      degerlendirme: { label: "Değerlendirmede", color: "#f4b740" },
      sozlesme: { label: "Sözleşme", color: "#2563eb" },
      yayinda: { label: "Yayında", color: "#37c98a" },
      arsiv: { label: "Arşiv", color: "#5b6070" }
    };
    const PIPELINE = ["aday", "gorusuluyor", "degerlendirme", "sozlesme", "yayinda"];
    const PACKAGES = {
      vip: { label: "VIP Paket", withVat: 70800, noVat: 59000 },
      pro: { label: "Profesyonel Paket", withVat: 42000, noVat: 35000 },
      standart: { label: "Standart Paket", withVat: 24000, noVat: 20000 }
    };
    const PAYMENT_METHODS = {
      taksit: { label: "Taksit", vatIncluded: true, installments: true },
      nakit: { label: "Nakit", vatIncluded: false, installments: false },
      pesin: { label: "Peşin Kredi Kartı", vatIncluded: true, installments: false }
    };

    let db = { staff: [], authors: [], expenses: [], tasks: [], stock: [], printOrders: [], packageContracts: {} };
    let currentView = "dashboard";
    let filterStatus = "all";
    let filterDate = "all";
    let authorsRenderLimit = 60;
    let currentRole = "admin";
    let currentStaffId = null;
    let currentUsername = null; // Firestore'daki users/{uid}.username (e-postadan bağımsız görünen isim)
    let currentUserName = null; // Firestore'daki users/{uid}.name (crm/staff eşleşmesi yoksa "Hoşgeldiniz" etiketi bunu kullanır)
    let isRegistering = false;

    // load() içindeki Firestore dinleyicileri, kullanıcı onaylı şekilde
    // giriş yapmadan önce başlatılırsa güvenlik kuralları "izin yok"
    // hatası verir. Token'ı bekletmemize rağmen bu, ID token'ın Firestore
    // SDK'sına tam yayılması birkaç yüz milisaniye sürebildiği için hâlâ
    // görülebiliyor — bu yüzden ilk denemede "izin yok" alırsa kısa bir
    // bekleme ile birkaç kez daha deniyoruz, gerçek bir yetki sorununu
    // (örn. onaysız kullanıcı) birkaç saniyede ayırt ediyoruz.
    let dataLoaded = false;
    async function ensureDataLoaded() {
      if (dataLoaded) return;
      dataLoaded = true;
      const maxAttempts = 4;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await load();
          return;
        } catch (e) {
          console.error(`Veri yükleme hatası (deneme ${attempt}/${maxAttempts}):`, e);
          if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 700));
          } else {
            dataLoaded = false;
            alert("Veriler yüklenemedi. Lütfen sayfayı yenileyin.");
          }
        }
      }
    }

    function setupAuthListener() {
      auth.onAuthStateChanged(async user => {
        if (isRegistering) return; // Kayıt sırasında onAuthStateChanged devreye girme
        if (user) {
          // onAuthStateChanged "user" ile tetiklenmiş olması, Firestore
          // SDK'sının bir sonraki isteğe kimlik token'ını iliştirmeye tam
          // hazır olduğu anlamına gelmeyebiliyor (özellikle admin girişinde,
          // onay kontrolü GET'i olmadığı için bu "ısınma" adımı eksik
          // kalıyordu). Token'ı burada açıkça bekleyerek bu yarışı kapatıyoruz.
          try { await user.getIdToken(); } catch (e) { console.error("Token hatası:", e); }
          const u = user.email.split("@")[0].toLowerCase();
          const clean = str => str.toLowerCase().replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/\s+/g, '');

          if (u === "admin") {
            currentRole = "admin";
          } else {
            // Onay kontrolü
            try {
              const userDoc = await firestore.collection("users").doc(user.uid).get();
              if (!userDoc.exists || userDoc.data().approved !== true) {
                auth.signOut();
                const err = document.getElementById("loginError");
                if (err) {
                  err.innerHTML = icon('clock', 14) + " Hesabınız henüz admin tarafından onaylanmadı. Lütfen bekleyin.";
                  err.style.display = "block";
                }
                return;
              }
              currentRole = userDoc.data().role || "admin";
              currentUsername = userDoc.data().username || u;
              currentUserName = userDoc.data().name || null;
              // verifyBeforeUpdateEmail ile e-posta değişikliği sadece
              // kullanıcı onay linkine tıklayınca Firebase tarafında
              // gerçekleşiyor — bir sonraki girişte burada fark edip
              // Firestore'daki (arşiv amaçlı) email alanını senkronize ediyoruz.
              if (userDoc.data().email !== user.email) {
                firestore.collection("users").doc(user.uid).update({ email: user.email }).catch(() => {});
              }
            } catch (e) {
              console.error("Onay kontrolü hatası:", e);
              currentRole = "admin";
            }
          }

          await ensureDataLoaded();
          // Önce doğrudan userId bağlantısıyla eşleştir (approveUser bunu
          // otomatik kurar, e-posta/kullanıcı adı içeriğinden bağımsız,
          // güvenilir bir eşleşme). Sadece bu bağlantı yoksa (ör. elle
          // eklenmiş eski personel kayıtları) isimden tahmine düş.
          const stf = db.staff.find(s => s.userId === user.uid) ||
            db.staff.find(s => clean(s.name) === clean(u) || clean(s.name).includes(clean(u)));
          currentStaffId = stf ? stf.id : null;
          document.getElementById("loginError").style.display = "none";
          document.getElementById("loginScreen").style.display = "none";
          document.querySelector(".app").style.display = "grid";
          document.getElementById("chatFabDock").style.display = "flex";
          startChatFabPeek();
          restoreChatHistory();
          if (typeof Notification !== "undefined" && Notification.permission === "default") {
            Notification.requestPermission().then(() => initPushNotifications());
          } else {
            initPushNotifications();
          }
          render();
        } else {
          document.getElementById("loginScreen").style.display = "grid";
          document.querySelector(".app").style.display = "none";
          document.getElementById("chatFabDock").style.display = "none";
          stopChatFabPeek();
        }
      });
    }

    function checkLogin() {
      if (auth.currentUser) {
        document.getElementById("loginScreen").style.display = "none";
        document.querySelector(".app").style.display = "grid";
        document.getElementById("chatFabDock").style.display = "flex";
        startChatFabPeek();
        restoreChatHistory();
      } else {
        document.getElementById("loginScreen").style.display = "grid";
        document.querySelector(".app").style.display = "none";
        document.getElementById("chatFabDock").style.display = "none";
        stopChatFabPeek();
      }
    }

    async function handleLogin(e) {
      e.preventDefault();
      const btn = e.target.querySelector("button[type='submit']");
      const u = document.getElementById("loginUser").value.trim().toLowerCase();
      const p = document.getElementById("loginPass").value.trim();
      const err = document.getElementById("loginError");

      btn.disabled = true;
      btn.innerText = "Giriş Yapılıyor...";

      const email = u.includes("@") ? u : u + "@crm.com";
      const remember = document.getElementById("loginRemember").checked;

      try {
        // "Beni hatırla" işaretliyse oturum tarayıcı kapansa da açık kalır
        // (LOCAL); işaretli değilse sekme/tarayıcı kapanınca oturum sona erer
        // (SESSION) — varsayılan Firebase davranışı zaten LOCAL olduğu için
        // bu adım atlanırsa eski davranış (her zaman hatırla) korunur.
        await auth.setPersistence(remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION);
        await auth.signInWithEmailAndPassword(email, p);
        btn.disabled = false;
        btn.innerText = "Giriş Yap";
        // onAuthStateChanged will trigger and render the app.
      } catch (error) {
        let errorMsg = error.message;
        if (error.code === 'auth/invalid-credential') {
          errorMsg = "Girdiğiniz e-posta veya şifre hatalı.";
        }
        err.style.color = "var(--red)";
        err.innerText = "Hata: " + errorMsg;
        err.style.display = "block";
        btn.disabled = false;
        btn.innerText = "Giriş Yap";
      }
    }

    function goToTasksView() { switchView("tasks"); }
    function toggleTaskNotifDropdown() {
      const dd = document.getElementById("taskNotifDropdown");
      if (dd) dd.classList.toggle("open");
    }
    function closeTaskNotifDropdown() {
      const dd = document.getElementById("taskNotifDropdown");
      if (dd) dd.classList.remove("open");
    }
    function renderTaskNotifDropdown() {
      const dd = document.getElementById("taskNotifDropdown");
      if (!dd) return;

      if (currentRole === "admin") {
        const unseenCompleted = (db.tasks || []).filter(t => t.status === "tamamlandı" && t.completionSeen !== true)
          .sort((a, b) => new Date(b.completedDate || b.created) - new Date(a.completedDate || a.created));
        if (!unseenCompleted.length) {
          dd.innerHTML = `<div style="padding:20px 12px;text-align:center;color:var(--muted);font-size:12px">Yeni tamamlanan görev yok.</div>`;
          return;
        }
        dd.innerHTML = unseenCompleted.map(t => {
          const assigneeName = staffName(t.assignedTo) || "—";
          return `<div class="notifItem" onclick="closeTaskNotifDropdown();goToTasksView();" style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:2px">
      <div style="font-size:13px;font-weight:600;color:var(--txt)">${icon('checkCircle', 12)} ${escapeHtml(t.title)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${escapeHtml(assigneeName)} tamamladı${t.completedDate ? ' • ' + fmtDate(t.completedDate) : ''}</div>
    </div>`;
        }).join("") + `<div style="border-top:1px solid var(--line);margin-top:4px;padding-top:6px">
      <button class="btn ghost" style="width:100%" onclick="closeTaskNotifDropdown();goToTasksView();">Tümünü Gör</button>
    </div>`;
        return;
      }

      const myPending = (db.tasks || []).filter(t => t.assignedTo === currentStaffId && t.status !== "tamamlandı")
        .sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate) - new Date(b.dueDate);
        });
      if (!myPending.length) {
        dd.innerHTML = `<div style="padding:20px 12px;text-align:center;color:var(--muted);font-size:12px">Bekleyen görevin yok.</div>`;
        return;
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      dd.innerHTML = myPending.map(t => {
        let dueText = "";
        if (t.dueDate) {
          const days = Math.round((new Date(t.dueDate) - today) / 864e5);
          const col = days < 0 ? "var(--red)" : days <= 2 ? "var(--amber)" : "var(--muted)";
          const lbl = days < 0 ? `${-days} gün gecikti` : days === 0 ? "Bugün" : `${days} gün kaldı`;
          dueText = `<div style="font-size:11px;color:${col};font-weight:600;margin-top:2px">${lbl}</div>`;
        }
        return `<div class="notifItem" onclick="closeTaskNotifDropdown();goToTasksView();" style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:2px">
      <div style="font-size:13px;font-weight:600;color:var(--txt)">${escapeHtml(t.title)}</div>
      ${dueText}
    </div>`;
      }).join("") + `<div style="border-top:1px solid var(--line);margin-top:4px;padding-top:6px">
      <button class="btn ghost" style="width:100%" onclick="closeTaskNotifDropdown();goToTasksView();">Tümünü Gör</button>
    </div>`;
    }

    function handleLogout() {
      auth.signOut().then(() => {
        document.getElementById("loginUser").value = "";
        document.getElementById("loginPass").value = "";
      });
    }

    function togglePassword(id, el) {
      const inp = document.getElementById(id);
      if (inp.type === "password") {
        inp.type = "text";
        el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
      } else {
        inp.type = "password";
        el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
      }
    }

    function switchAuthTab(tab) {
      const loginForm = document.getElementById("loginForm");
      const regForm = document.getElementById("registerForm");
      const tabL = document.getElementById("tabLogin");
      const tabR = document.getElementById("tabRegister");
      if (tab === "login") {
        loginForm.style.display = "block";
        regForm.style.display = "none";
        tabL.style.borderBottom = "2px solid var(--brand)"; tabL.style.color = "var(--brand)";
        tabR.style.borderBottom = "2px solid transparent"; tabR.style.color = "var(--muted)";
      } else {
        loginForm.style.display = "none";
        regForm.style.display = "block";
        tabR.style.borderBottom = "2px solid var(--brand)"; tabR.style.color = "var(--brand)";
        tabL.style.borderBottom = "2px solid transparent"; tabL.style.color = "var(--muted)";
      }
    }

    async function handleRegister(e) {
      e.preventDefault();
      const btn = e.target.querySelector("button[type='submit']");
      const name = document.getElementById("regName").value.trim();
      const u = document.getElementById("regUser").value.trim().toLowerCase();
      const p = document.getElementById("regPass").value;
      const p2 = document.getElementById("regPass2").value;
      const err = document.getElementById("regError");
      const suc = document.getElementById("regSuccess");
      err.style.display = "none";
      suc.style.display = "none";

      if (!name) { err.innerText = "Lütfen adınızı ve soyadınızı girin."; err.style.display = "block"; return; }
      if (!u) { err.innerText = "Lütfen bir kullanıcı adı girin."; err.style.display = "block"; return; }
      if (u === "admin") { err.innerText = "'admin' kullanıcı adı sistem hesabı için ayrılmış."; err.style.display = "block"; return; }
      if (p !== p2) { err.innerText = "Şifreler eşleşmiyor."; err.style.display = "block"; return; }
      if (p.length < 6) { err.innerText = "Şifre en az 6 karakter olmalıdır."; err.style.display = "block"; return; }

      btn.disabled = true;
      btn.innerText = "Kayıt Yapılıyor...";
      const email = u.includes("@") ? u : u + "@crm.com";
      isRegistering = true;

      try {
        const cred = await auth.createUserWithEmailAndPassword(email, p);

        // Güvenlik: rol/onay durumu artık her zaman "personel" + onaysız
        // olarak oluşturulur. Firestore kuralları da bunu zorunlu kılıyor;
        // yetki yükseltmesi sadece mevcut bir admin tarafından yapılabilir.
        await firestore.collection("users").doc(cred.user.uid).set({
          name: name,
          username: u,
          email: email,
          approved: false,
          role: "personel",
          createdAt: new Date().toISOString()
        });
        await auth.signOut();
        suc.innerHTML = icon('checkCircle', 14) + " Kayıt başarılı! Hesabınız admin onayından sonra aktif olacaktır.";
        suc.style.display = "block";
        btn.disabled = false;
        btn.innerText = "Kayıt Ol";
        isRegistering = false;
      } catch (error) {
        isRegistering = false;
        let msg = error.message;
        if (error.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten kayıtlı.";
        if (error.code === "auth/weak-password") msg = "Şifre çok zayıf, en az 6 karakter olmalı.";
        err.innerText = msg;
        err.style.display = "block";
        btn.disabled = false;
        btn.innerText = "Kayıt Ol";
      }
    }

    let storageOK = true;

    // Yazarlar artık tek dev dokümanda değil, her biri kendi dokümanında
    // (authors/{id} koleksiyonu); personel ise küçük ayrı bir dokümanda
    // (crm/staff). db.authors / db.staff'ın şekli (düz dizi) DEĞİŞMEDİ —
    // sadece nereden geldikleri değişti — bu yüzden render/view
    // fonksiyonlarının hiçbiri değişmek zorunda kalmadı.
    function onDataChanged() {
      render();
      const drawer = document.getElementById("drawer");
      if (drawer && drawer.classList.contains("open")) {
        const match = drawer.innerHTML.match(/openAuthorModal\('([^']+)'\)/);
        if (match && match[1]) openDrawer(match[1]);
      }
    }

    function loadStaff() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        firestore.collection("crm").doc("staff").onSnapshot(doc => {
          db.staff = doc.exists ? (doc.data().staff || []) : [];
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Personel veri çekme hatası:", err);
          if (firstLoad) reject(err);
        });
      });
    }

    function loadAuthors() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        firestore.collection("authors").onSnapshot(snapshot => {
          if (firstLoad) {
            db.authors = snapshot.docs.map(d => d.data());
          } else {
            snapshot.docChanges().forEach(change => {
              const data = change.doc.data();
              const idx = db.authors.findIndex(a => a.id === data.id);
              if (change.type === "removed") {
                if (idx !== -1) db.authors.splice(idx, 1);
              } else if (idx !== -1) {
                db.authors[idx] = data;
              } else {
                db.authors.unshift(data);
              }
            });
          }
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Yazar veri çekme hatası:", err);
          if (firstLoad) reject(err);
        });
      });
    }

    function loadExpenses() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        firestore.collection("expenses").onSnapshot(snapshot => {
          if (firstLoad) {
            db.expenses = snapshot.docs.map(d => d.data());
          } else {
            snapshot.docChanges().forEach(change => {
              const data = change.doc.data();
              const idx = db.expenses.findIndex(x => x.id === data.id);
              if (change.type === "removed") {
                if (idx !== -1) db.expenses.splice(idx, 1);
              } else if (idx !== -1) {
                db.expenses[idx] = data;
              } else {
                db.expenses.unshift(data);
              }
            });
          }
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Gider veri çekme hatası:", err);
          if (firstLoad) reject(err);
        });
      });
    }

    // FCM push kurulumu: bu cihazın push aboneliği (token) alınıp
    // fcm_tokens koleksiyonuna personel kimliğiyle kaydedilir. Görev
    // atandığında worker (/notify-task) bu tokenlara push gönderir —
    // CRM sekmesi hatta tarayıcı kapalıyken bile bildirim ulaşır.
    async function initPushNotifications() {
      try {
        if (!("serviceWorker" in navigator)) return;
        if (typeof firebase.messaging !== "function" || !firebase.messaging.isSupported()) return;
        const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
        const fcmToken = await firebase.messaging().getToken({ serviceWorkerRegistration: reg });
        if (!fcmToken) return;
        await firestore.collection("fcm_tokens").doc(fcmToken).set({
          token: fcmToken,
          staffId: currentStaffId || null,
          uid: auth.currentUser ? auth.currentUser.uid : null,
          role: currentRole,
          updated: todayStr()
        });
      } catch (e) {
        // Push desteklenmiyorsa/izin yoksa sessizce geç — zil ve sekme içi
        // bildirimler çalışmaya devam eder.
        console.error("Push bildirimi kurulamadı:", e);
      }
    }

    // Görev atanınca worker üzerinden atanan personelin kayıtlı tüm
    // cihazlarına FCM push göndertir (client SDK'nın FCM gönderme yetkisi
    // yok, servis hesabı worker'da). Başarısız olsa da görev kaydını
    // etkilemez — bildirim "olsa iyi olur" katmanı.
    async function sendTaskPush(task) {
      try {
        if (!auth.currentUser) return;
        const idToken = await auth.currentUser.getIdToken();
        await fetch(NOTIFY_TASK_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
          body: JSON.stringify({ staffId: task.assignedTo, taskId: task.id, title: task.title, dueDate: task.dueDate || null })
        });
      } catch (e) {
        console.error("Push gönderilemedi:", e);
      }
    }

    // Tarayıcının kendi bildirim API'si — sadece CRM sekmesi bir yerde
    // açıkken çalışır; tag sayesinde aynı görev için FCM push'la çakışırsa
    // tarayıcı ikisini tek bildirimde birleştirir.
    function notifyNewTask(task) {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try {
        new Notification("Yeni görev atandı", {
          body: task.title + (task.dueDate ? ` — Son tarih: ${fmtDate(task.dueDate)}` : ""),
          icon: "logo.jpeg",
          tag: "task_" + (task.id || "")
        });
      } catch (e) {
        console.error("Bildirim gösterilemedi:", e);
      }
    }
    function notifyTaskCompleted(task) {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const assigneeName = staffName(task.assignedTo) || "Bir personel";
      try {
        new Notification("Görev tamamlandı", {
          body: `${assigneeName}: ${task.title}`,
          icon: "logo.jpeg"
        });
      } catch (e) {
        console.error("Bildirim gösterilemedi:", e);
      }
    }

    function loadTasks() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        firestore.collection("tasks").onSnapshot(snapshot => {
          if (firstLoad) {
            db.tasks = snapshot.docs.map(d => d.data());
          } else {
            snapshot.docChanges().forEach(change => {
              const data = change.doc.data();
              const idx = db.tasks.findIndex(x => x.id === data.id);
              if (change.type === "removed") {
                if (idx !== -1) db.tasks.splice(idx, 1);
              } else if (idx !== -1) {
                const wasCompleted = db.tasks[idx].status === "tamamlandı";
                db.tasks[idx] = data;
                if (!wasCompleted && data.status === "tamamlandı" && currentRole === "admin") notifyTaskCompleted(data);
              } else {
                db.tasks.unshift(data);
                if (change.type === "added" && data.assignedTo === currentStaffId) notifyNewTask(data);
              }
            });
          }
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Görev veri çekme hatası:", err);
          if (firstLoad) reject(err);
        });
      });
    }

    function loadStock() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        firestore.collection("stock").onSnapshot(snapshot => {
          if (firstLoad) {
            db.stock = snapshot.docs.map(d => d.data());
          } else {
            snapshot.docChanges().forEach(change => {
              const data = change.doc.data();
              const idx = db.stock.findIndex(x => x.id === data.id);
              if (change.type === "removed") {
                if (idx !== -1) db.stock.splice(idx, 1);
              } else if (idx !== -1) {
                db.stock[idx] = data;
              } else {
                db.stock.unshift(data);
              }
            });
          }
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Stok veri çekme hatası:", err);
          if (firstLoad) reject(err);
        });
      });
    }

    function loadPrintOrders() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        firestore.collection("printOrders").onSnapshot(snapshot => {
          if (firstLoad) {
            db.printOrders = snapshot.docs.map(d => d.data());
          } else {
            snapshot.docChanges().forEach(change => {
              const data = change.doc.data();
              const idx = db.printOrders.findIndex(x => x.id === data.id);
              if (change.type === "removed") {
                if (idx !== -1) db.printOrders.splice(idx, 1);
              } else if (idx !== -1) {
                db.printOrders[idx] = data;
              } else {
                db.printOrders.unshift(data);
              }
            });
          }
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Matbaa sipariş veri çekme hatası:", err);
          if (firstLoad) reject(err);
        });
      });
    }

    // Paket başına (vip/pro/standart) TEK bir sözleşme dosyası — her yazar
    // için ayrı değil, paket sabit olduğu için tek sefer yüklenip tüm o
    // paketteki yazarlarca paylaşılır. Doküman ID'si doğrudan paket anahtarı.
    function loadPackageContracts() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        firestore.collection("packageContracts").onSnapshot(snapshot => {
          const next = {};
          snapshot.forEach(doc => { next[doc.id] = doc.data(); });
          db.packageContracts = next;
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Sözleşme şablonu veri çekme hatası:", err);
          if (firstLoad) reject(err);
        });
      });
    }

    async function load() {
      db.staff = db.staff || [];
      db.authors = db.authors || [];
      db.expenses = db.expenses || [];
      db.tasks = db.tasks || [];
      db.stock = db.stock || [];
      db.printOrders = db.printOrders || [];
      db.packageContracts = db.packageContracts || {};
      await Promise.all([loadStaff(), loadAuthors(), loadExpenses(), loadTasks(), loadStock(), loadPrintOrders(), loadPackageContracts()]);
    }

    // Tek bir yazarın dokümanını, sunucudaki en güncel haliyle güvenli
    // şekilde günceller (iki kişi farklı yazarları aynı anda düzenlese bile
    // artık birbirini hiç etkilemez, çünkü her yazar ayrı doküman). fn iki
    // kez çağrılır (anlık ekran güncellemesi için yerel kopyaya, asıl kayıt
    // için sunucudan taze okunan kopyaya) — bu yüzden fn içinde uid()/
    // new Date() gibi her çağrıda farklı sonuç üretebilecek değerler
    // ÜRETİLMEMELİ, çağıran fonksiyon tarafından önceden hesaplanmalı.
    async function mutateAuthor(authorId, fn) {
      const a = db.authors.find(x => x.id === authorId);
      if (a) fn(a);
      render();
      const ref = firestore.collection("authors").doc(authorId);
      try {
        await firestore.runTransaction(async tx => {
          const doc = await tx.get(ref);
          if (!doc.exists) return;
          const server = doc.data();
          fn(server);
          tx.set(ref, server);
        });
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert("Veri kaydedilemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }

    async function createAuthor(authorData) {
      db.authors.unshift(authorData);
      render();
      try {
        await firestore.collection("authors").doc(authorData.id).set(authorData);
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert("Veri kaydedilemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }

    async function deleteAuthorDoc(authorId) {
      db.authors = db.authors.filter(x => x.id !== authorId);
      render();
      try {
        await firestore.collection("authors").doc(authorId).delete();
      } catch (e) {
        console.error("Silme hatası:", e);
        alert("Veri silinemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }

    // Giderler (ön muhasebe) — her gider ayrı, düz bir doküman; yazarlardaki
    // ödemelerin aksine iç içe bir dizi olmadığı için transaction'a gerek yok.
    async function createExpense(expenseData) {
      db.expenses.unshift(expenseData);
      render();
      try {
        await firestore.collection("expenses").doc(expenseData.id).set(expenseData);
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert("Gider kaydedilemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }
    async function updateExpense(expenseId, updates) {
      const x = db.expenses.find(e => e.id === expenseId);
      if (x) Object.assign(x, updates);
      render();
      try {
        await firestore.collection("expenses").doc(expenseId).update(updates);
      } catch (e) {
        console.error("Güncelleme hatası:", e);
        alert("Gider güncellenemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }
    async function deleteExpenseDoc(expenseId) {
      db.expenses = db.expenses.filter(x => x.id !== expenseId);
      render();
      try {
        await firestore.collection("expenses").doc(expenseId).delete();
      } catch (e) {
        console.error("Silme hatası:", e);
        alert("Gider silinemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }

    async function createStockItem(item) {
      db.stock.unshift(item);
      render();
      try {
        await firestore.collection("stock").doc(item.id).set(item);
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert("Stok kaydedilemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }
    async function updateStockItem(id, updates) {
      const x = db.stock.find(s => s.id === id);
      if (x) Object.assign(x, updates);
      render();
      try {
        await firestore.collection("stock").doc(id).update(updates);
      } catch (e) {
        console.error("Güncelleme hatası:", e);
        alert("Stok güncellenemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }
    async function deleteStockItem(id) {
      db.stock = db.stock.filter(x => x.id !== id);
      render();
      try {
        await firestore.collection("stock").doc(id).delete();
      } catch (e) {
        console.error("Silme hatası:", e);
        alert("Stok silinemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }

    async function createPrintOrder(order) {
      db.printOrders.unshift(order);
      render();
      try {
        await firestore.collection("printOrders").doc(order.id).set(order);
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert("Baskı siparişi kaydedilemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }
    async function updatePrintOrder(id, updates) {
      const x = db.printOrders.find(o => o.id === id);
      if (x) Object.assign(x, updates);
      render();
      try {
        await firestore.collection("printOrders").doc(id).update(updates);
      } catch (e) {
        console.error("Güncelleme hatası:", e);
        alert("Baskı siparişi güncellenemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }
    async function deletePrintOrder(id) {
      db.printOrders = db.printOrders.filter(x => x.id !== id);
      render();
      try {
        await firestore.collection("printOrders").doc(id).delete();
      } catch (e) {
        console.error("Silme hatası:", e);
        alert("Baskı siparişi silinemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }


    // Personel listesi küçük ve az değiştiği için kendi ayrı dokümanında
    // (crm/staff) tek parça tutuluyor. fn, {staff:[...]} şeklinde bir
    // sarmalayıcı alır ve önceki mutate() ile aynı şekilde d.staff = ...
    // atamasıyla kullanılabilir.
    async function mutateStaff(fn) {
      const wrapper = { staff: db.staff || [] };
      fn(wrapper);
      db.staff = wrapper.staff;
      render();
      const ref = firestore.collection("crm").doc("staff");
      try {
        await firestore.runTransaction(async tx => {
          const doc = await tx.get(ref);
          const server = { staff: doc.exists ? (doc.data().staff || []) : [] };
          fn(server);
          tx.set(ref, { staff: server.staff });
        });
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert("Veri kaydedilemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }

    function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function staffName(id) { const s = (db.staff || []).find(x => x.id === id); return s ? s.name : ''; }

    /* ---------- Yardımcılar ---------- */
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    /* ---------- SVG ikon seti (Lucide tarzı, tek renkli çizgi ikonlar) ---------- */
    const ICON_PATHS = {
      search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
      alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
      edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
      trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      chevronDown: '<path d="m6 9 6 6 6-6"/>',
      checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
      download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
      receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/>',
      bookOpen: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
      save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
      wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
      play: '<polygon points="6 3 20 12 6 21 6 3"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      trendingUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
      trendingDown: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
      package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.29 7 12 12l8.71-5"/><line x1="12" y1="22" x2="12" y2="12"/>',
      creditCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
      smartphone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
      loader: '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
      clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      clipboardList: '<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
    };
    function icon(name, size, extraStyle) {
      size = size || 15;
      const body = ICON_PATHS[name] || '';
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:-3px;${extraStyle || ''}">${body}</svg>`;
    }
    function loaderIcon(size) {
      size = size || 15;
      return `<svg class="spin-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:-3px">${ICON_PATHS.loader}</svg>`;
    }
    // Liste yüklenirken "Yükleniyor..." metni yerine, nihai kart şeklini
    // andıran soluk/nabız gibi atan bloklar (bkz. styles.css .skeleton*).
    // Native app'lerdeki tanıdık yükleme deseni — kullanıcı ne kadar
    // içerik geleceğini önceden görür, boş bir ekranla karşılaşmaz.
    function skeletonRows(count) {
      count = count || 3;
      let html = "";
      for (let i = 0; i < count; i++) {
        html += `<div class="skeleton-row">
      <div class="skeleton skeleton-avatar"></div>
      <div style="flex:1">
        <div class="skeleton skeleton-line" style="width:40%"></div>
        <div class="skeleton skeleton-line" style="width:65%;margin-top:8px"></div>
      </div>
    </div>`;
      }
      return html;
    }
    function flameIcon(size) {
      size = size || 14;
      return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="currentColor" style="flex-shrink:0;vertical-align:-2px;color:var(--red)"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>`;
    }
    function initials(n) { return n.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(); }
    function avatarColor(n) {
      const colors = ["#7c6cff", "#4aa8ff", "#37c98a", "#f4b740", "#f2617a", "#a99bff", "#22c1c3"];
      let s = 0; for (const c of n) s += c.charCodeAt(0);
      return colors[s % colors.length];
    }
    function fmtDate(s) { if (!s) return "—"; const d = new Date(s); return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" }); }
    function getContractDate(a) {
      if (!a) return null;
      if (a.contractDate) return a.contractDate;
      if (a.statusHistory && a.statusHistory.length) {
        const sh = a.statusHistory.find(h => h.status === 'sozlesme' || h.status === 'yayinda');
        if (sh && sh.date) return sh.date;
      }
      return (a.status === 'sozlesme' || a.status === 'yayinda') ? a.created : null;
    }
    function daysUntil(s) { if (!s) return null; return Math.round((new Date(s) - new Date().setHours(0, 0, 0, 0)) / 864e5); }
    // "Bugün"ün tarihini YEREL saate göre "YYYY-MM-DD" olarak döndürür.
    // new Date().toISOString().slice(0,10) KULLANMA — UTC'ye çevirdiği için
    // Türkiye saatiyle 00:00-03:00 arası yanlışlıkla "dün"ü döndürür.
    function todayStr() {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    function avgConversionDays(authors) {
      const diffs = [];
      authors.forEach(a => {
        if (!a.created || !a.statusHistory) return;
        const firstContract = a.statusHistory.find(h => h.status === "sozlesme");
        if (!firstContract) return;
        const d = Math.round((new Date(firstContract.date) - new Date(a.created)) / 864e5);
        if (d >= 0) diffs.push(d);
      });
      if (!diffs.length) return null;
      return Math.round(diffs.reduce((s, d) => s + d, 0) / diffs.length);
    }
    function normalizePhone(phone) {
      const digits = (phone || "").replace(/\D/g, "");
      return digits.length >= 10 ? digits.slice(-10) : digits;
    }
    function toWaLink(phone, text) {
      if (!phone) return "";
      let p = phone.replace(/\D/g, "");
      if (p.startsWith("0")) p = "90" + p.substring(1);
      else if (p.length === 10 && p.startsWith("5")) p = "90" + p;
      let url = "https://api.whatsapp.com/send?phone=" + p;
      if (text) url += "&text=" + encodeURIComponent(text);
      return url;
    }
    function waBtn(phone, text) {
      if (!phone) return "";
      return `<a href="${toWaLink(phone, text)}" target="_blank" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;justify-content:center;background:transparent;color:#25D366;border-radius:50%;width:26px;height:26px;text-decoration:none;transition:transform 0.2s;flex-shrink:0;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'" title="WhatsApp ile Mesaj Gönder">
        <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232"/></svg>
      </a>`;
    }

    /* ---------- WhatsApp hazır mesaj şablonları ---------- */
    function paymentReminderText(authorName, amount, days) {
      const when = days < 0 ? `${-days} gün önce vadesi geçen` : days === 0 ? "bugün vadesi gelen" : `${days} gün sonra vadesi gelecek`;
      return `Merhaba ${authorName}, ${amount.toLocaleString('tr-TR')} ₺ tutarındaki ${when} ödemenizi hatırlatmak isteriz. Bilgilerinize sunarız, teşekkür ederiz.`;
    }
    function followupReminderText(authorName) {
      return `Merhaba ${authorName}, sizinle görüşmemizin üzerinden bir süre geçti. Müsait olduğunuzda bizimle iletişime geçebilir misiniz? Teşekkür ederiz.`;
    }
    function contractConfirmText(authorName, packageLabel) {
      return `Merhaba ${authorName}, sözleşme sürecinizi tamamladık${packageLabel ? " ve " + packageLabel + "ni onayladık" : ""}. Bizimle çalışmayı tercih ettiğiniz için teşekkür ederiz, en kısa sürede sizinle iletişime geçeceğiz.`;
    }
    function receiptWaText(authorName, payment, vat) {
      const net = payment.amount - vat;
      const serviceLine = payment.serviceName ? `\nHizmet: ${payment.serviceName}` : '';
      return `Merhaba ${authorName}, ödeme makbuzunuz:\nTarih: ${fmtDate(payment.date)}${serviceLine}\nNet Tutar: ${net.toLocaleString('tr-TR')} ₺\nKDV: ${vat.toLocaleString('tr-TR')} ₺\nToplam: ${payment.amount.toLocaleString('tr-TR')} ₺\nDurum: ${payment.status}\nTeşekkür ederiz.`;
    }

    /* ---------- Profil dropdown kapat ---------- */
    document.addEventListener("click", e => {
      const dd = document.getElementById("profileDropdown");
      const pa = document.getElementById("topProfileArea");
      if (dd && pa && !pa.contains(e.target)) dd.classList.remove("open");
      const tdd = document.getElementById("taskNotifDropdown");
      const tb = document.getElementById("taskNotifBell");
      if (tdd && tb && !tb.contains(e.target)) tdd.classList.remove("open");
    });

    /* ---------- Navigasyon ---------- */
    // Hem soldaki (masaüstü/hamburger) menüyü hem mobil alt sekme çubuğunu
    // aynı anda senkron tutan tek görünüm değiştirme fonksiyonu.
    function switchView(view) {
      if (currentView === view) return;
      doSwitch(view);
    }
    
    function doSwitch(view) {
      currentView = view;
      filterStatus = "all";
      const searchEl = document.getElementById("search");
      if (searchEl) searchEl.value = ""; 
      document.querySelectorAll(".nav button, .bottom-nav-btn[data-view]").forEach(x => {
        x.classList.toggle("active", x.dataset.view === view);
      });
      render();
      const side = document.querySelector('.side');
      if (side) side.classList.remove('open');
      const mainEl = document.querySelector('.main');
      if (mainEl) mainEl.scrollTop = 0;
    }
    document.querySelectorAll(".nav button").forEach(b => {
      b.onclick = () => switchView(b.dataset.view);
    });
    document.querySelectorAll(".bottom-nav-btn[data-view]").forEach(b => {
      b.onclick = () => switchView(b.dataset.view);
    });
    // Mobildeki "Daha Fazla" sheet'i — masaüstündeki soldan kayan sidebar'ın
    // yerini alan alttan açılan menü (bkz. index.html #moreSheet).
    function toggleMoreSheet() { document.getElementById("moreSheet").classList.toggle("open"); }
    function closeMoreSheet() { document.getElementById("moreSheet").classList.remove("open"); }

    // Mobil bottom-sheet'lerin (tüm .modal .box'lar — form modalleri +
    // #moreSheet, ileride JS ile oluşturulan sheet'ler dahil) tepesindeki
    // sürükleme çubuğunu gerçekten fonksiyonel yapar: çubuk/başlık
    // bölgesinden başlayan bir aşağı sürükleme parmağı takip eder, eşiği
    // geçerse sheet kapanır, geçmezse geri zıplar. customConfirmModal
    // hariç — o bir Promise'e (window.customConfirmResolve) bağlı, sürükleyip
    // sadece gizlemek promise'i hiç resolve etmeden await eden kodu
    // sonsuza dek bekletir.
    (function initSheetDragToDismiss() {
      const HANDLE_ZONE = 56; // px — çubuk + başlık alanı
      const DISMISS_PX = 120;
      const DISMISS_RATIO = 0.3;
      let drag = null; // { box, modal, startY, dy, pointerId }

      document.addEventListener("pointerdown", e => {
        if (drag) return;
        if (!window.matchMedia("(max-width: 768px)").matches) return;
        const box = e.target.closest(".modal.open .box");
        if (!box) return;
        const modal = box.closest(".modal");
        if (!modal || modal.id === "customConfirmModal") return;
        const top = box.getBoundingClientRect().top;
        if (e.clientY - top > HANDLE_ZONE) return; // içerik alanı — normal scroll'a karışma
        drag = { box, modal, startY: e.clientY, dy: 0, pointerId: e.pointerId };
        box.classList.add("dragging");
        if (box.setPointerCapture) { try { box.setPointerCapture(e.pointerId); } catch (err) { } }
      });

      document.addEventListener("pointermove", e => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.dy = Math.max(0, e.clientY - drag.startY);
        drag.box.style.transform = `translateY(${drag.dy}px)`;
        e.preventDefault();
      }, { passive: false });

      function endDrag(e) {
        if (!drag || (e && e.pointerId !== drag.pointerId)) return;
        const { box, modal, dy } = drag;
        box.classList.remove("dragging");
        const boxHeight = box.getBoundingClientRect().height;
        if (dy > DISMISS_PX || dy > boxHeight * DISMISS_RATIO) {
          box.style.transform = "translateY(100%)";
          setTimeout(() => { modal.classList.remove("open"); box.style.transform = ""; }, 250);
        } else {
          box.style.transform = "";
        }
        drag = null;
      }
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);
    })();

    // Yazar kartlarında sola kaydırınca "Sil" ortaya çıkan tek eylemli
    // satır (bkz. authorCard() .swipe-item/.swipe-actions/.swipe-content).
    // delAuthor() zaten kendi onayını (customConfirm) istiyor — kaydırma
    // bu korumayı atlamıyor, sadece butona erişimi hızlandırıyor.
    (function initSwipeToDelete() {
      const OPEN_PX = 84;
      const LOCK_THRESHOLD = 10; // px — yatay/dikey niyeti ayırt etmek için
      const OPEN_RATIO = 0.4;
      let drag = null; // { item, content, startX, startY, locked, wasOpen, pointerId }
      // pointerdown, TIKLAMADAN ÖNCE başka açık satırları zaten kapatıyor —
      // bu yüzden aşağıdaki click-yutma mantığı ".swiped" durumunu değil,
      // "bu pointerdown gerçekten bir şey kapattı mı" bilgisini kullanıyor
      // (aksi halde click anına kadar .swiped zaten kalkmış oluyor ve
      // dokunulan karta tıklanmış gibi davranılıyordu).
      let suppressNextClick = false;

      document.addEventListener("pointerdown", e => {
        if (drag) return;
        if (!window.matchMedia("(max-width: 768px)").matches) return;
        const content = e.target.closest(".swipe-content");
        if (!content) return;
        const item = content.closest(".swipe-item");
        if (!item) return;
        suppressNextClick = false;
        document.querySelectorAll(".swipe-item.swiped").forEach(x => {
          if (x !== item) { x.classList.remove("swiped"); suppressNextClick = true; }
        });
        drag = { item, content, startX: e.clientX, startY: e.clientY, locked: null, wasOpen: item.classList.contains("swiped"), pointerId: e.pointerId };
      });

      document.addEventListener("pointermove", e => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (drag.locked === null) {
          if (Math.abs(dx) < LOCK_THRESHOLD && Math.abs(dy) < LOCK_THRESHOLD) return;
          drag.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          if (drag.locked === "x") {
            drag.item.classList.add("dragging");
            if (drag.content.setPointerCapture) { try { drag.content.setPointerCapture(e.pointerId); } catch (err) { } }
          }
        }
        if (drag.locked !== "x") return; // dikey niyet — sayfa scroll'una karışma
        e.preventDefault();
        const base = drag.wasOpen ? -OPEN_PX : 0;
        drag.dx = Math.min(0, Math.max(-OPEN_PX - 20, base + dx));
        drag.content.style.transform = `translateX(${drag.dx}px)`;
      }, { passive: false });

      function endDrag(e) {
        if (!drag || (e && e.pointerId !== drag.pointerId)) return;
        const { item, content, locked, dx } = drag;
        if (locked === "x") {
          item.classList.remove("dragging");
          item.classList.toggle("swiped", (dx || 0) < -OPEN_PX * OPEN_RATIO);
          content.style.transform = "";
        }
        drag = null;
      }
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);

      // Açık bir satırken başka bir yere dokununca sadece kapatır,
      // dokunulan elemanın kendi tıklama eylemini (ör. openDrawer)
      // TETİKLEMEZ — capture aşamasında olayı orada durduruyoruz. İki
      // durum var: (1) pointerdown başka bir swipe-content'e denk geldi ve
      // orada zaten kapattı (suppressNextClick), (2) boş bir alana/başka
      // bir swipe-content olmayan yere dokunuldu (aşağıdaki .swiped kontrolü).
      document.addEventListener("click", e => {
        if (suppressNextClick) {
          suppressNextClick = false;
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        const openItem = document.querySelector(".swipe-item.swiped");
        if (!openItem) return;
        if (openItem.contains(e.target)) return;
        openItem.classList.remove("swiped");
        e.stopPropagation();
        e.preventDefault();
      }, true);
    })();

    // Alt sekme çubuğunda olan view'ler — tek doğruluk kaynağı. Bottom-nav
    // HTML'i (index.html) zaten bu view'lere sahip; burada sadece sidebar'daki
    // KARŞILIĞINI mobilde gizlemek için bir attribute basıyoruz, CSS tek bir
    // seçiciyle bunu okuyor (bkz. styles.css .nav button[data-mobile-primary]).
    const MOBILE_PRIMARY_VIEWS = ["dashboard", "authors", "tasks", "followups", "contracts"];
    document.querySelectorAll(".nav button").forEach(b => {
      if (MOBILE_PRIMARY_VIEWS.includes(b.dataset.view)) b.setAttribute("data-mobile-primary", "true");
    });
    const TITLES = {
      dashboard: "Panel",
      authors: "Yazarlar",
      contracts: "Sözleşmeli Yazarlar",
      followups: "Takip Listesi",
      team: "Ekip",
      accounting: "Ödemeler",
      muhasebe: "Muhasebe",
      tasks: "Görevler",
      stock: "Dahiliye Stok",
      matbaa: "Matbaa",
      settings: "Ayarlar"
    };

    function resolveCurrentUserName() {
      const stf = db.staff.find(s => s.id === currentStaffId);
      if (stf) return stf.name;
      if (currentRole === "admin") return "Sistem Yöneticisi";
      if (currentUserName) return currentUserName;
      if (auth.currentUser) {
        let n = auth.currentUser.email.split("@")[0];
        return n.charAt(0).toUpperCase() + n.slice(1);
      }
      return "Personel";
    }

    /* ---------- Render ---------- */
    function render() {
      const w = document.getElementById("storageWarn");
      if (w) w.style.display = storageOK ? "none" : "block";

      document.getElementById("viewTitle").textContent = TITLES[currentView];

      const tp = document.getElementById("topProfileArea");
      if (tp) {
        const nameToSet = resolveCurrentUserName();
        document.querySelectorAll(".userNameLabel").forEach(el => el.textContent = nameToSet);
        const moreAvatar = document.getElementById("moreSheetAvatar");
        if (moreAvatar) {
          moreAvatar.textContent = initials(nameToSet);
          moreAvatar.style.background = avatarColor(nameToSet);
        }
      }

      const badge = document.getElementById("taskNotifBadge");
      if (badge) {
        // Admin için: kim atamış olursa olsun, henüz "görülmedi" işaretli
        // tüm tamamlanan görev sayısı. Diğer roller için: kendine atanmış
        // bekleyen görev sayısı. ("Kim atadı" eşleştirmesi, hesap
        // adı/rol değişiklikleri yüzünden güvenilmez olduğundan kaldırıldı.)
        const badgeCount = currentRole === "admin"
          ? (db.tasks || []).filter(t => t.status === "tamamlandı" && t.completionSeen !== true).length
          : (db.tasks || []).filter(t => t.assignedTo === currentStaffId && t.status !== "tamamlandı").length;
        if (badgeCount > 0) {
          badge.textContent = badgeCount > 9 ? "9+" : String(badgeCount);
          badge.style.display = "flex";
        } else {
          badge.style.display = "none";
        }
      }
      renderTaskNotifDropdown();

      const isPersonel = currentRole === "personel";
      // Muhasebe (gelir/gider) sadece admin/muhasebe içindir. Ödemeler ise
      // personele de açık — ama tutarları göremez (bkz. viewAccounting()
      // içindeki canSeeAmounts), sadece ödeme durumunu görür.
      const canSeeMuhasebe = currentRole === "admin" || currentRole === "muhasebe" || currentRole === "personel";
      const navTeam = document.querySelector('[data-view="team"]');
      if (navTeam) navTeam.style.display = isPersonel ? "none" : "block";
      const navMuhasebe = document.querySelector('[data-view="muhasebe"]');
      if (navMuhasebe) navMuhasebe.style.display = canSeeMuhasebe ? "flex" : "none";
      const navPay = document.querySelector('[data-view="accounting"]');
      if (navPay) navPay.style.display = "flex";
      // Mobildeki "Hesabım" sheet'i, sidebar'daki aynı rol bazlı görünürlüğü
      // kendi menü satırlarında (.more-sheet-row) tekrarlar.
      const moreTeam = document.querySelector('.more-sheet-row[data-view="team"]');
      if (moreTeam) moreTeam.style.display = isPersonel ? "none" : "flex";
      const moreMuhasebe = document.querySelector('.more-sheet-row[data-view="muhasebe"]');
      if (moreMuhasebe) moreMuhasebe.style.display = canSeeMuhasebe ? "flex" : "none";
      const morePay = document.querySelector('.more-sheet-row[data-view="accounting"]');
      if (morePay) morePay.style.display = "flex";

      if (isPersonel && currentView === "team") {
        currentView = "dashboard";
        document.querySelectorAll(".nav button, .bottom-nav-btn[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === "dashboard"));
        return render(); // Re-render with new view
      }
      if (!canSeeMuhasebe && currentView === "muhasebe") {
        currentView = "dashboard";
        document.querySelectorAll(".nav button, .bottom-nav-btn[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === "dashboard"));
        return render();
      }

      // Arama çubuğu ve buton gösterimi
      const searchInput = document.getElementById("search");
      const searchWrap = document.getElementById("searchWrap");
      if (currentView === "dashboard" || currentView === "settings" || currentView === "muhasebe" || currentView === "tasks" || currentView === "stock" || currentView === "matbaa") {
        searchWrap.style.display = "none";
      } else {
        searchWrap.style.display = "block";
        searchInput.placeholder = currentView === "team" ? "Ekip üyesi ara..." : currentView === "accounting" ? "Yazar veya eser ara..." : "Yazar, telefon, tür, not ara...";
      }
      document.getElementById("btnNewAuthor").style.display = currentView === "authors" ? "inline-block" : "none";
      const fab = document.getElementById("fabNewAuthor");
      if (fab) fab.classList.toggle("show", currentView === "authors");

      const c = document.getElementById("content");
      // Sekme değişince #content'in içeriği yerinde değişiyor (element
      // yeniden oluşmuyor), o yüzden CSS animasyonu kendiliğinden tetiklenmez
      // — class'ı çıkarıp reflow'u zorlayarak (void offsetWidth) her render'da
      // yeniden tetikliyoruz. Animasyonun kendisi mobilde tanımlı, masaüstünü
      // etkilemiyor (bkz. styles.css @media max-width:768px .view-enter).
      c.classList.remove("view-enter");
      void c.offsetWidth;
      if (currentView === "dashboard") {
        c.innerHTML = viewDashboard();
        setTimeout(initCharts, 0); // DOM update sonrası çalışması için
      }
      else if (currentView === "authors") c.innerHTML = viewAuthors();
      else if (currentView === "contracts") c.innerHTML = viewContracts();
      else if (currentView === "accounting") { c.innerHTML = viewAccounting(); renderAccountingList(); setTimeout(initAccountingChart, 0); setTimeout(initCashFlowChart, 0); }
      else if (currentView === "muhasebe") c.innerHTML = viewMuhasebe();
      else if (currentView === "tasks") { c.innerHTML = viewTasks(); if (currentRole === "admin") markMyCompletedTasksSeen(); }
      else if (currentView === "stock") c.innerHTML = viewStock();
      else if (currentView === "matbaa") c.innerHTML = viewMatbaa();
      else if (currentView === "followups") c.innerHTML = viewFollowups();
      else if (currentView === "team") { c.innerHTML = viewTeam(); if (currentRole === "admin") setTimeout(loadPendingUsers, 0); }
      else if (currentView === "settings") { c.innerHTML = viewSettings(); if (currentRole === "admin") setTimeout(loadUserManagement, 0); }
      c.classList.add("view-enter");
    }

    function searchTerm() { return document.getElementById("search").value.toLowerCase().trim(); }
    function filteredAuthors() {
      const t = searchTerm();
      return db.authors.filter(a => {
        const hay = (a.name + " " + (a.genres || []).join(" ") + " " + (a.work || "") + " " + (a.notes || "") + " " + (a.phone || "")).toLowerCase();
        let statusMatch = (filterStatus === "all" || a.status === filterStatus);
        if (currentView === "authors" && (a.status === "sozlesme" || a.status === "yayinda")) {
          statusMatch = false;
        }
        return (!t || hay.includes(t)) && statusMatch;
      });
    }

    function viewDashboard() {
      const a = db.authors;
      const overdue = a.filter(x => x.status !== "sozlesme" && x.status !== "yayinda" && x.status !== "arsiv" && daysUntil(x.followup) !== null && daysUntil(x.followup) < 0).length;

      // Ortak bölümler: Takip uyarıları ve Son etkileşimler
      const followSet = new Set();
      const followList = [];
      a.forEach(x => {
        if (x.status === "sozlesme" || x.status === "yayinda" || x.status === "arsiv") return;
        const dFollow = daysUntil(x.followup);
        const dInterview = (x.interviewDate && x.interviewTime) ? daysUntil(x.interviewDate) : null;
        const hasUpcomingInterview = dInterview !== null && dInterview >= 0 && dInterview <= 3;
        const hasFollowup = dFollow !== null && dFollow <= 3;
        if (hasFollowup || hasUpcomingInterview) {
          if (!followSet.has(x.id)) {
            followSet.add(x.id);
            const sortKey = (dFollow !== null) ? dFollow : dInterview;
            followList.push({ ...x, _sortKey: sortKey });
          }
        }
      });
      followList.sort((x, y) => x._sortKey - y._sortKey);

      let follow = `<div class="card" style="display:flex; flex-direction:column; max-height:450px;"><h4 style="margin:0 0 14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px; flex-shrink:0;">${icon('bell', 14)} Bugün ilgilenmen gerekenler ${overdue ? `<span class="badge" style="background:rgba(242,97,122,.2);color:#f2617a">${overdue} gecikmiş</span>` : ""}</h4><div style="overflow-y:auto; padding-right:4px;">`;
      if (!followList.length) follow += `<div class="empty">${icon('checkCircle', 15)} Yaklaşan takip yok.</div>`;
      else follow += followList.map(x => {
        const dFollow = daysUntil(x.followup);
        const dInterview = (x.interviewDate && x.interviewTime) ? daysUntil(x.interviewDate) : null;
        const d = (dFollow !== null) ? dFollow : (dInterview !== null ? dInterview : 0);
        const timeStr = x.interviewTime ? ` • 🕒 ${x.interviewTime}` : "";
        const lbl = (d < 0 ? `${-d} gün gecikti` : d === 0 ? "Bugün" : `${d} gün sonra`) + timeStr;
        const col = d < 0 ? "var(--red)" : d === 0 ? "var(--amber)" : "var(--muted)";
        return `<div class="mini" onclick="openDrawer('${x.id}')" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div><span class="mn">${escapeHtml(x.name)}</span><div class="ms">${escapeHtml(x.work) || "—"} • ${STATUS[x.status].label}</div></div>
      <div style="display:flex;align-items:center;gap:8px">${waBtn(x.phone, followupReminderText(x.name))}<span style="color:${col};font-weight:600;font-size:12px">${lbl}</span></div></div>`;
      }).join("");
      follow += `</div></div>`;

      const acts = [];
      a.forEach(x => (x.logs || []).forEach(l => acts.push({ ...l, name: x.name, id: x.id })));
      acts.sort((p, q) => new Date(q.date) - new Date(p.date));
      let recent = `<div class="card" style="display:flex; flex-direction:column; max-height:450px;"><h4 style="margin:0 0 14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px; flex-shrink:0;">${icon('clock', 14)} Son etkileşimler</h4><div class="timeline" style="overflow-y:auto; padding-right:4px;">`;
      recent += acts.slice(0, 50).map(l => `<div class="tl"><div class="tt">${fmtDate(l.date)} • ${escapeHtml(l.name)}</div><div class="tx"><span class="type">${escapeHtml(l.type)}</span>${escapeHtml(l.text)}</div></div>`).join("") || `<div class="empty">Kayıt yok</div>`;
      recent += `</div></div>`;

      // PERSONEL GÖRÜNÜMÜ
      const total = a.length;
      const adaylar = a.filter(x => ["aday", "gorusuluyor"].includes(x.status)).length;
      const aktif = a.filter(x => ["degerlendirme", "sozlesme"].includes(x.status)).length;
      const yayinda = a.filter(x => x.status === "yayinda").length;
      const avgDays = avgConversionDays(a);

      let stats = `<div class="grid stats" style="margin-bottom:16px">
    <div class="card stat"><div class="n">${total}</div><div class="l">Toplam kayıt</div></div>
    <div class="card stat"><div class="n">${adaylar}</div><div class="l">Aday & görüşülüyor</div><span class="chip" style="background:rgba(74,168,255,.15);color:#4aa8ff">Pipeline'da</span></div>
    <div class="card stat"><div class="n">${aktif}</div><div class="l">Aktif süreç</div><span class="chip" style="background:rgba(37,99,235,.15);color:#3b82f6">Değerlendirme/Sözleşme</span></div>
    <div class="card stat"><div class="n">${yayinda}</div><div class="l">Yayında</div><span class="chip" style="background:rgba(55,201,138,.15);color:#37c98a">Aktif yazar</span></div>
    <div class="card stat"><div class="n">${avgDays !== null ? avgDays + ' gün' : '—'}</div><div class="l">Ort. sözleşmeye dönüşüm süresi</div></div>
  </div>`;

      return stats + `<div class="grid grid-2col" style="gap:16px">${follow}${recent}</div>`;
    }

    function viewSettings() {
      const cu = auth.currentUser;
      const email = cu ? cu.email : "";
      const isBootstrapAdmin = email === "admin@crm.com";
      const uname = currentUsername || email.split("@")[0];
      const stf = db.staff.find(s => s.id === currentStaffId);
      const currentName = stf ? stf.name : (isBootstrapAdmin ? "Sistem Yöneticisi" : uname);

      let html = `<div class="card settings-card" style="margin-bottom:16px;max-width:520px">
    <h3 style="margin:0 0 8px;font-size:14px">${icon('save', 15)} Veri Yedeği</h3>
    <div style="color:var(--muted);font-size:12px;margin-bottom:12px">Veri kaybına karşı güncel bir kopyayı bilgisayarına indirebilirsin.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn ghost" onclick="exportFullBackupExcel()">${icon('download', 14)} Excel (CSV)</button>
      <button class="btn ghost" onclick="exportData()">${icon('download', 14)} JSON</button>
    </div>
  </div>`;

      html += `<div class="card settings-card" style="margin-bottom:16px;max-width:520px">
    <h3 style="margin:0 0 8px;font-size:14px">${icon('user', 15)} Hesabım</h3>
    <div style="color:var(--muted);font-size:12px;margin-bottom:12px">Ad soyad, kullanıcı adı ve şifreni buradan güncelleyebilirsin.</div>

    <label>Ad Soyad</label>
    <div style="display:flex;gap:8px">
      <input id="acc_name" value="${escapeHtml(currentName)}" style="flex:1;min-width:0">
      <button class="btn ghost" onclick="saveMyName()">Kaydet</button>
    </div>
    <div id="acc_nameMsg" style="font-size:11px;margin-top:4px"></div>

    ${isBootstrapAdmin ? '' : `
    <label>Kullanıcı Adı</label>
    <div style="display:flex;gap:8px">
      <input id="acc_username" value="${escapeHtml(uname)}" style="flex:1;min-width:0">
      <button class="btn ghost" onclick="saveMyUsername()">Kaydet</button>
    </div>
    <div id="acc_usernameMsg" style="font-size:11px;margin-top:4px"></div>
    `}

    <label>${icon('lock', 13)} Şifre Değiştir</label>
    <input type="password" id="acc_curPass" placeholder="Mevcut şifre" autocomplete="current-password">
    <input type="password" id="acc_newPass" placeholder="Yeni şifre (en az 6 karakter)" autocomplete="new-password" style="margin-top:8px">
    <input type="password" id="acc_newPass2" placeholder="Yeni şifre (tekrar)" autocomplete="new-password" style="margin-top:8px">
    <button class="btn ghost" style="margin-top:10px" onclick="saveMyPassword()">Şifreyi Güncelle</button>
    <div id="acc_passMsg" style="font-size:11px;margin-top:4px"></div>
  </div>`;

      if (currentRole === "admin") {
        html += `<div class="card settings-card" style="margin-bottom:16px;max-width:520px">
    <h3 style="margin:0 0 8px;font-size:14px">${icon('bookOpen', 15)} Sözleşme Şablonları</h3>
    <div style="color:var(--muted);font-size:12px;margin-bottom:12px">Her paket için kendi sözleşme dosyanı (PDF/görsel) bir kez yükle — o paketteki her yazarın detayında indirilebilir olur.</div>
    ${Object.keys(PACKAGES).map(key => {
          const pkg = PACKAGES[key];
          const contract = db.packageContracts[key];
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px dashed var(--line)">
      <div style="min-width:0">
        <div style="font-weight:600;font-size:13px">${escapeHtml(pkg.label)}</div>
        <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${contract ? escapeHtml(contract.name) : 'Henüz dosya yüklenmedi'}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
        ${contract ? `<button class="btn ghost" style="padding:4px 8px" onclick="downloadPackageContract('${key}')" title="İndir">${icon('download', 13)}</button>
        <button class="btn ghost" style="padding:4px 8px;color:var(--red)" onclick="deletePackageContract('${key}')" title="Sil">${icon('trash', 13)}</button>` : ''}
        <label class="btn ghost" style="padding:4px 8px;cursor:pointer;margin:0" title="${contract ? 'Değiştir' : 'Yükle'}">
          ${icon('edit', 13)}
          <input type="file" style="display:none" onchange="uploadPackageContract('${key}', this)" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx">
        </label>
      </div>
    </div>`;
        }).join('')}
    <div id="pkgContractMsg" style="font-size:11px;margin-top:8px"></div>
  </div>`;

        html += `<div class="card settings-card" style="margin-bottom:16px;max-width:760px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;flex-wrap:wrap">
      <h3 style="margin:0;font-size:14px">${icon('users', 15)} Kullanıcı Yönetimi</h3>
      <button class="btn ghost" onclick="openCreateUserModal()">+ Yeni Kullanıcı Ekle</button>
    </div>
    <div style="color:var(--muted);font-size:12px;margin-bottom:12px">Onaylı kullanıcıların adını, kullanıcı adını ve şifresini buradan değiştirebilirsin.</div>
    <div id="userMgmtArea">${skeletonRows(3)}</div>
  </div>`;
      }

      return html;
    }

    /* ---------- Hesabım (kendi ad/kullanıcı adı/şifre) ---------- */
    async function saveMyName() {
      const name = document.getElementById("acc_name").value.trim();
      if (!name) { alert("Ad soyad boş olamaz."); return; }
      const uidCur = auth.currentUser.uid;
      const isBootstrapAdmin = auth.currentUser.email === "admin@crm.com";
      try {
        const userDoc = await firestore.collection("users").doc(uidCur).get();
        if (userDoc.exists) {
          await firestore.collection("users").doc(uidCur).update({ name });
        } else if (isBootstrapAdmin) {
          // Sabit admin hesabının (admin@crm.com) normal onay akışından
          // geçmediği için hiç Firestore profili yok — isim ilk kez
          // kaydedilirken bu profili burada oluşturuyoruz.
          await firestore.collection("users").doc(uidCur).set({
            name, username: "admin", email: "admin@crm.com",
            role: "admin", approved: true, createdAt: new Date().toISOString()
          });
        }
      } catch (e) {
        alert("İsim güncellenemedi: " + e.message);
        return;
      }
      currentUserName = name;
      if (currentStaffId) {
        await mutateStaff(d => {
          const s = (d.staff || []).find(x => x.id === currentStaffId);
          if (s) s.name = name;
        });
      } else {
        render();
      }
      const msg = document.getElementById("acc_nameMsg");
      if (msg) { msg.style.color = "#37c98a"; msg.textContent = "Kaydedildi."; }
    }
    // Kullanıcı adı hem Firestore'da görünen isim hem de (username@crm.com
    // kalıbıyla) gerçek giriş e-postası olduğu için, client SDK'nın
    // "yeni e-postayı önce doğrula" kısıtlamasına takılmamak adına bu işlem
    // Worker üzerinden (servis hesabı yetkisiyle) yapılıyor — bkz.
    // callAdminUpdateUser. Kendi hesabın için çağırdığında Worker admin
    // yetkisi istemiyor, sadece token'ın gerçekten senin olduğunu doğruluyor.
    async function saveMyUsername() {
      const msg = document.getElementById("acc_usernameMsg");
      const newUsername = document.getElementById("acc_username").value.trim().toLowerCase();
      if (!newUsername) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Kullanıcı adı boş olamaz."; } return; }
      if (newUsername === "admin") { if (msg) { msg.style.color = "var(--red)"; msg.textContent = "'admin' kullanıcı adı sistem hesabı için ayrılmış."; } return; }
      if (!(await customConfirm(`Kullanıcı adın "${newUsername}" olarak değişecek. Bu işlem hemen oturumunu kapatacak, yeni kullanıcı adınla tekrar giriş yapman gerekecek. Devam edilsin mi?`, "Evet, Değiştir"))) return;
      if (msg) { msg.style.color = "var(--muted)"; msg.textContent = "Kaydediliyor..."; }
      try {
        await callAdminUpdateUser(auth.currentUser.uid, { username: newUsername });
      } catch (e) {
        if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Hata: " + e.message; }
        return;
      }
      currentUsername = newUsername;
      // Kullanıcı adı değişikliği (Worker/Identity Toolkit üzerinden,
      // ayrıcalıklı yol) mevcut oturumu geçersiz kılıyor — uygulama fark
      // etmeden veri çekmeye devam etmeye çalışırsa "Missing or
      // insufficient permissions" hatalarıyla karışık bir ekranda kalır.
      // Bu yüzden hemen çıkış yaptırıp net bir mesajla tekrar girişe
      // yönlendiriyoruz.
      await auth.signOut();
      const err = document.getElementById("loginError");
      if (err) {
        err.style.color = "#37c98a";
        err.innerHTML = icon('checkCircle', 14) + ` Kullanıcı adın "${newUsername}" olarak değişti. Yeni kullanıcı adınla tekrar giriş yap.`;
        err.style.display = "block";
      }
      const loginUserInput = document.getElementById("loginUser");
      if (loginUserInput) loginUserInput.value = newUsername;
    }
    async function saveMyPassword() {
      const msg = document.getElementById("acc_passMsg");
      const curPass = document.getElementById("acc_curPass").value;
      const newPass = document.getElementById("acc_newPass").value;
      const newPass2 = document.getElementById("acc_newPass2").value;
      if (!curPass || !newPass) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Mevcut ve yeni şifre zorunlu."; } return; }
      if (newPass.length < 6) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Yeni şifre en az 6 karakter olmalı."; } return; }
      if (newPass !== newPass2) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Yeni şifreler eşleşmiyor."; } return; }
      const user = auth.currentUser;
      if (msg) { msg.style.color = "var(--muted)"; msg.textContent = "Kaydediliyor..."; }
      try {
        const cred = firebase.auth.EmailAuthProvider.credential(user.email, curPass);
        await user.reauthenticateWithCredential(cred);
        await user.updatePassword(newPass);
      } catch (e) {
        let m = e.message;
        if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") m = "Mevcut şifre hatalı.";
        if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Hata: " + m; }
        return;
      }
      document.getElementById("acc_curPass").value = "";
      document.getElementById("acc_newPass").value = "";
      document.getElementById("acc_newPass2").value = "";
      if (msg) { msg.style.color = "#37c98a"; msg.textContent = "Şifre güncellendi."; }
    }

    /* ---------- Kullanıcı Yönetimi (admin, başka kullanıcılar için) ---------- */
    async function loadUserManagement() {
      const area = document.getElementById("userMgmtArea");
      if (!area) return;
      try {
        const snap = await firestore.collection("users").get();
        const users = [];
        snap.forEach(doc => { const d = doc.data(); if (d.approved === true) users.push({ id: doc.id, ...d }); });
        if (!users.length) { area.innerHTML = '<div class="empty">Onaylı kullanıcı yok.</div>'; return; }
        users.sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));
        const roleColors = { personel: '#4aa8ff', muhasebe: '#f4b740', admin: '#f2617a' };
        area.innerHTML = users.map(u => {
          const uname = u.username || (u.email || "").split("@")[0];
          const role = u.role || 'personel';
          const roleColor = roleColors[role] || '#9aa1b2';
          return `<div class="user-row" style="background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <div class="avatar" style="background:${avatarColor(u.name || uname)}">${escapeHtml(initials(u.name || uname))}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:15px">${escapeHtml(u.name || uname)}</div>
            <div style="font-size:12px;color:var(--muted)">@${escapeHtml(uname)}</div>
          </div>
          <button class="btn ghost" style="background:${roleColor}26;border-color:${roleColor};color:${roleColor};flex-shrink:0" onclick="openRoleModal('${u.id}', '${role}')">${ROLE_LABELS[role]}</button>
          <button class="btn ghost" style="padding:6px 10px;color:var(--red);border-color:rgba(242,97,122,.35)" onclick="adminDeleteUser('${u.id}', '${escapeHtml(u.name || uname)}')" title="Kullanıcıyı Sil">${icon('trash', 13)}</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
          <div>
            <label style="margin:0 0 4px">Ad Soyad</label>
            <div style="display:flex;gap:6px">
              <input id="um_name_${u.id}" value="${escapeHtml(u.name || "")}" style="flex:1;min-width:0">
              <button class="btn ghost" style="padding:6px 10px" onclick="adminSaveUserName('${u.id}')" title="Adı Kaydet">${icon('check', 13)}</button>
            </div>
          </div>
          <div>
            <label style="margin:0 0 4px">Kullanıcı Adı</label>
            <div style="display:flex;gap:6px">
              <input id="um_username_${u.id}" value="${escapeHtml(uname)}" style="flex:1;min-width:0">
              <button class="btn ghost" style="padding:6px 10px" onclick="adminSaveUserUsername('${u.id}')" title="Kullanıcı Adını Kaydet">${icon('check', 13)}</button>
            </div>
          </div>
          <div>
            <label style="margin:0 0 4px">Yeni Şifre</label>
            <div style="display:flex;gap:6px">
              <input type="password" id="um_pass_${u.id}" placeholder="••••••" style="flex:1;min-width:0">
              <button class="btn ghost" style="padding:6px 10px" onclick="adminResetUserPassword('${u.id}')" title="Şifreyi Sıfırla">${icon('lock', 13)}</button>
            </div>
          </div>
        </div>
        <div id="um_msg_${u.id}" style="font-size:11px;margin-top:8px"></div>
      </div>`;
        }).join('');
      } catch (e) {
        area.innerHTML = '<div class="empty" style="color:var(--red)">Kullanıcılar yüklenemedi: ' + e.message + '</div>';
      }
    }
    async function callAdminUpdateUser(targetUid, updates) {
      const token = await auth.currentUser.getIdToken();
      const resp = await fetch(USER_ADMIN_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ targetUid, ...updates })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Bilinmeyen hata");
      return data;
    }
    async function adminSaveUserName(targetUid) {
      const msg = document.getElementById("um_msg_" + targetUid);
      const name = document.getElementById("um_name_" + targetUid).value.trim();
      if (!name) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Ad soyad boş olamaz."; } return; }
      if (!(await customConfirm(`Bu kullanıcının adı "${name}" olarak değiştirilsin mi?`, "Evet, Değiştir"))) return;
      if (msg) { msg.style.color = "var(--muted)"; msg.textContent = "Kaydediliyor..."; }
      try {
        await callAdminUpdateUser(targetUid, { name });
        const s = (db.staff || []).find(x => x.userId === targetUid);
        if (s) await mutateStaff(d => { const m = (d.staff || []).find(x => x.userId === targetUid); if (m) m.name = name; });
        if (msg) { msg.style.color = "#37c98a"; msg.textContent = "Ad soyad güncellendi."; }
      } catch (e) {
        if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Hata: " + e.message; }
      }
    }
    async function adminSaveUserUsername(targetUid) {
      const msg = document.getElementById("um_msg_" + targetUid);
      const username = document.getElementById("um_username_" + targetUid).value.trim().toLowerCase();
      if (!username) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Kullanıcı adı boş olamaz."; } return; }
      if (!(await customConfirm(`Bu kullanıcının kullanıcı adı "${username}" olarak değiştirilsin mi? Bir sonraki girişte yeni kullanıcı adını kullanması gerekir.`, "Evet, Değiştir"))) return;
      if (msg) { msg.style.color = "var(--muted)"; msg.textContent = "Kaydediliyor..."; }
      try {
        await callAdminUpdateUser(targetUid, { username });
        if (msg) { msg.style.color = "#37c98a"; msg.textContent = "Kullanıcı adı güncellendi."; }
      } catch (e) {
        if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Hata: " + e.message; }
      }
    }
    async function adminResetUserPassword(targetUid) {
      const msg = document.getElementById("um_msg_" + targetUid);
      const passEl = document.getElementById("um_pass_" + targetUid);
      const password = passEl.value;
      if (!password || password.length < 6) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Şifre en az 6 karakter olmalı."; } return; }
      if (!(await customConfirm("Bu kullanıcının şifresi değiştirilsin mi?", "Evet, Değiştir"))) return;
      if (msg) { msg.style.color = "var(--muted)"; msg.textContent = "Kaydediliyor..."; }
      try {
        await callAdminUpdateUser(targetUid, { password });
        passEl.value = "";
        if (msg) { msg.style.color = "#37c98a"; msg.textContent = "Şifre güncellendi."; }
      } catch (e) {
        if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Hata: " + e.message; }
      }
    }
    // Hesabı tamamen siler (gerçek Auth hesabı + Firestore profili) — bir
    // daha o kullanıcı adıyla/şifreyle giriş yapılamaz. Ekip'teki "Sil"
    // butonundan farklı: o sadece ekip kartını kaldırır, hesabı silmez.
    async function adminDeleteUser(targetUid, displayName) {
      const msg = document.getElementById("um_msg_" + targetUid);
      if (!(await customConfirm(`"${displayName}" kullanıcısının hesabı tamamen silinsin mi? Bu işlem geri alınamaz, bir daha bu hesapla giriş yapılamaz.`, "Evet, Sil"))) return;
      if (msg) { msg.style.color = "var(--muted)"; msg.textContent = "Siliniyor..."; }
      try {
        const token = await auth.currentUser.getIdToken();
        const resp = await fetch(USER_ADMIN_DELETE_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ targetUid })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Bilinmeyen hata");
      } catch (e) {
        if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Hata: " + e.message; }
        return;
      }
      const s = (db.staff || []).find(x => x.userId === targetUid);
      if (s) await mutateStaff(d => { d.staff = (d.staff || []).filter(x => x.userId !== targetUid); });
      await loadUserManagement();
    }

    // Admin, birinin kendi kayıt olup onay beklemesine gerek kalmadan
    // doğrudan yeni bir kullanıcı hesabı açar (bkz. worker'daki
    // /admin/create-user — handleAdminCreateUser).
    function openCreateUserModal() {
      document.getElementById("cu_name").value = "";
      document.getElementById("cu_username").value = "";
      document.getElementById("cu_password").value = "";
      document.getElementById("cu_role").value = "personel";
      document.getElementById("cu_msg").textContent = "";
      document.getElementById("createUserModal").classList.add("open");
    }
    function closeCreateUserModal() { document.getElementById("createUserModal").classList.remove("open"); }
    async function saveNewUser() {
      const msg = document.getElementById("cu_msg");
      const name = document.getElementById("cu_name").value.trim();
      const username = document.getElementById("cu_username").value.trim().toLowerCase();
      const password = document.getElementById("cu_password").value;
      const role = document.getElementById("cu_role").value;
      if (!name) { msg.style.color = "var(--red)"; msg.textContent = "Ad soyad zorunlu."; return; }
      if (!username) { msg.style.color = "var(--red)"; msg.textContent = "Kullanıcı adı zorunlu."; return; }
      if (!password || password.length < 6) { msg.style.color = "var(--red)"; msg.textContent = "Şifre en az 6 karakter olmalı."; return; }
      msg.style.color = "var(--muted)"; msg.textContent = "Oluşturuluyor...";
      try {
        const token = await auth.currentUser.getIdToken();
        const resp = await fetch(USER_ADMIN_CREATE_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ name, username, password, role })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Bilinmeyen hata");

        // Onaylı kullanıcı akışıyla aynı şekilde otomatik Ekip'e ekle.
        const newStaffMember = { id: uid(), name, role: "Personel", userId: data.uid };
        await mutateStaff(state => {
          state.staff = state.staff || [];
          state.staff.push(newStaffMember);
        });

        closeCreateUserModal();
        await loadUserManagement();
      } catch (e) {
        msg.style.color = "var(--red)"; msg.textContent = "Hata: " + e.message;
      }
    }

    let chartStatus = null;
    let chartGenre = null;
    let chartMonthlyRevenue = null;
    let chartCashFlow = null;

    function getMonthlyRevenue(monthsBack) {
      const now = new Date();
      const months = [];
      for (let i = monthsBack - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }), total: 0 });
      }
      const map = {};
      months.forEach(m => map[m.key] = m);
      db.authors.forEach(a => (a.payments || []).forEach(p => {
        if (p.status !== "Ödendi" || !p.date) return;
        const d = new Date(p.date);
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        if (map[key]) map[key].total += p.amount;
      }));
      return months;
    }

    // Önümüzdeki N ay için beklenen ("Bekliyor" durumundaki) taksit
    // gelirini aya göre gruplar. Vadesi geçmiş ama hâlâ tahsil edilmemiş
    // ödemeler ayrı bir "gecikmiş" grubunda tutulur — ne zaman geleceği
    // belirsiz olduğu için aylık projeksiyona sessizce karıştırılmaz.
    // Pencerenin ötesindeki (N aydan sonraki) ödemeler de toplamdan
    // kaybolmasın diye ayrı bir "daha sonra" grubunda toplanır.
    function getCashFlowForecast(monthsAhead) {
      const now = new Date();
      const todayKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const months = [];
      for (let i = 0; i < monthsAhead; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }), total: 0, count: 0 });
      }
      const map = {};
      months.forEach(m => map[m.key] = m);

      let overdueTotal = 0, overdueCount = 0, laterTotal = 0, laterCount = 0;
      db.authors.forEach(a => (a.payments || []).forEach(p => {
        if (p.status !== "Bekliyor" || !p.date || !p.amount) return;
        if (p.date < todayKey) { overdueTotal += p.amount; overdueCount++; return; }
        const key = p.date.slice(0, 7);
        if (map[key]) { map[key].total += p.amount; map[key].count++; }
        else { laterTotal += p.amount; laterCount++; }
      }));

      const monthsTotal = months.reduce((s, m) => s + m.total, 0);
      return { months, overdueTotal, overdueCount, laterTotal, laterCount, grandTotal: monthsTotal + laterTotal };
    }

    function initCashFlowChart() {
      if (typeof Chart === 'undefined') return;
      const ctx = document.getElementById('cashFlowChart');
      if (!ctx) return;
      const forecast = getCashFlowForecast(6);
      if (chartCashFlow) chartCashFlow.destroy();
      chartCashFlow = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: forecast.months.map(m => m.label),
          datasets: [{
            label: 'Beklenen Tahsilat',
            data: forecast.months.map(m => m.total),
            backgroundColor: '#4aa8ff',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { color: '#9aa1b2', font: { family: 'Inter, sans-serif' }, callback: v => v.toLocaleString('tr-TR') }, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
            x: { ticks: { color: '#9aa1b2', font: { family: 'Inter, sans-serif' } }, grid: { display: false }, border: { display: false } }
          }
        }
      });
    }

    function initAccountingChart() {
      if (typeof Chart === 'undefined') return;
      const ctx = document.getElementById('monthlyRevenueChart');
      if (!ctx) return;
      const monthly = getMonthlyRevenue(6);
      if (chartMonthlyRevenue) chartMonthlyRevenue.destroy();
      chartMonthlyRevenue = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: monthly.map(m => m.label),
          datasets: [{
            label: 'Tahsil Edilen',
            data: monthly.map(m => m.total),
            backgroundColor: '#37c98a',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { color: '#9aa1b2', font: { family: 'Inter, sans-serif' }, callback: v => v.toLocaleString('tr-TR') }, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
            x: { ticks: { color: '#9aa1b2', font: { family: 'Inter, sans-serif' } }, grid: { display: false }, border: { display: false } }
          }
        }
      });
    }

    function initCharts() {
      if (typeof Chart === 'undefined') return;

      // Status Chart Data
      const statusCounts = {};
      Object.keys(STATUS).forEach(k => statusCounts[k] = 0);
      db.authors.forEach(a => { if (statusCounts[a.status] !== undefined) statusCounts[a.status]++; });

      const ctxStatus = document.getElementById('statusChart');
      if (ctxStatus) {
        if (chartStatus) chartStatus.destroy();
        chartStatus = new Chart(ctxStatus, {
          type: 'doughnut',
          data: {
            labels: Object.keys(STATUS).map(k => STATUS[k].label),
            datasets: [{
              data: Object.values(statusCounts),
              backgroundColor: Object.keys(STATUS).map(k => STATUS[k].color),
              borderWidth: 0,
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'right', labels: { color: '#9aa1b2', font: { size: 11, family: 'Inter, sans-serif' } } }
            },
            cutout: '65%'
          }
        });
      }

      // Genre Chart Data
      const genreCounts = {};
      db.authors.forEach(a => {
        (a.genres || []).forEach(g => {
          genreCounts[g] = (genreCounts[g] || 0) + 1;
        });
      });
      const genres = Object.keys(genreCounts).sort((x, y) => genreCounts[y] - genreCounts[x]).slice(0, 6);

      const ctxGenre = document.getElementById('genreChart');
      if (ctxGenre) {
        if (chartGenre) chartGenre.destroy();
        chartGenre = new Chart(ctxGenre, {
          type: 'bar',
          data: {
            labels: genres,
            datasets: [{
              label: 'Yazar',
              data: genres.map(g => genreCounts[g]),
              backgroundColor: '#4aa8ff',
              borderRadius: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1, color: '#9aa1b2', font: { family: 'Inter, sans-serif' } }, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
              x: { ticks: { color: '#9aa1b2', font: { family: 'Inter, sans-serif' } }, grid: { display: false }, border: { display: false } }
            }
          }
        });
      }
    }

    function viewAuthors() {
      const list = filteredAuthors();

      const visibleStatuses = Object.keys(STATUS).filter(s => s !== "sozlesme" && s !== "yayinda");
      const counts = { all: db.authors.filter(a => a.status !== "sozlesme" && a.status !== "yayinda").length };
      visibleStatuses.forEach(s => counts[s] = db.authors.filter(a => a.status === s).length);

      let bar = `<div class="toolbar" style="gap:10px; align-items:center; flex-wrap:wrap;">`;
      const allActive = filterStatus === 'all';
      bar += `<span class="pill ${allActive ? 'active' : ''}" onclick="setFilter('all')" onmouseover="this.style.borderColor='var(--brand)'" onmouseout="if(!${allActive}) this.style.borderColor='var(--line)'">
          Tümü (${counts.all})
        </span>`;
        
      bar += visibleStatuses.map(k => {
        const v = STATUS[k];
        const isActive = filterStatus === k;
        const style = isActive ? `background: ${v.color}18; border-color: ${v.color}; color: ${v.color}; box-shadow: 0 0 14px ${v.color}33; text-shadow: 0 0 12px ${v.color}44;` : ``;
        return `<span class="pill ${isActive ? 'active' : ''}" style="${style}" onclick="setFilter('${k}')" onmouseover="this.style.borderColor='${v.color}'" onmouseout="if(!${isActive}) this.style.borderColor='var(--line)'">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${v.color};margin-right:8px;box-shadow:0 0 8px ${v.color}"></span>
          ${v.label} (${counts[k]})
        </span>`;
      }).join("");
      
      const dfStyle = filterDate !== 'all' ? `background: rgba(74, 168, 255, 0.15); border-color: #4aa8ff; color: #4aa8ff; margin-left: auto;` : `margin-left: auto; border: 1px solid rgba(255,255,255,0.15);`;
      bar += `<button class="btn ${filterDate !== 'all' ? '' : 'ghost'}" style="${dfStyle}" onclick="openDateFilterModal()">${icon('calendar', 14)} Tarih: ${filterDate === 'all' ? 'Tümü' : filterDate}</button>`;
      
      bar += `</div>`;
      
      if (!list.length) return bar + `<div class="empty">Kayıt bulunamadı.</div>`;
      
      const getAuthorDate = (a) => {
        let latestDate = a.created || "Bilinmeyen Tarih";
        if (a.logs && a.logs.length > 0) {
          const maxLogDate = a.logs.map(l => l.date).reduce((x, y) => x > y ? x : y);
          if (maxLogDate > latestDate || latestDate === "Bilinmeyen Tarih") {
            latestDate = maxLogDate;
          }
        }
        return latestDate;
      };

      const groups = {};
      list.forEach(a => {
         const d = getAuthorDate(a);
         if (!groups[d]) groups[d] = [];
         groups[d].push(a);
      });

      const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

      const datesToRender = filterDate === 'all' ? sortedDates : (groups[filterDate] ? [filterDate] : []);

      let htmlOutput = bar;

      if (datesToRender.length === 0) {
         htmlOutput += `<div class="empty">Bu tarihte kayıt bulunamadı.</div>`;
      } else {
          // Cok sayida kart (her biri blur efektli) ayni anda DOM'a
          // basilirsa tarayici ciddi sekilde yavasliyor — bu yuzden
          // toplam kart sayisini authorsRenderLimit ile sinirlayip
          // "Daha Fazla Goster" ile kademeli aciyoruz.
          let rendered = 0;
          let totalInScope = 0;
          datesToRender.forEach(date => totalInScope += groups[date].length);
          for (const date of datesToRender) {
            if (rendered >= authorsRenderLimit) break;
            const remaining = authorsRenderLimit - rendered;
            const dateAuthors = groups[date].slice(0, remaining);
            htmlOutput += `<h2 style="margin: 24px 0 12px; color: var(--blue); font-size: 16px; border-bottom: 1px solid rgba(74, 168, 255, 0.3); padding-bottom: 8px;">${icon('calendar', 15)} ${date} Tarihli İşlemler</h2>`;
            htmlOutput += `<div class="grid authors">`;
            htmlOutput += dateAuthors.map(authorCard).join("");
            htmlOutput += `</div>`;
            rendered += dateAuthors.length;
          }
          if (rendered < totalInScope) {
            htmlOutput += `<div style="display:flex;justify-content:center;margin:20px 0"><button class="btn ghost" onclick="showMoreAuthors()">Daha Fazla Göster (${totalInScope - rendered} kayıt daha)</button></div>`;
          }
      }

      return htmlOutput;
    }

    function openDateFilterModal() {
      const list = filteredAuthors();
      const getAuthorDate = (a) => {
        let latestDate = a.created || "Bilinmeyen Tarih";
        if (a.logs && a.logs.length > 0) {
          const maxLogDate = a.logs.map(l => l.date).reduce((x, y) => x > y ? x : y);
          if (maxLogDate > latestDate || latestDate === "Bilinmeyen Tarih") {
            latestDate = maxLogDate;
          }
        }
        return latestDate;
      };

      const groups = {};
      list.forEach(a => {
         const d = getAuthorDate(a);
         if (!groups[d]) groups[d] = [];
         groups[d].push(a);
      });
      const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

      let content = `
        <div class="box" style="max-width: 320px; padding: 20px;">
          <h2 style="margin-top:0; font-size:16px;">${icon('calendar', 15)} Tarih Filtresi</h2>
          <div style="display:flex; flex-direction:column; gap: 8px; max-height:400px; overflow-y:auto; padding-right:4px;">
            <button class="btn ${filterDate === 'all' ? 'primary' : 'ghost'}" style="${filterDate === 'all' ? '' : 'justify-content:flex-start;'} width:100%;" onclick="setDateFilter('all'); closeDateFilterModal();">
              Tüm Tarihler
            </button>
      `;
      
      sortedDates.forEach(d => {
        const isActive = filterDate === d;
        const style = isActive ? `background: rgba(74, 168, 255, 0.15); border-color: #4aa8ff; color: #4aa8ff;` : `justify-content:flex-start;`;
        content += `<button class="btn ${isActive ? '' : 'ghost'}" style="${style} width:100%;" onclick="setDateFilter('${d}'); closeDateFilterModal();">
          ${d} (${groups[d].length})
        </button>`;
      });
      
      content += `
          </div>
          <div class="actions" style="margin-top: 16px;">
            <button class="btn ghost" style="width:100%" onclick="closeDateFilterModal()">Kapat</button>
          </div>
        </div>
      `;
      
      let m = document.getElementById("dateFilterModal");
      if (!m) {
        m = document.createElement("div");
        m.className = "modal";
        m.id = "dateFilterModal";
        document.body.appendChild(m);
      }
      m.innerHTML = content;
      m.classList.add("open");
    }

    function closeDateFilterModal() {
      const m = document.getElementById("dateFilterModal");
      if(m) m.classList.remove("open");
    }

    function authorCard(a) {
      const st = STATUS[a.status];
      const temp = Array.from({ length: 5 }, (_, i) => `<span style="background:${i < a.temp ? '#f4b740' : 'var(--line)'}"></span>`).join("");
      const d = daysUntil(a.followup);
      const timeTag = a.interviewTime ? ` 🕒${a.interviewTime}` : '';
      const fl = d === null ? (a.interviewTime && a.interviewDate ? `<span style="color:var(--brand)">${icon('clock', 13)} ${fmtDate(a.interviewDate)} 🕒${a.interviewTime}</span>` : "") : d < 0 ? `<span style="color:var(--red)">${icon('alertTriangle', 13)} ${-d}g gecikti${timeTag}</span>` : d <= 3 ? `<span style="color:var(--amber)">${icon('bell', 13)} ${d === 0 ? 'bugün' : d + 'g sonra'}${timeTag}</span>` : `${icon('calendar', 13)} ${fmtDate(a.followup)}${timeTag}`;

      const adder = a.addedBy === "admin" ? "Sistem Yöneticisi" : (staffName(a.addedBy) || "Personel");
      const cDateStr = (a.status === "sozlesme" || a.status === "yayinda" || a.contractDate) ? getContractDate(a) : null;
      const contractBadge = cDateStr ? `<div style="font-size:11px;color:var(--brand);display:flex;align-items:center;gap:4px;margin-top:2px" title="Sözleşme Tarihi">${icon('calendar', 11)} Sözleşme: ${fmtDate(cDateStr)}${a.contractEndDate ? ' • Bitiş: ' + fmtDate(a.contractEndDate) : ''}</div>` : '';

      // .swipe-item/.swipe-actions/.swipe-content: mobilde sola kaydırınca
      // altından "Sil" butonu çıkar (bkz. initSwipeToDelete). Masaüstünde
      // .swipe-actions hep gizli kalır (styles.css), kart eskisi gibi davranır.
      return `<div class="swipe-item">
    <div class="swipe-actions"><button class="swipe-delete-btn" onclick="event.stopPropagation();delAuthor('${a.id}')">${icon('trash', 18)}<span>Sil</span></button></div>
    <div class="swipe-content">
    <div class="card author" onclick="openDrawer('${a.id}')">
    <div class="head">
      <div class="avatar" style="background:${avatarColor(a.name)}">${escapeHtml(initials(a.name))}</div>
      <div style="flex:1">
        <div class="name">${escapeHtml(a.name)}</div>
        <div class="role">${escapeHtml(a.work) || "—"}</div>
        ${contractBadge}
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; justify-content:center; gap:6px;">
        <span style="font-size:11px; color:var(--muted); line-height:1;">(${escapeHtml(adder)})</span>
        <span class="badge" style="background:${st.color}15;color:${st.color};border:1px solid ${st.color}44;box-shadow:0 0 10px ${st.color}22">${st.label}</span>
      </div>
    </div>
    <div class="tags">${(a.genres || []).map(g => `<span class="tag">${escapeHtml(g)}</span>`).join("")}</div>
    <div class="meta-row">
      <div class="temp" title="İlgi düzeyi">${temp}</div>
      <div style="display:flex;align-items:center;gap:8px" onclick="event.stopPropagation()">${fl} ${waBtn(a.phone)}</div>
    </div>
    </div>
    </div>
  </div>`;
    }

    function setFilter(s) { filterStatus = s; authorsRenderLimit = 60; render(); }
    function setDateFilter(d) { filterDate = d; authorsRenderLimit = 60; render(); }
    function showMoreAuthors() { authorsRenderLimit += 60; render(); }

    let searchDebounceTimer = null;
    function debouncedRender() {
      authorsRenderLimit = 60;
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(render, 200);
    }
    let filterContract = "all";
    function setContractFilter(s) { filterContract = s; render(); }
    let filterPackage = "all";
    function setPackageFilter(p) { filterPackage = p; render(); }
    function openPackageFilterModal() {
      const allContracted = db.authors.filter(a => a.status === "sozlesme" || a.status === "yayinda");
      const PKG_TYPES = ["vip", "pro", "standart"];

      let content = `
        <div class="box" style="max-width: 320px; padding: 20px;">
          <h2 style="margin-top:0; font-size:16px;">${icon('chevronDown', 15)} Paket Filtresi</h2>
          <div style="display:flex; flex-direction:column; gap: 8px;">
            <button class="btn ${filterPackage === 'all' ? 'primary' : 'ghost'}" style="${filterPackage === 'all' ? '' : 'justify-content:flex-start;'} width:100%;" onclick="setPackageFilter('all'); closePackageFilterModal();">
              Tüm Paketler (${allContracted.length})
            </button>
      `;

      PKG_TYPES.forEach(k => {
        const pkg = PACKAGES[k];
        const count = allContracted.filter(a => a.package === k).length;
        const isActive = filterPackage === k;
        const style = isActive ? `background: rgba(124,108,255,.15); border-color: var(--brand); color: var(--brand);` : `justify-content:flex-start;`;
        content += `<button class="btn ${isActive ? '' : 'ghost'}" style="${style} width:100%;" onclick="setPackageFilter('${k}'); closePackageFilterModal();">
          ${pkg.label} (${count})
        </button>`;
      });

      content += `
          </div>
          <div class="actions" style="margin-top: 16px;">
            <button class="btn ghost" style="width:100%" onclick="closePackageFilterModal()">Kapat</button>
          </div>
        </div>
      `;

      let m = document.getElementById("packageFilterModal");
      if (!m) {
        m = document.createElement("div");
        m.className = "modal";
        m.id = "packageFilterModal";
        document.body.appendChild(m);
      }
      m.innerHTML = content;
      m.classList.add("open");
    }
    function closePackageFilterModal() {
      const m = document.getElementById("packageFilterModal");
      if (m) m.classList.remove("open");
    }

    function viewContracts() {
      const t = searchTerm();
      const match = a => !t || (a.name + " " + (a.genres || []).join(" ") + " " + (a.work || "") + " " + (a.notes || "") + " " + (a.phone || "")).toLowerCase().includes(t);
      const getCDate = a => new Date(getContractDate(a) || 0).getTime();
      const sozlesme = db.authors.filter(a => a.status === "sozlesme" && match(a)).sort((x, y) => getCDate(y) - getCDate(x));
      const yayinda = db.authors.filter(a => a.status === "yayinda" && match(a)).sort((x, y) => getCDate(y) - getCDate(x));
      const toplam = sozlesme.length + yayinda.length;

      const TYPES = ["Aktif Sözleşme", "Yayında"];
      const counts = { "Aktif Sözleşme": sozlesme.length, "Yayında": yayinda.length };
      const COLORS = { "Aktif Sözleşme": "#2563eb", "Yayında": "#37c98a" };

      let bar = `<div class="toolbar" style="margin-top:-8px;margin-bottom:20px;gap:10px">`;
      
      const allActive = filterContract === 'all';
      bar += `<span class="pill ${allActive ? 'active' : ''}" onclick="setContractFilter('all')" onmouseover="this.style.borderColor='var(--brand)'" onmouseout="if(!${allActive}) this.style.borderColor='var(--line)'">
          Tümü (${toplam})
        </span>`;

      TYPES.forEach(ft => {
        const c = COLORS[ft];
        const isActive = filterContract === ft;
        const style = isActive ? `background: ${c}15; border-color: ${c}; color: ${c}; box-shadow: 0 0 14px ${c}40;` : ``;
        bar += `<span class="pill ${isActive ? 'active' : ''}" style="${style}" onclick="setContractFilter('${ft}')" onmouseover="this.style.borderColor='${c}'" onmouseout="if(!${isActive}) this.style.borderColor='rgba(255,255,255,0.08)'">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:8px;box-shadow:0 0 8px ${c}"></span>
          ${ft} (${counts[ft]})
        </span>`;
      });

      const allContracted = [...sozlesme, ...yayinda];
      const pkgLabel = filterPackage === 'all' ? 'Tümü' : PACKAGES[filterPackage].label;
      const pkgBtnStyle = filterPackage !== 'all' ? `background: rgba(37,99,235,.15); border-color: var(--brand); color: var(--brand); margin-left:auto;` : `margin-left:auto; border: 1px solid var(--line);`;
      bar += `<button class="btn ${filterPackage !== 'all' ? '' : 'ghost'}" style="${pkgBtnStyle}" onclick="openPackageFilterModal()">${icon('chevronDown', 14)} Paket: ${pkgLabel}</button>`;
      bar += `<button class="btn ghost" style="border: 1px solid var(--line); margin-left: 10px;" onclick="openBulkMessageModal()">${icon('messageSquare', 14) || 'Mesaj'} Toplu Mesaj</button>`;
      bar += `</div>`;

      let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div style="color:var(--muted);font-size:13px">Sözleşme yaptığınız tüm yazarlar burada verimli şekilde yönetilir.</div>
        <span class="chip" style="background:rgba(37,99,235,.15);border:1px solid rgba(59,130,246,.3);color:#60a5fa;padding:5px 12px;font-weight:600;border-radius:20px">Toplam <b>${toplam}</b> Sözleşmeli Yazar</span>
      </div>`;
      html += bar;

      let displayList = [];
      if (filterContract === 'all') displayList = allContracted;
      else if (filterContract === 'Aktif Sözleşme') displayList = sozlesme;
      else if (filterContract === 'Yayında') displayList = yayinda;

      if (filterPackage !== 'all') displayList = displayList.filter(a => a.package === filterPackage);

      window.lastRenderedContractsList = displayList;

      if (displayList.length) {
        html += `<div class="grid authors">${displayList.map(authorCard).join("")}</div>`;
      } else {
        html += `<div class="empty">Bu bölümde henüz yazar yok.</div>`;
      }

      return html;
    }

    function getPaymentAlerts() {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const overdue = [], upcoming = [];
      db.authors.forEach(a => {
        (a.payments || []).forEach((p, idx) => {
          if (p.status !== "Bekliyor") return;
          const d = new Date(p.date);
          const days = Math.round((d - today) / 864e5);
          const item = { author: a, payment: p, idx, days };
          if (days < 0) overdue.push(item);
          else if (days <= 7) upcoming.push(item);
        });
      });
      overdue.sort((x, y) => x.days - y.days);
      upcoming.sort((x, y) => x.days - y.days);
      return { overdue, upcoming };
    }
    function vatPortion(p) {
      if (p.vatIncluded === false) return 0;
      return Math.round(p.amount - p.amount / 1.2);
    }

    // Eski ödeme kayıtlarında (bu güncellemeden önce eklenmiş) sabit bir id
    // yoktu, sil/düzenle/ödendi-işaretle işlemleri dizideki sıra numarasına
    // (index) göre çalışıyordu — eşzamanlı bir değişiklikte yanlış satırı
    // etkileme riski vardı. Bu, ilk açılışta eksik id'leri tek seferde
    // dolduran, hem yerel hem sunucu tarafını güncelleyen bir öz-onarım.
    function backfillPaymentIds() {
      const byAuthor = {};
      db.authors.forEach(a => {
        (a.payments || []).forEach((p, idx) => {
          if (!p.id) {
            byAuthor[a.id] = byAuthor[a.id] || [];
            byAuthor[a.id].push({ idx, newId: uid() });
          }
        });
      });
      Object.keys(byAuthor).forEach(authorId => {
        const assignments = byAuthor[authorId];
        const apply = author => {
          assignments.forEach(as => {
            const p = author.payments && author.payments[as.idx];
            if (p && !p.id) p.id = as.newId;
          });
        };
        mutateAuthor(authorId, apply);
      });
    }

    function getPaymentBreakdown(authors) {
      const byPackage = {}, byMethod = {};
      authors.forEach(a => (a.payments || []).forEach(p => {
        if (p.status !== "Ödendi") return;
        const pkgLabel = p.package && PACKAGES[p.package] ? PACKAGES[p.package].label : "Diğer/Paketsiz";
        byPackage[pkgLabel] = (byPackage[pkgLabel] || 0) + p.amount;
        const methodLabel = p.method && PAYMENT_METHODS[p.method] ? PAYMENT_METHODS[p.method].label : "Diğer";
        byMethod[methodLabel] = (byMethod[methodLabel] || 0) + p.amount;
      }));
      return { byPackage, byMethod };
    }

    function renderBreakdownBars(dataObj, colors) {
      const entries = Object.entries(dataObj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      if (!entries.length) return `<div class="empty" style="padding:8px 0">Veri yok</div>`;
      const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
      return entries.map(([label, val], i) => {
        const pct = Math.round(val / total * 100);
        const color = colors[i % colors.length];
        return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span>${escapeHtml(label)}</span>
        <span style="color:var(--muted)">${val.toLocaleString('tr-TR')} ₺ (%${pct})</span>
      </div>
      <div style="background:var(--panel-2);border-radius:6px;height:8px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:6px"></div>
      </div>
    </div>`;
      }).join('');
    }

    function printReceipt(authorId, paymentId) {
      const a = db.authors.find(x => x.id === authorId);
      const p = a && a.payments && a.payments.find(x => x.id === paymentId);
      if (!a || !p) return;
      const vat = vatPortion(p);
      const net = p.amount - vat;
      const waUrl = a.phone ? toWaLink(a.phone, receiptWaText(a.name, p, vat)) : '';
      const win = window.open('', '_blank', 'width=650,height=800');
      if (!win) { alert('Makbuz penceresi açılamadı. Tarayıcınız açılır pencereleri engelliyor olabilir.'); return; }
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Makbuz</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 40px; color: #222; }
      h1 { font-size: 20px; border-bottom: 2px solid #7c6cff; padding-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      td { padding: 8px 0; border-bottom: 1px solid #eee; }
      td:first-child { color: #666; width: 40%; }
      .total { font-size: 18px; font-weight: bold; }
      button, a.wa-btn { margin-top: 30px; padding: 10px 20px; font-size: 14px; cursor: pointer; }
      a.wa-btn { display: inline-block; margin-left: 10px; background: #25D366; color: #fff; text-decoration: none; border-radius: 6px; }
      @media print { button, a.wa-btn { display: none; } }
    </style></head><body>
      <h1>Ödeme Makbuzu</h1>
      <table>
        <tr><td>Yazar</td><td>${escapeHtml(a.name)}</td></tr>
        <tr><td>Tarih</td><td>${fmtDate(p.date)}</td></tr>
        ${p.serviceName ? `<tr><td>Hizmet</td><td>${escapeHtml(p.serviceName)}</td></tr>` : ''}
        <tr><td>Açıklama</td><td>${escapeHtml(p.notes) || '—'}</td></tr>
        <tr><td>Net Tutar</td><td>${net.toLocaleString('tr-TR')} ₺</td></tr>
        <tr><td>KDV (%20)</td><td>${vat.toLocaleString('tr-TR')} ₺</td></tr>
        <tr><td>Toplam</td><td class="total">${p.amount.toLocaleString('tr-TR')} ₺</td></tr>
        <tr><td>Durum</td><td>${escapeHtml(p.status)}</td></tr>
      </table>
      <button onclick="window.print()">Yazdır / PDF Kaydet</button>${waUrl ? `<a class="wa-btn" href="${waUrl}" target="_blank">WhatsApp'tan Gönder</a>` : ''}
    </body></html>`);
      win.document.close();
    }

    let paymentStatusTab = "odeyen";
    let paymentMethodFilter = "all";
    // Sekme/filtre değiştiğinde SADECE alttaki liste alanını günceller —
    // istatistik kartları, uyarılar ve aylık gelir grafiği (Chart.js canvas)
    // yeniden oluşturulmaz. Önceden her tıklamada render() tüm #content'i
    // (grafik dahil) yeniden çiziyordu, bu da göze "sayfa yeniden yükleniyor"
    // gibi bir sarsıntı/flaş olarak yansıyordu.
    function setPaymentStatusTab(t) { paymentStatusTab = t; renderAccountingList(); }
    function setPaymentMethodFilter(m) { paymentMethodFilter = m; renderAccountingList(); }

    function getAccountingAuthors() {
      const t = searchTerm();
      const match = a => !t || (a.name + " " + (a.work || "")).toLowerCase().includes(t);
      const contracted = db.authors.filter(a => (a.status === "sozlesme" || a.status === "yayinda") && match(a));
      // Sözleşmesi bitip arşivlenen ama ödeme geçmişi olan yazarlar da listede kalsın.
      const archivedWithPayments = db.authors.filter(a => a.status !== "sozlesme" && a.status !== "yayinda" && (a.payments || []).length > 0 && match(a));
      return { contracted, displayAuthors: [...contracted, ...archivedWithPayments] };
    }

    const ACCOUNTING_STATUS_COLORS = { "Ödendi": "#37c98a", "Bekliyor": "#f4b740", "İptal": "#9aa1b2" };
    function renderAuthorPaymentCard(a, canSeeAmounts, canManagePayments) {
      const payments = (a.payments || []).slice().sort((p, q) => new Date(p.date) - new Date(q.date));
      const paid = payments.filter(p => p.status === "Ödendi");
      const pending = payments.filter(p => p.status === "Bekliyor");
      const paidSum = paid.reduce((s, p) => s + p.amount, 0);
      const pendingSum = pending.reduce((s, p) => s + p.amount, 0);
      const isOtherStatus = a.status !== "sozlesme" && a.status !== "yayinda";

      const rows = payments.map(p => {
        const col = ACCOUNTING_STATUS_COLORS[p.status] || "#9aa1b2";
        const vat = vatPortion(p);
        const addedByLabel = p.addedBy === "admin" ? "Sistem Yöneticisi" : (staffName(p.addedBy) || "");
        const receiptBtn = canSeeAmounts ? `<button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="printReceipt('${a.id}', '${p.id}')" title="Makbuz">${icon('receipt', 14)}</button>` : '';
        const markPaidBtn = p.status === "Bekliyor" ? `<button class="btn ghost" style="padding:4px 10px;font-size:12px;color:#37c98a;border-color:#37c98a" onclick="markPaymentPaid('${a.id}', '${p.id}')">${icon('check', 13)} Ödendi</button>` : '';
        const editBtn = canManagePayments ? `<button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="openEditPaymentModal('${a.id}', '${p.id}')" title="Düzenle">${icon('edit', 14)}</button>` : '';
        const delBtn = canManagePayments ? `<button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="delPayment('${a.id}', '${p.id}')" title="Sil">${icon('trash', 14)}</button>` : '';
        const resmiBadge = canSeeAmounts ? (p.resmi === false
          ? `<span class="badge" style="background:rgba(244,183,64,.15);color:#f4b740;font-size:10px">Gayri Resmi</span>`
          : `<span class="badge" style="background:rgba(74,168,255,.15);color:#4aa8ff;font-size:10px">Resmi</span>`) : '';
        const methodLabel = p.method && PAYMENT_METHODS[p.method] ? PAYMENT_METHODS[p.method].label : '';
        return `<tr style="border-bottom:1px solid var(--line)">
        <td data-label="Tarih" style="padding:8px">${fmtDate(p.date)}</td>
        ${canSeeAmounts ? `<td data-label="Tutar" style="padding:8px;font-weight:600">${p.amount.toLocaleString('tr-TR')} ₺<div style="font-weight:400;font-size:11px;color:var(--muted)">KDV: ${vat.toLocaleString('tr-TR')} ₺</div></td>` : ''}
        <td data-label="Durum" style="padding:8px"><span class="badge" style="background:${col}22;color:${col}">${escapeHtml(p.status)}</span> ${resmiBadge}</td>
        <td data-label="Not" style="padding:8px;color:var(--muted);font-size:12px">${p.serviceName ? `<div style="color:var(--txt);font-weight:600">${escapeHtml(p.serviceName)}</div>` : ''}${methodLabel ? `<div style="color:var(--brand);font-weight:600">${escapeHtml(methodLabel)}</div>` : ''}${escapeHtml(p.notes) || (p.serviceName || methodLabel ? '' : '—')}${addedByLabel ? `<div style="font-size:11px;opacity:.7">${escapeHtml(addedByLabel)} ekledi</div>` : ''}</td>
        <td data-label="" style="padding:8px;text-align:right"><div style="display:flex;gap:6px;justify-content:flex-end">${receiptBtn}${markPaidBtn}${editBtn}${delBtn}</div></td>
      </tr>`;
      }).join('');

      return `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:12px;cursor:pointer" onclick="openDrawer('${a.id}')">
          <div class="avatar" style="background:${avatarColor(a.name)}">${escapeHtml(initials(a.name))}</div>
          <div>
            <div style="font-weight:600;font-size:15px">${escapeHtml(a.name)} ${isOtherStatus ? `<span class="badge" style="background:${STATUS[a.status].color}22;color:${STATUS[a.status].color};font-size:10px;vertical-align:middle">${STATUS[a.status].label}</span>` : ''}</div>
            <div style="color:var(--muted);font-size:12px">${escapeHtml(a.work) || "—"}</div>
          </div>
        </div>
        <div style="display:flex;gap:20px;text-align:right;flex-wrap:wrap">
          ${canSeeAmounts ? `<div><div style="font-size:11px;color:var(--muted)">Ödenen</div><div style="font-weight:700;color:#37c98a">${paidSum.toLocaleString('tr-TR')} ₺</div></div>
          <div><div style="font-size:11px;color:var(--muted)">Bekleyen</div><div style="font-weight:700;color:#f4b740">${pendingSum.toLocaleString('tr-TR')} ₺</div></div>` : ''}
          <div><div style="font-size:11px;color:var(--muted)">Taksit</div><div style="font-weight:700">${paid.length}/${payments.length}</div></div>
          <button class="btn ghost" style="padding:6px 10px" onclick="openPayModal('${a.id}')" title="Ödeme Ekle">+ Ödeme</button>
          <button class="btn ghost" style="padding:6px 10px" onclick="openExtraServiceModal('${a.id}')" title="Ekstra Hizmet Ekle">+ Ekstra Hizmet</button>
        </div>
      </div>
      ${payments.length ? `<div class="pay-table"><table style="width:100%;text-align:left;border-collapse:collapse;font-size:13px;min-width:520px">
        <tr class="pay-table-head" style="border-bottom:1px solid var(--line);color:var(--muted)">
          <th style="padding:8px;font-weight:600">Tarih</th>${canSeeAmounts ? '<th style="padding:8px;font-weight:600">Tutar</th>' : ''}<th style="padding:8px;font-weight:600">Durum</th><th style="padding:8px;font-weight:600">Not</th><th></th>
        </tr>
        ${rows}
      </table></div>` : `<div class="empty" style="padding:12px 0">Henüz ödeme kaydı yok.</div>`}
    </div>`;
    }

    function renderAccountingList() {
      const el = document.getElementById("accountingListArea");
      if (!el) return;
      const canManagePayments = currentRole === 'admin' || currentRole === 'muhasebe' || currentRole === 'personel';
      const canSeeAmounts = canManagePayments;
      const { displayAuthors } = getAccountingAuthors();

      if (!displayAuthors.length) { el.innerHTML = `<div class="empty">Sözleşmeli yazar bulunamadı.</div>`; return; }

      const hasPaid = a => (a.payments || []).some(p => p.status === "Ödendi");
      const hasMethod = (a, m) => (a.payments || []).some(p => p.method === m);

      let filtered = displayAuthors;
      if (paymentMethodFilter !== 'all') filtered = filtered.filter(a => hasMethod(a, paymentMethodFilter));

      const paidAuthors = filtered.filter(hasPaid);
      const unpaidAuthors = filtered.filter(a => !hasPaid(a));

      let html = `<div class="toolbar" style="gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
    <span class="pill ${paymentStatusTab === 'odeyen' ? 'active' : ''}" style="${paymentStatusTab === 'odeyen' ? 'background:rgba(55,201,138,.15);border-color:#37c98a;color:#37c98a' : ''}" onclick="setPaymentStatusTab('odeyen')">${icon('checkCircle', 13)} Ödemesini Yapanlar (${paidAuthors.length})</span>
    <span class="pill ${paymentStatusTab === 'odemeyen' ? 'active' : ''}" style="${paymentStatusTab === 'odemeyen' ? 'background:rgba(244,183,64,.15);border-color:#f4b740;color:#f4b740' : ''}" onclick="setPaymentStatusTab('odemeyen')">${icon('clock', 13)} Henüz Ödeme Yapmayanlar (${unpaidAuthors.length})</span>
  </div>`;

      html += `<div class="toolbar" style="gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <span class="pill ${paymentMethodFilter === 'all' ? 'active' : ''}" onclick="setPaymentMethodFilter('all')">Tümü</span>
    ${Object.keys(PAYMENT_METHODS).map(key => {
        const isActive = paymentMethodFilter === key;
        return `<span class="pill ${isActive ? 'active' : ''}" style="${isActive ? 'background:rgba(74,168,255,.15);border-color:#4aa8ff;color:#4aa8ff' : ''}" onclick="setPaymentMethodFilter('${key}')">${escapeHtml(PAYMENT_METHODS[key].label)}</span>`;
      }).join('')}
  </div>`;

      const activeList = paymentStatusTab === 'odeyen' ? paidAuthors : unpaidAuthors;
      html += activeList.length ? activeList.map(a => renderAuthorPaymentCard(a, canSeeAmounts, canManagePayments)).join('') : `<div class="empty">Bu grupta yazar yok.</div>`;

      el.innerHTML = html;
    }

    function viewAccounting() {
      backfillPaymentIds();
      const canManagePayments = currentRole === 'admin' || currentRole === 'muhasebe' || currentRole === 'personel';
      const canSeeAmounts = canManagePayments; // personel ödeme durumunu görür ama tutarları görmez
      const { contracted, displayAuthors } = getAccountingAuthors();

      let totalPaid = 0, totalPending = 0, totalVat = 0;
      displayAuthors.forEach(a => (a.payments || []).forEach(p => {
        if (p.status === "Ödendi") { totalPaid += p.amount; totalVat += vatPortion(p); }
        else if (p.status === "Bekliyor") totalPending += p.amount;
      }));

      let html = `<div class="grid stats" style="margin-bottom:16px">
    <div class="card stat"><div class="n">${contracted.length}</div><div class="l">Sözleşmeli yazar</div></div>
    ${canSeeAmounts ? `<div class="card stat"><div class="n">${totalPaid.toLocaleString('tr-TR')} ₺</div><div class="l">Tahsil edilen</div><span class="chip" style="background:rgba(55,201,138,.15);color:#37c98a">Ödendi</span></div>
    <div class="card stat"><div class="n">${totalPending.toLocaleString('tr-TR')} ₺</div><div class="l">Bekleyen ödeme</div><span class="chip" style="background:rgba(244,183,64,.15);color:#f4b740">Bekliyor</span></div>
    <div class="card stat"><div class="n">${totalVat.toLocaleString('tr-TR')} ₺</div><div class="l">Tahsilattaki KDV</div><span class="chip" style="background:rgba(169,155,255,.15);color:#a99bff">%20 KDV</span></div>` : ''}
  </div>`;

      if (canSeeAmounts) {
        html += `<div style="display:flex;justify-content:flex-end;margin-bottom:16px">
    <button class="btn ghost" onclick="exportPaymentsCSV()">${icon('download', 14)} Ödemeleri CSV İndir</button>
  </div>`;
      }

      const alerts = getPaymentAlerts();
      if (alerts.overdue.length || alerts.upcoming.length) {
        const items = [...alerts.overdue, ...alerts.upcoming];
        html += `<div class="card" style="margin-bottom:16px">
    <h4 style="margin:0 0 14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">${icon('bell', 14)} Vadesi Gelen Taksitler ${alerts.overdue.length ? `<span class="badge" style="background:rgba(242,97,122,.2);color:#f2617a">${alerts.overdue.length} gecikmiş</span>` : ""}</h4>
    ${items.map(item => {
          const lbl = item.days < 0 ? `${-item.days} gün gecikti` : item.days === 0 ? "Bugün" : `${item.days} gün sonra`;
          const col = item.days < 0 ? "var(--red)" : item.days <= 2 ? "var(--amber)" : "var(--muted)";
          const reminderText = paymentReminderText(item.author.name, item.payment.amount, item.days);
          return `<div class="mini" onclick="openDrawer('${item.author.id}')" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div><span class="mn">${escapeHtml(item.author.name)}</span><div class="ms">${canSeeAmounts ? item.payment.amount.toLocaleString('tr-TR') + ' ₺' : ''}${item.payment.notes ? (canSeeAmounts ? " • " : "") + escapeHtml(item.payment.notes) : ""}</div></div>
      <div style="display:flex;align-items:center;gap:8px">${waBtn(item.author.phone, reminderText)}<span style="color:${col};font-weight:600;font-size:12px">${lbl}</span></div></div>`;
        }).join("")}
  </div>`;
      }

      if (canSeeAmounts) {
        const monthly = getMonthlyRevenue(6);
        const thisMonth = monthly[monthly.length - 1].total;
        const lastMonth = monthly.length > 1 ? monthly[monthly.length - 2].total : 0;
        const diff = thisMonth - lastMonth;
        const pct = lastMonth > 0 ? Math.round((diff / lastMonth) * 100) : (thisMonth > 0 ? 100 : 0);
        const trendColor = diff >= 0 ? '#37c98a' : '#f2617a';
        const trendArrow = diff >= 0 ? '▲' : '▼';

        html += `<div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <h4 style="margin:0;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">${icon('trendingUp', 14)} Aylık Gelir (Tahsil Edilen)</h4>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:18px;font-weight:700">${thisMonth.toLocaleString('tr-TR')} ₺ <span style="font-weight:400;font-size:12px;color:var(--muted)">bu ay</span></span>
        <span style="font-size:12px;font-weight:600;color:${trendColor}">${trendArrow} %${Math.abs(pct)} geçen aya göre</span>
      </div>
    </div>
    <div style="height:220px"><canvas id="monthlyRevenueChart"></canvas></div>
  </div>`;

        const cashFlow = getCashFlowForecast(6);
        html += `<div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <h4 style="margin:0;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">${icon('calendar', 14)} Nakit Akışı Projeksiyonu (Önümüzdeki 6 Ay)</h4>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:18px;font-weight:700">${cashFlow.grandTotal.toLocaleString('tr-TR')} ₺ <span style="font-weight:400;font-size:12px;color:var(--muted)">beklenen taksit toplamı</span></span>
        ${cashFlow.overdueCount ? `<span style="font-size:12px;font-weight:600;color:var(--red)">${icon('alertTriangle', 12)} ${cashFlow.overdueTotal.toLocaleString('tr-TR')} ₺ gecikmiş (${cashFlow.overdueCount} taksit, projeksiyona dahil değil)</span>` : ''}
      </div>
    </div>
    <div style="height:220px"><canvas id="cashFlowChart"></canvas></div>
  </div>`;

        const breakdown = getPaymentBreakdown(displayAuthors);
        html += `<div class="grid grid-2col" style="gap:16px;margin-bottom:16px">
    <div class="card">
      <h4 style="margin:0 0 14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">${icon('package', 14)} Pakete Göre Tahsilat</h4>
      ${renderBreakdownBars(breakdown.byPackage, ['#7c6cff', '#4aa8ff', '#37c98a', '#9aa1b2'])}
    </div>
    <div class="card">
      <h4 style="margin:0 0 14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">${icon('creditCard', 14)} Ödeme Şekline Göre Tahsilat</h4>
      ${renderBreakdownBars(breakdown.byMethod, ['#f4b740', '#37c98a', '#a99bff', '#9aa1b2'])}
    </div>
  </div>`;
      }

      html += `<div id="accountingListArea"></div>`;
      return html;
    }

    function viewMuhasebe() {
      const isResmi = x => x.resmi !== false; // eski kayıtlarda alan yoksa varsayılan Resmi
      const sumBy = (list, pred) => list.filter(pred).reduce((s, x) => s + (x.amount || 0), 0);

      // Gelir artık ayrı bir liste değil, Ödemeler'deki (yazar ödemeleri)
      // "Ödendi" durumundaki kayıtlardan hesaplanıyor.
      const paidPayments = db.authors.flatMap(a =>
        (a.payments || []).filter(p => p.status === "Ödendi").map(p => ({ ...p, authorName: a.name, authorId: a.id }))
      );

      const resmiGelir = sumBy(paidPayments, isResmi);
      const gayriResmiGelir = sumBy(paidPayments, x => !isResmi(x));
      const resmiGider = sumBy(db.expenses, isResmi);
      const gayriResmiGider = sumBy(db.expenses, x => !isResmi(x));
      const toplamGelir = resmiGelir + gayriResmiGelir;
      const toplamGider = resmiGider + gayriResmiGider;
      const resmiNet = resmiGelir - resmiGider;
      const gayriResmiNet = gayriResmiGelir - gayriResmiGider;
      const genelNet = resmiNet + gayriResmiNet;

      let html = `<div class="grid stats" style="margin-bottom:16px">
    <div class="card stat"><div class="n">${toplamGelir.toLocaleString('tr-TR')} ₺</div><div class="l">Toplam Gelir</div><span class="chip" style="background:rgba(55,201,138,.15);color:#37c98a">Resmi + Gayri Resmi</span></div>
    <div class="card stat"><div class="n">${toplamGider.toLocaleString('tr-TR')} ₺</div><div class="l">Toplam Gider</div><span class="chip" style="background:rgba(242,97,122,.15);color:#f2617a">Resmi + Gayri Resmi</span></div>
    <div class="card stat"><div class="n">${genelNet.toLocaleString('tr-TR')} ₺</div><div class="l">Genel Net</div><span class="chip" style="background:${genelNet >= 0 ? 'rgba(74,168,255,.15);color:#4aa8ff' : 'rgba(242,97,122,.15);color:#f2617a'}">${genelNet >= 0 ? 'Kâr' : 'Zarar'}</span></div>
  </div>`;

      html += `<div class="grid grid-2col" style="gap:16px;margin-bottom:16px">
    <div class="card">
      <h4 style="margin:0 0 14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">Resmi</h4>
      <div class="kv"><span>Gelir</span><span style="color:#37c98a;font-weight:600">${resmiGelir.toLocaleString('tr-TR')} ₺</span></div>
      <div class="kv"><span>Gider</span><span style="color:#f2617a;font-weight:600">${resmiGider.toLocaleString('tr-TR')} ₺</span></div>
      <div class="kv"><span>Net</span><span style="color:${resmiNet >= 0 ? '#4aa8ff' : '#f2617a'};font-weight:700">${resmiNet.toLocaleString('tr-TR')} ₺</span></div>
    </div>
    <div class="card">
      <h4 style="margin:0 0 14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">Gayri Resmi</h4>
      <div class="kv"><span>Gelir</span><span style="color:#37c98a;font-weight:600">${gayriResmiGelir.toLocaleString('tr-TR')} ₺</span></div>
      <div class="kv"><span>Gider</span><span style="color:#f2617a;font-weight:600">${gayriResmiGider.toLocaleString('tr-TR')} ₺</span></div>
      <div class="kv"><span>Net</span><span style="color:${gayriResmiNet >= 0 ? '#4aa8ff' : '#f2617a'};font-weight:700">${gayriResmiNet.toLocaleString('tr-TR')} ₺</span></div>
    </div>
  </div>`;

      const resmiBadge = x => isResmi(x)
        ? `<span class="badge" style="background:rgba(74,168,255,.15);color:#4aa8ff;font-size:10px">Resmi</span>`
        : `<span class="badge" style="background:rgba(244,183,64,.15);color:#f4b740;font-size:10px">Gayri Resmi</span>`;

      html += `<div class="card" style="margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:14px">
      <h4 style="margin:0;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">${icon('trendingUp', 14)} Gelirler</h4>
      <span style="font-size:11px;color:var(--muted)">Ödemeler sekmesindeki tahsil edilmiş ödemelerden hesaplanır</span>
    </div>
    ${paidPayments.length ? paidPayments.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map(x => `<div class="mini" onclick="openDrawer('${x.authorId}')" style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer">
      <div><span class="mn">${escapeHtml(x.authorName)}</span> ${resmiBadge(x)}<div class="ms">${fmtDate(x.date)}${x.serviceName ? ' • ' + escapeHtml(x.serviceName) : (x.package && PACKAGES[x.package] ? ' • ' + escapeHtml(PACKAGES[x.package].label) : '')}</div></div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-weight:600;color:#37c98a">+${x.amount.toLocaleString('tr-TR')} ₺</span>
      </div>
    </div>`).join('') : `<div class="empty">Henüz tahsil edilmiş ödeme yok.</div>`}
  </div>`;

      html += `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:14px">
      <h4 style="margin:0;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">${icon('trendingDown', 14)} Giderler</h4>
      <button class="btn ghost" onclick="openExpenseModal()">+ Gider Ekle</button>
    </div>
    ${db.expenses.length ? db.expenses.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map(x => `<div class="mini" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div><span class="mn">${escapeHtml(x.category)}</span> ${resmiBadge(x)}<div class="ms">${fmtDate(x.date)}${x.description ? ' • ' + escapeHtml(x.description) : ''}</div></div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-weight:600;color:#f2617a">-${x.amount.toLocaleString('tr-TR')} ₺</span>
        <button class="btn ghost" style="padding:4px 8px" onclick="openExpenseModal('${x.id}')" title="Düzenle">${icon('edit', 13)}</button>
        <button class="btn ghost" style="padding:4px 8px" onclick="delExpense('${x.id}')" title="Sil">${icon('trash', 13)}</button>
      </div>
    </div>`).join('') : `<div class="empty">Henüz gider eklenmemiş.</div>`}
  </div>`;

      return html;
    }

    /* ---------- Stok ---------- */
    let stockSearch = "";
    // setStockSearch artık genel render()'ı DEĞİL, sadece #stockResultsList
    // içindeki liste HTML'ini günceller — arama kutusunun kendisi (input
    // elementi) hiç yeniden oluşturulmadığı için yazarken odak (focus) ve
    // imleç konumu asla kaybolmuyor (önceki debounce denemesi render()'ı
    // hâlâ çağırdığı için input yine yeniden yaratılıp odağı kaybediyordu).
    function stockResultsHtml() {
      const list = db.stock.slice().sort((a, b) => a.title.localeCompare(b.title, 'tr'));
      const t = stockSearch.trim().toLowerCase();
      const filtered = t ? list.filter(x => x.title.toLowerCase().includes(t)) : list;
      return filtered.length ? filtered.map(x => `<div class="mini" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div><span class="mn">${escapeHtml(x.title)}</span><div class="ms">${escapeHtml(x.type || 'Kitap')}</div></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-weight:700;color:var(--brand)">${(x.quantity || 0).toLocaleString('tr-TR')} adet</span>
        <button class="btn ghost" style="padding:4px 8px" onclick="openStockModal('${x.id}')" title="Düzenle">${icon('edit', 13)}</button>
        <button class="btn ghost" style="padding:4px 8px" onclick="delStockItem('${x.id}')" title="Sil">${icon('trash', 13)}</button>
      </div>
    </div>`).join('') : `<div class="empty">Kayıt bulunamadı.</div>`;
    }
    function setStockSearch(v) {
      stockSearch = v;
      const el = document.getElementById("stockResultsList");
      if (el) el.innerHTML = stockResultsHtml();
    }
    function viewStock() {
      const totalStock = db.stock.reduce((s, x) => s + (x.quantity || 0), 0);

      let html = `<div class="grid stats" style="margin-bottom:16px">
    <div class="card stat"><div class="n">${db.stock.length}</div><div class="l">Toplam Ürün</div></div>
    <div class="card stat"><div class="n">${totalStock.toLocaleString('tr-TR')}</div><div class="l">Toplam Stok Adedi</div></div>
  </div>`;

      html += `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px">
      <input id="stockSearchInput" placeholder="Kitap ara..." value="${escapeHtml(stockSearch)}" oninput="setStockSearch(this.value)" style="max-width:280px;flex:1">
      <button class="btn" onclick="openStockModal()">+ Kitap Ekle</button>
    </div>
    <div id="stockResultsList">${stockResultsHtml()}</div>
  </div>`;

      return html;
    }
    function openStockModal(id) {
      const x = id ? db.stock.find(s => s.id === id) : null;
      document.getElementById("stockModalTitle").textContent = x ? "Kitabı Düzenle" : "Kitap Ekle";
      document.getElementById("st_id").value = id || "";
      document.getElementById("st_title").value = x ? x.title : "";
      document.getElementById("st_type").value = x ? (x.type || "Kitap") : "Kitap";
      document.getElementById("st_quantity").value = x ? x.quantity : "";
      document.getElementById("stockModal").classList.add("open");
    }
    function closeStockModal() { document.getElementById("stockModal").classList.remove("open"); }
    async function saveStockItem() {
      const id = document.getElementById("st_id").value;
      const title = document.getElementById("st_title").value.trim();
      if (!title) { alert("Kitap adı zorunlu."); return; }
      const type = document.getElementById("st_type").value.trim() || "Kitap";
      const quantity = Math.max(0, parseInt(document.getElementById("st_quantity").value, 10) || 0);

      if (id) {
        await updateStockItem(id, { title, type, quantity });
      } else {
        await createStockItem({ id: uid(), title, type, quantity, created: todayStr() });
      }
      closeStockModal();
      render();
    }
    async function delStockItem(id) {
      if (!(await customConfirm("Bu kitap stok kaydından silinsin mi?"))) return;
      await deleteStockItem(id);
      render();
    }

    /* ---------- Matbaa Paneli ---------- */
    // İki yönlü sevkiyat kaydı: matbaanın bize gönderdikleri (gelen) ve
    // bizim matbaaya gönderdiklerimiz (giden). Durum/sipariş takibi yerine
    // basit bir gelen/giden log tutuyoruz.

    // Matbaadan "gelen" bir kayıt eklendiğinde/düzenlendiğinde/silindiğinde
    // aynı miktarı Dahiliye Stok'taki başlığı birebir eşleşen kitaba
    // yansıtır (stok elle iki kez girilmesin diye). Eşleşen kayıt yoksa
    // ve eklenen miktar pozitifse yeni bir stok kaydı açılır. "giden"
    // yönü (matbaaya gönderdiklerimiz) stoğu hiç etkilemez — çağıran
    // taraf sadece "gelen" için bunu çağırır. Düzenleme/silmede önce
    // eski etkiyi tersine çevirip (negatif delta) sonra yeni etkiyi
    // uygulayarak (pozitif delta) hem miktar düzeltmelerinin hem de
    // başlık/yön değişikliklerinin stoğu doğru yansıtması sağlanır.
    async function applyPrintOrderToStock(title, deltaQuantity) {
      if (!title || !deltaQuantity) return;
      const norm = title.trim().toLowerCase();
      const existing = db.stock.find(s => s.title.trim().toLowerCase() === norm);
      if (existing) {
        const newQty = Math.max(0, (existing.quantity || 0) + deltaQuantity);
        await updateStockItem(existing.id, { quantity: newQty });
      } else if (deltaQuantity > 0) {
        await createStockItem({ id: uid(), title: title.trim(), type: "Kitap", quantity: deltaQuantity, created: todayStr() });
      }
    }

    let matbaaTab = "gelen";
    function setMatbaaTab(t) { matbaaTab = t; render(); }
    function viewMatbaa() {
      const gelen = db.printOrders.filter(o => o.direction === "gelen").sort((a, b) => new Date(b.date) - new Date(a.date));
      const giden = db.printOrders.filter(o => o.direction === "giden").sort((a, b) => new Date(b.date) - new Date(a.date));
      const list = matbaaTab === "gelen" ? gelen : giden;

      let html = `<div class="toolbar" style="gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <span class="pill ${matbaaTab === 'gelen' ? 'active' : ''}" style="${matbaaTab === 'gelen' ? 'background:rgba(74,168,255,.15);border-color:#4aa8ff;color:#4aa8ff' : ''}" onclick="setMatbaaTab('gelen')">${icon('download', 13)} Matbaanın Bize Gönderdikleri (${gelen.length})</span>
    <span class="pill ${matbaaTab === 'giden' ? 'active' : ''}" style="${matbaaTab === 'giden' ? 'background:rgba(55,201,138,.15);border-color:#37c98a;color:#37c98a' : ''}" onclick="setMatbaaTab('giden')">${icon('package', 13)} Bizim Gönderdiklerimiz (${giden.length})</span>
    <button class="btn" style="margin-left:auto" onclick="openPrintOrderModal(null, '${matbaaTab}')">+ Kayıt Ekle</button>
  </div>`;

      html += `<div class="card">
    ${list.length ? list.map(o => `<div class="mini" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div><span class="mn">${escapeHtml(o.title)}</span><div class="ms">${fmtDate(o.date)}${o.note ? ' • ' + escapeHtml(o.note) : ''}</div></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-weight:600">${(o.quantity || 0).toLocaleString('tr-TR')} adet</span>
        <button class="btn ghost" style="padding:4px 8px" onclick="openPrintOrderModal('${o.id}')" title="Düzenle">${icon('edit', 13)}</button>
        <button class="btn ghost" style="padding:4px 8px" onclick="delPrintOrder('${o.id}')" title="Sil">${icon('trash', 13)}</button>
      </div>
    </div>`).join('') : `<div class="empty">Henüz kayıt yok.</div>`}
  </div>`;

      return html;
    }
    function openPrintOrderModal(id, direction) {
      const o = id ? db.printOrders.find(x => x.id === id) : null;
      document.getElementById("printModalTitle").textContent = o ? "Kaydı Düzenle" : "Kayıt Ekle";
      document.getElementById("pr_id").value = id || "";
      document.getElementById("pr_direction").value = o ? o.direction : (direction || "gelen");
      document.getElementById("pr_title").value = o ? o.title : "";
      document.getElementById("pr_quantity").value = o ? o.quantity : "";
      document.getElementById("pr_date").value = o ? o.date : todayStr();
      document.getElementById("pr_note").value = o ? (o.note || "") : "";
      document.getElementById("printOrderModal").classList.add("open");
    }
    function closePrintOrderModal() { document.getElementById("printOrderModal").classList.remove("open"); }
    async function savePrintOrder() {
      const id = document.getElementById("pr_id").value;
      const title = document.getElementById("pr_title").value.trim();
      if (!title) { alert("Kitap / ürün adı zorunlu."); return; }
      const direction = document.getElementById("pr_direction").value;
      const quantity = Math.max(0, parseInt(document.getElementById("pr_quantity").value, 10) || 0);
      const date = document.getElementById("pr_date").value;
      const note = document.getElementById("pr_note").value.trim();

      if (id) {
        const existing = db.printOrders.find(o => o.id === id);
        const oldDirection = existing ? existing.direction : null;
        const oldTitle = existing ? existing.title : null;
        const oldQuantity = existing ? (existing.quantity || 0) : 0;
        await updatePrintOrder(id, { title, direction, quantity, date, note });
        if (oldDirection === "gelen") await applyPrintOrderToStock(oldTitle, -oldQuantity);
        if (direction === "gelen") await applyPrintOrderToStock(title, quantity);
      } else {
        await createPrintOrder({ id: uid(), title, direction, quantity, date, note, created: todayStr() });
        if (direction === "gelen") await applyPrintOrderToStock(title, quantity);
      }
      closePrintOrderModal();
      render();
    }
    async function delPrintOrder(id) {
      if (!(await customConfirm("Bu kayıt silinsin mi?"))) return;
      const existing = db.printOrders.find(x => x.id === id);
      await deletePrintOrder(id);
      if (existing && existing.direction === "gelen") {
        await applyPrintOrderToStock(existing.title, -(existing.quantity || 0));
      }
      render();
    }

    /* ---------- Görevler ---------- */
    function openTaskModal(taskId) {
      const t = taskId ? db.tasks.find(x => x.id === taskId) : null;
      document.getElementById("taskModalTitle").textContent = t ? "Görevi Düzenle" : "Görev Ekle";
      document.getElementById("tsk_id").value = taskId || "";
      document.getElementById("tsk_title").value = t ? t.title : "";
      document.getElementById("tsk_description").value = t ? (t.description || "") : "";
      document.getElementById("tsk_dueDate").value = t ? (t.dueDate || "") : "";
      const sel = document.getElementById("tsk_assignedTo");
      sel.innerHTML = (db.staff || []).map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
      if (t) sel.value = t.assignedTo;
      document.getElementById("taskModal").classList.add("open");
    }
    function closeTaskModal() { document.getElementById("taskModal").classList.remove("open"); }
    async function saveTask() {
      const taskId = document.getElementById("tsk_id").value;
      const title = document.getElementById("tsk_title").value.trim();
      if (!title) { alert("Başlık zorunlu."); return; }
      const assignedTo = document.getElementById("tsk_assignedTo").value;
      if (!assignedTo) { alert("Kime atanacağını seç."); return; }
      const description = document.getElementById("tsk_description").value.trim();
      const dueDate = document.getElementById("tsk_dueDate").value || null;

      if (taskId) {
        const updates = { title, description, assignedTo, dueDate };
        const t = db.tasks.find(x => x.id === taskId);
        if (t) Object.assign(t, updates);
        closeTaskModal();
        render();
        try {
          await firestore.collection("tasks").doc(taskId).update(updates);
        } catch (e) {
          console.error("Güncelleme hatası:", e);
          alert("Görev güncellenemedi. Lütfen internet bağlantınızı kontrol edin.");
        }
        return;
      }

      const task = {
        id: uid(), title, description, assignedTo,
        assignedBy: currentStaffId || "admin",
        dueDate, status: "bekliyor", report: null, completedDate: null,
        created: todayStr()
      };
      db.tasks.unshift(task);
      closeTaskModal();
      render();
      try {
        await firestore.collection("tasks").doc(task.id).set(task);
        sendTaskPush(task); // beklenmez (fire-and-forget) — kayıt akışını yavaşlatmasın
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert("Görev kaydedilemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }
    async function completeTask(taskId) {
      const reportEl = document.getElementById("tsk_report_" + taskId);
      const report = reportEl ? reportEl.value.trim() : "";
      if (!(await customConfirm("Bu görev tamamlandı olarak işaretlensin mi?", "Evet, Tamamlandı"))) return;
      // completionSeen: false — atayan admin bunu Görevler'i (ya da zili)
      // görene kadar "yeni tamamlandı" olarak işaretli kalır. Tarayıcı
      // bildirim izni gerektirmeyen, güvenilir çalışan gösterge bu.
      const updates = { status: "tamamlandı", report: report || null, completedDate: todayStr(), completionSeen: false };
      const t = db.tasks.find(x => x.id === taskId);
      if (t) Object.assign(t, updates);
      render();
      try {
        await firestore.collection("tasks").doc(taskId).update(updates);
      } catch (e) {
        console.error("Güncelleme hatası:", e);
        alert("Görev güncellenemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }
    // Admin Görevler sekmesine girince, henüz "görülmedi" işaretli tüm
    // tamamlanan görevleri görülmüş yapar (zil rozeti buna göre iner).
    async function markMyCompletedTasksSeen() {
      const unseen = db.tasks.filter(t => t.status === "tamamlandı" && t.completionSeen !== true);
      if (!unseen.length) return;
      unseen.forEach(t => { t.completionSeen = true; });
      try {
        const batch = firestore.batch();
        unseen.forEach(t => batch.update(firestore.collection("tasks").doc(t.id), { completionSeen: true }));
        await batch.commit();
      } catch (e) {
        console.error("Görev görülme durumu güncellenemedi:", e);
      }
    }
    async function deleteTask(taskId) {
      if (!(await customConfirm("Bu görev silinsin mi?"))) return;
      db.tasks = db.tasks.filter(x => x.id !== taskId);
      render();
      try {
        await firestore.collection("tasks").doc(taskId).delete();
      } catch (e) {
        console.error("Silme hatası:", e);
        alert("Görev silinemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    }
    let taskTab = "aktif";
    function setTaskTab(t) { taskTab = t; render(); }
    // Ekip görünümünde seçili personel — kartına tıklayınca görevleri
    // açılır, tekrar tıklayınca seçim kalkar (tüm görevler görünür).
    let selectedTaskStaffId = null;
    function selectTaskStaff(id) {
      selectedTaskStaffId = selectedTaskStaffId === id ? null : id;
      render();
    }
    // Görev istatistikleri: başarı yüzdesi = tamamlanan / toplam.
    // Puan: tamamlanan başına 10, son tarihinde/öncesinde bitirilene +5 bonus.
    function taskStatsFor(tasks) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const done = tasks.filter(t => t.status === "tamamlandı");
      const active = tasks.filter(t => t.status !== "tamamlandı");
      const overdue = active.filter(t => t.dueDate && new Date(t.dueDate) < today);
      const onTime = done.filter(t => !t.dueDate || (t.completedDate && new Date(t.completedDate) <= new Date(t.dueDate)));
      const pct = tasks.length ? Math.round(done.length / tasks.length * 100) : 0;
      return { total: tasks.length, done: done.length, active: active.length, overdue: overdue.length, pct, score: done.length * 10 + onTime.length * 5 };
    }
    function viewTasks() {
      const isTaskAdmin = currentRole === "admin";
      const relevantTasks = isTaskAdmin ? db.tasks : db.tasks.filter(t => t.assignedTo === currentStaffId);

      let html = "";
      if (isTaskAdmin) {
        html += `<div style="display:flex;justify-content:flex-end;margin-bottom:16px">
    <button class="btn" onclick="openTaskModal()">${icon('clipboardList', 14)} + Görev Ekle</button>
  </div>`;
      }

      // ---- Toplu analiz — sadece admin görür, hangi sekme açık olursa
      // olsun üstte sabit durur ----
      if (isTaskAdmin) {
        const overall = taskStatsFor(relevantTasks);
        const pctColor = overall.pct >= 70 ? "var(--green)" : overall.pct >= 40 ? "var(--amber)" : "var(--red)";
        const statCard = (label, value, color) => `<div class="card" style="flex:1;min-width:110px;padding:14px 16px;text-align:center;margin-bottom:0">
    <div style="font-size:22px;font-weight:700;color:${color || 'var(--txt)'}">${value}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:2px;text-transform:uppercase;letter-spacing:.5px">${label}</div>
  </div>`;
        html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
    ${statCard("Toplam Görev", overall.total)}
    ${statCard("Aktif", overall.active, "var(--amber)")}
    ${statCard("Geciken", overall.overdue, overall.overdue ? "var(--red)" : "var(--muted)")}
    ${statCard("Tamamlanan", overall.done, "var(--green)")}
    ${statCard("Başarı", "%" + overall.pct, pctColor)}
    ${statCard("Toplam Puan", overall.score, "var(--brand-2)")}
  </div>`;
      }

      if (!relevantTasks.length) {
        return html + `<div class="empty">${isTaskAdmin ? "Henüz görev eklenmemiş." : "Sana atanmış bir görev yok."}</div>`;
      }

      // Seçili personel varsa listeler ona göre süzülür (hem aktif hem tamamlanan)
      const filteredTasks = (isTaskAdmin && selectedTaskStaffId)
        ? relevantTasks.filter(t => t.assignedTo === selectedTaskStaffId)
        : relevantTasks;

      const pending = filteredTasks.filter(t => t.status !== "tamamlandı").sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return new Date(b.created) - new Date(a.created);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      });
      const completed = filteredTasks.filter(t => t.status === "tamamlandı")
        .sort((a, b) => new Date(b.completedDate || b.created) - new Date(a.completedDate || a.created));

      const today = new Date(); today.setHours(0, 0, 0, 0);

      const taskCard = t => {
        const assigneeName = staffName(t.assignedTo) || "—";
        let dueBadge = "";
        if (t.dueDate && t.status !== "tamamlandı") {
          const days = Math.round((new Date(t.dueDate) - today) / 864e5);
          const col = days < 0 ? "var(--red)" : days <= 2 ? "var(--amber)" : "var(--muted)";
          const lbl = days < 0 ? `${-days} gün gecikti` : days === 0 ? "Bugün" : `${days} gün kaldı`;
          dueBadge = `<span style="color:${col};font-weight:600;font-size:12px">${icon('calendar', 12)} ${fmtDate(t.dueDate)} • ${lbl}</span>`;
        } else if (t.dueDate) {
          dueBadge = `<span style="color:var(--muted);font-size:12px">${icon('calendar', 12)} ${fmtDate(t.dueDate)}</span>`;
        }

        const statusBadge = t.status === "tamamlandı"
          ? `<span class="badge" style="background:rgba(55,201,138,.15);color:#37c98a">${icon('checkCircle', 12)} Tamamlandı</span>`
          : `<span class="badge" style="background:rgba(244,183,64,.15);color:#f4b740">${icon('clock', 12)} Bekliyor</span>`;

        let actionArea = "";
        if (t.status !== "tamamlandı" && t.assignedTo === currentStaffId) {
          actionArea = `<div style="margin-top:10px">
        <textarea id="tsk_report_${t.id}" placeholder="Tamamlandığında kısa bir rapor yaz (opsiyonel)..." style="min-height:60px"></textarea>
        <button class="btn" style="margin-top:6px" onclick="completeTask('${t.id}')">${icon('checkCircle', 14)} Tamamlandı Olarak İşaretle</button>
      </div>`;
        } else if (t.status === "tamamlandı" && t.report) {
          actionArea = `<div style="margin-top:10px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:13px">
        <div style="color:var(--muted);font-size:11px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Rapor</div>
        ${escapeHtml(t.report)}
      </div>`;
        }

        const editBtn = (isTaskAdmin && t.status !== "tamamlandı") ? `<button class="btn ghost" style="padding:6px 8px" onclick="openTaskModal('${t.id}')" title="Düzenle">${icon('edit', 13)}</button>` : "";
        const deleteBtn = isTaskAdmin ? `<button class="btn ghost" style="padding:6px 8px;color:var(--red)" onclick="deleteTask('${t.id}')" title="Sil">${icon('trash', 13)}</button>` : "";

        return `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px">${escapeHtml(t.title)}</div>
          ${t.description ? `<div style="color:var(--muted);font-size:13px;margin-top:2px">${escapeHtml(t.description)}</div>` : ""}
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${statusBadge}
            ${isTaskAdmin ? `<span style="font-size:12px;color:var(--muted)">${icon('user', 12)} ${escapeHtml(assigneeName)}</span>` : ""}
            ${dueBadge}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">${editBtn}${deleteBtn}</div>
      </div>
      ${actionArea}
    </div>`;
      };

      // ---- Ekip kartları (sadece admin) — avatar + başarı yüzdesi halkası ----
      if (isTaskAdmin && (db.staff || []).length) {
        const ringCard = s => {
          const st = taskStatsFor(relevantTasks.filter(t => t.assignedTo === s.id));
          const initials = (s.name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
          const ringColor = !st.total ? "var(--muted)" : st.pct >= 70 ? "var(--green)" : st.pct >= 40 ? "var(--amber)" : "var(--red)";
          const r = 26, c = 2 * Math.PI * r;
          const offset = c * (1 - st.pct / 100);
          const selected = selectedTaskStaffId === s.id;
          return `<div onclick="selectTaskStaff('${s.id}')" class="card" style="margin-bottom:0;width:150px;padding:14px 10px;text-align:center;cursor:pointer;transition:all .2s;${selected ? 'border-color:var(--brand-2);box-shadow:0 0 0 2px rgba(59,130,246,.25), 0 8px 24px rgba(59,130,246,.15)' : ''}">
      <div style="position:relative;display:inline-block">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="${r}" stroke="var(--line)" stroke-width="4" fill="none"/>
          <circle cx="32" cy="32" r="${r}" stroke="${ringColor}" stroke-width="4" fill="none"
            stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
            stroke-linecap="round" transform="rotate(-90 32 32)"/>
          <text x="32" y="38" text-anchor="middle" font-size="17" font-weight="700" fill="var(--txt)">${escapeHtml(initials)}</text>
        </svg>
        <span style="position:absolute;bottom:-4px;right:-8px;background:${ringColor};color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,.3)">%${st.pct}</span>
      </div>
      <div style="font-size:13px;font-weight:600;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.name)}</div>
      <div style="display:flex;justify-content:center;gap:8px;margin-top:6px;font-size:11px">
        <span style="color:var(--amber)" title="Aktif görev">${icon('clock', 10)} ${st.active}</span>
        ${st.overdue ? `<span style="color:var(--red)" title="Geciken">${icon('alertTriangle', 10)} ${st.overdue}</span>` : ""}
        <span style="color:var(--green)" title="Tamamlanan">${icon('checkCircle', 10)} ${st.done}</span>
      </div>
      <div style="font-size:11px;color:var(--brand-2);font-weight:700;margin-top:4px" title="Başarı puanı: tamamlama 10p + zamanında bitirme 5p">★ ${st.score} puan</div>
    </div>`;
        };
        html += `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px">${db.staff.map(ringCard).join("")}</div>`;
      }

      html += `<div class="toolbar" style="gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <span class="pill ${taskTab === 'aktif' ? 'active' : ''}" style="${taskTab === 'aktif' ? 'background:rgba(244,183,64,.15);border-color:#f4b740;color:#f4b740' : ''}" onclick="setTaskTab('aktif')">${icon('clock', 13)} Aktif (${pending.length})</span>
    <span class="pill ${taskTab === 'tamamlanan' ? 'active' : ''}" style="${taskTab === 'tamamlanan' ? 'background:rgba(55,201,138,.15);border-color:#37c98a;color:#37c98a' : ''}" onclick="setTaskTab('tamamlanan')">${icon('checkCircle', 13)} Tamamlanan (${completed.length})</span>
    ${isTaskAdmin && selectedTaskStaffId ? `<span class="pill" style="border-color:var(--brand-2);color:var(--brand-2)" onclick="selectTaskStaff('${selectedTaskStaffId}')">${escapeHtml(staffName(selectedTaskStaffId) || "")} ✕</span>` : ""}
  </div>`;

      const list = taskTab === "aktif" ? pending : completed;
      const emptyMsg = isTaskAdmin && selectedTaskStaffId
        ? (taskTab === "aktif" ? "Bu personelin aktif görevi yok." : "Bu personelin tamamlanan görevi yok.")
        : (taskTab === "aktif" ? "Aktif görev yok." : "Henüz tamamlanan görev yok.");
      html += list.length ? list.map(taskCard).join("") : `<div class="empty">${emptyMsg}</div>`;

      return html;
    }

    // Bir yazarın "Telefon" tipindeki görüşme kayıtları arasında en az bir
    // BAŞARILI (ulaşılan) görüşme var mı? Metinde "açmadı/ulaşılamadı/
    // cevapsız/meşgul/kapalı" gibi ulaşılamama ifadelerinden biri geçiyorsa
    // o kayıt "ulaşılamadı" sayılır — bunlardan hiç farklısı yoksa (ya da
    // hiç Telefon kaydı yoksa) null/false döner. Elle girilen özet
    // metnine dayandığı için kesin değil, ama mevcut veriyle (yapı
    // değişikliği gerektirmeden) hemen kullanılabilir bir yaklaşım.
    const UNREACHED_CALL_RE = /(cevap\s*verme|cevapsız|cevapsiz|ulaşılamad|ulasilamad|ulaşamad|ulasamad|aç[mı]ad|ac[mı]ad|açık değil|acik degil|kapalı|kapali|meşgul|mesgul)/i;
    function unreachedCallStatus(logs) {
      const phoneLogs = (logs || []).filter(l => l.type === "Telefon");
      if (!phoneLogs.length) return null; // hiç arama denemesi yok — değerlendirme dışı
      return !phoneLogs.some(l => !UNREACHED_CALL_RE.test(l.text || ""));
    }
    function getUnreachedAuthors() {
      return db.authors.filter(a => {
        if (a.status === "sozlesme" || a.status === "yayinda" || a.status === "arsiv") return false;
        return unreachedCallStatus(a.logs) === true;
      });
    }

    function viewFollowups() {
      const t = searchTerm();
      const matchSearch = a =>
        !t || (a.name + " " + (a.genres || []).join(" ") + " " + (a.work || "") + " " + (a.notes || "") + " " + (a.phone || "")).toLowerCase().includes(t);

      const list = db.authors.filter(a => {
        if (a.status === "sozlesme" || a.status === "yayinda" || a.status === "arsiv") return false;
        if (!matchSearch(a)) return false;
        const hasFollowup = a.followup && a.followup.trim();
        const hasUpcomingInterview = a.interviewDate && a.interviewTime && daysUntil(a.interviewDate) >= 0;
        return hasFollowup || hasUpcomingInterview;
      }).sort((x, y) => {
        const dateX = x.followup || x.interviewDate;
        const dateY = y.followup || y.interviewDate;
        return new Date(dateX) - new Date(dateY);
      });

      // "Hiç ulaşılamayanlar" bağımsız bir küme — takip/randevu tarihi
      // olmasa bile (hatta HİÇBİRİ olmasa bile) telefonla hiç ulaşılamamış
      // adaylar burada görünmeli, bu yüzden `list`'ten değil tüm yazar
      // havuzundan hesaplanıyor.
      const unreached = getUnreachedAuthors().filter(matchSearch);

      if (!list.length && !unreached.length) return `<div class="empty">Planlanmış takip yok.</div>`;

      const overdue = [], today = [], upcoming = [], randevular = [];
      list.forEach(a => {
        const dFollow = daysUntil(a.followup);
        const dInterview = (a.interviewDate && a.interviewTime) ? daysUntil(a.interviewDate) : null;
        if (a.interviewTime) randevular.push(a);

        if (dFollow !== null && dFollow < 0) {
          overdue.push(a);
        } else {
          const d = (dFollow !== null) ? dFollow : dInterview;
          if (d === 0) today.push(a);
          else if (d !== null && d > 0) upcoming.push(a);
        }
      });

      if (!['all', 'overdue', 'today', 'upcoming', 'randevu', 'unreached'].includes(filterStatus)) filterStatus = 'all';

      const filterTabs = [
        { id: 'overdue', label: 'Gecikenler', count: overdue.length, color: '#f2617a' },
        { id: 'today', label: 'Bugün', count: today.length, color: '#f4b740' },
        { id: 'upcoming', label: 'Gelecek', count: upcoming.length, color: '#4aa8ff' },
        { id: 'randevu', label: '🕒 Randevular', count: randevular.length, color: '#a99bff' },
        { id: 'unreached', label: '📵 Hiç Ulaşılamayanlar', count: unreached.length, color: '#ff8a5c' }
      ];

      let bar = `<div class="toolbar" style="margin-top:-8px;margin-bottom:20px;gap:10px">`;
      
      const allActive = filterStatus === 'all';
      const allStyle = allActive ? `background: rgba(255,255,255,0.08); border-color: #fff; color: #fff; box-shadow: 0 0 14px rgba(255,255,255,0.15);` : ``;
      bar += `<span class="pill ${allActive ? 'active' : ''}" style="${allStyle}" onclick="setFilter('all')" onmouseover="this.style.borderColor='#fff'" onmouseout="if(!${allActive}) this.style.borderColor='var(--line)'">
          Tümü (${list.length})
        </span>`;

      filterTabs.forEach(t => {
        const isActive = filterStatus === t.id;
        const style = isActive ? `background: ${t.color}15; border-color: ${t.color}; color: ${t.color}; box-shadow: 0 0 14px ${t.color}40;` : ``;
        bar += `<span class="pill ${isActive ? 'active' : ''}" style="${style}" onclick="setFilter('${t.id}')" onmouseover="this.style.borderColor='${t.color}'" onmouseout="if(!${isActive}) this.style.borderColor='rgba(255,255,255,0.08)'">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.color};margin-right:8px;box-shadow:0 0 8px ${t.color}"></span>
          ${t.label} (${t.count})
        </span>`;
      });
      bar += `</div>`;

      let activeList = list;
      if (filterStatus === 'overdue') activeList = overdue;
      else if (filterStatus === 'today') activeList = today;
      else if (filterStatus === 'upcoming') activeList = upcoming;
      else if (filterStatus === 'randevu') activeList = randevular;
      else if (filterStatus === 'unreached') activeList = unreached;

      if (!activeList.length) return bar + `<div class="empty">Bu kategoride kayıt bulunamadı.</div>`;
      const cards = activeList.map(authorCard).join("");
      return bar + `<div class="grid authors">${cards}</div>`;
    }

    /* ---------- Detay Drawer ---------- */
    function openDrawer(id) {
      const a = db.authors.find(x => x.id === id); if (!a) return;
      const st = STATUS[a.status];
      // Sözleşme belgesi: herhangi bir kullanıcı (Sözleşmeli Yazarlar
      // ekranından açılan bu detaydan) paketin sözleşme dosyasını
      // yükleyip/değiştirip indirebilir — admin ayrıcalığı gerekmiyor.
      let contractRowHtml = "";
      if ((a.status === "sozlesme" || a.status === "yayinda") && a.package) {
        const contract = db.packageContracts[a.package];
        contractRowHtml = `<div class="kv"><span>Sözleşme Belgesi</span><span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${contract ? `<a href="#" onclick="downloadPackageContract('${a.package}');return false;" style="color:var(--brand);text-decoration:underline;font-size:12px">${icon('download', 13)} ${escapeHtml(contract.name)}</a>` : `<span style="font-size:12px;color:var(--muted)">Yüklenmedi</span>`}
          <label style="cursor:pointer;color:var(--brand);font-size:11px;text-decoration:underline">
            ${contract ? 'Değiştir' : 'Yükle'}
            <input type="file" style="display:none" onchange="uploadPackageContract('${a.package}', this, 'pkgContractDrawerMsg')" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx">
          </label>
        </span></div>
        <div id="pkgContractDrawerMsg" style="font-size:11px;margin:-6px 0 8px"></div>`;
      }
      const logs = (a.logs || []).map((l, _idx) => ({ ...l, _idx })).sort((p, q) => new Date(q.date) - new Date(p.date));
      const tl = logs.map(l => {
        const sn = staffName(l.staffId);
        return `<div class="tl">
      <div class="tt" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${fmtDate(l.date)}${l.time ? " " + escapeHtml(l.time) : ""}${sn ? ` • <span style="color:var(--blue)">${escapeHtml(sn)}</span>` : ''}</span>
        <span style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn ghost" style="padding:2px 6px" onclick="openLogModal('${a.id}', ${l._idx})" title="Düzenle">${icon('edit', 12)}</button>
          <button class="btn ghost" style="padding:2px 6px" onclick="delLog('${a.id}', ${l._idx})" title="Sil">${icon('trash', 12)}</button>
        </span>
      </div>
      <div class="tx"><span class="type">${escapeHtml(l.type)}</span>${escapeHtml(l.text)}</div>
    </div>`;
      }).join("") || `<div class="empty" style="padding:16px">Henüz görüşme kaydı yok.</div>`;

      const booksHtml = (a.books || []).map(b => {
        const sales = (b.sales || []).slice().sort((p, q) => new Date(q.date) - new Date(p.date));
        const totalCopies = sales.reduce((s, x) => s + (x.copies || 0), 0);
        const totalRevenue = sales.reduce((s, x) => s + (x.revenue || 0), 0);
        const royalty = b.royaltyRate != null ? totalRevenue * b.royaltyRate / 100 : null;
        const salesRows = sales.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line);font-size:12px">
        <div><span style="color:var(--txt)">${fmtDate(s.date)}</span><span style="color:var(--muted)"> • ${s.copies || 0} adet • ${(s.revenue || 0).toLocaleString('tr-TR')} ₺${s.note ? ' • ' + escapeHtml(s.note) : ''}</span></div>
        <button class="btn ghost" style="padding:2px 6px;font-size:11px" onclick="delSale('${a.id}', '${b.id}', '${s.id}')" title="Sil">${icon('trash', 13)}</button>
      </div>`).join('') || `<div class="empty" style="padding:8px 0;font-size:12px">Henüz satış kaydı yok.</div>`;

        return `<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-weight:600;font-size:14px">${escapeHtml(b.title)}</div>
          <div style="color:var(--muted);font-size:11px">${b.publishDate ? fmtDate(b.publishDate) : 'Yayın tarihi girilmemiş'}${b.royaltyRate != null ? ' • %' + b.royaltyRate + ' telif' : ''}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn ghost" style="padding:4px 8px;font-size:11px" onclick="openBookModal('${a.id}', '${b.id}')" title="Düzenle">${icon('edit', 13)}</button>
          <button class="btn ghost" style="padding:4px 8px;font-size:11px" onclick="delBook('${a.id}', '${b.id}')" title="Sil">${icon('trash', 13)}</button>
        </div>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:8px;font-size:12px;flex-wrap:wrap">
        <div><span style="color:var(--muted)">Toplam Satış: </span><b>${totalCopies.toLocaleString('tr-TR')} adet</b></div>
        <div><span style="color:var(--muted)">Ciro: </span><b>${totalRevenue.toLocaleString('tr-TR')} ₺</b></div>
        ${royalty != null ? `<div><span style="color:var(--muted)">Telif: </span><b style="color:#37c98a">${royalty.toLocaleString('tr-TR')} ₺</b></div>` : ''}
      </div>
      ${salesRows}
      <button class="btn ghost" style="margin-top:8px;padding:4px 10px;font-size:12px;width:100%" onclick="openSaleModal('${a.id}', '${b.id}')">+ Satış Kaydı Ekle</button>
    </div>`;
      }).join('') || `<div class="empty" style="padding:16px">Henüz eser eklenmemiş.</div>`;

      const authorFiles = (a.files || []).map((f, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed var(--line);">
          <div style="display:flex; flex-direction:column; gap:4px">
            <div style="font-weight:600; font-size:13px"><a href="#" onclick="downloadFile('${a.id}', ${idx});return false;" style="color:var(--brand);text-decoration:none">${escapeHtml(f.name)}</a></div>
            <div style="font-size:11px; color:var(--muted)">${fmtDate(f.date)} • <span style="color:var(--txt)">${escapeHtml(f.type) || 'Diğer'}</span> • ${(f.size / 1024).toFixed(1)} KB</div>
          </div>
          <button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="delFile('${a.id}', ${idx})" title="Sil">${icon('trash', 14)}</button>
        </div>
      `).join("") || `<div class="empty" style="padding:16px">Henüz dosya eklenmemiş.</div>`;

      document.getElementById("drawer").innerHTML = `
    <div class="dh">
      <button class="close" onclick="closeDrawer()">×</button>
      <div style="display:flex;gap:14px;align-items:center">
        <div class="avatar" style="width:54px;height:54px;font-size:20px;background:${avatarColor(a.name)}">${escapeHtml(initials(a.name))}</div>
        <div><div style="font-size:19px;font-weight:700">${escapeHtml(a.name)}</div>
        <div style="color:var(--muted);font-size:13px">${escapeHtml(a.work) || "—"}</div></div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <span class="badge" style="background:${st.color}22;color:${st.color}">${st.label}</span>
        ${(a.genres || []).map(g => `<span class="tag">${escapeHtml(g)}</span>`).join("")}
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" style="flex:1" onclick="openLogModal('${a.id}')">+ Görüşme</button>
        ${(a.status === "sozlesme" || a.status === "yayinda") ? `<button class="btn" style="flex:1; background:rgba(55,201,138,0.15); border-color:#37c98a; color:#37c98a" onclick="openBookModal('${a.id}')">+ Eser</button>` : ''}
        <button class="btn ghost" onclick="openAuthorModal('${a.id}')">${icon('edit', 15)}</button>
        <button class="btn ghost" onclick="delAuthor('${a.id}')" title="Sil">${icon('trash', 15)}</button>
      </div>
    </div>
    <div class="db">
      <div class="section"><h4>İletişim & Bilgi</h4>
        <div class="kv"><span>E-posta</span><span>${escapeHtml(a.email) || "—"}</span></div>
        <div class="kv"><span>Telefon</span><span style="display:flex;align-items:center;gap:8px">${escapeHtml(a.phone) || "—"} ${waBtn(a.phone)}</span></div>
        ${(a.phone && (a.status === "sozlesme" || a.status === "yayinda")) ? `<div class="kv"><span>Sözleşme Mesajı</span><span><a href="${toWaLink(a.phone, contractConfirmText(a.name, a.package && PACKAGES[a.package] ? PACKAGES[a.package].label : ''))}" target="_blank" style="color:var(--brand);text-decoration:underline;font-size:12px">${icon('smartphone', 13)} Onay Mesajı Gönder</a></span></div>` : ''}
        ${contractRowHtml}
        <div class="kv"><span>Kaynak</span><span>${escapeHtml(a.source) || "—"}</span></div>
        <div class="kv"><span>İlgi düzeyi</span><span>${flameIcon(15).repeat(a.temp || 0) || "—"}</span></div>
        <div class="kv"><span>Görüşme tarihi</span><span>${fmtDate(a.interviewDate)}${a.interviewTime ? " • " + escapeHtml(a.interviewTime) : ""}</span></div>
        <div class="kv"><span>Sonraki takip</span><span>${fmtDate(a.followup)}</span></div>
        ${(a.status === "sozlesme" || a.status === "yayinda" || a.contractDate) ? `<div class="kv"><span>Sözleşme Tarihi</span><span style="color:var(--brand);font-weight:600">${fmtDate(getContractDate(a))}</span></div>` : ''}
        ${a.contractEndDate ? `<div class="kv"><span>Sözleşme Bitiş</span><span>${fmtDate(a.contractEndDate)}</span></div>` : ''}
        <div class="kv"><span>İlk kayıt</span><span>${fmtDate(a.created)}</span></div>
      </div>
      <div class="section"><h4>Notlar</h4>
        <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:13px;line-height:1.5;white-space:pre-wrap">${escapeHtml(a.notes) || "—"}</div>
      </div>

      ${(a.status === "sozlesme" || a.status === "yayinda") ? `<div class="section"><h4>${icon('bookOpen', 15)} Eserler ve Satış (${(a.books || []).length})</h4>
        ${booksHtml}
      </div>` : ''}

      <div class="section"><h4>Dosyalar ve Belgeler (${(a.files || []).length})</h4>
        <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:0 12px">${authorFiles}</div>
      </div>

      <div class="section"><h4>Görüşme Geçmişi (${logs.length})</h4>
        <div class="timeline">${tl}</div>
      </div>
    </div>`;
      document.getElementById("drawer").classList.add("open");
      document.getElementById("overlay").classList.add("open");
    }
    function closeDrawer() { document.getElementById("drawer").classList.remove("open"); document.getElementById("overlay").classList.remove("open"); }

    /* ---------- Yazar CRUD ---------- */
    function openAuthorModal(id) {
      const m = document.getElementById("authorModal");
      const g = v => document.getElementById(v);
      if (id) {
        const a = db.authors.find(x => x.id === id);
        document.getElementById("modalTitle").textContent = "Yazarı Düzenle";
        g("f_id").value = a.id; g("f_name").value = a.name; g("f_status").value = a.status;
        g("f_email").value = a.email || ""; g("f_phone").value = a.phone || "";
        g("f_genres").value = (a.genres || []).join(", "); g("f_temp").value = a.temp || 3;
        g("f_work").value = a.work || ""; g("f_interviewDate").value = a.interviewDate || ""; g("f_interviewTime").value = a.interviewTime || ""; g("f_followup").value = a.followup || ""; g("f_source").value = a.source || "Diğer";
        g("f_notes").value = a.notes || "";
        g("f_package").value = a.package || "";
        g("f_contractDate").value = a.contractDate || getContractDate(a) || "";
        g("f_contractEndDate").value = a.contractEndDate || "";
      } else {
        document.getElementById("modalTitle").textContent = "Yeni Yazar";
        ["f_id", "f_name", "f_email", "f_phone", "f_genres", "f_work", "f_interviewDate", "f_interviewTime", "f_followup", "f_notes", "f_contractDate", "f_contractEndDate"].forEach(v => g(v).value = "");
        g("f_status").value = "aday"; g("f_temp").value = "3"; g("f_source").value = "E-posta başvurusu"; g("f_package").value = "";
      }
      toggleFPackage();
      m.classList.add("open");
    }
    function closeModal() { document.getElementById("authorModal").classList.remove("open"); }
    function toggleFPackage() {
      const show = document.getElementById("f_status").value === "sozlesme" || document.getElementById("f_status").value === "yayinda";
      document.getElementById("f_packageContainer").style.display = show ? "grid" : "none";
      const endEl = document.getElementById("f_contractEndContainer");
      if (endEl) endEl.style.display = show ? "grid" : "none";
    }
    async function saveAuthor() {
      const g = v => document.getElementById(v).value.trim();
      const name = g("f_name");
      if (!name) { alert("Ad Soyad zorunlu."); return; }
      const id = g("f_id");
      const phone = g("f_phone");
      if (phone) {
        const normalizedPhone = normalizePhone(phone);
        const duplicate = db.authors.find(author =>
          author.id !== id &&
          author.phone &&
          normalizePhone(author.phone) === normalizedPhone
        );
        if (duplicate) {
          alert("⚠️ Bu numara ile daha önce zaten görüşülmüş! (\"" + duplicate.name + "\" adlı yazarda kayıtlı.) Aynı numara ikinci kez kaydedilemez.");
          return;
        }
      }
      const oldAuthor = id ? db.authors.find(x => x.id === id) : null;
      const wasContracted = oldAuthor ? oldAuthor.status === "sozlesme" : false;
      const status = g("f_status");
      const today = todayStr();
      const isContractedStatus = status === "sozlesme" || status === "yayinda";

      let contractDate = g("f_contractDate");
      if (!contractDate && isContractedStatus) {
        contractDate = oldAuthor ? getContractDate(oldAuthor) || today : today;
      }
      const contractEndDate = g("f_contractEndDate") || (oldAuthor ? oldAuthor.contractEndDate || null : null);

      const payload = {
        name, status, email: g("f_email"), phone: g("f_phone"),
        genres: g("f_genres").split(",").map(s => s.trim()).filter(Boolean),
        temp: +g("f_temp"), work: g("f_work"), interviewDate: g("f_interviewDate"), interviewTime: g("f_interviewTime") || null, followup: g("f_followup"), source: g("f_source"), notes: g("f_notes"),
        package: g("f_package") || null,
        contractDate: contractDate || null,
        contractEndDate: contractEndDate || null
      };
      const newId = id || uid();
      if (id) {
        await mutateAuthor(id, a => {
          const statusChanged = a.status !== payload.status;
          Object.assign(a, payload);
          if (statusChanged) {
            a.statusHistory = a.statusHistory || [];
            a.statusHistory.push({ status: payload.status, date: today });
          }
        });
      } else {
        payload.id = newId; payload.created = today; payload.logs = []; payload.addedBy = currentStaffId || "admin";
        payload.statusHistory = [{ status: payload.status, date: today }];
        await createAuthor(payload);
      }
      closeModal(); render();
      if (id) openDrawer(id);

      // Yazar yeni sözleşmeli olduysa (durum ilk kez "Sözleşme"ye geçtiyse)
      // ödeme şekli sorulması için ödeme ekranı otomatik açılır; formda
      // seçilen paket buraya otomatik taşınır.
      if (payload.status === "sozlesme" && !wasContracted) {
        openPayModal(newId);
      }
    }
    window.customConfirmResolve = null;
    async function customConfirm(message, confirmLabel) {
      return new Promise(resolve => {
        document.getElementById("customConfirmMessage").textContent = message;
        document.getElementById("customConfirmConfirmBtn").textContent = confirmLabel || "Evet, Sil";
        document.getElementById("customConfirmModal").classList.add("open");
        window.customConfirmResolve = function (result) {
          document.getElementById("customConfirmModal").classList.remove("open");
          resolve(result);
        };
      });
    }

    async function delAuthor(id) {
      if (!(await customConfirm("Bu yazar ve tüm kayıtları silinsin mi?"))) return;
      await deleteAuthorDoc(id);
      closeDrawer(); render();
    }

    /* ---------- Görüşme kaydı ---------- */
    function openLogModal(authorId, logIndex) {
      const isEdit = logIndex !== undefined && logIndex !== null;
      document.getElementById("l_authorId").value = authorId;
      document.getElementById("l_logIndex").value = isEdit ? logIndex : "";
      document.getElementById("logModalTitle").textContent = isEdit ? "Görüşme / Etkileşim Düzenle" : "Görüşme / Etkileşim Ekle";
      document.getElementById("logModalSaveBtn").textContent = isEdit ? "Kaydet" : "Ekle";

      const existing = isEdit ? (db.authors.find(x => x.id === authorId)?.logs || [])[logIndex] : null;

      document.getElementById("l_type").value = existing ? existing.type : "Telefon";
      document.getElementById("l_date").value = existing ? existing.date : todayStr();
      document.getElementById("l_time").value = existing ? (existing.time || "") : "";
      document.getElementById("l_text").value = existing ? existing.text : "";
      // Staff dropdown doldur
      const sel = document.getElementById("l_staff");
      sel.innerHTML = '<option value="">— Seçiniz —</option>' + (db.staff || []).map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.role)})</option>`).join('');

      if (existing) {
        sel.value = existing.staffId || "";
        sel.style.display = "block";
        sel.previousElementSibling.style.display = "block";
      } else if (currentStaffId) {
        sel.value = currentStaffId;
        sel.style.display = "none";
        sel.previousElementSibling.style.display = "none";
      } else {
        sel.style.display = "block";
        sel.previousElementSibling.style.display = "block";
      }

      document.getElementById("logModal").classList.add("open");
    }
    function closeLogModal() { document.getElementById("logModal").classList.remove("open"); }
    async function saveLog() {
      const id = document.getElementById("l_authorId").value;
      const logIndexRaw = document.getElementById("l_logIndex").value;
      const isEdit = logIndexRaw !== "";
      const text = document.getElementById("l_text").value.trim();
      if (!text) { alert("Özet zorunlu."); return; }
      let staffId = document.getElementById("l_staff").value;
      if (!isEdit && currentStaffId) staffId = currentStaffId;
      const logEntry = { type: document.getElementById("l_type").value, date: document.getElementById("l_date").value, time: document.getElementById("l_time").value || null, text, staffId };

      await mutateAuthor(id, a => {
        a.logs = a.logs || [];
        if (isEdit) {
          a.logs[+logIndexRaw] = logEntry;
        } else {
          a.logs.push(logEntry);
          // Görüşme eklemek, "Bugün ilgilenmen gerekenler" listesindeki
          // bekleyen takibin karşılığıdır — takip tarihi bugün/gecikmiş/
          // yakınsa (dashboard'daki esikle ayni, bkz. viewDashboard) artik
          // ele alindigi icin temizlenir. Uzak bir gelecek tarihi olan
          // takipler (henuz sirasi gelmemis) bu genel not eklemeyle
          // bozulmaz.
          const d = daysUntil(a.followup);
          if (d !== null && d <= 3) a.followup = "";
          // Ayni esik, randevu (Görüşme tarihi/saati) icin de gecerli —
          // aksi halde randevusu yaklasan/gecmis bir yazara görüşme notu
          // eklense bile randevu saati "Bugün ilgilenmen gerekenler" ve
          // Takip Listesi'nde asilı kalmaya devam ediyordu.
          const dInt = (a.interviewDate && a.interviewTime) ? daysUntil(a.interviewDate) : null;
          if (dInt !== null && dInt <= 3) { a.interviewDate = ""; a.interviewTime = ""; }
        }
      });
      closeLogModal(); openDrawer(id); render();
    }
    async function delLog(authorId, logIndex) {
      if (!(await customConfirm("Bu görüşme kaydı silinsin mi?"))) return;
      await mutateAuthor(authorId, a => {
        if (a.logs) a.logs.splice(logIndex, 1);
      });
      openDrawer(authorId); render();
    }

    /* ---------- Ödeme Yönetimi ---------- */
    function openPayModal(authorId) {
      let author = null;
      if (authorId) {
        document.getElementById("p_authorId").value = authorId;
        document.getElementById("p_authorSelectContainer").style.display = "none";
        author = db.authors.find(x => x.id === authorId);
      } else {
        document.getElementById("p_authorId").value = "";
        const sel = document.getElementById("p_authorSelect");
        sel.innerHTML = `<option value="">-- Yazar Seçin --</option>` +
          db.authors.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
        document.getElementById("p_authorSelectContainer").style.display = "block";
      }
      // Paket artık burada seçilmiyor: yazarın kaydındaki paketi kullanılır.
      const pkgKey = (author && author.package && PACKAGES[author.package]) ? author.package : "";
      document.getElementById("p_package").value = pkgKey;
      document.getElementById("p_noPackageWarning").style.display = (author && !pkgKey) ? "block" : "none";
      document.getElementById("p_serviceName").value = "";
      document.getElementById("p_method").value = "";
      document.getElementById("p_amount").value = "";
      document.getElementById("p_resmi").value = "true";
      document.getElementById("p_installments").value = "1";
      document.getElementById("p_installmentsContainer").style.display = "none";
      document.getElementById("p_date").value = todayStr();
      document.getElementById("p_notes").value = "";
      document.getElementById("p_status").value = "Ödendi";
      document.getElementById("payModalTitle").textContent = "Ödeme Bilgisi";
      document.getElementById("p_serviceNameContainer").style.display = "none";
      paymentAmountManuallyEdited = false;
      applyPackage();
      document.getElementById("payModal").classList.add("open");
    }
    function openExtraServiceModal(authorId) {
      openPayModal(authorId);
      document.getElementById("p_package").value = "";
      document.getElementById("p_noPackageWarning").style.display = "none";
      document.getElementById("payModalTitle").textContent = "Ekstra Hizmet Ekle";
      document.getElementById("p_serviceNameContainer").style.display = "block";
      applyPackage();
      document.getElementById("p_serviceName").focus();
    }
    function closePayModal() { document.getElementById("payModal").classList.remove("open"); }
    // Kullanıcı tutarı elle değiştirdiyse applyPackage() bunun üzerine
    // tekrar paket fiyatını yazmasın diye (ör. ödeme şekli değiştirince).
    let paymentAmountManuallyEdited = false;
    document.getElementById("p_amount").addEventListener("input", () => { paymentAmountManuallyEdited = true; });
    function applyPackage() {
      const key = document.getElementById("p_package").value;
      const methodKey = document.getElementById("p_method").value;
      const method = PAYMENT_METHODS[methodKey];
      const amountEl = document.getElementById("p_amount");

      if (key && PACKAGES[key] && !paymentAmountManuallyEdited) {
        const pkg = PACKAGES[key];
        const vatIncluded = method ? method.vatIncluded : true;
        amountEl.value = vatIncluded ? pkg.withVat : pkg.noVat;
        document.getElementById("p_notes").value = pkg.label + (method ? " (" + method.label + ")" : "");
      }

      const instEl = document.getElementById("p_installments");
      const instContainer = document.getElementById("p_installmentsContainer");
      if (method && method.installments) {
        instContainer.style.display = "block";
      } else {
        instEl.value = "1";
        instContainer.style.display = "none";
      }
    }
    async function savePayment() {
      let id = document.getElementById("p_authorId").value;
      if (!id) {
        id = document.getElementById("p_authorSelect").value;
        if (!id) { alert("Lütfen yazar seçin."); return; }
      }
      const totalAmount = parseFloat(document.getElementById("p_amount").value.trim());
      if (!totalAmount) { alert("Tutar zorunlu."); return; }
      const installments = Math.min(6, parseInt(document.getElementById("p_installments").value) || 1);

      const baseDate = new Date(document.getElementById("p_date").value);
      const status = document.getElementById("p_status").value;
      const notes = document.getElementById("p_notes").value.trim();
      const methodKey = document.getElementById("p_method").value;
      const method = PAYMENT_METHODS[methodKey];
      const vatIncluded = method ? method.vatIncluded : true;
      const addedBy = currentStaffId || "admin";
      const packageKey = document.getElementById("p_package").value || null;
      const serviceName = document.getElementById("p_serviceName").value.trim() || null;
      const resmi = document.getElementById("p_resmi").value === "true";

      const newPayments = [];
      if (installments > 1) {
        const instAmount = Math.floor(totalAmount / installments);
        const remainder = totalAmount - (instAmount * installments);
        for (let i = 0; i < installments; i++) {
          let d = new Date(baseDate);
          d.setMonth(d.getMonth() + i);
          let instNotes = notes + (notes ? " " : "") + `(${i + 1}/${installments}. Taksit)`;
          let instStatus = i === 0 ? status : "Bekliyor";
          let amt = (i === installments - 1) ? (instAmount + remainder) : instAmount;
          newPayments.push({
            id: uid(), amount: amt, date: d.toISOString().slice(0, 10),
            status: instStatus, notes: instNotes, vatIncluded, addedBy, resmi,
            package: packageKey, method: methodKey || null, serviceName
          });
        }
      } else {
        newPayments.push({
          id: uid(), amount: totalAmount, date: document.getElementById("p_date").value,
          status: status, notes: notes, vatIncluded, addedBy, resmi,
          package: packageKey, method: methodKey || null, serviceName
        });
      }
      await mutateAuthor(id, a => {
        a.payments = a.payments || [];
        a.payments.push(...newPayments);
      });
      closePayModal();
      if (document.getElementById("drawer").classList.contains("open")) openDrawer(id);
      render();
    }
    async function delPayment(authorId, paymentId) {
      if (!(await customConfirm("Ödeme silinsin mi?"))) return;
      await mutateAuthor(authorId, a => {
        a.payments = a.payments.filter(p => p.id !== paymentId);
      });
      if (document.getElementById("drawer").classList.contains("open")) openDrawer(authorId);
      render();
    }
    async function markPaymentPaid(authorId, paymentId) {
      if (!(await customConfirm("Bu taksit/ödeme ödendi olarak işaretlensin mi?", "Evet, Ödendi"))) return;
      await mutateAuthor(authorId, a => {
        const p = a.payments.find(x => x.id === paymentId);
        if (p) p.status = "Ödendi";
      });
      render();
    }
    function openEditPaymentModal(authorId, paymentId) {
      const a = db.authors.find(x => x.id === authorId);
      const p = a && a.payments && a.payments.find(x => x.id === paymentId);
      if (!p) return;
      document.getElementById("ep_authorId").value = authorId;
      document.getElementById("ep_paymentId").value = paymentId;
      document.getElementById("ep_amount").value = p.amount;
      document.getElementById("ep_date").value = p.date;
      document.getElementById("ep_status").value = p.status;
      document.getElementById("ep_method").value = p.method || "";
      document.getElementById("ep_vatIncluded").value = p.vatIncluded === false ? "false" : "true";
      document.getElementById("ep_resmi").value = p.resmi === false ? "false" : "true";
      document.getElementById("ep_notes").value = p.notes || "";
      document.getElementById("ep_serviceName").value = p.serviceName || "";
      document.getElementById("editPaymentModal").classList.add("open");
    }
    function closeEditPaymentModal() { document.getElementById("editPaymentModal").classList.remove("open"); }
    function applyEditPaymentMethod() {
      const method = PAYMENT_METHODS[document.getElementById("ep_method").value];
      if (method) document.getElementById("ep_vatIncluded").value = method.vatIncluded ? "true" : "false";
    }
    async function saveEditPayment() {
      const authorId = document.getElementById("ep_authorId").value;
      const paymentId = document.getElementById("ep_paymentId").value;
      const amount = parseFloat(document.getElementById("ep_amount").value);
      if (!amount) { alert("Tutar zorunlu."); return; }
      const date = document.getElementById("ep_date").value;
      const status = document.getElementById("ep_status").value;
      const method = document.getElementById("ep_method").value || null;
      const vatIncluded = document.getElementById("ep_vatIncluded").value === "true";
      const resmi = document.getElementById("ep_resmi").value === "true";
      const notes = document.getElementById("ep_notes").value.trim();
      const serviceName = document.getElementById("ep_serviceName").value.trim() || null;

      await mutateAuthor(authorId, a => {
        const p = a.payments.find(x => x.id === paymentId);
        p.amount = amount; p.date = date; p.status = status; p.method = method; p.vatIncluded = vatIncluded; p.resmi = resmi; p.notes = notes; p.serviceName = serviceName;
      });
      closeEditPaymentModal();
      if (document.getElementById("drawer").classList.contains("open")) openDrawer(authorId);
      render();
    }

    /* ---------- Giderler (Ön Muhasebe) ---------- */
    function openExpenseModal(expenseId) {
      const x = expenseId ? db.expenses.find(e => e.id === expenseId) : null;
      document.getElementById("expenseModalTitle").textContent = x ? "Gideri Düzenle" : "Gider Ekle";
      document.getElementById("ex_id").value = expenseId || "";
      document.getElementById("ex_amount").value = x ? x.amount : "";
      document.getElementById("ex_date").value = x ? x.date : todayStr();
      document.getElementById("ex_category").value = x ? x.category : "Kira";
      document.getElementById("ex_resmi").value = x ? String(x.resmi !== false) : "true";
      document.getElementById("ex_description").value = x ? (x.description || "") : "";
      document.getElementById("expenseModal").classList.add("open");
    }
    function closeExpenseModal() { document.getElementById("expenseModal").classList.remove("open"); }
    async function saveExpense() {
      const id = document.getElementById("ex_id").value;
      const amount = parseFloat(document.getElementById("ex_amount").value);
      if (!amount) { alert("Tutar zorunlu."); return; }
      const date = document.getElementById("ex_date").value;
      const category = document.getElementById("ex_category").value;
      const resmi = document.getElementById("ex_resmi").value === "true";
      const description = document.getElementById("ex_description").value.trim();

      if (id) {
        await updateExpense(id, { amount, date, category, resmi, description });
      } else {
        await createExpense({
          id: uid(), amount, date, category, resmi, description,
          addedBy: currentStaffId || "admin", created: todayStr()
        });
      }
      closeExpenseModal();
      render();
    }
    async function delExpense(id) {
      if (!(await customConfirm("Bu gider silinsin mi?"))) return;
      await deleteExpenseDoc(id);
      render();
    }

    /* ---------- Dosya Yönetimi ---------- */
    function openFileModal(authorId) {
      if (authorId) {
        document.getElementById("fi_authorId").value = authorId;
        document.getElementById("fi_authorSelectContainer").style.display = "none";
      } else {
        document.getElementById("fi_authorId").value = "";
        const sel = document.getElementById("fi_authorSelect");
        sel.innerHTML = `<option value="">-- Yazar Seçin --</option>` +
          db.authors.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
        document.getElementById("fi_authorSelectContainer").style.display = "block";
      }
      document.getElementById("fi_file").value = "";
      document.getElementById("fi_name").value = "";
      document.getElementById("fi_type").value = "Diğer";
      document.getElementById("fileModal").classList.add("open");
    }
    function closeFileModal() { document.getElementById("fileModal").classList.remove("open"); }
    async function saveFile() {
      let id = document.getElementById("fi_authorId").value;
      if (!id) {
        id = document.getElementById("fi_authorSelect").value;
        if (!id) { alert("Lütfen yazar seçin."); return; }
      }
      const fileInput = document.getElementById("fi_file");
      const name = document.getElementById("fi_name").value.trim();
      const type = document.getElementById("fi_type").value;
      if (!fileInput.files[0]) { alert("Lütfen dosya seçin."); return; }
      const file = fileInput.files[0];
      if (!name) { alert("Lütfen dosya adı/açıklaması girin."); return; }
      if (file.size > 2 * 1024 * 1024) { alert("Dosya boyutu 2MB'den büyük olamaz."); return; }

      const btn = document.getElementById("fi_saveBtn");
      btn.disabled = true; btn.innerHTML = "Yükleniyor...";

      try {
        const fileDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Firebase Firestore 1MB doc limiti aşmamak için chunklara ayırıyoruz
        const chunkSize = 800000;
        const totalChunks = Math.ceil(fileDataUrl.length / chunkSize);
        const fileId = "file_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);

        for (let i = 0; i < totalChunks; i++) {
          const chunkData = fileDataUrl.slice(i * chunkSize, (i + 1) * chunkSize);
          await firestore.collection("crm_files").doc(`${fileId}_${i}`).set({
            data: chunkData,
            index: i,
            fileId: fileId
          });
        }

        const fileMeta = {
          name, size: file.size, date: todayStr(), type,
          isChunked: true, fileId: fileId, totalChunks: totalChunks
        };
        await mutateAuthor(id, a => {
          a.files = a.files || [];
          a.files.push(fileMeta);
        });
        closeFileModal(); openDrawer(id); render();
      } catch (err) {
        console.error("Yükleme Hatası:", err);
        alert("Dosya yüklenirken hata oluştu: " + err.message);
      } finally {
        btn.disabled = false; btn.innerHTML = "Yükle";
      }
    }
    async function delFile(authorId, idx) {
      if (!(await customConfirm("Dosya silinsin mi?"))) return;
      const a = db.authors.find(x => x.id === authorId);
      const f = a.files[idx];
      if (f.isChunked) {
        for(let i=0; i<f.totalChunks; i++) {
          firestore.collection("crm_files").doc(`${f.fileId}_${i}`).delete().catch(e=>console.log(e));
        }
      }
      await mutateAuthor(authorId, da => {
        da.files.splice(idx, 1);
      });
      openDrawer(authorId); render();
    }
    async function downloadFile(authorId, idx) {
      const a = db.authors.find(x => x.id === authorId);
      if (!a || !a.files || !a.files[idx]) return;
      const f = a.files[idx];
      
      if (f.isChunked) {
        let fullData = "";
        try {
          // Chunkları birleştir
          for(let i=0; i<f.totalChunks; i++) {
            const doc = await firestore.collection("crm_files").doc(`${f.fileId}_${i}`).get();
            if(doc.exists) fullData += doc.data().data;
          }
          if(fullData) triggerDownload(fullData, f.name);
          else alert("Dosya verisi bulunamadı.");
        } catch(e) {
          alert("Dosya indirilirken hata: " + e.message);
        }
      } else if (f.url) {
        if (f.url.startsWith("http")) window.open(f.url, "_blank");
        else if (f.url.startsWith("data:")) triggerDownload(f.url, f.name);
      }
    }
    function triggerDownload(dataUrl, name) {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    /* ---------- Paket Sözleşme Şablonları (admin, paket başına tek dosya) ---------- */
    async function uploadPackageContract(packageKey, inputEl, msgElId) {
      const file = inputEl.files[0];
      inputEl.value = "";
      if (!file) return;
      // Gerçek taranmış/çok sayfalı sözleşmeler yazar dosyalarından daha
      // büyük olabileceği için burada daha yüksek bir sınır kullanılıyor.
      if (file.size > 8 * 1024 * 1024) { alert("Dosya boyutu 8MB'den büyük olamaz."); return; }
      const msg = document.getElementById(msgElId || "pkgContractMsg");
      if (msg) { msg.style.color = "var(--muted)"; msg.textContent = "Yükleniyor..."; }

      try {
        const old = db.packageContracts[packageKey];
        const fileDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const chunkSize = 800000;
        const totalChunks = Math.ceil(fileDataUrl.length / chunkSize);
        const fileId = "pkgcontract_" + packageKey + "_" + Date.now();

        for (let i = 0; i < totalChunks; i++) {
          const chunkData = fileDataUrl.slice(i * chunkSize, (i + 1) * chunkSize);
          await firestore.collection("crm_files").doc(`${fileId}_${i}`).set({ data: chunkData, index: i, fileId: fileId });
        }

        await firestore.collection("packageContracts").doc(packageKey).set({
          name: file.name, size: file.size, date: todayStr(),
          fileId, totalChunks
        });

        // Eski dosyanın chunk'larını temizle (varsa)
        if (old && old.fileId) {
          for (let i = 0; i < old.totalChunks; i++) {
            firestore.collection("crm_files").doc(`${old.fileId}_${i}`).delete().catch(() => {});
          }
        }

        if (msg) { msg.style.color = "#37c98a"; msg.textContent = "Yüklendi."; }
        render();
      } catch (e) {
        if (msg) { msg.style.color = "var(--red)"; msg.textContent = "Hata: " + e.message; }
      }
    }
    async function downloadPackageContract(packageKey) {
      const contract = db.packageContracts[packageKey];
      if (!contract) return;
      let fullData = "";
      try {
        for (let i = 0; i < contract.totalChunks; i++) {
          const doc = await firestore.collection("crm_files").doc(`${contract.fileId}_${i}`).get();
          if (doc.exists) fullData += doc.data().data;
        }
        if (fullData) triggerDownload(fullData, contract.name);
        else alert("Dosya verisi bulunamadı.");
      } catch (e) {
        alert("Dosya indirilirken hata: " + e.message);
      }
    }
    async function deletePackageContract(packageKey) {
      const contract = db.packageContracts[packageKey];
      if (!contract) return;
      if (!(await customConfirm("Bu paketin sözleşme dosyası silinsin mi?"))) return;
      for (let i = 0; i < contract.totalChunks; i++) {
        firestore.collection("crm_files").doc(`${contract.fileId}_${i}`).delete().catch(() => {});
      }
      await firestore.collection("packageContracts").doc(packageKey).delete();
      render();
    }

    /* ---------- Eserler ve Satış ---------- */
    function openBookModal(authorId, bookId) {
      const a = db.authors.find(x => x.id === authorId);
      const book = bookId ? (a.books || []).find(b => b.id === bookId) : null;
      document.getElementById("bookModalTitle").textContent = book ? "Eseri Düzenle" : "Eser Ekle";
      document.getElementById("bk_authorId").value = authorId;
      document.getElementById("bk_bookId").value = bookId || "";
      document.getElementById("bk_title").value = book ? book.title : "";
      document.getElementById("bk_publishDate").value = book ? (book.publishDate || "") : "";
      document.getElementById("bk_royaltyRate").value = book && book.royaltyRate != null ? book.royaltyRate : "";
      document.getElementById("bookModal").classList.add("open");
    }
    function closeBookModal() { document.getElementById("bookModal").classList.remove("open"); }
    async function saveBook() {
      const authorId = document.getElementById("bk_authorId").value;
      const bookId = document.getElementById("bk_bookId").value;
      const title = document.getElementById("bk_title").value.trim();
      if (!title) { alert("Kitap adı zorunlu."); return; }
      const publishDate = document.getElementById("bk_publishDate").value;
      const royaltyRateRaw = document.getElementById("bk_royaltyRate").value;
      const royaltyRate = royaltyRateRaw === "" ? null : Math.max(0, Math.min(100, parseFloat(royaltyRateRaw)));

      if (bookId) {
        await mutateAuthor(authorId, a => {
          const b = (a.books || []).find(x => x.id === bookId);
          if (b) { b.title = title; b.publishDate = publishDate; b.royaltyRate = royaltyRate; }
        });
      } else {
        const newBook = { id: uid(), title, publishDate, royaltyRate, sales: [] };
        await mutateAuthor(authorId, a => {
          a.books = a.books || [];
          a.books.push(newBook);
        });
      }
      closeBookModal();
      openDrawer(authorId); render();
    }
    async function delBook(authorId, bookId) {
      if (!(await customConfirm("Bu eser ve tüm satış kayıtları silinsin mi?"))) return;
      await mutateAuthor(authorId, a => {
        a.books = (a.books || []).filter(b => b.id !== bookId);
      });
      openDrawer(authorId); render();
    }

    function openSaleModal(authorId, bookId) {
      document.getElementById("sl_authorId").value = authorId;
      document.getElementById("sl_bookId").value = bookId;
      document.getElementById("sl_date").value = todayStr();
      document.getElementById("sl_copies").value = "";
      document.getElementById("sl_revenue").value = "";
      document.getElementById("sl_note").value = "";
      document.getElementById("saleModal").classList.add("open");
    }
    function closeSaleModal() { document.getElementById("saleModal").classList.remove("open"); }
    async function saveSale() {
      const authorId = document.getElementById("sl_authorId").value;
      const bookId = document.getElementById("sl_bookId").value;
      const date = document.getElementById("sl_date").value;
      const copies = parseInt(document.getElementById("sl_copies").value) || 0;
      const revenue = parseFloat(document.getElementById("sl_revenue").value) || 0;
      if (!copies && !revenue) { alert("Adet veya ciro girin."); return; }
      const note = document.getElementById("sl_note").value.trim();
      const newSale = { id: uid(), date, copies, revenue, note };

      await mutateAuthor(authorId, a => {
        const b = (a.books || []).find(x => x.id === bookId);
        if (b) { b.sales = b.sales || []; b.sales.push(newSale); }
      });
      closeSaleModal();
      openDrawer(authorId); render();
    }
    async function delSale(authorId, bookId, saleId) {
      if (!(await customConfirm("Bu satış kaydı silinsin mi?"))) return;
      await mutateAuthor(authorId, a => {
        const b = (a.books || []).find(x => x.id === bookId);
        if (b) b.sales = (b.sales || []).filter(s => s.id !== saleId);
      });
      openDrawer(authorId); render();
    }

    /* ---------- Ekip Yönetimi ---------- */
    function viewTeam() {
      db.staff = db.staff || [];
      const t = searchTerm();
      const staff = db.staff.filter(s => !t || (s.name + " " + (s.role || "")).toLowerCase().includes(t));
      // Her üyenin istatistikleri
      const stats = staff.map(s => {
        const logs = [];
        const myAuthors = new Set();
        let converted = 0;
        let revenueCollected = 0;
        db.authors.forEach(a => {
          if (a.addedBy === s.id) {
            myAuthors.add(a.id);
            if (a.status === "sozlesme" || a.status === "yayinda") converted++;
          }
          (a.logs || []).forEach(l => {
            if (l.staffId === s.id) {
              logs.push({ ...l, authorName: a.name, authorId: a.id });
              myAuthors.add(a.id);
            }
          });
          (a.payments || []).forEach(p => {
            if (p.addedBy === s.id && p.status === "Ödendi") revenueCollected += p.amount;
          });
        });
        return { ...s, totalLogs: logs.length, authorCount: myAuthors.size, converted, revenueCollected, recentLogs: logs.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3) };
      });

      const addForm = "";

      const pendingApprovalHtml = currentRole === "admin" ? `
    <div class="card" style="margin-bottom:16px;border-color:var(--amber)">
      <h3 style="margin:0 0 12px;font-size:14px;color:var(--amber)">${icon('users', 15)} Kullanıcı Onay Yönetimi</h3>
      <div style="color:var(--muted);font-size:12px;margin-bottom:12px">Kayıt olan kullanıcılar burada listelenir. Onaylamadığınız kullanıcılar sisteme giriş yapamaz.</div>
      <div id="pendingUsersArea">${skeletonRows(2)}</div>
    </div>
  ` : "";

      if (!staff.length) return pendingApprovalHtml + addForm + `<div class="empty">Henüz ekip üyesi eklenmemiş.</div>`;

      const cards = stats.map(s => {
        const recentHtml = s.recentLogs.map(l => `<div style="font-size:11px;color:var(--muted);padding:3px 0;border-bottom:1px dashed var(--line)">${fmtDate(l.date)} • ${escapeHtml(l.authorName)} • <span style="color:var(--txt)">${escapeHtml(l.text.slice(0, 50))}${l.text.length > 50 ? '...' : ''}</span></div>`).join('');
        return `<div class="card" style="margin-bottom:12px">
      <div class="team-card-row" style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div class="team-card-head" style="display:flex;align-items:center;gap:12px;flex:1">
          <div class="avatar" style="background:${avatarColor(s.name)}">${escapeHtml(initials(s.name))}</div>
          <div>
            <div style="font-weight:600;font-size:15px">${escapeHtml(s.name)}</div>
            <div id="roleArea_${s.id}" style="color:var(--muted);font-size:12px">${escapeHtml(s.role) || '—'}</div>
          </div>
        </div>
        <div class="team-card-stats" style="display:flex;gap:20px;text-align:right;flex-wrap:wrap">
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:700;color:var(--brand)">${s.totalLogs}</div>
            <div style="color:var(--muted);font-size:11px">görüşme</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:700;color:var(--blue)">${s.authorCount}</div>
            <div style="color:var(--muted);font-size:11px">yazar</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:700;color:#37c98a">${s.converted}</div>
            <div style="color:var(--muted);font-size:11px">sözleşmeye döndü</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:16px;font-weight:700;color:#f4b740">${s.revenueCollected.toLocaleString('tr-TR')} ₺</div>
            <div style="color:var(--muted);font-size:11px">tahsil edilen</div>
          </div>
        </div>
        <button class="btn ghost team-card-del" onclick="delStaff('${s.id}')" style="padding:6px 10px" title="Sil">${icon('trash', 14)}</button>
      </div>
      ${recentHtml ? `<div style="margin-top:6px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Son görüşmeler</div>${recentHtml}</div>` : ''}
    </div>`;
      }).join('');

      return pendingApprovalHtml + addForm + cards;
    }

    async function addStaff() {
      const name = document.getElementById('st_name').value.trim();
      if (!name) { alert('Ad Soyad zorunlu.'); return; }
      const role = document.getElementById('st_role').value.trim();
      const newStaff = { id: uid(), name, role };
      await mutateStaff(d => { d.staff = d.staff || []; d.staff.push(newStaff); });
      render();
    }
    async function delStaff(id) {
      if (!(await customConfirm('Bu ekip üyesi silinsin mi? Görüşme kayıtlarındaki referanslar kalacaktır.'))) return;
      await mutateStaff(d => { d.staff = (d.staff || []).filter(x => x.id !== id); });
      render();
    }

    /* ---------- Yedek al / yükle ---------- */
    function exportData() {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "mst-crm-yedek-" + todayStr() + ".json";
      a.click();
    }
    function rowsToCsvBlob(rows) {
      const csv = rows.map(r => r.map(cell => {
        const s = String(cell === undefined || cell === null ? "" : cell);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(";")).join("\r\n");
      return new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    }
    function downloadBlob(blob, filename) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    }
    function exportPaymentsCSV() {
      const rows = [["Yazar", "Tarih", "Hizmet", "Tutar", "KDV", "Durum", "Not", "Ekleyen"]];
      db.authors.forEach(a => {
        (a.payments || []).forEach(p => {
          const addedByLabel = p.addedBy === "admin" ? "Sistem Yöneticisi" : (staffName(p.addedBy) || "");
          rows.push([a.name, p.date, p.serviceName || "", p.amount, vatPortion(p), p.status, p.notes || "", addedByLabel]);
        });
      });
      downloadBlob(rowsToCsvBlob(rows), "odemeler-" + todayStr() + ".csv");
    }
    function exportFullBackupExcel() {
      const rows = [["Ad", "Telefon", "E-posta", "Tür", "Durum", "Paket", "Sözleşme Tarihi", "Ödeme Şekli", "Toplam Tahsilat", "Bekleyen Tutar", "Kayıt Tarihi", "Notlar"]];
      db.authors.forEach(a => {
        const payments = a.payments || [];
        const totalPaid = payments.filter(p => p.status === "Ödendi").reduce((s, p) => s + (p.amount || 0), 0);
        const totalPending = payments.filter(p => p.status === "Bekliyor").reduce((s, p) => s + (p.amount || 0), 0);
        const lastMethod = payments.length ? payments[payments.length - 1].method : null;
        const cDateStr = getContractDate(a);
        rows.push([
          a.name, a.phone || "", a.email || "", (a.genres || []).join(", "),
          STATUS[a.status] ? STATUS[a.status].label : (a.status || ""),
          a.package && PACKAGES[a.package] ? PACKAGES[a.package].label : "",
          cDateStr ? fmtDate(cDateStr) : "",
          lastMethod && PAYMENT_METHODS[lastMethod] ? PAYMENT_METHODS[lastMethod].label : "",
          totalPaid, totalPending, a.created ? fmtDate(a.created) : "", a.notes || ""
        ]);
      });
      downloadBlob(rowsToCsvBlob(rows), "mst-crm-yedek-" + todayStr() + ".csv");
    }
    // Not: dosyadaki yazarları/personeli yazar (var olanların üzerine
    // yazar) ama dosyada OLMAYAN, sunucuda hâlâ duran yazarları silmez.
    function importData(e) {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        try {
          const imported = JSON.parse(r.result);
          const authors = imported.authors || [];
          const staffList = imported.staff || [];

          const CHUNK = 450;
          for (let i = 0; i < authors.length; i += CHUNK) {
            const batch = firestore.batch();
            authors.slice(i, i + CHUNK).forEach(a => {
              batch.set(firestore.collection("authors").doc(a.id), a);
            });
            await batch.commit();
          }
          await firestore.collection("crm").doc("staff").set({ staff: staffList });
          alert("Yedek yüklendi.");
        } catch (err) {
          alert("Geçersiz dosya veya yükleme hatası: " + err.message);
        }
      };
      r.readAsText(f); e.target.value = "";
    }

    const ROLE_LABELS = { personel: "Personel", muhasebe: "Muhasebe", admin: "Admin" };
    async function loadPendingUsers() {
      const area = document.getElementById("pendingUsersArea");
      if (!area) return;
      try {
        const snap = await firestore.collection("users").get();
        if (snap.empty) {
          area.innerHTML = '<div class="empty">Henüz kayıt olan kullanıcı yok.</div>';
          return;
        }
        const pending = [];
        snap.forEach(doc => {
          const d = { id: doc.id, ...doc.data() };
          if (d.approved !== true) pending.push(d);
        });

        let html = '';

        if (pending.length) {
          html += '<div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">';
          pending.forEach(d => {
            const statusBadge = `<span style="background:rgba(244,183,64,.15);color:var(--amber);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600">${icon('clock', 12)} Onay Bekliyor</span>`;
            const actions = `<button class="btn" style="padding:5px 12px;font-size:12px" onclick="approveUser('${d.id}')">${icon('check', 13)} Onayla</button>
           <button class="btn ghost" style="padding:5px 10px;font-size:12px;color:var(--red)" onclick="rejectUser('${d.id}')">${icon('xCircle', 13)} Reddet</button>`;
            html += `<div style="display:flex;align-items:center;gap:12px;background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:12px 16px">
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${escapeHtml(d.name) || '—'}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">@${escapeHtml(d.username || d.email)} • ${d.createdAt ? new Date(d.createdAt).toLocaleDateString('tr-TR') : '—'}</div>
        </div>
        ${statusBadge}
        <div style="display:flex;gap:6px">${actions}</div>
      </div>`;
          });
          html += '</div>';
        }

        area.innerHTML = html || '<div class="empty">Onay bekleyen kullanıcı yok.</div>';
      } catch (e) {
        area.innerHTML = '<div class="empty" style="color:var(--red)">Kullanıcılar yüklenemedi: ' + e.message + '</div>';
      }
    }
    async function changeUserRole(userId, newRole) {
      closeRoleModal();
      const confirmText = newRole === 'admin'
        ? "Bu kullanıcıya tam yönetici (admin) yetkisi verilsin mi? Tüm verilere ve ayarlara erişebilir."
        : `Bu kullanıcının rolü "${ROLE_LABELS[newRole]}" olarak değiştirilsin mi?`;
      if (!(await customConfirm(confirmText, newRole === 'admin' ? "Evet, Admin Yap" : "Evet, Değiştir"))) {
        return;
      }
      try {
        await firestore.collection("users").doc(userId).update({ role: newRole });
      } catch (e) {
        alert('Rol güncellenemedi: ' + e.message);
      }
      await loadUserManagement();
    }
    // Tarih filtresi modalıyla aynı desen: dinamik oluşturulan bir .modal
    // içine renkli/aktif .btn listesi basılıyor — native <select> yerine bu
    // kullanılıyor çünkü tarayıcılar arası select popup stillendirmesi
    // güvenilir çalışmıyor.
    function openRoleModal(userId, currentRoleVal) {
      const roleColors = { personel: '#4aa8ff', muhasebe: '#f4b740', admin: '#f2617a' };
      let content = `
        <div class="box" style="max-width: 300px; padding: 20px;">
          <h2 style="margin-top:0; font-size:16px;">${icon('users', 15)} Rol Seç</h2>
          <div style="display:flex; flex-direction:column; gap: 8px;">
      `;
      Object.keys(ROLE_LABELS).forEach(r => {
        const isActive = currentRoleVal === r;
        const c = roleColors[r] || '#9aa1b2';
        const style = isActive ? `background:${c}26;border-color:${c};color:${c};` : `justify-content:flex-start;`;
        content += `<button class="btn ${isActive ? '' : 'ghost'}" style="${style} width:100%;" onclick="changeUserRole('${userId}', '${r}')">${ROLE_LABELS[r]}</button>`;
      });
      content += `
          </div>
          <div class="actions" style="margin-top: 16px;">
            <button class="btn ghost" style="width:100%" onclick="closeRoleModal()">Kapat</button>
          </div>
        </div>
      `;
      let m = document.getElementById("roleModal");
      if (!m) {
        m = document.createElement("div");
        m.className = "modal";
        m.id = "roleModal";
        document.body.appendChild(m);
      }
      m.innerHTML = content;
      m.classList.add("open");
    }
    function closeRoleModal() {
      const m = document.getElementById("roleModal");
      if (m) m.classList.remove("open");
    }

    async function approveUser(userId) {
      if (!(await customConfirm('Bu kullanıcıyı onaylamak istediğinize emin misiniz?', 'Evet, Onayla'))) return;
      try {
        const doc = await firestore.collection("users").doc(userId).get();
        const d = doc.data();
        await firestore.collection("users").doc(userId).update({ approved: true });

        // Otomatik olarak Ekip'e de ekle
        if (d && d.name) {
          const clean = str => str.toLowerCase().replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/\s+/g, '');
          const newStaffMember = { id: uid(), name: d.name, role: "Personel", userId: userId };
          await mutateStaff(state => {
            state.staff = state.staff || [];
            const existing = state.staff.find(s => clean(s.name) === clean(d.name));
            if (existing) existing.userId = existing.userId || userId;
            else state.staff.push(newStaffMember);
          });
        }

        render();
        await loadPendingUsers();
        await loadUserManagement();
      } catch (e) { alert('Hata: ' + e.message); }
    }

    async function rejectUser(userId) {
      if (!(await customConfirm('Bu kullanıcıyı silmek/engellemek istediğinize emin misiniz?', 'Evet, Sil'))) return;
      try {
        await firestore.collection("users").doc(userId).delete();
        render();
        await loadPendingUsers();
      } catch (e) { alert('Hata: ' + e.message); }
    }



    async function initApp() {
      const loginFormHtml = document.getElementById("loginScreen").innerHTML;
      
      const authReady = new Promise(resolve => {
        const unsub = auth.onAuthStateChanged(() => { unsub(); resolve(true); });
      });
      const timeout = new Promise(resolve => setTimeout(() => resolve(false), 10000));
      
      const ok = await Promise.race([authReady, timeout]);

      if (!ok) {
        document.getElementById("loginScreen").innerHTML = `
          <div style="text-align:center;max-width:280px">
            <div style="color:var(--red);font-weight:600;margin-bottom:8px">Bağlantı kurulamadı</div>
            <div style="color:var(--muted);font-size:13px;margin-bottom:16px">İnternet bağlantınızı kontrol edip tekrar deneyin.</div>
            <button class="btn" onclick="location.reload()">Tekrar Dene</button>
          </div>`;
        return;
      }

      document.getElementById("loginScreen").innerHTML = loginFormHtml;
      setupAuthListener();
    }

    /* ---------- AI Asistan (CRM içi sohbet) ---------- */
    const CHAT_WORKER_URL = "https://yazar-crm-whatsapp-webhook.mst-ajans.workers.dev/chat";
    const USER_ADMIN_WORKER_URL = "https://yazar-crm-whatsapp-webhook.mst-ajans.workers.dev/admin/update-user";
    const USER_ADMIN_DELETE_WORKER_URL = "https://yazar-crm-whatsapp-webhook.mst-ajans.workers.dev/admin/delete-user";
    const USER_ADMIN_CREATE_WORKER_URL = "https://yazar-crm-whatsapp-webhook.mst-ajans.workers.dev/admin/create-user";
    const NOTIFY_TASK_WORKER_URL = "https://yazar-crm-whatsapp-webhook.mst-ajans.workers.dev/notify-task";

    function toggleChatWidget() {
      const panel = document.getElementById("chatPanel");
      const dock = document.getElementById("chatFabDock");
      const isOpen = panel.style.display !== "none";
      panel.style.display = isOpen ? "none" : "flex";
      if (isOpen) {
        dock.style.right = "-42px";
      } else {
        dock.style.right = "24px";
        document.getElementById("chatFabBubble").style.opacity = "0";
        document.getElementById("chatInput").focus();
      }
    }

    // Buton normalde köşede yarı gizli duruyor, çok yer kaplamasın diye.
    // Belirli aralıklarla kısa bir süreliğine dışarı çıkıp bir mesaj
    // gösteriyor, sonra tekrar geri çekiliyor — kullanıcı unutmasın diye.
    let chatFabPeekInterval = null;
    function peekChatFab() {
      const dock = document.getElementById("chatFabDock");
      const bubble = document.getElementById("chatFabBubble");
      const panel = document.getElementById("chatPanel");
      if (panel.style.display === "flex") return; // sohbet zaten açıksa dokunma
      dock.style.right = "24px";
      bubble.style.opacity = "1";
      bubble.style.transform = "translateX(0)";
      setTimeout(() => {
        if (panel.style.display === "flex") return;
        bubble.style.opacity = "0";
        bubble.style.transform = "translateX(8px)";
        dock.style.right = "-42px";
      }, 3500);
    }
    function startChatFabPeek() {
      stopChatFabPeek();
      setTimeout(peekChatFab, 4000);
      chatFabPeekInterval = setInterval(peekChatFab, 25000);
    }
    function stopChatFabPeek() {
      if (chatFabPeekInterval) { clearInterval(chatFabPeekInterval); chatFabPeekInterval = null; }
    }

    function buildChatContext() {
      const all = db.authors || [];
      const authors = all.map(a => {
        const payments = a.payments || [];
        const totalPaid = payments.filter(p => p.status === "Ödendi").reduce((s, p) => s + (p.amount || 0), 0);
        const totalPending = payments.filter(p => p.status === "Bekliyor").reduce((s, p) => s + (p.amount || 0), 0);
        return {
          name: a.name, status: a.status, source: a.source || null, package: a.package || null,
          ilgiDuzeyi: a.temp || null, created: a.created || null, takipTarihi: a.followup || null,
          totalPaid, totalPending, addedBy: a.addedBy || null
        };
      });
      const staff = (db.staff || []).map(s => ({ name: s.name, role: s.role }));

      // Sayım/toplam sorularında modelin listeyi elle sayıp yanlış sonuç
      // vermesini önlemek için, doğru sayıları CRM'in kendisi burada
      // önceden hesaplayıp "stats" olarak veriyoruz.
      const countByStatus = {};
      const countBySource = {};
      let totalPaidAll = 0, totalPendingAll = 0;
      all.forEach(a => {
        countByStatus[a.status] = (countByStatus[a.status] || 0) + 1;
        const src = a.source || "Belirtilmemiş";
        countBySource[src] = (countBySource[src] || 0) + 1;
      });
      authors.forEach(a => { totalPaidAll += a.totalPaid; totalPendingAll += a.totalPending; });

      const stats = {
        toplamYazarSayisi: all.length,
        durumaGoreSayi: countByStatus,
        kaynagaGoreSayi: countBySource,
        toplamTahsilEdilen: totalPaidAll,
        toplamBekleyenOdeme: totalPendingAll,
        personelSayisi: staff.length
      };

      // Tarih hesaplarını (kaç gün gecikti, kaç gün kaldı) modele
      // bırakmıyoruz — CRM zaten bunun için kullandığı mantığı burada da
      // kullanıp hazır, doğru listeler olarak veriyor.
      const alerts = getPaymentAlerts();
      const gecikenOdemeler = alerts.overdue.map(x => ({
        yazar: x.author.name, tutar: x.payment.amount, kacGunGecikti: -x.days
      }));
      const yaklasanOdemeler = alerts.upcoming.map(x => ({
        yazar: x.author.name, tutar: x.payment.amount, kacGunKaldi: x.days
      }));
      const ilgilenilmesiGerekenler = all
        .filter(a => { const d = daysUntil(a.followup); return d !== null && d <= 3; })
        .map(a => ({ yazar: a.name, takipTarihi: a.followup, kacGun: daysUntil(a.followup) }));

      return {
        today: todayStr(), stats,
        gecikenOdemeler, yaklasanOdemeler, ilgilenilmesiGerekenler,
        authors, staff
      };
    }

    // Sohbet geçmişi, hesaba özel (uid'ye göre) localStorage'da saklanır —
    // aynı bilgisayarı kullanan farklı personelin geçmişi birbirine karışmaz.
    let chatHistoryData = [];
    function chatHistoryKey() {
      return "chatHistory_" + (auth.currentUser ? auth.currentUser.uid : "anon");
    }
    function persistChatHistory() {
      try { localStorage.setItem(chatHistoryKey(), JSON.stringify(chatHistoryData)); } catch (e) { /* depolama dolu/kapalı olabilir, sessizce geç */ }
    }
    let chatHistoryRestored = false;
    function restoreChatHistory() {
      if (chatHistoryRestored) return; // birden fazla çağrılırsa mesajlar tekrarlanmasın
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(chatHistoryKey()) || "[]"); } catch (e) { saved = []; }
      if (!saved.length) return;
      chatHistoryRestored = true;
      const suggestions = document.getElementById("chatSuggestions");
      if (suggestions) suggestions.remove();
      chatHistoryData = [];
      saved.forEach(m => addChatMessage(m.role, m.text, false));
    }

    function addChatMessage(role, text, save) {
      const container = document.getElementById("chatMessages");
      const bubble = document.createElement("div");
      bubble.style.cssText = role === "user"
        ? "align-self:flex-end;background:var(--brand);color:#fff;padding:8px 12px;border-radius:12px 12px 2px 12px;max-width:85%;font-size:13px;white-space:pre-wrap"
        : "align-self:flex-start;background:var(--panel-2);color:var(--txt);padding:8px 12px;border-radius:12px 12px 12px 2px;max-width:85%;font-size:13px;white-space:pre-wrap";
      bubble.textContent = text;
      container.appendChild(bubble);
      container.scrollTop = container.scrollHeight;
      if (save !== false) {
        chatHistoryData.push({ role, text });
        persistChatHistory();
      }
      return bubble;
    }

    function addLoadingCatBubble() {
      const container = document.getElementById("chatMessages");
      const bubble = document.createElement("div");
      bubble.style.cssText = "align-self:flex-start;background:var(--panel-2);color:var(--txt);padding:12px 18px;border-radius:12px 12px 12px 2px;max-width:85%";
      bubble.innerHTML = `<div class="cat-loader walking" style="display:flex;flex-direction:column;align-items:center;width:40px">
        <div class="cat-icon" style="font-size:28px;line-height:1;display:block;filter:brightness(0) invert(1)">🐈</div>
        <div class="cat-shadow" style="width:22px;height:5px;border-radius:50%;background:#000;margin-top:2px"></div>
      </div>`;
      container.appendChild(bubble);
      container.scrollTop = container.scrollHeight;
      return bubble;
    }

    function askSuggestion(text) {
      document.getElementById("chatInput").value = text;
      sendChatMessage();
    }

    async function sendChatMessage() {
      const input = document.getElementById("chatInput");
      const question = input.value.trim();
      if (!question) return;
      input.value = "";
      const suggestions = document.getElementById("chatSuggestions");
      if (suggestions) suggestions.remove();
      addChatMessage("user", question);
      const sendBtn = document.getElementById("chatSendBtn");
      sendBtn.disabled = true;
      const loadingBubble = addLoadingCatBubble();
      const catLoader = loadingBubble.querySelector(".cat-loader");

      let finalText;
      try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch(CHAT_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
          body: JSON.stringify({ question, context: buildChatContext() })
        });
        const data = await resp.json();
        finalText = resp.ok ? data.answer : ("Hata: " + (data.error || "Bilinmeyen hata"));
      } catch (e) {
        finalText = "Bağlantı hatası: " + e.message;
      } finally {
        // Kedi bir anda yere yığılıp kaybolsun, sonra gerçek cevap belirsin.
        catLoader.className = "cat-loader collapsing";
        await new Promise(r => setTimeout(r, 550));
        loadingBubble.textContent = finalText;
        chatHistoryData.push({ role: "assistant", text: finalText });
        persistChatHistory();
        sendBtn.disabled = false;
      }
    }

    // --- TEMALAR (AÇIK / KOYU TEMA SİSTEMİ) ---
    function updateLogoSources(theme) {
      const isLight = (theme === 'light') || (document.documentElement.getAttribute('data-theme') === 'light');
      const logoSrc = isLight ? 'logo.jpeg' : 'logo-dark.png';
      document.querySelectorAll('.mark img, .topbar-mark img').forEach(img => {
        if (img.src && !img.src.includes(logoSrc)) {
          img.src = logoSrc;
        }
      });
    }

    // Saat 07:00-19:00 arası açık (beyaz), 19:00-07:00 arası koyu tema
    // otomatik uygulanır. Kullanıcı butonla elle değiştirirse bu seçim
    // bir sonraki saat sınırına (07:00 veya 19:00) kadar korunur, o sınır
    // geçildiğinde otomatik moda geri döner — sonsuza kadar elle sabit
    // kalmaz (bkz. kullanıcı tercihi).
    const THEME_LIGHT_START_HOUR = 7;
    const THEME_LIGHT_END_HOUR = 19;
    function getAutoTheme() {
      const h = new Date().getHours();
      return (h >= THEME_LIGHT_START_HOUR && h < THEME_LIGHT_END_HOUR) ? 'light' : 'dark';
    }
    function getNextThemeBoundary() {
      const now = new Date();
      for (const h of [THEME_LIGHT_START_HOUR, THEME_LIGHT_END_HOUR]) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0, 0);
        if (d > now) return d;
      }
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, THEME_LIGHT_START_HOUR, 0, 0, 0);
    }

    let themeCheckTimer = null;
    function initTheme() {
      const overrideUntil = parseInt(localStorage.getItem('crm_theme_override_until') || '0', 10);
      const manualTheme = localStorage.getItem('crm_theme_manual');
      if (manualTheme && Date.now() < overrideUntil) {
        applyTheme(manualTheme);
      } else {
        localStorage.removeItem('crm_theme_manual');
        localStorage.removeItem('crm_theme_override_until');
        applyTheme(getAutoTheme());
      }
      // Sekme açık kaldığı sürece saat sınırlarını (07:00/19:00) ve
      // elle-seçim süresinin dolup dolmadığını periyodik kontrol eder.
      clearTimeout(themeCheckTimer);
      themeCheckTimer = setTimeout(initTheme, 60000);
    }

    function toggleTheme() {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const theme = isLight ? 'dark' : 'light';
      applyTheme(theme);
      localStorage.setItem('crm_theme_manual', theme);
      localStorage.setItem('crm_theme_override_until', String(getNextThemeBoundary().getTime()));
    }

    function applyTheme(theme) {
      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      updateThemeToggleBtn();
      updateLogoSources(theme);
    }

    function updateThemeToggleBtn() {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const btn = document.getElementById('themeToggleBtn');
      if (btn) {
        if (isLight) {
          // Açık temadayız -> Geceye geçiş ikonu (Ay)
          btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
        } else {
          // Koyu temadayız -> Gündüze geçiş ikonu (Güneş)
          btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
        }
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTheme);
    } else {
      initTheme();
    }

    // --- MST INTRO SPLASH SCREEN ---
    function dismissMstIntro() {
      const intro = document.getElementById('mstIntroScreen');
      if (intro && intro.style.display !== 'none') {
        intro.style.opacity = '0';
        intro.style.transform = 'scale(1.05)';
        setTimeout(() => {
          intro.style.display = 'none';
        }, 600);
      }
    }
    setTimeout(dismissMstIntro, 1850);

    /* --- TOPLU MESAJ GÖNDERİMİ (PREMIUM UI) --- */
    let bulkMessageTargets = [];
    let bulkMessageCurrentIndex = 0;
    
    // Şablon Metinleri
    const BULK_TEMPLATES = {
      bayram: "Merhaba {isim},\n\nBayramınızı en içten dileklerimle kutlar, sevdiklerinizle birlikte sağlıklı ve mutlu bir bayram geçirmenizi dileriz.",
      hatirlatma: "Merhaba {isim},\n\nNasılsınız? Uzun zamandır görüşemiyoruz, müsait olduğunuzda durum değerlendirmesi yapmak isteriz.",
      sozlesme: "Sayın {isim},\n\nSözleşme sürecinizle ilgili bir bilgilendirme yapmak için iletişime geçiyoruz. Detaylar için lütfen dönüş yapınız."
    };

    window.bulkMessageTempList = []; // Filtrelenmiş tüm liste
    
    function openBulkMessageModal() {
      if (!window.lastRenderedContractsList || window.lastRenderedContractsList.length === 0) {
        alert("Bu listede yazar bulunmuyor.");
        return;
      }
      
      const allWithPhone = window.lastRenderedContractsList.filter(a => a.phone && a.phone.trim().length > 5);
      
      if (allWithPhone.length === 0) {
        alert("Bu listedeki yazarların geçerli bir telefon numarası bulunmuyor.");
        return;
      }
      
      window.bulkMessageTempList = allWithPhone;
      
      const modal = document.getElementById("bulkMessageModal");
      if (modal) modal.classList.add("open");
      
      // Arayüzü Sıfırla
      document.getElementById("bulkMessageInputArea").style.display = "block";
      document.getElementById("bulkMessageProgressArea").style.display = "none";
      document.getElementById("bulkTemplateSelect").value = "";
      document.getElementById("bulkMessageText").value = "";
      document.getElementById("bulkMessageSearch").value = "";
      
      renderBulkRecipients();
      updateBulkLivePreview();
    }
    
    function renderBulkRecipients(filterText = "") {
      const container = document.getElementById("bulkMessageRecipients");
      if (!container) return;
      
      const search = filterText.toLowerCase().trim();
      let html = "";
      
      window.bulkMessageTempList.forEach((a, i) => {
        const nameMatches = a.name.toLowerCase().includes(search);
        const workMatches = (a.work || "").toLowerCase().includes(search);
        
        if (search && !nameMatches && !workMatches) return;
        
        // Avatar ve Kart Stili
        const ini = initials(a.name);
        const col = avatarColor(a.name);
        const statusLabel = a.status === 'sozlesme' ? 'Sözleşmeli' : (a.status === 'yayinda' ? 'Yayında' : a.status);
        
        html += `
          <label class="bulk-recipient-item" style="display:flex; align-items:center; gap:12px; cursor:pointer; padding:8px; border-radius:6px; border:1px solid transparent; transition:all 0.2s;">
            <input type="checkbox" class="bulk-cb" data-idx="${i}" checked style="accent-color:var(--brand); width:16px; height:16px; cursor:pointer;" onchange="updateBulkSelectedCount()">
            <div style="width:32px; height:32px; border-radius:50%; background:${col}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:12px; flex-shrink:0;">${ini}</div>
            <div style="display:flex; flex-direction:column; overflow:hidden;">
              <span style="font-weight:600; font-size:13px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(a.name)}</span>
              <span style="font-size:11px; color:var(--muted); white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(a.work || "Eser girilmedi")} • ${statusLabel}</span>
            </div>
          </label>
        `;
      });
      
      if (!html) {
         html = `<div class="empty" style="padding:20px 0; font-size:12px;">Aramaya uygun yazar bulunamadı.</div>`;
      }
      
      container.innerHTML = html;
      updateBulkSelectedCount();
    }
    
    function filterBulkRecipients() {
      const val = document.getElementById("bulkMessageSearch").value;
      renderBulkRecipients(val);
    }
    
    function toggleBulkSelectAll() {
      const cbs = document.querySelectorAll(".bulk-cb");
      if(cbs.length === 0) return;
      
      // Eğer hepsi seçiliyse kaldır, değilse hepsini seç
      const allChecked = Array.from(cbs).every(cb => cb.checked);
      cbs.forEach(cb => cb.checked = !allChecked);
      
      updateBulkSelectedCount();
    }
    
    function updateBulkSelectedCount() {
      const selected = document.querySelectorAll(".bulk-cb:checked").length;
      const total = window.bulkMessageTempList.length;
      document.getElementById("bulkMessageSelectedCount").textContent = selected;
      document.getElementById("bulkMessageTotalCount").textContent = total;
      
      // Hover efektleri için
      document.querySelectorAll('.bulk-recipient-item').forEach(item => {
         const cb = item.querySelector('.bulk-cb');
         if (cb && cb.checked) {
           item.style.background = 'var(--bg)';
           item.style.borderColor = 'var(--line)';
         } else {
           item.style.background = 'transparent';
           item.style.borderColor = 'transparent';
         }
      });
    }

    window.insertBulkVariable = function(variable) {
      const textarea = document.getElementById("bulkMessageText");
      if(!textarea) return;
      
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      
      textarea.value = text.substring(0, start) + variable + text.substring(end);
      textarea.focus();
      textarea.selectionEnd = start + variable.length;
      
      updateBulkLivePreview();
    };

    window.applyBulkTemplate = function() {
      const val = document.getElementById("bulkTemplateSelect").value;
      if (val && BULK_TEMPLATES[val]) {
        document.getElementById("bulkMessageText").value = BULK_TEMPLATES[val];
        updateBulkLivePreview();
      }
    };

    window.updateBulkLivePreview = function() {
      const previewEl = document.getElementById("bulkMessagePreview");
      let text = document.getElementById("bulkMessageText").value;
      
      if (!text.trim()) {
        previewEl.innerHTML = `<span style="color:var(--muted)">Lütfen mesaj yazın...</span>`;
        return;
      }
      
      // Önizleme için ilk seçili kişiyi bulalım (eğer arama ile gizlenmemişse bile listeden birini alalım)
      const cbs = document.querySelectorAll(".bulk-cb:checked");
      let mockTarget = window.bulkMessageTempList[0]; // Fallback
      
      if (cbs.length > 0) {
        const idx = parseInt(cbs[0].getAttribute("data-idx"));
        mockTarget = window.bulkMessageTempList[idx];
      }
      
      if (mockTarget) {
        text = text.replace(/{isim}/gi, mockTarget.name);
        text = text.replace(/{telefon}/gi, mockTarget.phone);
      }
      
      previewEl.textContent = text;
    };

    function closeBulkMessageModal() {
      const modal = document.getElementById("bulkMessageModal");
      if (modal) modal.classList.remove("open");
    }
    
    function cancelBulkMessage() {
      // Sadece arayüzü başa döndür
      document.getElementById("bulkMessageProgressArea").style.display = "none";
      document.getElementById("bulkMessageInputArea").style.display = "block";
    }

    function startBulkMessage() {
       const checkboxes = document.querySelectorAll(".bulk-cb:checked");
       if(checkboxes.length === 0) {
         alert("Lütfen gönderim yapılacak en az bir yazar seçin.");
         return;
       }
       
       const msg = document.getElementById("bulkMessageText").value.trim();
       if(!msg) {
         alert("Lütfen gönderilecek mesajı yazın.");
         return;
       }
       
       bulkMessageTargets = [];
       checkboxes.forEach(cb => {
         const idx = parseInt(cb.getAttribute("data-idx"));
         bulkMessageTargets.push(window.bulkMessageTempList[idx]);
       });
       
       bulkMessageCurrentIndex = 0;
       
       // Animasyonlu geçiş
       const inputArea = document.getElementById("bulkMessageInputArea");
       inputArea.style.opacity = "0";
       setTimeout(() => {
         inputArea.style.display = "none";
         inputArea.style.opacity = "1";
         
         const progArea = document.getElementById("bulkMessageProgressArea");
         progArea.style.display = "block";
         
         updateBulkMessageUI();
       }, 200);
    }

    function updateBulkMessageUI() {
      const total = bulkMessageTargets.length;
      const current = bulkMessageCurrentIndex;
      
      const statusEl = document.getElementById("bulkMessageStatusText");
      const currentRecEl = document.getElementById("bulkMessageCurrentRecipient");
      const progressFill = document.getElementById("bulkMessageProgressFill");
      const btnNext = document.getElementById("btnSendNextBulkMessage");
      const btnCancel = document.getElementById("btnCancelBulkMessage");
      
      if (!statusEl || !progressFill || !btnNext) return;
      
      if (current >= total) {
        statusEl.innerHTML = `<span style="color:var(--brand);">🎉 Tüm Gönderimler Tamamlandı!</span>`;
        currentRecEl.innerHTML = `Toplam <b>${total}</b> kişiye mesaj penceresi açıldı.`;
        progressFill.style.width = "100%";
        btnNext.style.display = "none";
        btnCancel.textContent = "Kapat";
        btnCancel.onclick = closeBulkMessageModal;
        return;
      }
      
      const target = bulkMessageTargets[current];
      statusEl.innerHTML = `İşlem Devam Ediyor...`;
      currentRecEl.innerHTML = `Sıradaki: <b style="color:var(--txt);">${escapeHtml(target.name)}</b> <span style="font-size:13px;">(${current + 1} / ${total})</span>`;
      
      const pct = Math.round((current / total) * 100);
      progressFill.style.width = `${pct}%`;
      
      btnNext.style.display = "inline-block";
      
      if (current === 0) {
        btnNext.textContent = `İlk Gönderimi Başlat (${current + 1}/${total})`;
      } else {
        btnNext.textContent = `Sıradakine Gönder (${current + 1}/${total})`;
      }
    }

    window.openBulkMessageModal = openBulkMessageModal;
    window.closeBulkMessageModal = closeBulkMessageModal;
    window.updateBulkMessageUI = updateBulkMessageUI;
    window.cancelBulkMessage = cancelBulkMessage;
    window.startBulkMessage = startBulkMessage;
    window.filterBulkRecipients = filterBulkRecipients;
    window.toggleBulkSelectAll = toggleBulkSelectAll;
    window.updateBulkSelectedCount = updateBulkSelectedCount;

    window.sendNextBulkMessage = function() {
      if (bulkMessageCurrentIndex >= bulkMessageTargets.length) return;
      
      const target = bulkMessageTargets[bulkMessageCurrentIndex];
      let text = document.getElementById("bulkMessageText").value || "";
      
      // Şablon değişkenlerini değiştirme
      text = text.replace(/{isim}/gi, target.name);
      text = text.replace(/{telefon}/gi, target.phone);
      
      const url = toWaLink(target.phone, text);
      window.open(url, "_blank");
      
      bulkMessageCurrentIndex++;
      updateBulkMessageUI();
    };

    initApp();
