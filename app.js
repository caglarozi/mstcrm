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
    // NOT — burada bir süre enablePersistence({synchronizeTabs:true}) vardı
    // (okuma kotasını düşürmek için) ama 2026-08-05'te GERİ ALINDI:
    //
    // Önbellek açıkken onSnapshot ilk olarak YEREL kopyadan tetikleniyor.
    // loadAuthors/loadStock/... içindeki "firstLoad" dalı bu ilk anlık
    // görüntüyü kesin doğru kabul edip db.authors = [...] atamasını yapıyor.
    // Cihazda henüz önbellek yoksa bu görüntü BOŞ geliyor; ekrana boş liste
    // basılıyor ve ardından sunucudan gelen veriyle doldurulması bekleniyor.
    // Kota dolu olduğu için sunucu senkronizasyonu reddedilince liste boş
    // KALIYOR — kullanıcıya bütün kayıtlar silinmiş gibi görünüyor.
    // Önbellek yokken aynı durumda uygulama bunun yerine "Veriler
    // yüklenemedi, sayfayı yenileyin" diyip açıkça hata veriyor.
    //
    // Ayrıca sessiz bir veri kaybı riski: mutateStaff yerel db.staff'ı
    // olduğu gibi sunucuya geri yazıyor — yerel kopya boşken personel
    // listesinde bir işlem yapılırsa liste sunucuda da silinebilirdi.
    //
    // Önbellek tekrar açılacaksa önce load* fonksiyonları ilk anlık
    // görüntüyü snapshot.metadata.fromCache ile ayırt edecek şekilde
    // düzeltilmeli (yani sunucudan gelen ilk görüntü beklenmeli).
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

    /* ---------- Uygulama içi bildirim: alert() yerine toast ----------
     * Tarayıcının "mst-crm.web.app şunu diyor" penceresi, Android uygulaması
     * (TWA) içinde web sitesinden kalma bir görüntü veriyordu. Buradaki tüm
     * alert() çağrıları cevap beklenmeyen bilgi/uyarı mesajı olduğundan
     * (confirm/prompt hiç kullanılmıyor), alert imzası korunarak üstten
     * düşen, kendiliğinden kaybolan uygulama içi bir bildirime çevrildi.
     * Çağıran ~54 yerin hiçbirine dokunulmadı. Tema renkleri CSS
     * değişkenlerinden geldiği için açık/koyu temaya kendiliğinden uyar. */
    (function initToast() {
      let wrap = null;
      function getWrap() {
        if (wrap && document.body.contains(wrap)) return wrap;
        wrap = document.createElement("div");
        wrap.id = "toastWrap";
        wrap.setAttribute("role", "status");
        wrap.style.cssText = "position:fixed;top:calc(12px + env(safe-area-inset-top,0px));left:12px;right:12px;z-index:4000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;";
        document.body.appendChild(wrap);
        return wrap;
      }
      window.alert = function (msg) {
        const t = document.createElement("div");
        t.style.cssText = "pointer-events:auto;cursor:pointer;max-width:560px;width:100%;background:var(--panel);color:var(--txt);border:1px solid var(--line);border-left:3px solid var(--brand);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:0;transform:translateY(-8px);transition:opacity .25s,transform .25s;white-space:pre-line;";
        t.textContent = String(msg);
        getWrap().appendChild(t);
        // requestAnimationFrame değil: TWA arka plandayken rAF durur,
        // toast görünmez kalırdı. setTimeout her durumda işler.
        setTimeout(() => { t.style.opacity = "1"; t.style.transform = "none"; }, 20);
        // Uzun mesaja okumaya yetecek kadar süre; dokununca hemen kapanır.
        const sure = Math.min(9000, 3500 + String(msg).length * 30);
        const zamanlayici = setTimeout(kapat, sure);
        t.onclick = kapat;
        function kapat() {
          clearTimeout(zamanlayici);
          t.style.opacity = "0";
          t.style.transform = "translateY(-8px)";
          setTimeout(() => t.remove(), 260);
        }
      };
    })();

    /* ---------- Veri katmanı (Firebase) ---------- */
    const KEY = "kalem_crm_v1";
    const STATUS = {
      aday: { label: "Aday", color: "#9aa1b2" },
      gorusuluyor: { label: "Görüşülüyor", color: "#4aa8ff" },
      degerlendirme: { label: "Değerlendirmede", color: "#f4b740" },
      eseryaziyor: { label: "Eseri Yazıyor", color: "#c084fc" },
      sozlesme: { label: "Sözleşme", color: "#2563eb" },
      yayinda: { label: "Yayında", color: "#37c98a" },
      arsiv: { label: "Arşiv", color: "#5b6070" }
    };
    const PIPELINE = ["aday", "gorusuluyor", "degerlendirme", "eseryaziyor", "sozlesme", "yayinda"];
    // mstyayincilik.com'daki paket merdiveni (Basamak I-VII + Zirve).
    // withVat sitedeki KDV dahil bedel, noVat %20 KDV'siz karşılığı.
    // Aylık paketlerde tutar, asgari sözleşme süresinin toplamıdır
    // (ödeme ekranına otomatik dolar, elle değiştirilebilir).
    const PACKAGES = {
      sifirpesin: { label: "Sıfır Peşin (Ortak Yayın)", withVat: 0, noVat: 0 },
      dijital: { label: "Dijital Yazar (1.490 ₺/ay · min 6 ay)", withVat: 8940, noVat: 7450 },
      gorunur: { label: "Görünür Yazar (3.490 ₺/ay · min 3 ay)", withVat: 10470, noVat: 8725 },
      kademeli: { label: "Kademeli Yayın", withVat: 19900, noVat: 16583 },
      baslangic: { label: "Başlangıç Yayın", withVat: 29900, noVat: 24917 },
      profbuyume: { label: "Profesyonel Büyüme", withVat: 59900, noVat: 49917 },
      vipint: { label: "VIP Uluslararası (99.900 ₺'den)", withVat: 99900, noVat: 83250 },
      prestij: { label: "Prestij Yazar Markası (179.000 ₺'den)", withVat: 179000, noVat: 149167 },
      // Eski paketler — mevcut kayıtların etiket ve tutarları bozulmasın diye durur:
      vip: { label: "VIP Paket (eski)", withVat: 70800, noVat: 59000 },
      pro: { label: "Profesyonel Paket (eski)", withVat: 42000, noVat: 35000 },
      standart: { label: "Standart Paket (eski)", withVat: 24000, noVat: 20000 }
    };
    const PAYMENT_METHODS = {
      taksit: { label: "Taksit", vatIncluded: true, installments: true },
      nakit: { label: "Nakit", vatIncluded: false, installments: false },
      pesin: { label: "Peşin Kredi Kartı", vatIncluded: true, installments: false }
    };

    let db = { staff: [], authors: [], expenses: [], tasks: [], stock: [], printOrders: [], packageContracts: {}, feedback: [] };
    let currentView = "dashboard";
    // En son hangi ekranın çizildiği — giriş animasyonunun yalnızca ekran
    // değişiminde oynaması için (bkz. render()).
    let sonCizilenGorunum = null;
    let filterStatus = "all";
    let filterDate = "all";
    let authorsGroupBy = "date"; // "date" | "staff" — yazar listesi tarih ya da görüşmeci sütunları halinde gruplanır
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
          showFeedbackFab(true);
          // Balon kısayoldur: kendiliğinden mesaj/ açılma yapmaz, yalnızca tıklanınca açılır.
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
          showFeedbackFab(false);
          stopChatFabPeek();
        }
      });
    }

    function checkLogin() {
      if (auth.currentUser) {
        document.getElementById("loginScreen").style.display = "none";
        document.querySelector(".app").style.display = "grid";
        document.getElementById("chatFabDock").style.display = "flex";
        showFeedbackFab(true);
        restoreChatHistory();
      } else {
        document.getElementById("loginScreen").style.display = "grid";
        document.querySelector(".app").style.display = "none";
        document.getElementById("chatFabDock").style.display = "none";
        showFeedbackFab(false);
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
          // Ortak görevde görevi kimin kapattığı önemli; eski kayıtlarda
          // completedBy yok, o zaman atanan kişiye düşülüyor.
          const doneName = staffName(t.completedBy) || staffName(t.assignedTo) || "—";
          return `<div class="notifItem" onclick="closeTaskNotifDropdown();goToTasksView();" style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:2px">
      <div style="font-size:13px;font-weight:600;color:var(--txt)">${icon('checkCircle', 12)} ${escapeHtml(t.title)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${escapeHtml(doneName)} tamamladı${t.completedDate ? ' • ' + fmtDate(t.completedDate) : ''}${isSharedTask(t) ? ' • ortak görev' : ''}</div>
    </div>`;
        }).join("") + `<div style="border-top:1px solid var(--line);margin-top:4px;padding-top:6px">
      <button class="btn ghost" style="width:100%" onclick="closeTaskNotifDropdown();goToTasksView();">Tümünü Gör</button>
    </div>`;
        return;
      }

      const myPending = (db.tasks || []).filter(t => isTaskFor(t, myTaskId()) && t.status !== "tamamlandı")
        .sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate) - new Date(b.dueDate);
        });
      // Havuzdaki görevler kimseye atanmadığı için myPending'e girmez;
      // ayrı bir satırla duyurulur ki listesi boş olan biri de havuzu görsün.
      const havuzSayisi = (db.tasks || []).filter(havuzdaAktif).length;
      const havuzSatiri = havuzSayisi
        ? `<div class="notifItem" onclick="closeTaskNotifDropdown();goToTasksView();" style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:2px;border:1px dashed #a78bfa">
      <div style="font-size:13px;font-weight:600;color:#a78bfa">${icon('users', 12)} Havuzda ${havuzSayisi} görev bekliyor</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">Üstlenmek için dokun</div>
    </div>` : "";

      if (!myPending.length) {
        dd.innerHTML = havuzSatiri ||
          `<div style="padding:20px 12px;text-align:center;color:var(--muted);font-size:12px">Bekleyen görevin yok.</div>`;
        return;
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      dd.innerHTML = havuzSatiri + myPending.map(t => {
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

    // Açık olan tüm Firestore dinleyicileri. Önceden onSnapshot'ın geri
    // döndürdüğü "aboneliği iptal et" fonksiyonu atılıyordu; load() bir
    // hata yüzünden tekrar denendiğinde (ensureDataLoaded 4 kez deniyor)
    // ilk denemede BAŞARILI olan koleksiyonlara ikinci, üçüncü, dördüncü
    // kez daha dinleyici bağlanıyordu. Her yeni dinleyici koleksiyonun
    // tamamını baştan okuduğu için, kota hatası alındığında okuma sayısı
    // 4 katına çıkıyor ve sorun kendi kendini büyütüyordu. Artık her
    // load() öncesi eskiler kapatılıyor.
    let activeListeners = [];
    function listen(ref, onNext, onError) {
      activeListeners.push(ref.onSnapshot(onNext, onError));
    }
    function stopAllListeners() {
      activeListeners.forEach(unsub => { try { unsub(); } catch (e) { /* zaten kapalı */ } });
      activeListeners = [];
    }

    function loadStaff() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        listen(firestore.collection("crm").doc("staff"), doc => {
          db.staff = doc.exists ? (doc.data().staff || []) : [];
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Personel veri çekme hatası:", err);
          if (firstLoad) reject(err);
        });
      });
    }

    /* ---------- Şikayet & Dilek kutusu (ANONİM) ----------
     * Gönderilerde kimlik bilgisi (staffId/addedBy) BİLEREK tutulmaz —
     * kim gönderdiği hiçbir yerde kaydedilmez. Silme yalnızca admin. */
    function loadFeedback() {
      return new Promise(resolve => {
        let firstLoad = true;
        // Hangi mesajları daha önce gördüğümüz: yeni geleni ayırt etmek
        // için. Dizi uzunluğuna bakmak yetmez — bir mesaj silinirken başka
        // biri eklenirse uzunluk aynı kalır ve bildirim kaçardı.
        let bilinenFeedback = new Set();
        listen(firestore.collection("crm").doc("feedback"), doc => {
          const gelen = doc.exists ? (doc.data().items || []) : [];
          if (!firstLoad) {
            // Kendi yazdığın mesaj için sana bildirim çıkmaz. "Benim mi"
            // bilgisi yalnızca bu tarayıcının localStorage'ında; sunucuya
            // ya da başka bir kullanıcıya hiç gitmiyor, anonimlik bozulmuyor.
            const benimkiler = getMyFeedbackIds();
            gelen.filter(x => x && x.id && !bilinenFeedback.has(x.id) && benimkiler.indexOf(x.id) === -1)
              .forEach(notifyYeniFeedback);
          }
          db.feedback = gelen;
          bilinenFeedback = new Set(gelen.map(x => x && x.id).filter(Boolean));
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Şikayet-dilek dinleyici hatası:", err);
          if (firstLoad) { firstLoad = false; resolve(); }
        });
      });
    }
    async function mutateFeedback(fn) {
      const wrapper = { items: db.feedback || [] };
      fn(wrapper);
      db.feedback = wrapper.items;
      render();
      const ref = firestore.collection("crm").doc("feedback");
      try {
        await firestore.runTransaction(async tx => {
          const doc = await tx.get(ref);
          const server = { items: doc.exists ? (doc.data().items || []) : [] };
          fn(server);
          tx.set(ref, { items: server.items });
        });
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert(dbErrorText(e, "Mesaj kaydedilemedi"));
      }
    }
    function viewFeedback() {
      const items = (db.feedback || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      let html = `<div class="card settings-card" style="max-width:640px;margin-bottom:16px">
    <h3 style="margin:0 0 8px;font-size:14px">📮 Şikayet & Dilek Kutusu</h3>
    <div style="color:var(--muted);font-size:12px;margin-bottom:12px">Buraya yazdıklarınız <b style="color:var(--txt)">tamamen anonimdir</b> — kim gönderdiği hiçbir şekilde kaydedilmez ve kimseye gösterilmez. Çekinmeden yazabilirsiniz.</div>
    <label>Tür</label>
    <select id="fb_type">
      <option value="dilek">💡 Dilek / Öneri</option>
      <option value="sikayet">⚠️ Şikayet</option>
      <option value="talep">📋 Talep</option>
    </select>
    <label style="margin-top:10px">Mesajınız</label>
    <textarea id="fb_text" rows="4" placeholder="Dileğinizi, şikayetinizi ya da talebinizi yazın..." style="width:100%;resize:vertical"></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:12px">
      <button class="btn" onclick="submitFeedback()">Anonim Olarak Gönder</button>
    </div>
  </div>`;

      const myIds = new Set(getMyFeedbackIds());
      const row = f => {
        const sikayet = f.type === "sikayet";
        const cozuldu = f.status === "cozuldu";
        const gorusuluyor = f.status === "gorusuluyor";
        const badge = sikayet
          ? `<span class="badge" style="background:rgba(242,97,122,.15);color:#f2617a;border:1px solid rgba(242,97,122,.4)">⚠️ Şikayet</span>`
          : f.type === "talep"
            ? `<span class="badge" style="background:rgba(167,139,250,.15);color:#a78bfa;border:1px solid rgba(167,139,250,.4)">📋 Talep</span>`
            : `<span class="badge" style="background:rgba(74,168,255,.15);color:#4aa8ff;border:1px solid rgba(74,168,255,.4)">💡 Dilek</span>`;
        const durumBadge = cozuldu
          ? `<span class="badge" style="background:rgba(55,201,138,.15);color:#37c98a;border:1px solid rgba(55,201,138,.4)">✔ Çözüldü</span>`
          : gorusuluyor
            ? `<span class="badge" style="background:rgba(244,183,64,.15);color:#f4b740;border:1px solid rgba(244,183,64,.4)">💬 Görüşülüyor</span>`
            : `<span class="badge" style="background:rgba(154,161,178,.15);color:#9aa1b2;border:1px solid rgba(154,161,178,.4)">Yeni</span>`;
        const adminBtns = currentRole === "admin" ? `
            ${!gorusuluyor && !cozuldu ? `<button class="btn ghost" style="padding:4px 10px;font-size:11px;border-color:rgba(244,183,64,.4);color:#f4b740" onclick="setFeedbackStatus('${f.id}','gorusuluyor')">💬 Görüşülüyor</button>` : ""}
            ${!cozuldu ? `<button class="btn ghost" style="padding:4px 10px;font-size:11px;border-color:rgba(55,201,138,.4);color:#37c98a" onclick="setFeedbackStatus('${f.id}','cozuldu')">✔ Çözüldü</button>` : `<button class="btn ghost" style="padding:4px 10px;font-size:11px" onclick="setFeedbackStatus('${f.id}','gorusuluyor')">↩ Yeniden Aç</button>`}` : "";
        // Gönderen kendi mesajını silebilir — "benim mi" bilgisi yalnızca bu
        // tarayıcının hafızasında tutulur, sunucuda kimlik yine yoktur.
        const ownDelBtn = myIds.has(f.id) ? `<button class="btn ghost" style="padding:4px 8px" onclick="delFeedback('${f.id}')" title="Mesajını sil (yalnızca sen görüyorsun bu butonu)">${icon('trash', 13)}</button>` : "";
        return `<div style="padding:12px 0;border-bottom:1px dashed var(--line);${cozuldu ? 'opacity:.65' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${badge}${durumBadge}<span style="color:var(--muted);font-size:11px">${fmtDate(f.date)}</span>${cozuldu && f.resolvedDate ? `<span style="color:#37c98a;font-size:11px">→ ${fmtDate(f.resolvedDate)} tarihinde çözüldü</span>` : ""}</div>
          <div style="display:flex;gap:6px;flex-shrink:0">${adminBtns}${ownDelBtn}</div>
        </div>
        <div style="font-size:13px;line-height:1.6;white-space:pre-wrap">${escapeHtml(f.text)}</div>
      </div>`;
      };

      const bekleyenTumu = items.filter(f => f.status !== "cozuldu").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      // Talepler kendi bölümünde durur; dilek ve şikayetler kutuda kalır.
      const bekleyenler = bekleyenTumu.filter(f => f.type !== "talep");
      const talepler = bekleyenTumu.filter(f => f.type === "talep");
      const cozulenler = items.filter(f => f.status === "cozuldu").sort((a, b) => (b.resolvedDate || b.date || "").localeCompare(a.resolvedDate || a.date || ""));

      html += `<div class="card" style="max-width:640px;margin-bottom:16px">
    <h3 style="margin:0 0 12px;font-size:14px">${icon('clock', 15)} Kutudakiler (${bekleyenler.length})</h3>`;
      html += bekleyenler.length ? bekleyenler.map(row).join("") : `<div class="empty">Bekleyen dilek/şikayet yok.</div>`;
      html += `</div>`;

      html += `<div class="card" style="max-width:640px;margin-bottom:16px;border-color:rgba(167,139,250,.35)">
    <h3 style="margin:0 0 12px;font-size:14px;color:#a78bfa">📋 Talepler (${talepler.length})</h3>`;
      html += talepler.length ? talepler.map(row).join("") : `<div class="empty">Bekleyen talep yok.</div>`;
      html += `</div>`;

      html += `<div class="card" style="max-width:640px;border-color:rgba(55,201,138,.35)">
    <h3 style="margin:0 0 12px;font-size:14px;color:#37c98a">✔ Çözülenler (${cozulenler.length})</h3>`;
      html += cozulenler.length ? cozulenler.map(row).join("") : `<div class="empty">Henüz çözülen kayıt yok.</div>`;
      html += `</div>`;
      return html;
    }
    const MY_FEEDBACK_KEY = "mstcrm_myFeedback_v1";
    function getMyFeedbackIds() {
      try { return JSON.parse(localStorage.getItem(MY_FEEDBACK_KEY)) || []; } catch (e) { return []; }
    }
    function rememberMyFeedback(id) {
      const l = getMyFeedbackIds();
      l.push(id);
      try { localStorage.setItem(MY_FEEDBACK_KEY, JSON.stringify(l)); } catch (e) { /* engellenmis olabilir */ }
    }
    async function setFeedbackStatus(id, status) {
      if (currentRole !== "admin") return;
      const resolvedDate = status === "cozuldu" ? todayStr() : null;
      await mutateFeedback(d => {
        const f = d.items.find(x => x.id === id);
        if (f) { f.status = status; f.resolvedDate = resolvedDate; }
      });
    }
    // Ortak gönderim çekirdeği: hem Şikayet & Dilek sayfasındaki form hem de
    // her ekranda duran yüzen düğmenin penceresi burayı kullanıyor. İki ayrı
    // kopya olsaydı anonimlik kuralı bir yerde unutulabilirdi.
    async function feedbackKaydet(type, text) {
      if (!text) { alert("Mesaj boş olamaz."); return false; }
      // Kimlik bilgisi bilerek eklenmiyor — gönderi anonim. Yalnızca bu
      // tarayıcı, silme yetkisi için kendi gönderdiklerinin id'sini hatırlar.
      const entry = { id: uid(), type, text, date: todayStr() };
      rememberMyFeedback(entry.id);
      await mutateFeedback(d => { if (!d.items.some(x => x.id === entry.id)) d.items.push(entry); });
      // Kutuyu ekipte HERKES okuyabildiği için bildirim de herkese gider.
      //
      // Gönderen listeden ÇIKARILMAZ — bu bilinçli. Kutu anonim; "herkes
      // hariç bir kişi" şeklinde bir hedef listesi göndermek, o kişinin
      // gönderen olduğunu ele verirdi (küçük ekipte "bildirim almayan kim?"
      // sorusu doğrudan gönderene çıkar). Bu yüzden hedef ayrım yapmadan
      // tüm ekip + yöneticiler. Gönderenin kendi ekranında bildirim
      // çıkmaması ayrıca hallediliyor (bkz. loadFeedback) — o bilgi
      // tarayıcının kendi localStorage'ında, dışarı hiç çıkmıyor.
      sendPush({
        staffIds: (db.staff || []).map(s => s.id).filter(Boolean),
        rol: "admin",
        baslik: FEEDBACK_BILDIRIM_BASLIK[type] || "📮 Yeni mesaj",
        govde: String(text).slice(0, 200),
        etiket: "feedback_" + entry.id
      });
      customAlert("Teşekkürler! 📮", "Mesajınız kutuya anonim olarak bırakıldı.");
      return true;
    }

    async function submitFeedback() {
      await feedbackKaydet(
        document.getElementById("fb_type").value,
        document.getElementById("fb_text").value.trim()
      );
    }

    /* ---------- Her ekranda duran dilek/şikayet düğmesi ----------
     * Kutu daha önce yalnızca kendi sayfasından açılıyordu; menüye girmeyi
     * gerektirdiği için pratikte kullanılmıyordu. Artık yüzen düğme her
     * görünümde duruyor ve pencereyi açıyor. */
    // Üç tür de aynı kutuya düşüyor ama farklı yerlerde toplanıyor: talepler
    // kendi bölümünde listeleniyor (bkz. viewFeedback). Kullanıcı hangisini
    // seçtiğinde ne olacağını bilsin diye kısa bir açıklama gösteriyoruz.
    const FEEDBACK_IPUCU = {
      dilek: "Bir fikriniz ya da öneriniz varsa buraya yazın.",
      sikayet: "Rahatsız olduğunuz bir durumu bildirin. Kişi adı vermek yerine durumu anlatın.",
      talep: "Somut bir isteğiniz varsa (malzeme, izin, düzenleme) buraya yazın — talepler ayrı bir listede toplanır."
    };
    function onFeedbackTypeChange() {
      const el = document.getElementById("fbm_ipucu");
      if (!el) return;
      const tur = document.getElementById("fbm_type").value;
      el.className = tur === "talep" ? "assigneeHint ortak" : "assigneeHint";
      el.textContent = FEEDBACK_IPUCU[tur] || "";
    }

    function openFeedbackModal() {
      document.getElementById("fbm_type").value = "dilek";
      document.getElementById("fbm_text").value = "";
      onFeedbackTypeChange();
      document.getElementById("feedbackModal").classList.add("open");
      // Odağı metin alanına ver: dokunmatikte bir dokunuş kazandırır.
      setTimeout(() => { const t = document.getElementById("fbm_text"); if (t) t.focus(); }, 60);
    }
    function closeFeedbackModal() {
      document.getElementById("feedbackModal").classList.remove("open");
    }
    async function submitFeedbackModal() {
      const ok = await feedbackKaydet(
        document.getElementById("fbm_type").value,
        document.getElementById("fbm_text").value.trim()
      );
      if (ok) closeFeedbackModal();
    }
    function showFeedbackFab(goster) {
      const el = document.getElementById("feedbackFab");
      if (el) el.style.display = goster ? "inline-flex" : "none";
    }
    async function delFeedback(id) {
      // Yalnızca mesajı gönderen silebilir (bu tarayıcıdan gönderilmişse).
      if (!getMyFeedbackIds().includes(id)) return;
      if (!(await customConfirm("Kendi mesajınızı kutudan silmek istiyor musunuz?", "Evet, Sil"))) return;
      await mutateFeedback(d => { d.items = d.items.filter(x => x.id !== id); });
    }

    /* ---------- Güncelleme (bakım) modu ----------
     * Admin, Ayarlar'dan açar; crm/maintenance dokümanı üzerinden TÜM
     * kullanıcıların ekranında anlık olarak "güncelleme yapılıyor, veri
     * kaydetmeyin" uyarısı belirir. Kapatınca uyarı herkesten kalkar. */
    let maintenanceMode = { active: false, message: "" };
    let maintenanceWasActive = false;
    const MAINTENANCE_DEFAULT_MSG = "Şu anda sistemde güncelleme yapılıyor. Lütfen güncelleme bitene kadar YENİ VERİ KAYDETMEYİN — kaydettikleriniz kaybolabilir.";
    function loadMaintenance() {
      return new Promise(resolve => {
        let firstLoad = true;
        listen(firestore.collection("crm").doc("maintenance"), doc => {
          maintenanceMode = doc.exists ? (doc.data() || {}) : {};
          updateMaintenanceBanner();
          if (firstLoad) { firstLoad = false; resolve(); }
        }, err => {
          // Uyarı sistemi çalışmasa bile uygulama açılmaya devam etmeli.
          console.error("Bakım modu dinleyici hatası:", err);
          if (firstLoad) { firstLoad = false; resolve(); }
        });
      });
    }
    function updateMaintenanceBanner() {
      const active = !!maintenanceMode.active;
      let b = document.getElementById("maintenanceBanner");
      if (active) {
        const msg = maintenanceMode.message || MAINTENANCE_DEFAULT_MSG;
        if (!b) {
          b = document.createElement("div");
          b.id = "maintenanceBanner";
          b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:10500;background:linear-gradient(90deg,#b45309,#d97706);color:#fff;padding:10px 16px;text-align:center;font-size:13px;font-weight:600;box-shadow:0 2px 12px rgba(0,0,0,0.4)";
          document.body.appendChild(b);
        }
        b.textContent = "⚠️ " + msg;
        // Mod ilk kez aktifleştiğinde (veya kullanıcı bakım sırasında
        // giriş yaptığında) dikkat çekmek için ayrıca uyarı ekranı çıkar.
        if (!maintenanceWasActive) customAlert("Güncelleme Yapılıyor!", msg);
      } else if (b) {
        b.remove();
        if (maintenanceWasActive) customAlert("Güncelleme Tamamlandı", "Sistem güncellemesi bitti, çalışmaya devam edebilirsiniz.");
      }
      maintenanceWasActive = active;
    }
    async function toggleMaintenanceMode() {
      const newActive = !maintenanceMode.active;
      try {
        await firestore.collection("crm").doc("maintenance").set({
          active: newActive,
          message: "",
          by: currentStaffId || "admin",
          at: new Date().toISOString()
        });
      } catch (e) {
        console.error("Bakım modu yazma hatası:", e);
        alert("Güncelleme modu değiştirilemedi. " + dbErrorText(e, ""));
      }
      render();
    }

    /* ---------- Randevu hatırlatıcısı ----------
     * Bugünün randevularını (interviewDate + interviewTime) yarım dakikada
     * bir kontrol eder; saate 10 dk kala ekranda uyarı çıkarır. Aynı randevu
     * için bir kez uyarır (localStorage'da tutulur, sayfa yenilense de
     * tekrarlamaz). Personel yalnızca kendi görebildiği kayıtlar için uyarılır. */
    const APPT_NOTIFIED_KEY = "mstcrm_apptNotified_v1";
    const APPT_REMIND_BEFORE_MIN = 10;
    function getNotifiedAppts() {
      try { return JSON.parse(localStorage.getItem(APPT_NOTIFIED_KEY)) || {}; } catch (e) { return {}; }
    }
    function markApptNotified(key) {
      const m = getNotifiedAppts();
      m[key] = true;
      // Geçmiş günlerin kayıtlarını temizle ki liste şişmesin
      const today = todayStr();
      Object.keys(m).forEach(k => { const d = k.split("|")[1]; if (d && d < today) delete m[k]; });
      try { localStorage.setItem(APPT_NOTIFIED_KEY, JSON.stringify(m)); } catch (e) { /* dolu olabilir, kritik değil */ }
    }
    function checkAppointmentReminders() {
      if (!db.authors || !db.authors.length) return;
      const now = new Date();
      const today = todayStr();
      const notified = getNotifiedAppts();
      const due = [];
      visibleAuthors().forEach(a => {
        if (!a.interviewDate || !a.interviewTime || a.interviewDate !== today) return;
        const parts = a.interviewTime.split(":");
        const h = +parts[0], m = +parts[1];
        if (isNaN(h) || isNaN(m)) return;
        const t = new Date(); t.setHours(h, m, 0, 0);
        const diffMin = (t - now) / 60000;
        const key = a.id + "|" + a.interviewDate + "|" + a.interviewTime;
        if (diffMin <= APPT_REMIND_BEFORE_MIN && diffMin > -1 && !notified[key]) {
          due.push({ name: a.name, time: a.interviewTime, inMin: Math.max(0, Math.round(diffMin)) });
          markApptNotified(key);
        }
      });
      if (due.length) {
        const lines = due.map(d => '"' + d.name + '" — saat ' + d.time + (d.inMin > 0 ? " (" + d.inMin + " dk sonra)" : " (ŞİMDİ)")).join(" • ");
        customAlert("🔔 Randevu Hatırlatması!", (due.length > 1 ? "Yaklaşan randevularınız: " : "Yaklaşan randevunuz: ") + lines);
      }
    }
    setInterval(checkAppointmentReminders, 30000);

    /* ---------- Gün sonu raporu (20:00) ----------
     * Her gün 20:00'de otomatik açılır (uygulama açıksa; günde bir kez).
     * Paneldeki butonla istenildiği an da görüntülenebilir. Personel yalnızca
     * kendi raporunu, sistem yöneticisi tüm görüşmecilerinkini görür. */
    const EOD_REPORT_KEY = "mstcrm_eodReportShown_v1";
    const EOD_REPORT_HOUR = 20;
    // Kaçırılan aramalar: o gün ulaşılması GEREKTİĞİ halde (takip tarihi o
    // gün ya da geçmiş, veya randevusu o gün) hiç aranmamış adaylar.
    // Arayıp ulaşamadıklarımız sayılmaz — o arama yapılmıştır ve görüşme
    // kaydı olarak zaten "görüşme" sayısına girer.
    function kacirilanAramaYazarlari(staffKey, date) {
      return (db.authors || []).filter(a => {
        if (!["aday", "gorusuluyor", "degerlendirme", "eseryaziyor"].includes(a.status)) return false;
        if ((a.addedBy || "admin") !== staffKey) return false;
        const aranmaliydi = (a.followup && a.followup <= date) || (a.interviewDate === date);
        if (!aranmaliydi) return false;
        return !(a.logs || []).some(l => l.date === date);
      });
    }
    function dailyReportStatsFor(staffKey, date) {
      // O gün bu görüşmecinin "dokunduğu" kayıtlar: o gün ekledikleri +
      // o gün görüşme (log) girdikleri.
      const records = (db.authors || []).filter(a => {
        const createdToday = a.created === date && (a.addedBy || "admin") === staffKey;
        const loggedToday = (a.logs || []).some(l => l.date === date && (l.staffId || "admin") === staffKey);
        return createdToday || loggedToday;
      });
      const olumlu = records.filter(a => a.status === "sozlesme" || a.status === "yayinda").length;
      const olumsuz = records.filter(a => a.status === "arsiv").length;
      const devam = records.length - olumlu - olumsuz;
      const kacirilan = kacirilanAramaYazarlari(staffKey, date).length;
      const sonuclanan = olumlu + olumsuz;
      const basari = sonuclanan > 0 ? Math.round(olumlu / sonuclanan * 100) : null;
      return { gorusme: records.length, kacirilan, olumlu, olumsuz, devam, basari };
    }
    // Sayılar "kaç görüşme yapıldı" der; bu döküm "NE konuşuldu" der — gün
    // sonunda raporun asıl okunan kısmı bu. dailyReportStatsFor ile AYNI
    // "dokunulan kayıt" tanımını kullanır (o gün eklenen + o gün görüşme
    // notu girilen), yoksa sayılarla döküm birbirini tutmaz.
    function dailyConversationsFor(staffKey, date) {
      return (db.authors || []).map(a => {
        const notes = (a.logs || []).filter(l => l.date === date && (l.staffId || "admin") === staffKey);
        const createdToday = a.created === date && (a.addedBy || "admin") === staffKey;
        if (!notes.length && !createdToday) return null;
        return { a, notes, createdToday };
      }).filter(Boolean)
        // Çok konuşulan kayıt üste; eşitlikte ada göre (Türkçe sıralama).
        .sort((x, y) => (y.notes.length - x.notes.length) ||
          String(x.a.name || "").localeCompare(String(y.a.name || ""), "tr"));
    }

    function dailyConversationsHtml(items) {
      if (!items.length) return "";
      return items.map(({ a, notes, createdToday }) => {
        const st = STATUS[a.status] || { label: a.status || "—", color: "#9aa1b2" };
        const notlar = notes.length
          ? notes.map(l => `<div style="font-size:12px;color:var(--txt);margin-top:3px;line-height:1.45">
            <span style="color:var(--muted)">${escapeHtml(l.type || "Not")}:</span> ${escapeHtml(l.text || "").trim() || "<i style='color:var(--muted)'>(boş not)</i>"}
          </div>`).join("")
          : `<div style="font-size:12px;color:var(--muted);margin-top:3px;font-style:italic">Kayıt açıldı, henüz görüşme notu girilmemiş.</div>`;
        return `<div style="padding:7px 0 7px 10px;border-left:2px solid ${st.color};margin-top:8px">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <b style="font-size:12.5px">${escapeHtml(a.name || "—")}</b>
            ${a.phone ? `<span style="font-size:11px;color:var(--muted)">${escapeHtml(a.phone)}</span>` : ""}
            <span style="font-size:10px;color:${st.color};background:${st.color}18;border:1px solid ${st.color}44;border-radius:20px;padding:1px 7px">${escapeHtml(st.label)}</span>
            ${createdToday ? `<span style="font-size:10px;color:var(--muted)">• bugün eklendi</span>` : ""}
            ${notes.length > 1 ? `<span style="font-size:10px;color:var(--muted)">• ${notes.length} görüşme</span>` : ""}
          </div>
          ${notlar}
        </div>`;
      }).join("");
    }

    function openDailyReport(date) {
      date = date || todayStr();
      let keys;
      if (currentRole === "personel") {
        if (!currentStaffId) { customAlert("Rapor hazırlanamadı", "Hesabınız ekip listesiyle eşleşmediği için kişisel rapor oluşturulamıyor."); return; }
        keys = [currentStaffId];
      } else {
        keys = (db.staff || []).map(s => s.id).concat(["admin"]);
      }
      const chip = (label, val, color) => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:${color};background:${color}18;border:1px solid ${color}44;border-radius:20px;padding:2px 8px;white-space:nowrap"><b>${val}</b> ${label}</span>`;
      const rows = keys.map(k => {
        const items = dailyConversationsFor(k, date);
        return {
          key: k,
          name: k === "admin" ? "Sistem Yöneticisi" : (staffName(k) || "Personel"),
          st: dailyReportStatsFor(k, date),
          konusmaAdedi: items.length,
          konusmalar: dailyConversationsHtml(items)
        };
      }).filter(r => currentRole === "personel" || r.st.gorusme > 0 || r.st.kacirilan > 0);
      let body;
      if (!rows.length) {
        body = `<div class="empty">Bugün için raporlanacak görüşme bulunmuyor.</div>`;
      } else {
        body = rows.map(r => `<div style="padding:10px 0;border-bottom:1px dashed var(--line)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span class="avatar" style="background:${avatarColor(r.name)};width:24px;height:24px;font-size:10px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%">${escapeHtml(initials(r.name))}</span>
            <b style="font-size:14px">${escapeHtml(r.name)}</b>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${chip("görüşme", r.st.gorusme, "#4aa8ff")}
            ${r.st.kacirilan > 0
              ? `<button onclick="openKacirilanList('${r.key}','${date}')" title="Kimlerin aranmadığını gör" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#ef5350;background:#ef535018;border:1px solid #ef535066;border-radius:20px;padding:2px 8px;white-space:nowrap;cursor:pointer;font-weight:600"><b>${r.st.kacirilan}</b> kaçırılan arama ▸</button>`
              : chip("kaçırılan arama", 0, "#9aa1b2")}
            ${chip("olumlu", r.st.olumlu, "#37c98a")}
            ${chip("olumsuz", r.st.olumsuz, "#ef5350")}
            ${chip("devam eden", r.st.devam, "#f4b740")}
            ${r.st.basari !== null ? chip("başarı", "%" + r.st.basari, "#a78bfa") : chip("başarı", "%—", "#9aa1b2")}
          </div>
          ${!r.konusmalar ? "" : (currentRole === "personel"
            // Personelin kendi raporu kısa — döküm doğrudan açık gelsin.
            // Adminde 5 personelin dökümü tek ekrana sığmaz, sayılar
            // okunmaz hale gelir; orada katlanmış başlar, tıklayınca açılır.
            ? `<div style="margin-top:4px">${r.konusmalar}</div>`
            : `<details style="margin-top:6px">
            <summary style="cursor:pointer;font-size:11.5px;color:var(--brand-2);user-select:none;list-style:none">${icon('chevronDown', 12)} Görüşme dökümünü göster (${r.konusmaAdedi})</summary>
            ${r.konusmalar}
          </details>`)}
        </div>`).join("");
      }
      const content = `
        <div class="box" style="max-width:560px;padding:22px">
          <h2 style="margin:0 0 4px;font-size:17px">${icon('trendingUp', 16)} ${new Date().getHours() < EOD_REPORT_HOUR && date === todayStr() ? 'Gün İçi Raporu' : 'Gün Sonu Raporu'}</h2>
          <div style="color:var(--muted);font-size:12px;margin-bottom:10px">${fmtDate(date)}${date === todayStr() ? ' • saat ' + String(new Date().getHours()).padStart(2, '0') + ':' + String(new Date().getMinutes()).padStart(2, '0') + ' itibarıyla' : ''}</div>
          <div style="max-height:55vh;overflow-y:auto;padding-right:4px">${body}</div>
          <div class="actions" style="margin-top:16px;display:flex;gap:8px">
            <button class="btn ghost" style="flex:1" onclick="closeDailyReport();openMissedReport()">${icon('alertTriangle', 14)} Dönülmemişler</button>
            <button class="btn" style="flex:1" onclick="closeDailyReport()">Kapat</button>
          </div>
        </div>`;
      let m = document.getElementById("eodReportModal");
      if (!m) {
        m = document.createElement("div");
        m.className = "modal";
        m.id = "eodReportModal";
        document.body.appendChild(m);
      }
      m.innerHTML = content;
      m.classList.add("open");
    }
    function closeDailyReport() {
      const m = document.getElementById("eodReportModal");
      if (m) m.classList.remove("open");
    }
    // Rapordaki "kaçırılan arama" çipine tıklanınca açılır: o gün aranması
    // gerekip aranmamış adayları tek tek listeler; satıra tıklayınca yazarın
    // detayı açılır (hemen arayıp görüşme eklenebilsin diye).
    function openKacirilanList(staffKey, date) {
      const gName = staffKey === "admin" ? "Sistem Yöneticisi" : (staffName(staffKey) || "Personel");
      const liste = kacirilanAramaYazarlari(staffKey, date);
      const gunFarki = d => Math.max(0, Math.round((new Date(date) - new Date(d)) / 864e5));
      let body;
      if (!liste.length) {
        body = `<div class="empty">Kaçırılan arama kalmadı — hepsiyle ilgilenilmiş. 🎉</div>`;
      } else {
        body = liste.map(a => {
          const sebep = a.interviewDate === date
            ? `Bugün${a.interviewTime ? " saat " + escapeHtml(a.interviewTime) : ""} randevusu vardı, aranmadı`
            : `Takip tarihi ${fmtDate(a.followup)} — ${gunFarki(a.followup) === 0 ? "bugündü" : gunFarki(a.followup) + " gün geçti"}, aranmadı`;
          return `<div class="mini" onclick="closeKacirilanList();closeDailyReport();openDrawer('${a.id}')" style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <span class="avatar" style="background:${avatarColor(a.name)};width:26px;height:26px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;flex-shrink:0">${escapeHtml(initials(a.name))}</span>
              <div style="min-width:0">
                <span class="mn">${escapeHtml(a.name)}</span>
                <div class="ms" style="color:var(--red)">${sebep}</div>
                <div class="ms">${STATUS[a.status] ? STATUS[a.status].label : ""}${a.phone ? " • " + escapeHtml(a.phone) : ""}</div>
              </div>
            </div>
            <span onclick="event.stopPropagation()" style="flex-shrink:0">${waBtn(a.phone)}</span>
          </div>`;
        }).join("");
      }
      const content = `
        <div class="box" style="max-width:420px;padding:22px">
          <h2 style="margin:0 0 4px;font-size:16px">📵 Kaçırılan Aramalar</h2>
          <div style="color:var(--muted);font-size:12px;margin-bottom:10px">${escapeHtml(gName)} • ${fmtDate(date)} — aranması gerekip aranmayanlar</div>
          <div style="max-height:55vh;overflow-y:auto;padding-right:4px">${body}</div>
          <div class="actions" style="margin-top:16px">
            <button class="btn" style="width:100%" onclick="closeKacirilanList()">Kapat</button>
          </div>
        </div>`;
      let m = document.getElementById("kacirilanModal");
      if (!m) {
        m = document.createElement("div");
        m.className = "modal";
        m.id = "kacirilanModal";
        document.body.appendChild(m);
      }
      m.innerHTML = content;
      m.classList.add("open");
    }
    function closeKacirilanList() {
      const m = document.getElementById("kacirilanModal");
      if (m) m.classList.remove("open");
    }
    /* ---------- Dönülmemiş yazarlar raporu ----------
     * Görüşülmesi gerekip görüşülmemiş adayları geçmişe dönük analiz eder.
     * Bir yazar, yeni bir görüşme (log) eklenmedikçe bu listede kalır:
     *  - Takip tarihi geçmiş ve o tarihten sonra görüşme girilmemişse
     *  - Hiç görüşme yapılmamışsa (eklendiği günden beri)
     *  - Son görüşmenin üzerinden 7+ gün geçmiş ve ileri tarihli takip/randevu yoksa */
    function getMissedAuthors() {
      const today = todayStr();
      const active = ["aday", "gorusuluyor", "degerlendirme", "eseryaziyor"];
      const gunFarki = d => Math.max(0, Math.round((new Date(today) - new Date(d)) / 864e5));
      const out = [];
      visibleAuthors().forEach(a => {
        if (!active.includes(a.status)) return;
        const logs = (a.logs || []).filter(l => l.date).slice().sort((x, y) => x.date.localeCompare(y.date));
        const lastLog = logs.length ? logs[logs.length - 1].date : null;
        if (a.followup && a.followup < today && (!lastLog || lastLog < a.followup)) {
          out.push({ a, reason: "takip", days: gunFarki(a.followup), text: "Takip tarihi " + gunFarki(a.followup) + " gün geçti, hâlâ dönülmedi", color: "var(--red)" });
        } else if (!logs.length) {
          const d = gunFarki(a.created || today);
          if (d >= 1) out.push({ a, reason: "hic", days: d, text: d + " gündür hiç görüşme yapılmadı", color: "var(--amber)" });
        } else {
          const d = gunFarki(lastLog);
          const ileriTakip = (a.followup && a.followup >= today) || (a.interviewDate && a.interviewDate >= today);
          if (d >= 7 && !ileriTakip) {
            out.push({ a, reason: "eski", days: d, text: "Son görüşmeden bu yana " + d + " gün geçti, yeni takip planlanmadı", color: "#9aa1b2" });
          }
        }
      });
      out.sort((x, y) => y.days - x.days);
      return out;
    }
    function openMissedReport() {
      const missed = getMissedAuthors();
      let body;
      if (!missed.length) {
        body = `<div class="empty">${icon('checkCircle', 15)} Harika! Dönülmemiş yazar yok — tüm adaylarla ilgilenilmiş.</div>`;
      } else {
        body = missed.map(m => {
          const adder = m.a.addedBy === "admin" ? "Sistem Yöneticisi" : (staffName(m.a.addedBy) || "Personel");
          return `<div class="mini" onclick="closeMissedReport();closeDailyReport();openDrawer('${m.a.id}')" style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <span class="avatar" style="background:${avatarColor(m.a.name)};width:26px;height:26px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;flex-shrink:0">${escapeHtml(initials(m.a.name))}</span>
              <div style="min-width:0">
                <span class="mn">${escapeHtml(m.a.name)}</span>
                <div class="ms" style="color:${m.color}">${m.text}</div>
                <div class="ms">${STATUS[m.a.status].label} • ${escapeHtml(adder)}</div>
              </div>
            </div>
            <span style="font-weight:700;color:${m.color};font-size:13px;flex-shrink:0">${m.days}g</span>
          </div>`;
        }).join("");
      }
      const content = `
        <div class="box" style="max-width:460px;padding:22px">
          <h2 style="margin:0 0 4px;font-size:17px">${icon('alertTriangle', 16)} Dönülmemiş Yazarlar</h2>
          <div style="color:var(--muted);font-size:12px;margin-bottom:10px">${missed.length} yazar bekliyor — yeni görüşme eklenmedikçe listede kalırlar</div>
          <div style="max-height:55vh;overflow-y:auto;padding-right:4px">${body}</div>
          <div class="actions" style="margin-top:16px">
            <button class="btn" style="width:100%" onclick="closeMissedReport()">Kapat</button>
          </div>
        </div>`;
      let m = document.getElementById("missedReportModal");
      if (!m) {
        m = document.createElement("div");
        m.className = "modal";
        m.id = "missedReportModal";
        document.body.appendChild(m);
      }
      m.innerHTML = content;
      m.classList.add("open");
    }
    function closeMissedReport() {
      const m = document.getElementById("missedReportModal");
      if (m) m.classList.remove("open");
    }

    function checkDailyReport() {
      if (!db.authors || !db.authors.length) return;
      if (new Date().getHours() < EOD_REPORT_HOUR) return;
      const today = todayStr();
      let last = null;
      try { last = localStorage.getItem(EOD_REPORT_KEY); } catch (e) { /* engellenmis olabilir */ }
      if (last === today) return;
      try { localStorage.setItem(EOD_REPORT_KEY, today); } catch (e) { /* engellenmis olabilir */ }
      openDailyReport(today);
    }
    setInterval(checkDailyReport, 60000);

    /* ---------- Yazar listesi: yerel kopya + yalnızca değişenleri çekme ----------
     *
     * Önceden uygulama her açılışta "authors" koleksiyonunun TAMAMINI
     * (800+ doküman) yeniden indiriyordu. Günde 8 personel × 5 açılış =
     * ~32.500 okuma, yani Firebase ücretsiz planındaki günlük 50.000
     * okuma kotasının üçte ikisi tek başına açılışlarda gidiyordu.
     *
     * Artık liste tarayıcıda saklanıyor ve açılışta sunucuya sadece
     * "en son aldığım andan sonra değişenleri ver" diye soruluyor. Gün
     * içinde 800 kaydın belki 20'si değiştiği için açılış maliyeti
     * 800+ okumadan ~10 okumaya iniyor. Canlı senkronizasyon bozulmaz:
     * sonradan değişen her kayıt bu sorguya yine düşer.
     *
     * GÜVENLİK AĞI — herhangi bir aksilikte eski davranışa döner:
     * yerel kopya yoksa, bozuksa, çok eskiyse ya da fark sorgusu hata
     * verirse kopya silinir ve koleksiyonun tamamı eskisi gibi çekilir.
     * Yani en kötü ihtimalde bugünkü maliyete döneriz, veri kaybolmaz.
     */
    const AUTHOR_CACHE_PREFIX = "mstcrm_authors_v1_";
    // Yerel kopya en fazla 1 gün kullanılır, sonra koleksiyonun tamamı
    // yeniden çekilir. Bu bilinçli bir maliyet: kişi başı günde bir kez
    // ~800 okuma (8 personel için ~6.500, kotanın %13'ü). Karşılığında,
    // damgası atlanmış bir yazma yolu ya da fark sorgusundaki bir hata
    // yüzünden oluşabilecek "sessiz eskime" en fazla bir gün sürer —
    // haftalarca yanlış veri gösterilmesi ihtimali kalmaz.
    const AUTHOR_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const AUTHOR_CACHE_MAX_BYTES = 3 * 1024 * 1024;          // localStorage sınırına yaklaşma
    // Fark sorgusunu son damganın bir tık GERİSİNDEN başlatıyoruz.
    // CRM'deki yazmalar sunucu saatiyle damgalanıyor (sıralama garantili),
    // ama webhook yeni aday oluştururken kendi saatini kullanmak zorunda
    // (oluşturma isteğinde sunucu damgası dönüşümü kullanılamıyor). Bu pay
    // o küçük saat farkını kapatıyor.
    //
    // Payı büyük tutmak pahalıya patlar: pay içinde kalan HER kayıt her
    // açılışta yeniden okunur. Bu yüzden hem pay dar tutuldu hem de taşıma
    // betiği damgaları kayıtların gerçek son hareket tarihine yayıyor —
    // hepsine aynı damga basılsaydı her açılışta 800+ kayıt yeniden
    // okunur, kazanç sıfırlanırdı.
    const DELTA_SAFETY_MS = 60 * 1000;

    let authorWatermark = 0; // gördüğümüz en yeni "son değişiklik" damgası (ms)

    // updatedAt hem Firestore Timestamp'i (canlı veri) hem de düz nesne
    // ({seconds,...}, yerel kopyadan JSON ile geri okunmuş) olabilir.
    function authorUpdatedMs(a) {
      const u = a && a.updatedAt;
      if (!u) return 0;
      let ms;
      if (typeof u.toMillis === "function") ms = u.toMillis();
      else if (typeof u.seconds === "number") ms = u.seconds * 1000 + Math.floor((u.nanoseconds || 0) / 1e6);
      else ms = new Date(u).getTime();
      if (!Number.isFinite(ms)) return 0;
      // GELECEK TARİH SAVUNMASI: tek bir kaydın damgası bir şekilde
      // geleceğe düşerse (bozuk cihaz saati, hatalı toplu güncelleme),
      // watermark oraya sıçrar ve o andan sonraki GERÇEK değişikliklerin
      // hepsi fark sorgusunun altında kalıp görünmez olur — uygulama
      // sessizce eskimeye başlar. Bu yüzden makul bir ufkun (1 saat)
      // ötesindeki damgalar watermark'ı ilerletmez. Kayıt yine normal
      // şekilde işlenir, sadece "en yeni an" olarak sayılmaz.
      if (ms > Date.now() + 60 * 60 * 1000) return 0;
      return ms;
    }

    function authorCacheKey() {
      const uid = (auth.currentUser && auth.currentUser.uid) || "anon";
      return AUTHOR_CACHE_PREFIX + uid;
    }
    function clearAuthorCache() {
      try { localStorage.removeItem(authorCacheKey()); } catch (e) { /* önemsiz */ }
    }
    function readAuthorCache() {
      try {
        const raw = localStorage.getItem(authorCacheKey());
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (!p || !Array.isArray(p.authors) || !p.authors.length) return null;
        if (!p.watermark || !p.savedAt) return null;
        if (Date.now() - p.savedAt > AUTHOR_CACHE_MAX_AGE_MS) return null;
        return p;
      } catch (e) { return null; }
    }
    let cacheWriteTimer = null;
    function scheduleAuthorCacheWrite() {
      // Her anlık görüntüde yarım megabaytlık JSON üretmemek için geciktir.
      if (cacheWriteTimer) return;
      cacheWriteTimer = setTimeout(() => {
        cacheWriteTimer = null;
        try {
          if (!authorWatermark || !db.authors.length) return;
          const payload = JSON.stringify({ savedAt: Date.now(), watermark: authorWatermark, authors: db.authors });
          if (payload.length > AUTHOR_CACHE_MAX_BYTES) { clearAuthorCache(); return; }
          localStorage.setItem(authorCacheKey(), payload);
        } catch (e) { clearAuthorCache(); } // kota dolu/gizli pencere vb.
      }, 3000);
    }

    function applyAuthorChanges(changes) {
      changes.forEach(change => {
        const data = change.doc.data();
        authorWatermark = Math.max(authorWatermark, authorUpdatedMs(data));
        const idx = db.authors.findIndex(a => a.id === data.id);
        // "removed": doküman gerçekten silinmiş. deleted:true: yumuşak
        // silme — kayıt sunucuda duruyor ama listede görünmemeli (bkz.
        // deleteAuthorDoc; fark sorgusunun silmeyi de taşıyabilmesi için
        // böyle yapıldı).
        if (change.type === "removed" || data.deleted === true) {
          if (idx !== -1) db.authors.splice(idx, 1);
        } else if (idx !== -1) {
          db.authors[idx] = data;
        } else {
          db.authors.unshift(data);
        }
      });
    }

    function loadAuthors() {
      const cache = readAuthorCache();
      const useDelta = !!cache;
      if (useDelta) {
        db.authors = cache.authors;
        authorWatermark = cache.watermark;
      } else {
        authorWatermark = 0;
      }

      return new Promise((resolve, reject) => {
        let firstLoad = true;
        const col = firestore.collection("authors");
        const ref = useDelta
          ? col.where("updatedAt", ">", firebase.firestore.Timestamp.fromMillis(Math.max(0, authorWatermark - DELTA_SAFETY_MS)))
          : col;

        listen(ref, snapshot => {
          if (firstLoad && !useDelta) {
            const all = snapshot.docs.map(d => d.data());
            all.forEach(a => { authorWatermark = Math.max(authorWatermark, authorUpdatedMs(a)); });
            db.authors = all.filter(a => a.deleted !== true);
          } else {
            // Fark modunda ilk anlık görüntü de docChanges ile gelir
            // (hepsi "added" tipinde), o yüzden tek yol yeterli.
            applyAuthorChanges(snapshot.docChanges());
          }
          scheduleAuthorCacheWrite();
          if (firstLoad) { firstLoad = false; resolve(); }
          else onDataChanged();
        }, err => {
          console.error("Yazar veri çekme hatası:", err);
          if (!firstLoad) return;
          // Fark sorgusu ilk açılışta patladıysa yerel kopyaya güvenmeyi
          // bırak: kopyayı sil ve reddet. ensureDataLoaded yeniden
          // deneyecek, o denemede kopya olmadığı için koleksiyonun tamamı
          // eskisi gibi çekilecek.
          if (useDelta) clearAuthorCache();
          reject(err);
        });
      });
    }

    function loadExpenses() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        listen(firestore.collection("expenses"), snapshot => {
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
    // Asıl kayıt index.html'deki küçük betikte yapılıyor (Firebase SDK'sına
    // bağımlı olmasın diye — bkz. oradaki açıklama). Buradaki çağrı aynı
    // adresi tekrar kaydeder; register() aynı adres/kapsam için mevcut kaydı
    // döndürdüğünden ikinci bir worker oluşmaz. Eskiden kayıt YALNIZCA burada
    // ve üstelik messaging desteği varsa yapılıyordu; push desteklemeyen
    // tarayıcılarda (ör. bazı iOS sürümleri) worker hiç kaydolmuyor,
    // çevrimdışı çalışma ve "uygulama olarak yükle" hiç devreye girmiyordu.
    let swKaydiSozu = null;
    function registerServiceWorker() {
      if (swKaydiSozu) return swKaydiSozu;
      if (!("serviceWorker" in navigator)) return Promise.resolve(null);
      swKaydiSozu = navigator.serviceWorker.register("firebase-messaging-sw.js")
        .catch(e => { console.error("Servis worker kaydedilemedi:", e); return null; });
      return swKaydiSozu;
    }

    async function initPushNotifications() {
      try {
        const reg = await registerServiceWorker();
        if (!reg) return;
        if (typeof firebase.messaging !== "function" || !firebase.messaging.isSupported()) return;
        const fcmToken = await firebase.messaging().getToken({ serviceWorkerRegistration: reg });
        if (!fcmToken) return;
        await firestore.collection("fcm_tokens").doc(fcmToken).set({
          token: fcmToken,
          // Görev sistemindeki kimlikle AYNI olmalı (myTaskId): yönetici
          // ekip listesinde kayıtlı olmayabiliyor ve staffId'si boş
          // kalıyordu; bu yüzden kendisine atanan görevin bildirimi hiç
          // ulaşmıyordu (görev bildirimleri staffId ile hedefleniyor).
          staffId: currentStaffId || (currentRole === "admin" ? "admin" : null),
          uid: auth.currentUser ? auth.currentUser.uid : null,
          role: currentRole,
          // Hangi cihaz olduğu: "bilgisayarıma bildirim geliyor mu"
          // sorusunun cevabı kayıttan görülebilsin.
          cihaz: (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent.slice(0, 180) : null,
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
    // Tek çağrıda birden çok hedefe gider (worker token listesini bir kez
    // okusun diye). hedefler: { staffIds: [...], rol: "admin" } — ikisi
    // birlikte de verilebilir.
    async function sendPush({ staffIds, rol, baslik, govde, etiket, taskId, dueDate }) {
      try {
        if (!auth.currentUser) return;
        const ids = (staffIds || []).filter(Boolean);
        if (!ids.length && !rol) return;
        const idToken = await auth.currentUser.getIdToken();
        await fetch(NOTIFY_TASK_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
          body: JSON.stringify({
            staffIds: ids, rol: rol || null,
            baslik: baslik || "Yeni görev atandı",
            title: govde || baslik || "",   // worker'ın zorunlu alanı
            govde: govde || null, etiket: etiket || null,
            taskId: taskId || "", dueDate: dueDate || null
          })
        });
      } catch (e) {
        // Bildirim "olsa iyi olur" katmanı — başarısızlığı işlemi bozmaz.
        console.error("Push gönderilemedi:", e);
      }
    }

    // hedefler verilmezse görevin atandığı herkese gider.
    async function sendTaskPush(task, hedefler) {
      const ids = (hedefler && hedefler.length) ? hedefler : taskAssignees(task);
      return sendPush({
        staffIds: ids, taskId: task.id, title: task.title,
        baslik: "Yeni görev atandı", govde: task.title + (task.dueDate ? ` — Son tarih: ${fmtDate(task.dueDate)}` : ""),
        etiket: "task_" + task.id
      });
    }

    // Görev olayları için ekipteki DİĞER herkes (olayı yapan hariç).
    function digerEkipIdleri() {
      const ben = myTaskId();
      return (db.staff || []).map(s => s.id).filter(id => id && id !== ben);
    }

    // Tarayıcının kendi bildirim API'si — sadece CRM sekmesi bir yerde
    // açıkken çalışır; tag sayesinde aynı görev için FCM push'la çakışırsa
    // tarayıcı ikisini tek bildirimde birleştirir.
    function notifyNewTask(task) {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      // Havuz görevi kimseye atanmadı — "sana görev atandı" demek yanlış olur.
      const baslik = isHavuzGorevi(task) ? "Havuza yeni görev eklendi" : "Yeni görev atandı";
      try {
        new Notification(baslik, {
          body: task.title + (task.dueDate ? ` — Son tarih: ${fmtDate(task.dueDate)}` : ""),
          icon: "logo.jpeg",
          tag: "task_" + (task.id || "")
        });
      } catch (e) {
        console.error("Bildirim gösterilemedi:", e);
      }
    }
    // Sekme açıkken gösterilen tarayıcı bildirimi. Push (kapalıyken) ile
    // aynı tag kullanılırsa tarayıcı ikisini tek bildirimde birleştirir.
    function tarayiciBildirimi(baslik, govde, etiket) {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try {
        new Notification(baslik, { body: govde, icon: "logo.jpeg", tag: etiket || undefined });
      } catch (e) {
        console.error("Bildirim gösterilemedi:", e);
      }
    }
    const FEEDBACK_BILDIRIM_BASLIK = {
      dilek: "💡 Yeni dilek/öneri",
      sikayet: "⚠️ Yeni şikayet",
      talep: "📋 Yeni talep"
    };
    // Dilek/şikayet ANONİM: bildirimde de kim gönderdi bilgisi yok, zaten
    // hiçbir yerde tutulmuyor. Mesajın kendisi kısaltılarak gösteriliyor.
    function notifyYeniFeedback(item) {
      if (!item) return;
      tarayiciBildirimi(
        FEEDBACK_BILDIRIM_BASLIK[item.type] || "📮 Yeni mesaj",
        String(item.text || "").slice(0, 120),
        "feedback_" + item.id
      );
    }
    function notifyTaskCompleted(task) {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      // Ortak görevde "kime atandı" değil "kim kapattı" önemli.
      const doneName = staffName(task.completedBy) || staffName(task.assignedTo) || "Bir personel";
      try {
        new Notification("Görev tamamlandı", {
          body: `${doneName}: ${task.title}`,
          icon: "logo.jpeg"
        });
      } catch (e) {
        console.error("Bildirim gösterilemedi:", e);
      }
    }

    function loadTasks() {
      return new Promise((resolve, reject) => {
        let firstLoad = true;
        listen(firestore.collection("tasks"), snapshot => {
          if (firstLoad) {
            db.tasks = snapshot.docs.map(d => d.data());
          } else {
            snapshot.docChanges().forEach(change => {
              const data = change.doc.data();
              const idx = db.tasks.findIndex(x => x.id === data.id);
              if (change.type === "removed") {
                if (idx !== -1) db.tasks.splice(idx, 1);
              } else if (idx !== -1) {
                const onceki = db.tasks[idx];
                const wasCompleted = onceki.status === "tamamlandı";
                const oncekiTalep = !!(onceki.destekTalebi);
                const oncekiDurum = onceki.status;
                db.tasks[idx] = data;
                if (!wasCompleted && data.status === "tamamlandı" && currentRole === "admin") notifyTaskCompleted(data);
                // Destekçi talebi AÇILDIĞI an haber ver — talebi açan kişiye
                // ve göreve zaten dahil olanlara değil, karşılık verebilecek
                // olanlara.
                if (!oncekiTalep && destekAraniyor(data) && !isTaskFor(data, myTaskId())) {
                  tarayiciBildirimi("🙋 Destekçi aranıyor",
                    data.title + " — " + ((data.destekTalebi && data.destekTalebi.not) || ""),
                    "destek_" + data.id);
                }
                // Oylamaya düşen görev: kendi işine oy verilemez, tamamlayana
                // bildirim gitmesi gürültü olur.
                if (oncekiDurum !== "kontrol" && data.status === "kontrol" && (data.completedBy || null) !== myTaskId()) {
                  tarayiciBildirimi("🗳️ Oy bekleyen görev",
                    data.title + " — tamamlandı denildi, ekip onayı bekliyor",
                    "kontrol_" + data.id);
                }
              } else {
                db.tasks.unshift(data);
                if (change.type === "added" && (isTaskFor(data, myTaskId()) || havuzdaAktif(data))) notifyNewTask(data);
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
        listen(firestore.collection("stock"), snapshot => {
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
        listen(firestore.collection("printOrders"), snapshot => {
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
        listen(firestore.collection("packageContracts"), snapshot => {
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
      // Yeniden denemede aynı koleksiyona ikinci kez dinleyici bağlanmasın
      // (bkz. activeListeners açıklaması) — her deneme temiz başlar.
      stopAllListeners();
      db.staff = db.staff || [];
      db.authors = db.authors || [];
      db.expenses = db.expenses || [];
      db.tasks = db.tasks || [];
      db.stock = db.stock || [];
      db.printOrders = db.printOrders || [];
      db.packageContracts = db.packageContracts || {};
      await Promise.all([loadStaff(), loadAuthors(), loadExpenses(), loadTasks(), loadStock(), loadPrintOrders(), loadPackageContracts(), loadMaintenance(), loadFeedback()]);
    }

    // Firestore hatasını kullanıcıya anlaşılır bir cümleye çevirir. Önceden
    // her hata için tek tip "Lütfen internet bağlantınızı kontrol edin"
    // deniyordu; oysa uygulamanın gerçek arızası genellikle bağlantı değil,
    // Firebase ücretsiz (Spark) paketinin günlük kotasının dolmasıydı —
    // yanlış mesaj yüzünden sorun uzun süre internet arızası sanıldı.
    // Hata kodunu da yazıyoruz ki teknik olmayan kullanıcı ekran
    // görüntüsünü iletince sebep tek bakışta anlaşılsın.
    function dbErrorText(e, baseMessage) {
      const code = String((e && e.code) || "").replace(/^firestore\//, "");
      if (code === "resource-exhausted") {
        return baseMessage + "\n\nSebep: Günlük veri kotası doldu. Bu bir internet sorunu DEĞİL. " +
          "BU KAYIT SUNUCUYA GİTMEDİ — sayfayı yenilerseniz kaybolur. Birkaç dakika sonra tekrar deneyin; " +
          "kota her gece sıfırlanır.";
      }
      if (code === "permission-denied") {
        return baseMessage + "\n\nSebep: Bu işlem için yetkiniz yok ya da hesabınızın onayı kaldırılmış. Yöneticinize bildirin.";
      }
      if (code === "unavailable" || code === "deadline-exceeded" || code === "aborted") {
        return baseMessage + "\n\nSebep: Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.";
      }
      if (code === "invalid-argument" || code === "not-found") {
        return baseMessage + "\n\nSebep: Kayıt verisinde bir sorun var (kod: " + code + "). Yöneticinize bildirin.";
      }
      return baseMessage + "\n\n(Hata kodu: " + (code || "bilinmiyor") + ") Sorun sürerse bu kodu yöneticinize iletin.";
    }

    // Tek bir yazarın dokümanını, sunucudaki en güncel haliyle güvenli
    // şekilde günceller (iki kişi farklı yazarları aynı anda düzenlese bile
    // artık birbirini hiç etkilemez, çünkü her yazar ayrı doküman). fn iki
    // kez çağrılır (anlık ekran güncellemesi için yerel kopyaya, asıl kayıt
    // için sunucudan taze okunan kopyaya) — bu yüzden fn içinde uid()/
    // new Date() gibi her çağrıda farklı sonuç üretebilecek değerler
    // ÜRETİLMEMELİ, çağıran fonksiyon tarafından önceden hesaplanmalı.
    // Her yazar yazmasına "son değişiklik" damgası basar. Bu damga
    // olmadan, uygulamanın açılışta "sadece değişenleri ver" sorgusu
    // (bkz. loadAuthors) o kaydı GÖREMEZ — yani damgasız bir yazma yolu
    // kalırsa o değişiklik diğer kullanıcıların ekranına hiç ulaşmaz.
    // Sunucu saati kullanılıyor: cihaz saatleri yanlış olabilir, damganın
    // karşılaştırıldığı değer ise hep sunucudan gelir.
    function stampUpdated(obj) {
      obj.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      return obj;
    }

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
          tx.set(ref, stampUpdated(server));
        });
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert(dbErrorText(e, "Veri kaydedilemedi"));
      }
    }

    async function createAuthor(authorData) {
      db.authors.unshift(authorData);
      render();
      try {
        await firestore.collection("authors").doc(authorData.id).set(stampUpdated({ ...authorData }));
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert(dbErrorText(e, "Veri kaydedilemedi"));
      }
    }

    // Yumuşak silme: doküman gerçekten silinmiyor, "deleted" işareti ve
    // yeni bir damga yazılıyor. Sebebi: açılıştaki fark sorgusu yalnızca
    // DEĞİŞEN dokümanları görebilir, gerçekten silinmiş bir dokümanı ise
    // hiç göremez — o zaman kaydı yerel kopyasında tutan diğer
    // kullanıcılarda silinen yazar ekranda kalmaya devam ederdi.
    // Yan fayda: yanlışlıkla silinen kayıt sunucuda duruyor, geri
    // alınabilir. Listeleme tarafında deleted:true olanlar ayıklanıyor.
    async function deleteAuthorDoc(authorId) {
      db.authors = db.authors.filter(x => x.id !== authorId);
      render();
      try {
        await firestore.collection("authors").doc(authorId).update(stampUpdated({ deleted: true }));
      } catch (e) {
        console.error("Silme hatası:", e);
        alert(dbErrorText(e, "Veri silinemedi"));
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
        alert(dbErrorText(e, "Gider kaydedilemedi"));
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
        alert(dbErrorText(e, "Gider güncellenemedi"));
      }
    }
    async function deleteExpenseDoc(expenseId) {
      db.expenses = db.expenses.filter(x => x.id !== expenseId);
      render();
      try {
        await firestore.collection("expenses").doc(expenseId).delete();
      } catch (e) {
        console.error("Silme hatası:", e);
        alert(dbErrorText(e, "Gider silinemedi"));
      }
    }

    async function createStockItem(item) {
      db.stock.unshift(item);
      render();
      try {
        await firestore.collection("stock").doc(item.id).set(item);
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert(dbErrorText(e, "Stok kaydedilemedi"));
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
        alert(dbErrorText(e, "Stok güncellenemedi"));
      }
    }
    async function deleteStockItem(id) {
      db.stock = db.stock.filter(x => x.id !== id);
      render();
      try {
        await firestore.collection("stock").doc(id).delete();
      } catch (e) {
        console.error("Silme hatası:", e);
        alert(dbErrorText(e, "Stok silinemedi"));
      }
    }

    async function createPrintOrder(order) {
      db.printOrders.unshift(order);
      render();
      try {
        await firestore.collection("printOrders").doc(order.id).set(order);
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert(dbErrorText(e, "Baskı siparişi kaydedilemedi"));
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
        alert(dbErrorText(e, "Baskı siparişi güncellenemedi"));
      }
    }
    async function deletePrintOrder(id) {
      db.printOrders = db.printOrders.filter(x => x.id !== id);
      render();
      try {
        await firestore.collection("printOrders").doc(id).delete();
      } catch (e) {
        console.error("Silme hatası:", e);
        alert(dbErrorText(e, "Baskı siparişi silinemedi"));
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
        alert(dbErrorText(e, "Veri kaydedilemedi"));
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
    /* ---------- Görev önceliği (1-5 yıldız) ----------
     * Öncelik, aktif ve havuz listelerinde BİRİNCİL sıralama ölçütü: yüksek
     * yıldız üste çıkar, eşitlikte son tarihe göre sıralanır. Yıldız vermek
     * sıralamayı değiştirmiyorsa anlamı da kalmazdı.
     */
    const ONCELIK_ETIKET = { 1: "Çok düşük", 2: "Düşük", 3: "Normal", 4: "Yüksek", 5: "Çok acil" };
    const ONCELIK_RENK = { 1: "#9aa1b2", 2: "#9aa1b2", 3: "#4aa8ff", 4: "#f4b740", 5: "#f2617a" };
    const ONCELIK_VARSAYILAN = 3;
    // Eski kayıtlarda öncelik alanı yok. Hepsini en alta itmek yerine
    // "Normal" sayıyoruz ki yeni görevlerle makul şekilde harmanlansınlar —
    // yoksa 50+ eski görev bir anda listenin dibine düşerdi.
    function gorevOnceligi(t) {
      const n = t && Number(t.oncelik);
      return (Number.isFinite(n) && n >= 1 && n <= 5) ? Math.round(n) : ONCELIK_VARSAYILAN;
    }
    function yildizIkon(dolu, size, renk) {
      size = size || 13;
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${dolu ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" style="flex-shrink:0;vertical-align:-2px;color:${renk}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    }
    function oncelikRozeti(t) {
      const n = gorevOnceligi(t);
      let s = "";
      for (let i = 1; i <= 5; i++) s += yildizIkon(i <= n, 13, i <= n ? ONCELIK_RENK[n] : "var(--line)");
      return `<span title="Öncelik: ${ONCELIK_ETIKET[n]}" style="display:inline-flex;align-items:center;gap:1px">${s}</span>`;
    }

    /* ---------- Görev değerlendirmesi (tamamlanınca 5 üzerinden puan) ----------
     * Ekipteki HER kullanıcı tamamlanmış bir göreve 1-5 puan verebilir.
     * Herkesin tek oyu vardır ve istediğinde değiştirebilir. Kart ortalamayı
     * ve oy sayısını gösterir; personel kartında o kişinin ALDIĞI puanların
     * ortalaması çıkar.
     *
     * Oylar { kimlik: puan } haritasında tutulur ve Firestore'a NOKTALI ALAN
     * YOLUYLA yazılır (degerlendirmeler.<kimlik>). Tüm haritayı geri
     * yazsaydık, iki kişi aynı anda oy verdiğinde biri diğerinin oyunu
     * silerdi.
     */
    function gorevDegerlendirmeleri(t) {
      const d = t && t.degerlendirmeler;
      return (d && typeof d === "object") ? d : {};
    }
    function gecerliPuanlar(t) {
      return Object.values(gorevDegerlendirmeleri(t))
        .map(Number).filter(n => Number.isFinite(n) && n >= 1 && n <= 5);
    }
    function gorevOrtalamaPuan(t) {
      const p = gecerliPuanlar(t);
      if (!p.length) return null;
      return p.reduce((a, b) => a + b, 0) / p.length;
    }
    // Oy verirken kullanılan kimlik: personelde ekip kimliği, yöneticide "admin".
    function degerlendirenKimligi() {
      if (currentStaffId) return currentStaffId;
      return currentRole === "admin" ? "admin" : null;
    }
    function benimPuanim(t) {
      const k = degerlendirenKimligi();
      if (!k) return null;
      const n = Number(gorevDegerlendirmeleri(t)[k]);
      return (Number.isFinite(n) && n >= 1 && n <= 5) ? n : null;
    }
    function puanRengi(ort) {
      if (ort === null) return "var(--muted)";
      if (ort >= 4.5) return "#37c98a";
      if (ort >= 3.5) return "#4aa8ff";
      if (ort >= 2.5) return "#f4b740";
      return "#f2617a";
    }

    async function puanVer(taskId, puan) {
      const kim = degerlendirenKimligi();
      if (!kim) { customAlert("Puan verilemedi", "Hesabınız ekip listesiyle eşleşmediği için değerlendirme yapamıyorsunuz."); return; }
      const t = db.tasks.find(x => x.id === taskId);
      if (!t || t.status !== "tamamlandı") return;
      const n = Math.min(5, Math.max(1, Number(puan) || 0));

      t.degerlendirmeler = Object.assign({}, gorevDegerlendirmeleri(t), { [kim]: n });
      render();
      try {
        // Noktalı alan yolu yalnızca kendi oyumuzu yazar, başkasınınkine
        // dokunmaz — aynı anda oy verilse ikisi de korunur.
        await firestore.collection("tasks").doc(taskId).update({ ["degerlendirmeler." + kim]: n });
      } catch (e) {
        console.error("Puan verilemedi:", e);
        alert(dbErrorText(e, "Puan kaydedilemedi"));
      }
    }

    function degerlendirmeKutusu(t) {
      if (t.status !== "tamamlandı") return "";
      const ort = gorevOrtalamaPuan(t);
      const oySayisi = gecerliPuanlar(t).length;
      const benim = benimPuanim(t);
      const renk = puanRengi(ort);
      const kim = degerlendirenKimligi();

      const ortalamaSatiri = ort === null
        ? `<span style="font-size:12px;color:var(--muted)">Henüz puan verilmemiş</span>`
        : `<span style="display:inline-flex;align-items:center;gap:4px">
        <b style="font-size:15px;color:${renk}">${ort.toFixed(1).replace(".", ",")}</b>
        <span style="font-size:11px;color:var(--muted)">/ 5 · ${oySayisi} oy</span>
      </span>`;

      const benimYildizlar = kim
        ? [1, 2, 3, 4, 5].map(i =>
          `<button type="button" class="yildizBtn" onclick="puanVer('${t.id}',${i})" title="${i} puan ver" aria-label="${i} puan ver">${yildizIkon(benim !== null && i <= benim, 20, (benim !== null && i <= benim) ? "#f4b740" : "var(--line)")}</button>`
        ).join("")
        : "";

      return `<div style="margin-top:8px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600">Değerlendirme</div>
          ${ortalamaSatiri}
        </div>
        ${kim ? `<div style="display:flex;align-items:center;gap:6px;margin-top:2px;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--muted)">${benim === null ? "Sen de puan ver:" : "Senin puanın:"}</span>
          <span style="display:inline-flex;align-items:center">${benimYildizlar}</span>
        </div>` : ""}
      </div>`;
    }

    /* ---------- Görev kontrol oylaması ----------
     * Tamamlanan görev doğrudan kapanmaz: "kontrol" (oylamada) durumuna düşer
     * ve ekip işin gerçekten bittiğini oylar. Tamamlayan kişi kendi işine oy
     * veremez. 2 ONAY → görev kesin tamamlanır; 2 RET → görev havuza geri
     * döner (raporu ve geçmişi silinmez, yeniden yapılmak üzere alınabilir).
     * Oylar puanlamadaki gibi noktalı alan yoluyla yazılır — eşzamanlı oylar
     * birbirini ezmez. */
    // 5 kişi oy kullanıyor — çoğunluk 3'tür: 3 onay kesinleştirir, 3 ret
    // havuza döndürür (beraberlik matematiksel olarak mümkün değil).
    const KONTROL_ONAY_ESIGI = 3;
    const KONTROL_RET_ESIGI = 3;
    function kontrolOylari(t) {
      const o = t && t.kontrolOylari;
      return (o && typeof o === "object") ? o : {};
    }
    function kontrolOySayilari(t) {
      const oylar = Object.values(kontrolOylari(t));
      return { onay: oylar.filter(o => o === "onay").length, ret: oylar.filter(o => o === "ret").length };
    }
    async function kontrolOyVer(taskId, oy) {
      const kim = degerlendirenKimligi();
      if (!kim) { customAlert("Oy verilemedi", "Hesabınız ekip listesiyle eşleşmediği için oylamaya katılamıyorsunuz."); return; }
      const t = db.tasks.find(x => x.id === taskId);
      if (!t || t.status !== "kontrol") return;
      if ((t.completedBy || null) === kim) { customAlert("Kendi işine oy veremezsin", "Tamamladığın görevin kontrolünü ekipteki diğer kişiler oylar."); return; }
      if (oy !== "onay" && oy !== "ret") return;

      t.kontrolOylari = Object.assign({}, kontrolOylari(t), { [kim]: oy });
      render();
      const ref = firestore.collection("tasks").doc(taskId);
      try {
        await ref.update({ ["kontrolOylari." + kim]: oy });
        // Eşik kontrolü sunucudaki güncel oylarla, transaction içinde yapılır —
        // iki kişi aynı anda oy verse de sonuç bir kez ve doğru işlenir.
        await firestore.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists || snap.data().status !== "kontrol") return;
          const server = snap.data();
          const oylar = Object.values((server.kontrolOylari && typeof server.kontrolOylari === "object") ? server.kontrolOylari : {});
          const onay = oylar.filter(o => o === "onay").length;
          const ret = oylar.filter(o => o === "ret").length;
          if (onay >= KONTROL_ONAY_ESIGI) {
            tx.update(ref, { status: "tamamlandı", kontrolSonuc: "onaylandi", kontrolBitis: todayStr() });
          } else if (ret >= KONTROL_RET_ESIGI) {
            // Yetersiz bulundu: görev havuza geri düşer, yeniden alınabilir.
            tx.update(ref, {
              status: "bekliyor", havuzda: true, assignees: [], assignedTo: null,
              alanKisi: null, alinmaTarihi: null, ertelemeTarihi: null,
              kontrolSonuc: "reddedildi", kontrolOylari: {}, completionSeen: true
            });
          }
        });
        const guncel = await ref.get();
        if (guncel.exists) {
          const yerel = db.tasks.find(x => x.id === taskId);
          if (yerel) Object.assign(yerel, guncel.data());
        }
        render();
      } catch (e) {
        console.error("Kontrol oyu verilemedi:", e);
        alert(dbErrorText(e, "Oy kaydedilemedi"));
      }
    }
    function oylamaKutusu(t) {
      if (t.status !== "kontrol") return "";
      const kim = degerlendirenKimligi();
      const { onay, ret } = kontrolOySayilari(t);
      const benimOyum = kim ? kontrolOylari(t)[kim] : null;
      const tamamlayan = t.completedBy === "admin" ? "Sistem Yöneticisi" : (staffName(t.completedBy) || "Personel");
      const oylayabilir = kim && (t.completedBy || null) !== kim;
      return `<div style="margin-top:8px;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.35);border-radius:8px;padding:10px 12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="font-size:11px;color:#a78bfa;text-transform:uppercase;letter-spacing:.5px;font-weight:600">🗳️ Kontrol Oylaması — ${escapeHtml(tamamlayan)} tamamladı</div>
          <div style="font-size:12px"><b style="color:#37c98a">${onay}</b> <span style="color:var(--muted)">onay</span> • <b style="color:#f2617a">${ret}</b> <span style="color:var(--muted)">ret</span></div>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">${KONTROL_ONAY_ESIGI} onay alırsa görev kesinleşir, ${KONTROL_RET_ESIGI} ret alırsa havuza geri döner.</div>
        ${oylayabilir ? `<div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn ghost" style="flex:1;border-color:rgba(55,201,138,.5);color:#37c98a;${benimOyum === 'onay' ? 'background:rgba(55,201,138,.18)' : ''}" onclick="kontrolOyVer('${t.id}','onay')">👍 Onayla${benimOyum === 'onay' ? ' ✓' : ''}</button>
          <button class="btn ghost" style="flex:1;border-color:rgba(242,97,122,.5);color:#f2617a;${benimOyum === 'ret' ? 'background:rgba(242,97,122,.18)' : ''}" onclick="kontrolOyVer('${t.id}','ret')">👎 Yetersiz${benimOyum === 'ret' ? ' ✓' : ''}</button>
        </div>` : `<div style="font-size:12px;color:var(--muted);margin-top:6px">${kim ? "Kendi tamamladığın işe oy veremezsin — ekibin oylamasını bekle." : ""}</div>`}
      </div>`;
    }

    /* ---------- Günlük görev hedefi ----------
     * Her personelin günde kaç görev tamamlaması beklendiği ekip kaydında
     * (crm/staff) tutulur; yönetici Ekip ekranından değiştirir.
     *
     * SAYIM KURALI: kişi görevi "tamamlandı" işaretlediği GÜN sayılır —
     * görev ekip oylamasında ("kontrol") bekliyor olsa bile. Aksi halde
     * kişinin günlük sayısı meslektaşlarının ne zaman oy verdiğine bağlı
     * olurdu; kendi emeğini ölçen bir hedef bu olmazdı.
     */
    const GUNLUK_HEDEF_VARSAYILAN = 5;
    function gunlukHedef(staffId) {
      const s = (db.staff || []).find(x => x.id === staffId);
      const n = s && Number(s.gunlukHedef);
      return (Number.isFinite(n) && n >= 1 && n <= 99) ? Math.round(n) : GUNLUK_HEDEF_VARSAYILAN;
    }
    function bugunTamamlanan(staffId, tarih) {
      const t = tarih || todayStr();
      return (db.tasks || []).filter(x => x.completedBy === staffId && x.completedDate === t).length;
    }
    // Hedefi kişinin KENDİSİ belirler (Görevler ekranındaki kutudan).
    // Yönetici de Ekip ekranından herkesinkini düzenleyebilir; başkasının
    // hedefine karışmak dışında kimse kimsenin sayısını değiştiremez.
    function hedefiDegistirebilir(staffId) {
      return currentRole === "admin" || staffId === currentStaffId;
    }
    // Sayı girilmişse aralığa çekilir (0 yazan "en az" demek istemiştir → 1);
    // sayı DEĞİLSE varsayılana dönülür. "|| varsayılan" kullanılamaz, 0'ı yutar.
    function hedefeCek(deger) {
      const sayi = parseInt(deger, 10);
      return Number.isFinite(sayi) ? Math.min(99, Math.max(1, sayi)) : GUNLUK_HEDEF_VARSAYILAN;
    }
    async function setGunlukHedef(staffId, deger) {
      if (!hedefiDegistirebilir(staffId)) return;
      const n = hedefeCek(deger);
      await mutateStaff(d => {
        const s = (d.staff || []).find(x => x.id === staffId);
        if (s) s.gunlukHedef = n;
      });
    }
    // +/- düğmeleri: ekran anında güncellenir, Firestore'a yazma kısa bir
    // süre beklenir. Arka arkaya beşe basan biri tek kayıt yapsın —
    // her tıklamada transaction açmak hem kotayı hem de bağlantıyı yorar.
    let hedefYazmaZaman = null;
    function hedefAdimla(staffId, adim) {
      if (!hedefiDegistirebilir(staffId)) return;
      const s = (db.staff || []).find(x => x.id === staffId);
      if (!s) return;
      const yeni = hedefeCek(gunlukHedef(staffId) + adim);
      if (yeni === gunlukHedef(staffId)) return;   // sınırdayız, boşuna çizme
      s.gunlukHedef = yeni;
      render();
      clearTimeout(hedefYazmaZaman);
      hedefYazmaZaman = setTimeout(() => setGunlukHedef(staffId, yeni), 700);
    }
    // Kutuya elle yazıldığında (onchange) bekletmeden kaydedilir; bekleyen
    // bir +/- yazması varsa iptal edilir, yoksa eski değeri geri yazardı.
    function hedefYaz(staffId, deger) {
      clearTimeout(hedefYazmaZaman);
      return setGunlukHedef(staffId, deger);
    }
    // Ortak ilerleme çubuğu: hem personelin kendi kartında hem yöneticinin
    // ekip halkalarında aynı hesap kullanılsın diye tek yerde üretiliyor.
    function hedefCubugu(staffId, kompakt) {
      const hedef = gunlukHedef(staffId);
      const yapilan = bugunTamamlanan(staffId);
      const yuzde = Math.min(100, Math.round(yapilan / hedef * 100));
      const tamam = yapilan >= hedef;
      const renk = tamam ? "#37c98a" : yuzde >= 50 ? "var(--brand-2)" : "#f4b740";
      const kalan = Math.max(0, hedef - yapilan);

      if (kompakt) {
        return `<div title="Bugün tamamlanan görev: ${yapilan} / ${hedef}" style="margin-top:6px">
        <div style="height:5px;border-radius:3px;background:var(--line);overflow:hidden">
          <div style="height:100%;width:${yuzde}%;background:${renk};border-radius:3px;transition:width .3s"></div>
        </div>
        <div style="font-size:10px;color:${renk};font-weight:700;margin-top:3px">${tamam ? "✔ hedef tamam" : `${yapilan}/${hedef} bugün`}</div>
      </div>`;
      }

      // Hedef sayısı, sahibi için doğrudan kartın içinde düzenlenebilir —
      // kişi günün başında kendi hedefini buraya yazar.
      const kendinin = hedefiDegistirebilir(staffId) && (db.staff || []).some(s => s.id === staffId);
      const hedefAlani = kendinin
        ? `<span class="bolu">/</span>
          <span class="hedefKutu">
            <button type="button" onclick="hedefAdimla('${staffId}', -1)" title="Hedefi azalt" aria-label="Hedefi azalt"${hedef <= 1 ? ' disabled' : ''}>−</button>
            <input type="number" inputmode="numeric" min="1" max="99" step="1" value="${hedef}" id="hedefKutu_${staffId}"
              onchange="hedefYaz('${staffId}', this.value)"
              onfocus="this.select()"
              title="Bugün kaç görev tamamlamayı hedefliyorsun?" aria-label="Günlük görev hedefi">
            <button type="button" onclick="hedefAdimla('${staffId}', 1)" title="Hedefi artır" aria-label="Hedefi artır"${hedef >= 99 ? ' disabled' : ''}>+</button>
          </span>
          <span class="birim">görev</span>`
        : `<span class="bolu">/</span><span class="birim" style="font-size:15px;font-weight:700;color:var(--txt)">${hedef}</span><span class="birim">görev</span>`;

      return `<div class="card" style="margin-bottom:16px;${tamam ? 'border-color:rgba(55,201,138,.4)' : ''}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600">${icon('checkCircle', 13)} Günlük hedef</div>
        <div class="hedefSayac">
          <b class="yapilan" style="color:${renk}">${yapilan}</b>
          ${hedefAlani}
        </div>
      </div>
      <div style="height:10px;border-radius:5px;background:var(--line);overflow:hidden">
        <div style="height:100%;width:${yuzde}%;background:${renk};border-radius:5px;transition:width .4s"></div>
      </div>
      <div style="font-size:12px;color:${renk};font-weight:600;margin-top:8px">
        ${tamam ? "🎉 Bugünün hedefini tamamladın!" : `%${yuzde} — ${kalan} görev kaldı`}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5">
        Bugün tamamladığın görevler sayılır, sayaç her gün sıfırdan başlar.${kendinin ? " Hedefini yukarıdaki sayıyı değiştirerek kendin belirlersin." : ""}
      </div>
    </div>`;
    }

    // Ekip ekranındaki hedef satırı. Hedefi yalnızca yönetici değiştirir;
    // ekrana erişebilen diğer roller (muhasebe) sayıyı okur — personel bu
    // ekrana zaten giremiyor, Görevler'deki kendi çubuğunu görüyor.
    function hedefSatiri(staffId) {
      const hedef = gunlukHedef(staffId);
      const yapilan = bugunTamamlanan(staffId);
      const tamam = yapilan >= hedef;
      const renk = tamam ? "#37c98a" : "var(--muted)";
      if (currentRole !== "admin") {
        return `<div style="font-size:12px;color:var(--muted);margin-top:6px;padding-top:8px;border-top:1px dashed var(--line)">
      Günlük hedef: <b style="color:${renk}">${yapilan} / ${hedef}</b> görev
    </div>`;
      }
      return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:6px;padding-top:8px;border-top:1px dashed var(--line)">
    <span>${icon('checkCircle', 12)} Günlük görev hedefi</span>
    <input type="number" min="1" max="99" step="1" value="${hedef}" id="hedef_${staffId}"
      onchange="setGunlukHedef('${staffId}', this.value)"
      style="width:64px;padding:5px 8px;text-align:center;font-weight:700"
      title="Bu kişinin günde kaç görev tamamlaması bekleniyor? Kişi bu sayıyı kendi de değiştirebilir.">
    <span style="color:${renk};font-weight:600">bugün ${yapilan} tamamladı${tamam ? " ✔" : ""}</span>
  </div>`;
    }

    let seciliOncelik = ONCELIK_VARSAYILAN;
    function secOncelik(n) {
      seciliOncelik = Math.min(5, Math.max(1, Number(n) || ONCELIK_VARSAYILAN));
      const box = document.getElementById("tsk_oncelik");
      if (!box) return;
      let s = "";
      for (let i = 1; i <= 5; i++) {
        s += `<button type="button" class="yildizBtn" onclick="secOncelik(${i})" title="${ONCELIK_ETIKET[i]}" aria-label="${ONCELIK_ETIKET[i]}">${yildizIkon(i <= seciliOncelik, 24, i <= seciliOncelik ? ONCELIK_RENK[seciliOncelik] : "var(--line)")}</button>`;
      }
      box.innerHTML = s + `<span style="margin-left:10px;font-size:12.5px;color:${ONCELIK_RENK[seciliOncelik]};font-weight:600">${ONCELIK_ETIKET[seciliOncelik]}</span>`;
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
      return `<a class="wa-ico" href="${toWaLink(phone, text)}" target="_blank" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;justify-content:center;background:transparent;color:#25D366;border-radius:50%;width:26px;height:26px;text-decoration:none;transition:transform 0.2s;flex-shrink:0;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'" title="WhatsApp ile Mesaj Gönder">
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
      feedback: "Şikayet & Dilek",
      linda: "Linda (AI Asistan)",
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
          // Havuzdaki görevler de sayılır: kimse fark etmezse havuz öylece
          // bekler — rozetin işi zaten "bakılacak iş var" demek.
          // Ertelenmiş havuz görevi rozete sayılmaz — tarihi gelmeden
          // yapılacak iş değil, sayılırsa rozet hep dolu kalır.
          // Destekçi aranan görevler de sayılır: kimse fark etmezse talep
          // öylece bekler — rozetin işi zaten "bakılacak iş var" demek.
          : (db.tasks || []).filter(t => (isTaskFor(t, currentStaffId) && t.status !== "tamamlandı") || havuzdaAktif(t) || destekAraniyor(t)).length;
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
      if (currentView === "dashboard" || currentView === "settings" || currentView === "muhasebe" || currentView === "tasks" || currentView === "stock" || currentView === "matbaa" || currentView === "feedback" || currentView === "linda") {
        searchWrap.style.display = "none";
      } else {
        searchWrap.style.display = "block";
        searchInput.placeholder = currentView === "team" ? "Ekip üyesi ara..." : currentView === "accounting" ? "Yazar veya eser ara..." : "Yazar, telefon, görüşme, not ara...";
      }
      document.getElementById("btnNewAuthor").style.display = currentView === "authors" ? "inline-block" : "none";
      const fab = document.getElementById("fabNewAuthor");
      if (fab) fab.classList.toggle("show", currentView === "authors");

      const c = document.getElementById("content");
      // Giriş animasyonu (staggerFade) SADECE başka bir ekrana geçildiğinde
      // oynar. render() aynı zamanda her veri değişiminde de çağrılıyor
      // (oy verme, görev tamamlama, hedef değiştirme, ödeme ekleme...);
      // orada da oynasaydı en ufak işlemde bütün ekran baştan yükleniyormuş
      // gibi görünürdü — kullanıcı bunu "site sürekli yenileniyor" diye
      // yaşıyordu. Aynı ekran yeniden çizilirken sayfanın kaydırma konumu da
      // korunuyor, yoksa liste kısalınca en başa fırlıyor.
      const gorunumDegisti = sonCizilenGorunum !== currentView;
      const kaydirma = window.scrollY;
      // Sekme içinde kalırken class'ı kaldırmak şart: yeni oluşan kartlar
      // .view-enter altındayken animasyonu kendiliğinden baştan oynatır.
      c.classList.remove("view-enter");
      if (gorunumDegisti) void c.offsetWidth;
      if (currentView === "dashboard") {
        c.innerHTML = viewDashboard();
        setTimeout(initCharts, 0); // DOM update sonrası çalışması için
        // Reklam verisi oturumda bir kez çekilir; sonraki render'larda
        // hafızadaki kopya yeniden çizilir, tekrar okuma yapılmaz.
        setTimeout(reklamDurumuYukle, 0);
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
      else if (currentView === "feedback") c.innerHTML = viewFeedback();
      else if (currentView === "linda") { c.innerHTML = viewLinda(); renderChatInto("lindaMessages"); setTimeout(() => { const i = document.getElementById("lindaInput"); if (i) i.focus(); }, 0); }
      else if (currentView === "settings") { c.innerHTML = viewSettings(); if (currentRole === "admin") setTimeout(loadUserManagement, 0); }
      if (gorunumDegisti) c.classList.add("view-enter");
      else if (window.scrollY !== kaydirma) window.scrollTo(0, kaydirma);
      sonCizilenGorunum = currentView;
    }

    // Türkçe duyarlı, büyük/küçük harf ve aksan farkı gözetmeyen arama
    // anahtarı: "KIRMIZI", "kırmızı" ve "Kirmizi" aynı anahtara iner —
    // aramalarda İ/i, I/ı, ş/s, ğ/g, ü/u, ö/o, ç/c farkları eşleşmeyi bozmaz.
    function searchKey(s) {
      return (s || "").normalize("NFC").toLocaleLowerCase("tr")
        .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
        .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");
    }
    function searchTerm() { return searchKey(document.getElementById("search").value).trim(); }
    // Aranan kelimeyi metnin içinde fosforlu kalemle çizilmiş gibi işaretler.
    // Eşleştirme searchKey ile yapılır (büyük/küçük harf ve Türkçe karakter
    // duyarsız); dönüştürme harf başına bire bir olduğundan işaret konumları
    // orijinal metne aynen oturur. Çıktı HTML-kaçışlıdır, güvenle basılır.
    function vurgula(text, term) {
      const kaynak = String(text || "");
      const needle = searchKey(term || "").trim();
      if (!needle) return escapeHtml(kaynak);
      const key = searchKey(kaynak);
      if (key.length !== kaynak.length) return escapeHtml(kaynak); // beklenmedik uzunluk farkı — vurgusuz bas
      let out = "", i = 0;
      while (true) {
        const idx = key.indexOf(needle, i);
        if (idx === -1) { out += escapeHtml(kaynak.slice(i)); break; }
        out += escapeHtml(kaynak.slice(i, idx));
        out += `<mark style="background:#f4b740;color:#1a1a1e;border-radius:3px;padding:0 2px;font-weight:600">${escapeHtml(kaynak.slice(idx, idx + needle.length))}</mark>`;
        i = idx + needle.length;
      }
      return out;
    }
    // Personel yalnızca kendi görüşmelerini görür: kaydı kendisi eklemiş ya da
    // en az bir görüşmesini (log) kendisi yapmış olmalı. Admin ve muhasebe
    // tüm kayıtları görür. Ekip eşleşmesi olmayan personel hiçbirini göremez.
    // Ortak havuz: ileri tarihli takip/randevusu olmayan ve 7 gündür yeni
    // görüşme eklenmemiş adaylar TÜM görüşmecilere açılır — sahibi dönmediyse
    // başka bir görüşmeci devralıp arayabilir. Görüşme eklendiği anda kayıt
    // havuzdan çıkar (görüşmeyi ekleyen artık kaydı görmeye devam eder).
    const POOL_STALE_DAYS = 7;
    function isInCommonPool(a) {
      if (!["aday", "gorusuluyor", "degerlendirme", "eseryaziyor"].includes(a.status)) return false;
      const today = todayStr();
      if (a.followup && a.followup >= today) return false;
      if (a.interviewDate && a.interviewDate >= today) return false;
      const logs = (a.logs || []).filter(l => l.date);
      const last = logs.length ? logs.reduce((m, l) => l.date > m ? l.date : m, "") : (a.created || today);
      return Math.round((new Date(today) - new Date(last)) / 864e5) >= POOL_STALE_DAYS;
    }
    function canSeeAuthor(a) {
      if (currentRole !== "personel") return true;
      if (!currentStaffId) return false;
      if (a.addedBy === currentStaffId) return true;
      if ((a.logs || []).some(l => l.staffId === currentStaffId)) return true;
      return isInCommonPool(a);
    }
    function visibleAuthors() { return (db.authors || []).filter(canSeeAuthor); }

    function filteredAuthors() {
      const t = searchTerm();
      return visibleAuthors().filter(a => {
        // Görüşme (log) metinleri de aranır: bir görüşmede geçen kelime
        // yazıldığında o görüşmenin yapıldığı yazarlar listelenir.
        const hay = searchKey(a.name + " " + (a.genres || []).join(" ") + " " + (a.work || "") + " " + (a.notes || "") + " " + (a.phone || "") + " " + (a.logs || []).map(l => l.text || "").join(" "));
        let statusMatch = (filterStatus === "all" || a.status === filterStatus);
        if (filterStatus === "havuz") statusMatch = isInCommonPool(a);
        if (currentView === "authors" && (a.status === "sozlesme" || a.status === "yayinda")) {
          statusMatch = false;
        }
        return (!t || hay.includes(t)) && statusMatch;
      });
    }

    /* ---------- Reklam iyileştirmeleri (Yazar yönetim panelinden) ----------
     * Meta reklam denetimini PANEL (app.mstyayincilik.com) çalıştırır ve
     * sonucunu crm/reklam_durumu dokümanına yazar; CRM sadece OKUR. Böylece
     * CRM'in Meta'ya bağlanması, reklam jetonu tutması ya da 115 kuralı
     * ikinci kez uygulaması gerekmiyor — motor tek yerde kalıyor.
     *
     * KOTA: tek doküman = tek okuma, üstelik yalnızca YÖNETİCİ panoyu
     * açtığında çekiliyor. Personel bu maliyeti hiç ödemiyor. onSnapshot
     * değil tek seferlik get — canlı dinleyici açıp boşuna okuma harcamıyor
     * (reklam verisi zaten saatte bir güncellenen bir şey).
     */
    const REKLAM_DOC = "reklam_durumu";
    // Yönetim paneli (reklam denetiminin arayüzü) — yazarların kullandığı
    // app.mstyayincilik.com DEĞİL; o adres karttaki düğmeyi yanlış yere
    // götürüyordu (kullanıcı bildirimi, 2026-08-11).
    const REKLAM_PANEL_URL = "https://admin.mstyayincilik.com";
    // Panel bu süreden uzaktır yazmadıysa veri "bayat" sayılır. Eski reklam
    // verisiyle bütçe kararı almak zarar verir; sessizce eski veriyi
    // göstermektense açıkça uyarmak daha güvenli.
    const REKLAM_BAYAT_SAAT = 36;
    let reklamDurumu = { asama: "baslamadi", veri: null, hata: null };

    async function reklamDurumuYukle() {
      if (currentRole !== "admin") return;
      if (reklamDurumu.asama === "yukleniyor" || reklamDurumu.asama === "bitti") { reklamKartiCiz(); return; }
      reklamDurumu.asama = "yukleniyor";
      reklamKartiCiz();
      try {
        const d = await firestore.collection("crm").doc(REKLAM_DOC).get();
        reklamDurumu = { asama: "bitti", veri: d.exists ? d.data() : null, hata: null };
      } catch (e) {
        console.error("Reklam durumu okunamadı:", e);
        reklamDurumu = { asama: "bitti", veri: null, hata: dbErrorText(e, "Reklam verisi okunamadı") };
      }
      reklamKartiCiz();
    }

    function reklamSaatFarki(iso) {
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return null;
      return (Date.now() - t) / 3600000;
    }
    // CTR'de yüksek iyi, CPM'de düşük iyi — yön aynı, anlam ters.
    function reklamTrend(simdi, onceki, yuksekIyi) {
      if (typeof simdi !== "number" || typeof onceki !== "number" || !onceki) return "";
      const fark = (simdi - onceki) / onceki * 100;
      if (Math.abs(fark) < 1) return `<span style="font-size:11px;color:var(--muted)">≈ sabit</span>`;
      const artti = fark > 0;
      const iyi = yuksekIyi ? artti : !artti;
      const renk = iyi ? "#37c98a" : "#f2617a";
      return `<span style="font-size:11px;color:${renk};font-weight:600">${artti ? "▲" : "▼"} %${Math.abs(fark).toFixed(0)}</span>`;
    }
    function reklamSayi(n, ondalik) {
      if (typeof n !== "number") return "—";
      return n.toLocaleString("tr-TR", { minimumFractionDigits: ondalik || 0, maximumFractionDigits: ondalik || 0 });
    }

    function reklamKartiIcerik() {
      const { asama, veri, hata } = reklamDurumu;
      if (asama === "baslamadi" || asama === "yukleniyor") {
        return `<div class="empty" style="padding:14px">Reklam verisi yükleniyor…</div>`;
      }
      if (hata) return `<div class="empty" style="padding:14px;color:var(--red)">${escapeHtml(hata)}</div>`;
      if (!veri) {
        return `<div class="empty" style="padding:14px">
          Yönetim paneli henüz reklam verisi yazmamış.
          <div style="font-size:11px;margin-top:6px">Panel <code>crm/${REKLAM_DOC}</code> dokümanını yazmaya başlayınca bu kart kendiliğinden dolar.</div>
        </div>`;
      }

      const o = veri.ozet || {}, t = veri.trend || {}, s = veri.sayilar || {};
      const yas = reklamSaatFarki(veri.guncellenme);
      const bayat = yas === null || yas > REKLAM_BAYAT_SAAT;
      const yasMetni = yas === null ? "tarih bilinmiyor"
        : yas < 1 ? "az önce güncellendi"
          : yas < 24 ? `${Math.round(yas)} saat önce güncellendi`
            : `${Math.round(yas / 24)} gün önce güncellendi`;

      const kutu = (etiket, deger, ek) => `<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:10px 12px">
        <div style="font-size:17px;font-weight:700">${deger}</div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-top:2px">${etiket} ${ek || ""}</div>
      </div>`;

      // Izgara (flex değil): flex'te son satıra tek kutu düşünce flex-grow
      // onu satır boyunca şişiriyordu. auto-fit ile kutular hep eşit kalır.
      const rakamlar = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px;margin-bottom:12px">
        ${kutu("Harcama", reklamSayi(o.harcama) + " ₺")}
        ${kutu("Erişim", reklamSayi(o.erisim))}
        ${kutu("Tıklama", reklamSayi(o.tiklama))}
        ${kutu("CPM", reklamSayi(o.cpm) + " ₺", reklamTrend(t.simdikiCPM, t.oncekiCPM, false))}
        ${kutu("CTR", "%" + reklamSayi(o.ctr, 2), reklamTrend(t.simdikiCTR, t.oncekiCTR, true))}
        ${kutu("Frekans", reklamSayi(o.frekans, 1))}
      </div>`;

      const bulgular = Array.isArray(veri.bulgular) ? veri.bulgular : [];
      const bulguHtml = bulgular.length
        ? bulgular.map(b => `<div style="border-left:3px solid var(--brand-2);padding:8px 0 8px 10px;margin-bottom:8px">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:3px">
              <span style="font-size:10px;color:var(--brand-2);background:rgba(59,130,246,.15);border-radius:20px;padding:1px 8px">${escapeHtml(b.grup || "")}</span>
              <b style="font-size:13px">${escapeHtml(b.aksiyon || "—")}</b>
            </div>
            ${b.olcum ? `<div style="font-size:12px;color:var(--muted)">${escapeHtml(b.olcum)}</div>` : ""}
            ${b.neden ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">${escapeHtml(b.neden)}</div>` : ""}
            ${b.etki ? `<div style="font-size:11px;color:#37c98a;margin-top:3px">Beklenen etki: ${escapeHtml(b.etki)}</div>` : ""}
          </div>`).join("")
        : `<div class="empty" style="padding:10px">Şu an uygulanabilir bir öneri yok.</div>`;

      const sayac = (s.toplamKural || s.ihlal)
        ? `<div style="font-size:11px;color:var(--muted);margin:2px 0 10px">
            ${s.toplamKural || "?"} kuralın ${s.kontrolEdilen || "?"} tanesi ölçülebildi ·
            <b style="color:var(--txt)">${s.ihlal || 0} bulgu</b> ·
            ${s.uygulanabilir || 0} tanesi doğrudan uygulanabilir</div>`
        : "";

      return `${bayat ? `<div style="background:rgba(244,183,64,.12);border:1px solid rgba(244,183,64,.4);color:#f4b740;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:10px">
          ${icon('alertTriangle', 13)} Veri güncel değil (${escapeHtml(yasMetni)}). Panel yazmayı durdurmuş olabilir — karar almadan önce panelden kontrol edin.
        </div>` : ""}
        ${rakamlar}${sayac}
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Uygulanabilir öneriler</div>
        ${bulguHtml}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">
          <span style="font-size:11px;color:var(--muted)">${escapeHtml(veri.donem || "")} • ${escapeHtml(yasMetni)}</span>
          <a href="${REKLAM_PANEL_URL}" target="_blank" rel="noopener" class="btn ghost" style="padding:5px 12px;font-size:12px;text-decoration:none">Panelde aç ↗</a>
        </div>`;
    }

    function reklamKartiCiz() {
      const el = document.getElementById("reklamKartiGovde");
      if (el) el.innerHTML = reklamKartiIcerik();
    }

    function viewDashboard() {
      const a = visibleAuthors();
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

      const missedCount = getMissedAuthors().length;
      const reportBtn = `<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    <button class="btn ghost" style="${missedCount ? 'border-color:var(--red);color:var(--red)' : ''}" onclick="openMissedReport()">${icon('alertTriangle', 14)} Dönülmemiş Yazarlar${missedCount ? ' (' + missedCount + ')' : ''}</button>
    <button class="btn ghost" onclick="openDailyReport()">${icon('trendingUp', 14)} Gün Sonu Raporu</button>
  </div>`;

      // Reklam kartı yalnızca yöneticide. Personelin işine yaramadığı gibi,
      // gereksiz bir Firestore okuması da doğururdu.
      const reklamKarti = currentRole === "admin" ? `<div class="card" style="margin-bottom:16px">
    <h4 style="margin:0 0 12px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">${icon('trendingUp', 14)} Reklam İyileştirmeleri</h4>
    <div id="reklamKartiGovde"></div>
  </div>` : "";

      return reportBtn + stats + reklamKarti + `<div class="grid grid-2col" style="gap:16px">${follow}${recent}</div>`;
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
      <button class="btn ghost" onclick="exportFullBackupExcel()">${icon('download', 14)} Excel — Tüm Yazarlar (.xlsx)</button>
      <button class="btn ghost" onclick="exportData()">${icon('download', 14)} JSON</button>
    </div>
  </div>`;

      if (currentRole === "admin") {
        const mAktif = !!maintenanceMode.active;
        html += `<div class="card settings-card" style="margin-bottom:16px;max-width:520px;${mAktif ? 'border-color:var(--amber)' : ''}">
    <h3 style="margin:0 0 8px;font-size:14px">${icon('alertTriangle', 15)} Güncelleme Modu</h3>
    <div style="color:var(--muted);font-size:12px;margin-bottom:12px">Açıkken tüm kullanıcıların ekranında "güncelleme yapılıyor, lütfen veri kaydetmeyin" uyarısı belirir. CRM'de değişiklik yapmaya başlamadan önce açın, işiniz bitince kapatın — uyarı herkesten anında kalkar.</div>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button class="btn ${mAktif ? '' : 'ghost'}" style="${mAktif ? 'background:rgba(244,183,64,0.2);border-color:var(--amber);color:var(--amber)' : ''}" onclick="toggleMaintenanceMode()">${mAktif ? 'Güncelleme Modunu KAPAT' : 'Güncelleme Modunu AÇ'}</button>
      <span style="font-size:12px;color:${mAktif ? 'var(--amber)' : 'var(--muted)'}">${mAktif ? '⚠️ Şu anda AÇIK — kullanıcılar uyarıyı görüyor' : 'Kapalı'}</span>
    </div>
  </div>`;
      }

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
      visibleAuthors().forEach(a => (a.payments || []).forEach(p => {
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
      visibleAuthors().forEach(a => (a.payments || []).forEach(p => {
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
      visibleAuthors().forEach(a => { if (statusCounts[a.status] !== undefined) statusCounts[a.status]++; });

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
      visibleAuthors().forEach(a => {
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
      const counts = { all: visibleAuthors().filter(a => a.status !== "sozlesme" && a.status !== "yayinda").length };
      visibleStatuses.forEach(s => counts[s] = visibleAuthors().filter(a => a.status === s).length);

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
      
      const havuzCount = visibleAuthors().filter(isInCommonPool).length;
      const havuzActive = filterStatus === 'havuz';
      const havuzStyle = havuzActive ? `background: rgba(45, 212, 191, 0.15); border-color: #2dd4bf; color: #2dd4bf; box-shadow: 0 0 14px rgba(45,212,191,0.2);` : ``;
      bar += `<span class="pill ${havuzActive ? 'active' : ''}" style="${havuzStyle}" onclick="setFilter('havuz')" onmouseover="this.style.borderColor='#2dd4bf'" onmouseout="if(!${havuzActive}) this.style.borderColor='var(--line)'">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2dd4bf;margin-right:8px;box-shadow:0 0 8px #2dd4bf"></span>
          Ortak Havuz (${havuzCount})
        </span>`;

      const dfStyle = filterDate !== 'all' ? `background: rgba(74, 168, 255, 0.15); border-color: #4aa8ff; color: #4aa8ff; margin-left: auto;` : `margin-left: auto; border: 1px solid rgba(255,255,255,0.15);`;
      bar += `<button class="btn ${filterDate !== 'all' ? '' : 'ghost'}" style="${dfStyle}" onclick="openDateFilterModal()">${icon('calendar', 14)} Tarih: ${filterDate === 'all' ? 'Tümü' : filterDate}</button>`;

      const gbActive = authorsGroupBy === 'staff';
      const gbStyle = gbActive ? `background: rgba(167, 139, 250, 0.15); border-color: #a78bfa; color: #a78bfa;` : `border: 1px solid rgba(255,255,255,0.15);`;
      bar += `<button class="btn ${gbActive ? '' : 'ghost'}" style="${gbStyle}" onclick="setAuthorsGroupBy('${gbActive ? 'date' : 'staff'}')">${icon('users', 14)} Görüşmeciye Göre</button>`;
      bar += `<button class="btn ghost" style="border: 1px solid rgba(255,255,255,0.15);" onclick="openDailyReport()" title="Bugünün şu ana kadarki raporu">${icon('trendingUp', 14)} Rapor</button>`;
      bar += `<button class="btn ghost" style="border: 1px solid rgba(45,212,191,0.4);color:#2dd4bf" onclick="openImportModal()" title="PDF / Word / Excel belgesinden yazarları toplu kaydet">📄 Belgeden Yükle</button>`;

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

      // Görüşmeciye göre grupla: günlük bölümler halinde, her günün altında
      // o gün kayıt ekleyen görüşmecilerin sütunları yan yana gösterilir.
      if (authorsGroupBy === 'staff') {
        const dateFiltered = filterDate === 'all' ? list : list.filter(a => getAuthorDate(a) === filterDate);

        // Kayıt hangi görüşmeciye yazılacak: o gün görüşme (log) ekleyen
        // personel varsa görüşmeyi yapan o kişidir; yoksa kaydı ekleyen.
        const ownerFor = (a, date) => {
          const dayLogs = (a.logs || []).filter(l => l.date === date && l.staffId);
          if (dayLogs.length) return dayLogs[dayLogs.length - 1].staffId;
          return a.addedBy || 'admin';
        };

        const byDate = {};
        dateFiltered.forEach(a => {
          const d = getAuthorDate(a);
          (byDate[d] = byDate[d] || []).push(a);
        });
        // İstatistik kaynağı: filtre bağımsız TÜM kayıtlar (yazarlar listesi
        // sözleşme/yayında olanları gizlediği için görünen listeden sayılamaz).
        const allByDate = {};
        visibleAuthors().forEach(a => {
          const d = getAuthorDate(a);
          (allByDate[d] = allByDate[d] || []).push(a);
        });

        const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
        if (!dates.length) return bar + `<div class="empty">Bu tarihte kayıt bulunamadı.</div>`;

        const chip = (label, val, color) => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:${color};background:${color}18;border:1px solid ${color}44;border-radius:20px;padding:2px 8px;white-space:nowrap"><b>${val}</b> ${label}</span>`;

        let staffHtml = bar;
        let rendered = 0;
        const totalInScope = dateFiltered.length;
        for (const date of dates) {
          if (rendered >= authorsRenderLimit) break;
          const dayAuthors = byDate[date];
          const byStaff = {};
          dayAuthors.forEach(a => {
            const key = ownerFor(a, date);
            (byStaff[key] = byStaff[key] || []).push(a);
          });
          // Sütun sırası: ekip listesi sırası, sonra Sistem Yöneticisi, sonra eşleşmeyenler
          const orderedKeys = [];
          (db.staff || []).forEach(s => { if (byStaff[s.id]) orderedKeys.push(s.id); });
          if (byStaff['admin'] && !orderedKeys.includes('admin')) orderedKeys.push('admin');
          Object.keys(byStaff).forEach(k => { if (!orderedKeys.includes(k)) orderedKeys.push(k); });

          staffHtml += `<h2 style="margin: 24px 0 12px; color: var(--blue); font-size: 16px; border-bottom: 1px solid rgba(74, 168, 255, 0.3); padding-bottom: 8px;">${icon('calendar', 15)} ${date} Tarihli İşlemler</h2>`;
          staffHtml += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px;align-items:start">`;
          orderedKeys.forEach(key => {
            const gName = key === 'admin' ? 'Sistem Yöneticisi' : (staffName(key) || 'Personel');
            const items = byStaff[key];
            const remaining = Math.max(0, authorsRenderLimit - rendered);
            const shown = items.slice(0, remaining);
            rendered += shown.length;
            // O günün istatistikleri: görüşmecinin o gün eklediği/işlem gördüğü tüm kayıtlar
            const dayAll = (allByDate[date] || []).filter(a => ownerFor(a, date) === key);
            const olumlu = dayAll.filter(a => a.status === 'sozlesme' || a.status === 'yayinda').length;
            const olumsuz = dayAll.filter(a => a.status === 'arsiv').length;
            const devam = dayAll.length - olumlu - olumsuz;
            // Başarı oranı sonuçlanmış görüşmeler üzerinden: olumlu / (olumlu + olumsuz)
            const sonuclanan = olumlu + olumsuz;
            const basari = sonuclanan > 0 ? Math.round(olumlu / sonuclanan * 100) : null;
            staffHtml += `<div>
              <h3 style="margin:0 0 8px;display:flex;align-items:center;gap:8px;font-size:14px;color:var(--txt);border-bottom:2px solid ${avatarColor(gName)};padding-bottom:8px">
                <span class="avatar" style="background:${avatarColor(gName)};width:24px;height:24px;font-size:10px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%">${escapeHtml(initials(gName))}</span>
                ${escapeHtml(gName)}
              </h3>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
                ${chip('görüşme', dayAll.length, '#4aa8ff')}
                ${chip('olumlu', olumlu, '#37c98a')}
                ${chip('olumsuz', olumsuz, '#ef5350')}
                ${chip('devam eden', devam, '#f4b740')}
                ${basari !== null ? chip('başarı', '%' + basari, '#a78bfa') : chip('başarı', '%—', '#9aa1b2')}
              </div>
              <div style="display:flex;flex-direction:column;gap:12px">${shown.map(authorCard).join("")}</div>
            </div>`;
          });
          staffHtml += `</div>`;
        }
        if (rendered < totalInScope) {
          staffHtml += `<div style="display:flex;justify-content:center;margin:20px 0"><button class="btn ghost" onclick="showMoreAuthors()">Daha Fazla Göster (${totalInScope - rendered} kayıt daha)</button></div>`;
        }
        return staffHtml;
      }

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
            // O gün telefonla aranıp AÇMAYANLAR sağda ayrı sütunda toplanır;
            // solda görüşülenler (ve o gün eklenen diğer kayıtlar) kalır.
            const acmayanlar = [], gorusulenler = [];
            dateAuthors.forEach(a => {
              const dayLogs = (a.logs || []).filter(l => l.date === date);
              const acmadiVar = dayLogs.some(l => l.type === "Telefon" && UNREACHED_CALL_RE.test(l.text || ""));
              // Sonradan açıp görüşme yapılan (türü ne olursa olsun gerçek bir
              // kayıt eklenen) yazar Açmayanlar'dan çıkar, Görüşülenler'e döner.
              const gorusmeVar = dayLogs.some(l => !(l.type === "Telefon" && UNREACHED_CALL_RE.test(l.text || "")));
              (acmadiVar && !gorusmeVar ? acmayanlar : gorusulenler).push(a);
            });
            if (acmayanlar.length) {
              htmlOutput += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;align-items:start">`;
              htmlOutput += `<div>
                <h3 style="margin:0 0 10px;font-size:14px;color:#37c98a;display:flex;align-items:center;gap:6px">${icon('checkCircle', 14)} Görüşülenler (${gorusulenler.length})</h3>
                <div style="display:flex;flex-direction:column;gap:12px">${gorusulenler.map(authorCard).join("")}</div>
              </div>`;
              htmlOutput += `<div>
                <h3 style="margin:0 0 10px;font-size:14px;color:#f2617a;display:flex;align-items:center;gap:6px">📵 Açmayanlar (${acmayanlar.length})</h3>
                <div style="display:flex;flex-direction:column;gap:12px">${acmayanlar.map(authorCard).join("")}</div>
              </div>`;
              htmlOutput += `</div>`;
            } else {
              htmlOutput += `<div class="grid authors">`;
              htmlOutput += dateAuthors.map(authorCard).join("");
              htmlOutput += `</div>`;
            }
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

      // Devam eden görüşmelerde ismin altında kaç gündür görüşüldüğü yazar
      // (başlangıç: kaydın eklendiği tarih; kart açılmadan görünsün diye).
      let gorusmeSuresi = '';
      if ((a.status === 'aday' || a.status === 'gorusuluyor' || a.status === 'degerlendirme' || a.status === 'eseryaziyor') && a.created) {
        const gDays = Math.max(0, Math.round((new Date().setHours(0, 0, 0, 0) - new Date(a.created)) / 864e5));
        const gTxt = gDays === 0 ? 'Bugün eklendi' : gDays + ' gündür görüşülüyor';
        const gCol = gDays >= 30 ? 'var(--red)' : gDays >= 14 ? 'var(--amber)' : 'var(--muted)';
        gorusmeSuresi = `<div style="font-size:11px;color:${gCol};display:flex;align-items:center;gap:4px;margin-top:2px">${icon('clock', 11)} ${gTxt}</div>`;
      }

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
        ${gorusmeSuresi}
        ${isInCommonPool(a) ? `<div style="font-size:11px;color:#2dd4bf;font-weight:700;display:flex;align-items:center;gap:4px;margin-top:2px">${icon('users', 11)} ORTAK HAVUZ — herkes arayabilir</div>` : ''}
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
      <div style="display:flex;align-items:center;gap:8px" onclick="event.stopPropagation()">${(() => {
        if (!["aday", "gorusuluyor", "degerlendirme", "eseryaziyor"].includes(a.status)) return "";
        // Bugün gerçek bir görüşme eklendiyse (açmadı kaydı dışında herhangi
        // bir kayıt) Açmadı simgesi karttan kalkar — artık gereksizdir.
        const bugun = todayStr();
        const bugunGorusuldu = (a.logs || []).some(l => l.date === bugun && !(l.type === "Telefon" && UNREACHED_CALL_RE.test(l.text || "")));
        if (bugunGorusuldu) return "";
        return `<button class="btn ghost" style="padding:3px 8px;font-size:11px;border-color:rgba(242,97,122,.4);color:#f2617a;white-space:nowrap" onclick="markNoAnswer('${a.id}')" title="Bugün arandı, açmadı; mesaj iletildi olarak kaydet">📵 Açmadı</button>`;
      })()}${fl} ${waBtn(a.phone)}</div>
    </div>
    </div>
    </div>
  </div>`;
    }

    // Tek tıkla "arandı ama açmadı, mesaj iletildi" görüşme kaydı düşer.
    // Metin, ulaşılamayan arama tespitiyle (UNREACHED_CALL_RE) uyumludur —
    // kart o günün bölümünde "Açmayanlar" sütununa geçer.
    async function markNoAnswer(id) {
      const entry = { type: "Telefon", date: todayStr(), time: null, text: "Açmadı, mesaj iletildi", staffId: currentStaffId || null };
      await mutateAuthor(id, a => {
        a.logs = a.logs || [];
        if (!a.logs.some(l => l.date === entry.date && l.text === entry.text)) a.logs.push(entry);
      });
      render();
    }

    function setFilter(s) { filterStatus = s; authorsRenderLimit = 60; render(); }
    function setDateFilter(d) { filterDate = d; authorsRenderLimit = 60; render(); }
    function setAuthorsGroupBy(m) { authorsGroupBy = m; authorsRenderLimit = 60; render(); }
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
      const allContracted = visibleAuthors().filter(a => a.status === "sozlesme" || a.status === "yayinda");
      const PKG_TYPES = Object.keys(PACKAGES);

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
      const match = a => !t || searchKey(a.name + " " + (a.genres || []).join(" ") + " " + (a.work || "") + " " + (a.notes || "") + " " + (a.phone || "") + " " + (a.logs || []).map(l => l.text || "").join(" ")).includes(t);
      const getCDate = a => new Date(getContractDate(a) || 0).getTime();
      const sozlesme = visibleAuthors().filter(a => a.status === "sozlesme" && match(a)).sort((x, y) => getCDate(y) - getCDate(x));
      const yayinda = visibleAuthors().filter(a => a.status === "yayinda" && match(a)).sort((x, y) => getCDate(y) - getCDate(x));
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
      visibleAuthors().forEach(a => {
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
      const match = a => !t || searchKey(a.name + " " + (a.work || "")).includes(t);
      const contracted = visibleAuthors().filter(a => (a.status === "sozlesme" || a.status === "yayinda") && match(a));
      // Sözleşmesi bitip arşivlenen ama ödeme geçmişi olan yazarlar da listede kalsın.
      const archivedWithPayments = visibleAuthors().filter(a => a.status !== "sozlesme" && a.status !== "yayinda" && (a.payments || []).length > 0 && match(a));
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
      const paidPayments = visibleAuthors().flatMap(a =>
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
    const STOCK_CRITICAL_LIMIT = 5;
    function stockResultsHtml() {
      // Stoğu kritik sınırın (5) altına düşenler en öne (en azdan çoğa),
      // kalanlar alfabetik sıralanır.
      const list = db.stock.slice().sort((a, b) => {
        const aKritik = (a.quantity || 0) < STOCK_CRITICAL_LIMIT;
        const bKritik = (b.quantity || 0) < STOCK_CRITICAL_LIMIT;
        if (aKritik !== bKritik) return aKritik ? -1 : 1;
        if (aKritik && bKritik) return (a.quantity || 0) - (b.quantity || 0);
        return a.title.localeCompare(b.title, 'tr');
      });
      const t = searchKey(stockSearch).trim();
      const filtered = t ? list.filter(x => searchKey(x.title).includes(t)) : list;
      return filtered.length ? filtered.map(x => {
        const kritik = (x.quantity || 0) < STOCK_CRITICAL_LIMIT;
        return `<div class="mini" style="display:flex;justify-content:space-between;align-items:center;gap:8px;${kritik ? 'border-left:3px solid var(--red);padding-left:8px;background:rgba(242,97,122,0.06);border-radius:8px' : ''}">
      <div><span class="mn">${escapeHtml(x.title)}</span><div class="ms">${escapeHtml(x.type || 'Kitap')}${kritik ? ` <span style="color:var(--red);font-weight:700">• STOK KRİTİK</span>` : ''}</div></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-weight:700;white-space:nowrap;color:${kritik ? 'var(--red)' : 'var(--brand)'}">${(x.quantity || 0).toLocaleString('tr-TR')} adet</span>
        <button class="btn ghost" style="padding:4px 8px" onclick="openStockModal('${x.id}')" title="Düzenle">${icon('edit', 13)}</button>
        <button class="btn ghost" style="padding:4px 8px" onclick="delStockItem('${x.id}')" title="Sil">${icon('trash', 13)}</button>
      </div>
    </div>`;
      }).join('') : `<div class="empty">Kayıt bulunamadı.</div>`;
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
      const norm = searchKey(title).trim();
      const existing = db.stock.find(s => searchKey(s.title).trim() === norm);
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
        <span style="font-weight:600;white-space:nowrap">${(o.quantity || 0).toLocaleString('tr-TR')} adet</span>
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
    /* ---------- Ortak görev ----------
     * Bir görev birden fazla kişiye atanabilir. ESKİ kayıtlarda yalnızca
     * assignedTo (tek personel) var, YENİ kayıtlarda asıl kaynak assignees
     * dizisi. assignedTo yine de ilk kişiyle doldurulmaya devam ediyor:
     * gözden kaçmış bir okuma yolu kalırsa boş isim yerine bir isim görsün.
     * Bu yüzden her yerde doğrudan alan okumak yerine taskAssignees()
     * kullanılmalı — tek kişilik eski görevleri de tek elemanlı dizi olarak
     * döndürüp iki biçimi tek yola indiriyor.
     *
     * Tamamlama kuralı: İLK tamamlayan görevi HERKES için kapatır. Bu yüzden
     * kişi bazlı durum tutulmuyor, tek bir status alanı yetiyor; kimin
     * kapattığı completedBy'da duruyor.
     */
    function taskAssignees(t) {
      if (!t) return [];
      if (Array.isArray(t.assignees) && t.assignees.length) return t.assignees;
      return t.assignedTo ? [t.assignedTo] : [];
    }
    function isTaskFor(t, staffId) {
      return !!staffId && taskAssignees(t).indexOf(staffId) !== -1;
    }
    function isSharedTask(t) { return taskAssignees(t).length > 1; }
    function taskAssigneeNames(t) {
      const names = taskAssignees(t).map(id => id === "admin" ? "Sistem Yöneticisi" : (staffName(id) || "—"));
      return names.length ? names.join(", ") : "—";
    }
    // Görev sistemindeki kimliğim: personel için ekip id'si, admin için
    // "admin". Admin ekip listesinde kayıtlı olmayabilir ama havuzdan görev
    // alıp tamamlayabilmeli — bu yüzden currentStaffId'ye düşülmez.
    function myTaskId() {
      return currentStaffId || (currentRole === "admin" ? "admin" : null);
    }

    /* ---------- Görev havuzu ----------
     * Kimseye atanmamış görevler havuzda bekler; personel oradan kendine
     * görev ALIR. Havuzdaki görevin assignees'i BOŞTUR — bu yüzden
     * isTaskFor() ona false döner ve normal görünürlük süzgecine takılmaz;
     * havuz görevleri listelere ayrıca eklenir (bkz. viewTasks).
     *
     * Görev alma İŞLEM (transaction) ile yapılır: iki kişi aynı anda
     * "Görevi Al" derse ikisi de alamaz, ilki kazanır. Basit bir update
     * kullanılsaydı iki kişi aynı görevi üstlenmiş sanıp aynı işi iki kez
     * yapardı.
     */
    function isHavuzGorevi(t) {
      return !!t && t.havuzda === true && t.status !== "tamamlandı";
    }

    /* ---------- Erteleme ----------
     * Havuzdan alınan (ya da havuzda duran) bir görev SEBEBİ yazılarak
     * ertelenebilir; görev havuza geri düşer. Tarih verilirse o güne kadar
     * "beklemede" kalır: aktif havuz listesini, yan menü rozetini ve
     * bildirim listesini meşgul etmez, tarihi gelince kendiliğinden aktif
     * havuza döner (ayrı bir zamanlanmış işe gerek yok — sadece tarih
     * karşılaştırması).
     *
     * Sebep ZORUNLU: bir görev havuzda dolaşıp duruyorsa sebebini görmek
     * (dosya yok / yetki yok / yoğunluk) asıl bilgidir. Geçmiş
     * ertelemeGecmisi'nde birikir, kartta gösterilir.
     */
    function ertelenmisMi(t) {
      return isHavuzGorevi(t) && !!t.ertelemeTarihi && t.ertelemeTarihi > todayStr();
    }
    // Şu an üstlenilebilir havuz görevi (ertelenmişler hariç).
    function havuzdaAktif(t) {
      return isHavuzGorevi(t) && !ertelenmisMi(t);
    }
    // Ertelenebilir mi? Elimdeki görevi ben (ya da yönetici) erteleyebilirim.
    // Havuzda ÖYLECE duran görevi yalnızca yönetici erteleyebilir — yoksa bir
    // kişi kimsenin göremeyeceği şekilde işi ileri atabilirdi.
    function ertelenebilirMi(t) {
      if (!t || t.status === "tamamlandı") return false;
      if (currentRole === "admin") return true;
      if (!currentStaffId) return false;
      if (isHavuzGorevi(t)) return false;
      return isTaskFor(t, currentStaffId);
    }

    // Personel kendi eklediği görevi düzeltebilsin/silebilsin (yazım hatası,
    // yanlışlıkla eklenmiş görev). AMA havuza bıraktığı görevi başkası
    // üstlendiyse artık dokunamaz — çalışılan işi altından çekmesin.
    function gorevuYonetebilir(t) {
      if (currentRole === "admin") return true;
      if (!t || !currentStaffId) return false;
      if (t.assignedBy !== currentStaffId) return false;
      if (t.status === "tamamlandı") return false;
      const atananlar = taskAssignees(t);
      return atananlar.length === 0 || (atananlar.length === 1 && atananlar[0] === currentStaffId);
    }

    async function gorevAl(taskId) {
      const benim = myTaskId();
      if (!benim) { customAlert("Görev alınamadı", "Hesabınız ekip listesiyle eşleşmediği için görev alamıyorsunuz. Yöneticinize bildirin."); return; }
      const t = db.tasks.find(x => x.id === taskId);
      if (!(await customConfirm(`"${t ? t.title : "Bu görev"}" görevini üstleniyor musun?\n\nGörev havuzdan çıkıp senin listene geçecek.`, "Evet, Görevi Al"))) return;

      const ref = firestore.collection("tasks").doc(taskId);
      // Görev üstlenilince erteleme beklemesi biter (geçmişi kalır).
      const alinma = { havuzda: false, assignees: [benim], assignedTo: benim, alanKisi: benim, alinmaTarihi: todayStr(), ertelemeTarihi: null };
      try {
        await firestore.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw new Error("YOK");
          if (snap.data().havuzda !== true) throw new Error("ALINMIS");
          tx.update(ref, alinma);
        });
        if (t) Object.assign(t, alinma);
        render();
      } catch (e) {
        if (e.message === "ALINMIS") {
          customAlert("Görev başkasına gitti", "Bu görevi az önce başka biri aldı. Havuz listesi yenilendi.");
        } else if (e.message === "YOK") {
          customAlert("Görev bulunamadı", "Bu görev silinmiş olabilir.");
        } else {
          console.error("Görev alma hatası:", e);
          alert(dbErrorText(e, "Görev alınamadı"));
        }
      }
    }

    /* ---------- Destekçi talebi ----------
     * Görevi üstlenen kişi işi yaparken tıkanırsa "destekçi" ister; talep
     * ekipteki herkese görünür, karşılık veren kişi göreve DAHİL olur ve
     * iş oradan sonra ortak görev olarak yürür (assignees'e eklenir).
     *
     * Neden havuza geri bırakmak yerine bu var: erteleme, işi bırakıp
     * havuza atmaktır — yapılanlar sahipsiz kalır. Destek talebi ise işi
     * bırakmadan yardım çağırmaktır, görev sahibinde kalmaya devam eder.
     *
     * İlk karşılık veren kazanır (transaction): iki kişi aynı anda "Destek
     * Ol" derse ikisi birden eklenip görev üç kişiye çıkmasın. Sonradan
     * yine destek istenebilir — talep temizlendiği için yeni talep açılır.
     */
    function destekTalebi(t) {
      return (t && t.destekTalebi && typeof t.destekTalebi === "object") ? t.destekTalebi : null;
    }
    // Aktif talep: görev hâlâ yapılıyor olmalı. Oylamadaki/biten ya da
    // havuza düşmüş görevde talep anlamsızdır (sahibi yok / iş bitmiş).
    function destekAraniyor(t) {
      return !!destekTalebi(t) && t.status !== "tamamlandı" && t.status !== "kontrol" && !isHavuzGorevi(t);
    }
    function destekIsteyebilir(t) {
      if (!t || destekAraniyor(t) || isHavuzGorevi(t)) return false;
      if (t.status === "tamamlandı" || t.status === "kontrol") return false;
      return isTaskFor(t, myTaskId());
    }
    // Talebi yalnızca isteyen kişi (ya da yönetici) geri çekebilir.
    function destekTalebiGeriCekebilir(t) {
      if (!destekAraniyor(t)) return false;
      if (currentRole === "admin") return true;
      return destekTalebi(t).isteyen === myTaskId();
    }
    // Göreve zaten dahil olan kendi talebine "destek olamaz".
    function destekOlabilir(t) {
      const benim = myTaskId();
      return destekAraniyor(t) && !!benim && !isTaskFor(t, benim);
    }
    function destekIsteyenAdi(t) {
      const d = destekTalebi(t);
      if (!d) return "";
      return d.isteyen === "admin" ? "Sistem Yöneticisi" : (staffName(d.isteyen) || "Personel");
    }

    function openDestekModal(taskId) {
      const t = db.tasks.find(x => x.id === taskId);
      if (!t) return;
      document.getElementById("destek_id").value = taskId;
      document.getElementById("destek_baslik").textContent = t.title || "";
      document.getElementById("destek_not").value = "";
      document.getElementById("destekModal").classList.add("open");
      setTimeout(() => { const el = document.getElementById("destek_not"); if (el) el.focus(); }, 50);
    }
    function closeDestekModal() { document.getElementById("destekModal").classList.remove("open"); }

    async function submitDestekTalebi() {
      const taskId = document.getElementById("destek_id").value;
      // Not ZORUNLU: "yardım lazım" tek başına kimseyi harekete geçirmez;
      // ne konuda destek istendiği yazılmazsa kimse üstlenip üstlenemeyeceğini
      // bilemez (erteleme sebebiyle aynı gerekçe).
      const not = document.getElementById("destek_not").value.trim();
      if (!not) { alert("Ne konuda desteğe ihtiyacın olduğunu kısaca yaz."); return; }
      const t = db.tasks.find(x => x.id === taskId);
      if (!t || !destekIsteyebilir(t)) { closeDestekModal(); return; }

      const talep = { isteyen: myTaskId(), tarih: todayStr(), not };
      try {
        await firestore.collection("tasks").doc(taskId).update({ destekTalebi: talep });
        t.destekTalebi = talep;
        // Talebi kimse görmezse öylece bekler — ekipteki herkese haber ver.
        sendPush({
          staffIds: digerEkipIdleri(), rol: currentRole === "admin" ? null : "admin",
          baslik: "🙋 Destekçi aranıyor",
          govde: t.title + " — " + not, etiket: "destek_" + taskId, taskId
        });
        closeDestekModal();
        render();
        customAlert("Destekçi talebin iletildi", "Ekip \"Destek\" sekmesinde görecek. Karşılık veren kişi görevine ortak olur.");
      } catch (e) {
        console.error("Destek talebi gönderilemedi:", e);
        alert(dbErrorText(e, "Destek talebi iletilemedi"));
      }
    }

    async function destekTalebiniGeriCek(taskId) {
      const t = db.tasks.find(x => x.id === taskId);
      if (!t || !destekTalebiGeriCekebilir(t)) return;
      if (!(await customConfirm("Destekçi talebi geri çekilsin mi?"))) return;
      try {
        await firestore.collection("tasks").doc(taskId).update({ destekTalebi: null });
        t.destekTalebi = null;
        render();
      } catch (e) {
        console.error("Destek talebi geri çekilemedi:", e);
        alert(dbErrorText(e, "Talep geri çekilemedi"));
      }
    }

    async function destekOl(taskId) {
      const benim = myTaskId();
      if (!benim) { customAlert("Destek olunamadı", "Hesabınız ekip listesiyle eşleşmediği için göreve katılamıyorsunuz. Yöneticinize bildirin."); return; }
      const t = db.tasks.find(x => x.id === taskId);
      if (!t) return;
      if (!(await customConfirm(`"${t.title}" görevine destekçi olarak katılıyor musun?\n\nGörev ortak göreve dönüşecek ve senin listende de görünecek.`, "Evet, Destek Ol"))) return;

      const ref = firestore.collection("tasks").doc(taskId);
      let sonuc = null;
      try {
        await firestore.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw new Error("YOK");
          const d = snap.data();
          if (!d.destekTalebi) throw new Error("KAPANMIS");
          // assignees boş olabilir (eski kayıt) — assignedTo'ya düşülür.
          const mevcut = (Array.isArray(d.assignees) && d.assignees.length)
            ? d.assignees.slice() : (d.assignedTo ? [d.assignedTo] : []);
          if (mevcut.indexOf(benim) !== -1) throw new Error("ZATEN");
          const yeni = mevcut.concat([benim]);
          const gecmis = (Array.isArray(d.destekGecmisi) ? d.destekGecmisi : []).concat([{
            kisi: benim, isteyen: d.destekTalebi.isteyen, not: d.destekTalebi.not || "", tarih: todayStr()
          }]);
          sonuc = { assignees: yeni, destekTalebi: null, destekGecmisi: gecmis, isteyen: d.destekTalebi.isteyen };
          tx.update(ref, { assignees: yeni, destekTalebi: null, destekGecmisi: gecmis });
        });
        if (sonuc) {
          Object.assign(t, { assignees: sonuc.assignees, destekTalebi: null, destekGecmisi: sonuc.destekGecmisi });
          // Destek isteyen kişiye haber ver — talebinin karşılandığını
          // görmek için listeye bakmak zorunda kalmasın.
          sendTaskPush(t, [sonuc.isteyen]);
        }
        render();
      } catch (e) {
        if (e.message === "KAPANMIS") {
          customAlert("Talep kapanmış", "Bu göreve az önce başka biri destek oldu ya da talep geri çekildi.");
          render();
        } else if (e.message === "ZATEN") {
          customAlert("Zaten bu görevdesin", "Bu görev senin listende de görünüyor.");
        } else if (e.message === "YOK") {
          customAlert("Görev bulunamadı", "Bu görev silinmiş olabilir.");
        } else {
          console.error("Destek olma hatası:", e);
          alert(dbErrorText(e, "Göreve katılınamadı"));
        }
      }
    }

    function openErteleModal(taskId) {
      const t = db.tasks.find(x => x.id === taskId);
      if (!t) return;
      document.getElementById("ertele_id").value = taskId;
      document.getElementById("ertele_baslik").textContent = t.title || "";
      document.getElementById("ertele_sebep").value = "";
      document.getElementById("ertele_tarih").value = "";
      // Bugün ve öncesi seçilemesin: geçmişe erteleme anlamsız, seçilirse
      // görev zaten "beklemiyor" sayılır ve kullanıcı erteleyememiş olur.
      document.getElementById("ertele_tarih").min = gunEkleStr(todayStr(), 1);
      erteleIpucuGuncelle();
      document.getElementById("erteleModal").classList.add("open");
    }
    function closeErteleModal() { document.getElementById("erteleModal").classList.remove("open"); }
    function gunEkleStr(tarih, gun) {
      const d = new Date(tarih + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + gun);
      return d.toISOString().slice(0, 10);
    }
    function erteleIpucuGuncelle() {
      const el = document.getElementById("ertele_ipucu");
      if (!el) return;
      const tarih = document.getElementById("ertele_tarih").value;
      if (tarih) {
        el.className = "assigneeHint ortak";
        el.textContent = `Görev havuza düşecek ama ${fmtDate(tarih)} tarihine kadar "beklemede" kalacak; o gün aktif havuza gelir.`;
      } else {
        el.className = "assigneeHint";
        el.textContent = "Tarih vermezsen görev hemen havuza düşer, isteyen alabilir.";
      }
    }

    async function erteleKaydet() {
      const taskId = document.getElementById("ertele_id").value;
      const sebep = document.getElementById("ertele_sebep").value.trim();
      const tarih = document.getElementById("ertele_tarih").value || null;
      if (!sebep) { alert("Erteleme sebebi zorunlu — neden şimdi yapılamadığını kısaca yaz."); return; }

      const t = db.tasks.find(x => x.id === taskId);
      const kayit = {
        kisi: currentStaffId || "admin",
        tarih: todayStr(),
        sebep,
        kadar: tarih
      };
      const guncelleme = {
        havuzda: true, assignees: [], assignedTo: null, alanKisi: null, alinmaTarihi: null,
        ertelemeTarihi: tarih,
        ertelemeGecmisi: ((t && t.ertelemeGecmisi) || []).concat([kayit])
      };
      if (t) Object.assign(t, guncelleme);
      closeErteleModal();
      render();
      try {
        await firestore.collection("tasks").doc(taskId).update(guncelleme);
      } catch (e) {
        console.error("Erteleme hatası:", e);
        alert(dbErrorText(e, "Görev ertelenemedi"));
      }
    }

    // Personel de görev ekleyebilir ama YALNIZCA kendine ya da havuza —
    // başkasına iş yazamaz. Bu yüzden seçicide sadece kendisi listelenir ve
    // kutu kilitlidir; yönetici tüm ekibi görür.
    function renderAssigneePicker(selectedIds) {
      const box = document.getElementById("tsk_assignees");
      if (!box) return;
      const sel = selectedIds || [];
      const chipHtml = (id, ad, on) => `<label class="assigneeChip${on ? ' selected' : ''}">
        <input type="checkbox" value="${id}"${on ? ' checked' : ''} onchange="onAssigneeToggle(this)">
        ${escapeHtml(ad)}
      </label>`;
      if (currentRole !== "admin") {
        // Personel kendine VEYA yöneticiye görev atayabilir (ikisine birden
        // seçilirse ortak görev olur); diğer personele atayamaz.
        const ben = (db.staff || []).find(s => s.id === currentStaffId);
        let htmlStr = "";
        if (ben) htmlStr += chipHtml(ben.id, ben.name + " (sen)", sel.indexOf(ben.id) !== -1);
        htmlStr += chipHtml("admin", "Sistem Yöneticisi", sel.indexOf("admin") !== -1);
        if (!ben) htmlStr += `<div style="font-size:12px;color:var(--muted);margin-top:4px">Hesabın ekip listesiyle eşleşmediği için kendine görev ekleyemezsin — yöneticiye atayabilir ya da havuza bırakabilirsin.</div>`;
        box.innerHTML = htmlStr;
        updateAssigneeHint();
        return;
      }
      // Admin de görev alabildiği için listede kendisi de var.
      const kisiler = [{ id: "admin", name: "Sistem Yöneticisi (sen)" }].concat(db.staff || []);
      box.innerHTML = kisiler.map(s => chipHtml(s.id, s.name, sel.indexOf(s.id) !== -1)).join("");
      updateAssigneeHint();
    }
    function onAssigneeToggle(cb) {
      const chip = cb.closest("label");
      if (chip) chip.classList.toggle("selected", cb.checked);
      updateAssigneeHint();
    }
    function selectedAssignees() {
      return Array.from(document.querySelectorAll("#tsk_assignees input[type=checkbox]"))
        .filter(c => c.checked).map(c => c.value);
    }
    function havuzSecili() {
      const el = document.getElementById("tsk_havuz");
      return !!(el && el.checked);
    }
    // Havuz açıkken kişi seçimi anlamsız — seçiciyi soluklaştırıp
    // tıklanamaz yapıyoruz ki çelişkili bir görev kaydedilemesin.
    function onHavuzToggle() {
      const box = document.getElementById("tsk_assignees");
      const acik = havuzSecili();
      if (box) {
        box.style.opacity = acik ? ".4" : "";
        box.style.pointerEvents = acik ? "none" : "";
        if (acik) {
          box.querySelectorAll("input[type=checkbox]").forEach(c => {
            c.checked = false;
            const chip = c.closest("label"); if (chip) chip.classList.remove("selected");
          });
        } else if (currentRole !== "admin") {
          // Personelde havuz kapatılınca seçim yeniden "kendisi" olmalı;
          // aksi halde kutu boş kalır ve kaydedemez.
          renderAssigneePicker([currentStaffId]);
          return;
        }
      }
      updateAssigneeHint();
    }
    function updateAssigneeHint() {
      const el = document.getElementById("tsk_assigneeHint");
      if (!el) return;
      if (havuzSecili()) {
        el.className = "assigneeHint ortak";
        el.textContent = "Havuz görevi — kimseye atanmayacak. Herkes görür, ilk üstlenen kendi listesine alır.";
        return;
      }
      const secili = selectedAssignees();
      const n = secili.length;
      if (currentRole !== "admin") {
        if (n > 1) {
          el.className = "assigneeHint ortak";
          el.textContent = "Ortak görev — sana ve yöneticiye birlikte atanacak.";
        } else if (n === 1) {
          el.className = "assigneeHint";
          el.textContent = secili[0] === "admin" ? "Bu görev Sistem Yöneticisi'ne atanacak." : "Bu görev sana atanacak.";
        } else {
          el.className = "assigneeHint";
          el.textContent = "Kendine ya da yöneticiye ata — ya da 'Havuza bırak' seçeneğini kullan.";
        }
        return;
      }
      if (n > 1) {
        el.className = "assigneeHint ortak";
        el.textContent = `Ortak görev — ${n} kişiye atanacak. İlk tamamlayan görevi herkes için kapatır.`;
      } else {
        el.className = "assigneeHint";
        el.textContent = n === 1 ? "Tek kişiye atanacak." : "En az bir kişi seç.";
      }
    }

    function openTaskModal(taskId) {
      const t = taskId ? db.tasks.find(x => x.id === taskId) : null;
      document.getElementById("taskModalTitle").textContent = t ? "Görevi Düzenle" : "Görev Ekle";
      document.getElementById("tsk_id").value = taskId || "";
      document.getElementById("tsk_title").value = t ? t.title : "";
      document.getElementById("tsk_description").value = t ? (t.description || "") : "";
      // Yeni görevde tarih alanı otomatik olarak bugünle gelir (değiştirilebilir).
      document.getElementById("tsk_dueDate").value = t ? (t.dueDate || "") : todayStr();
      document.getElementById("tsk_havuz").checked = !!(t && t.havuzda === true);
      secOncelik(t ? gorevOnceligi(t) : ONCELIK_VARSAYILAN);
      // Başlıktaki açıklama role göre değişir: personel çoklu seçim yapamaz,
      // ona "birden fazla kişi seçebilirsin" demek yanıltıcı olur.
      const lblHint = document.getElementById("tsk_assigneeLabelHint");
      if (lblHint) lblHint.textContent = currentRole === "admin"
        ? "— birden fazla kişi seçebilirsin (ortak görev)"
        : "— kendine ekleyebilir ya da havuza bırakabilirsin";
      renderAssigneePicker(t ? taskAssignees(t) : []);
      onHavuzToggle();   // seçiciyi havuz durumuna göre aç/kapat
      document.getElementById("taskModal").classList.add("open");
    }
    function closeTaskModal() { document.getElementById("taskModal").classList.remove("open"); }
    async function saveTask() {
      const taskId = document.getElementById("tsk_id").value;
      const title = document.getElementById("tsk_title").value.trim();
      if (!title) { alert("Başlık zorunlu."); return; }
      const havuz = havuzSecili();
      // Personel yalnızca KENDİNE, YÖNETİCİYE ya da havuza görev yazabilir.
      // Seçim ekranda zaten kısıtlı ama kaynağı burada da sabitliyoruz —
      // ekrana güvenip başka personele iş yazılmasına açık kapı bırakmıyoruz.
      const izinliler = currentRole === "admin" ? null : [currentStaffId, "admin"].filter(Boolean);
      const assignees = havuz ? []
        : selectedAssignees().filter(id => !izinliler || izinliler.indexOf(id) !== -1);
      if (!havuz && !assignees.length) {
        alert(currentRole === "admin"
          ? "Görevin kime atanacağını seç — ya da 'Havuza bırak' işaretle."
          : "Görevi kendine ya da yöneticiye ata — ya da 'Havuza bırak' seçeneğini kullan.");
        return;
      }
      const description = document.getElementById("tsk_description").value.trim();
      const dueDate = document.getElementById("tsk_dueDate").value || null;

      if (taskId) {
        const t = db.tasks.find(x => x.id === taskId);
        const oncekiAtananlar = taskAssignees(t);
        const updates = havuz
          // Havuza geri alınan görevin sahibi de temizlenmeli, yoksa kayıt
          // hem havuzda hem birinin listesinde görünür.
          ? { title, description, dueDate, oncelik: seciliOncelik, havuzda: true, assignees: [], assignedTo: null, alanKisi: null, alinmaTarihi: null }
          : { title, description, dueDate, oncelik: seciliOncelik, havuzda: false, assignees, assignedTo: assignees[0] };
        if (t) Object.assign(t, updates);
        closeTaskModal();
        render();
        try {
          await firestore.collection("tasks").doc(taskId).update(updates);
          // Düzenlemede göreve YENİ eklenen kişilere push at; zaten atanmış
          // olanlar aynı görev için ikinci kez bildirim almasın.
          const yeniEklenenler = assignees.filter(id => oncekiAtananlar.indexOf(id) === -1);
          if (yeniEklenenler.length && t) sendTaskPush(t, yeniEklenenler);
        } catch (e) {
          console.error("Güncelleme hatası:", e);
          alert(dbErrorText(e, "Görev güncellenemedi"));
        }
        return;
      }

      const task = {
        id: uid(), title, description,
        assignees, assignedTo: havuz ? null : assignees[0],
        havuzda: havuz, alanKisi: null, alinmaTarihi: null,
        oncelik: seciliOncelik,
        assignedBy: currentStaffId || "admin",
        dueDate, status: "bekliyor", report: null, completedDate: null,
        completedBy: null, created: todayStr()
      };
      db.tasks.unshift(task);
      closeTaskModal();
      render();
      try {
        await firestore.collection("tasks").doc(task.id).set(task);
        // Havuz görevinin atananı yok — kimse haberdar olmazsa havuzda
        // öylece bekler, o yüzden bildirim tüm personele gider. Kendine
        // eklediğin göreve kendi telefonundan bildirim gelmesi ise gürültü:
        // her iki durumda da kendimizi hedeflerden çıkarıyoruz.
        // beklenmez (fire-and-forget) — kayıt akışını yavaşlatmasın
        const pushHedefleri = (havuz ? (db.staff || []).map(s => s.id) : assignees)
          .filter(id => id !== currentStaffId);
        if (pushHedefleri.length) sendTaskPush(task, pushHedefleri);
      } catch (e) {
        console.error("Kaydetme hatası:", e);
        alert(dbErrorText(e, "Görev kaydedilemedi"));
      }
    }
    async function completeTask(taskId) {
      const reportEl = document.getElementById("tsk_report_" + taskId);
      const report = reportEl ? reportEl.value.trim() : "";
      const ozelestiriEl = document.getElementById("tsk_ozelestiri_" + taskId);
      const ozelestiri = ozelestiriEl ? ozelestiriEl.value.trim() : "";
      // Ortak görevde tamamlama görevi HERKES için kapatır — kullanıcı bunu
      // bilerek onaylasın diye soru metni ona göre değişiyor.
      const soru = isSharedTask(db.tasks.find(x => x.id === taskId))
        ? "Bu ORTAK görev tamamlandı olarak işaretlensin mi?\n\nGörev önce ekip oylamasına düşecek; onaylanırsa herkes için kapanacak."
        : "Bu görev tamamlandı olarak işaretlensin mi?\n\nGörev önce ekip oylamasına düşecek; yeterli onay alınca kesinleşecek.";
      if (!(await customConfirm(soru, "Evet, Tamamlandı"))) return;
      // completionSeen: false — atayan admin bunu Görevler'i (ya da zili)
      // görene kadar "yeni tamamlandı" olarak işaretli kalır. Tarayıcı
      // bildirim izni gerektirmeyen, güvenilir çalışan gösterge bu.
      // status "kontrol": görev doğrudan kapanmaz, ekip oylamasına düşer
      // (bkz. kontrolOyVer) — 2 onay kesinleştirir, 2 ret havuza döndürür.
      const updates = { status: "kontrol", report: report || null, ozelestiri: ozelestiri || null, completedDate: todayStr(), completedBy: currentStaffId || "admin", completionSeen: false, kontrolOylari: {} };
      const t = db.tasks.find(x => x.id === taskId);
      if (t) Object.assign(t, updates);
      render();
      try {
        await firestore.collection("tasks").doc(taskId).update(updates);
        // Görev oylamaya düştü: onaylayacak kişiler haberdar olmazsa iş
        // "kontrol"de asılı kalır. Kendi işine oy verilemediği için
        // tamamlayan kişi hedeflerin dışında (bkz. digerEkipIdleri).
        sendPush({
          staffIds: digerEkipIdleri(), rol: currentRole === "admin" ? null : "admin",
          baslik: "🗳️ Oy bekleyen görev",
          govde: (t ? t.title : "Bir görev") + " — tamamlandı denildi, ekip onayı bekliyor",
          etiket: "kontrol_" + taskId, taskId
        });
      } catch (e) {
        console.error("Güncelleme hatası:", e);
        alert(dbErrorText(e, "Görev güncellenemedi"));
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
        alert(dbErrorText(e, "Görev silinemedi"));
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
      // Kişinin ALDIĞI değerlendirme puanlarının ortalaması. Yalnızca oy
      // almış tamamlanan görevler sayılır; hiç oy yoksa null (— gösterilir),
      // 0 değil — "puansız" ile "kötü puan" karışmasın.
      const puanlananlar = done.map(gorevOrtalamaPuan).filter(n => n !== null);
      const puanOrt = puanlananlar.length
        ? puanlananlar.reduce((a, b) => a + b, 0) / puanlananlar.length : null;
      return { total: tasks.length, done: done.length, active: active.length, overdue: overdue.length, pct, score: done.length * 10 + onTime.length * 5, puanOrt, puanlananSayi: puanlananlar.length };
    }
    function viewTasks() {
      const isTaskAdmin = currentRole === "admin";
      // Havuz görevleri kimseye atanmadığı için isTaskFor süzgecine takılmaz;
      // herkesin görmesi gerektiğinden ayrıca ekleniyor.
      // Oylamadaki (kontrol) görevleri HERKES görür — göremeyen oy kullanamaz.
      // Destekçi aranan görevler de herkese açılır, yoksa talebi yalnızca
      // görevin sahibi görür ve kimse karşılık veremez.
      const relevantTasks = isTaskAdmin
        ? db.tasks
        : db.tasks.filter(t => isTaskFor(t, currentStaffId) || isHavuzGorevi(t) || t.status === "kontrol" || destekAraniyor(t));

      // Görev ekleme herkeste açık: yönetici istediğine atar, personel
      // yalnızca kendine ya da havuza ekleyebilir (bkz. renderAssigneePicker).
      let html = `<div style="display:flex;justify-content:flex-end;margin-bottom:16px">
    <button class="btn" onclick="openTaskModal()">${icon('clipboardList', 14)} + Görev Ekle</button>
  </div>`;

      // ---- Günlük hedef — personel kendi ilerlemesini en üstte görür.
      // Admin'inki ekip kartlarındaki halkanın altında (kompakt) duruyor.
      if (!isTaskAdmin && currentStaffId) html += hedefCubugu(currentStaffId, false);

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
    ${statCard("Değerlendirme", overall.puanOrt === null ? "—" : overall.puanOrt.toFixed(1).replace(".", ",") + " / 5", puanRengi(overall.puanOrt))}
    ${statCard("Toplam Puan", overall.score, "var(--brand-2)")}
  </div>`;
      }

      if (!relevantTasks.length) {
        return html + `<div class="empty">${isTaskAdmin ? "Henüz görev eklenmemiş." : "Sana atanmış bir görev yok."}</div>`;
      }

      // Seçili personel varsa listeler ona göre süzülür (hem aktif hem tamamlanan)
      const filteredTasks = (isTaskAdmin && selectedTaskStaffId)
        ? relevantTasks.filter(t => isTaskFor(t, selectedTaskStaffId))
        : relevantTasks;

      // Havuz görevleri kendi sekmesinde durur; "Aktif" listesi yalnızca
      // sahibi belli olan görevleri gösterir, yoksa kişinin listesi
      // üstlenmediği işlerle karışır.
      // Sıralama: ÖNCE öncelik (çok yıldız üstte), sonra son tarih, sonra
      // eklenme. Yıldız sıralamayı değiştirmeseydi anlamı kalmazdı.
      const havuzSirala = (a, b) => {
        const oncelikFarki = gorevOnceligi(b) - gorevOnceligi(a);
        if (oncelikFarki) return oncelikFarki;
        if (!a.dueDate && !b.dueDate) return new Date(b.created) - new Date(a.created);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      };
      // Ertelenmiş görevler aktif havuzdan ayrılır: sekme sayacı ve rozet
      // "şu an alınabilir" işleri saysın, tarihi gelmemiş olanlar altta
      // ayrı bir bölümde beklesin.
      const havuzAktifler = filteredTasks.filter(havuzdaAktif).sort(havuzSirala);
      const havuzBekleyenler = filteredTasks.filter(ertelenmisMi)
        .sort((a, b) => String(a.ertelemeTarihi).localeCompare(String(b.ertelemeTarihi)));
      const havuzGorevleri = havuzAktifler;
      const sahipliGorevler = filteredTasks.filter(t => !isHavuzGorevi(t));

      // Destekçi aranan görevler kendi sekmesinde toplanır.
      const destekBekleyenler = sahipliGorevler.filter(destekAraniyor).sort(havuzSirala);
      // "Aktif" YALNIZCA kendi işlerim (yönetici hepsini görür). Başkasının
      // destek beklediği görev, sırf herkese görünür oldu diye benim aktif
      // listemi doldurmamalı — oylamadaki görevlerde de aynı ayrım var.
      const pending = sahipliGorevler
        .filter(t => t.status !== "tamamlandı" && t.status !== "kontrol")
        .filter(t => isTaskAdmin || isTaskFor(t, myTaskId()))
        .sort(havuzSirala);
      // Oylamadakiler: tamamlandı denmiş ama ekip kontrolünden geçmemiş görevler
      const kontroldekiler = sahipliGorevler.filter(t => t.status === "kontrol")
        .sort((a, b) => new Date(b.completedDate || b.created) - new Date(a.completedDate || a.created));
      const completed = sahipliGorevler.filter(t => t.status === "tamamlandı")
        .sort((a, b) => new Date(b.completedDate || b.created) - new Date(a.completedDate || a.created));

      const today = new Date(); today.setHours(0, 0, 0, 0);

      const taskCard = t => {
        const assigneeName = taskAssigneeNames(t);
        const ortak = isSharedTask(t);
        let dueBadge = "";
        if (t.dueDate && t.status !== "tamamlandı") {
          const days = Math.round((new Date(t.dueDate) - today) / 864e5);
          const col = days < 0 ? "var(--red)" : days <= 2 ? "var(--amber)" : "var(--muted)";
          const lbl = days < 0 ? `${-days} gün gecikti` : days === 0 ? "Bugün" : `${days} gün kaldı`;
          dueBadge = `<span style="color:${col};font-weight:600;font-size:12px">${icon('calendar', 12)} ${fmtDate(t.dueDate)} • ${lbl}</span>`;
        } else if (t.dueDate) {
          dueBadge = `<span style="color:var(--muted);font-size:12px">${icon('calendar', 12)} ${fmtDate(t.dueDate)}</span>`;
        }

        // Ortak görev tamamlandığında "kim kapattı" bilgisi rozete yazılır —
        // görev herkeste kapandığı için diğerleri neden kapandığını görsün.
        const doneByName = staffName(t.completedBy);
        const statusBadge = t.status === "tamamlandı"
          ? `<span class="badge" style="background:rgba(55,201,138,.15);color:#37c98a">${icon('checkCircle', 12)} Tamamlandı${ortak && doneByName ? ' — ' + escapeHtml(doneByName) : ''}</span>`
          : t.status === "kontrol"
            ? `<span class="badge" style="background:rgba(45,212,191,.15);color:#2dd4bf">🗳️ Oylamada</span>`
            : `<span class="badge" style="background:rgba(244,183,64,.15);color:#f4b740">${icon('clock', 12)} Bekliyor</span>`;

        const havuzda = isHavuzGorevi(t);
        const bekliyor = ertelenmisMi(t);
        const sharedBadge = havuzda
          ? (bekliyor
            ? `<span class="badge" style="background:rgba(167,139,250,.12);color:#a78bfa">${icon('clock', 12)} ${fmtDate(t.ertelemeTarihi)} tarihine ertelendi</span>`
            : `<span class="badge" style="background:rgba(167,139,250,.18);color:#a78bfa">${icon('users', 12)} Havuzda — sahibi yok</span>`)
          : ortak
            ? `<span class="badge" style="background:rgba(59,130,246,.15);color:var(--brand-2)">${icon('users', 12)} Ortak görev • ${taskAssignees(t).length} kişi</span>`
            : "";

        let actionArea = "";
        if (havuzda) {
          // Havuzdaki göreve rapor kutusu koymuyoruz: önce üstlenilmeli.
          actionArea = myTaskId()
            ? `<div style="margin-top:10px"><button class="btn" style="width:100%;background:rgba(167,139,250,.18);border-color:#a78bfa;color:#a78bfa" onclick="gorevAl('${t.id}')">${icon('checkCircle', 14)} Bu Görevi Al</button></div>`
            : `<div style="margin-top:10px;font-size:12px;color:var(--muted)">Havuzdan görev almak için ekip listesinde tanımlı bir personel hesabı gerekir.</div>`;
        } else if (t.status !== "tamamlandı" && isTaskFor(t, myTaskId())) {
          // Rapor "ne yapıldı", özeleştiri "daha iyi nasıl yapılabilirdi".
          // İkisi ayrı alan: tek kutuya sığdırılsa özeleştiri raporun içinde
          // kaybolur, sonradan ayrıştırılamaz.
          actionArea = `<div style="margin-top:10px">
        <textarea id="tsk_report_${t.id}" placeholder="Tamamlandığında kısa bir rapor yaz (opsiyonel)..." style="min-height:60px"></textarea>
        <textarea id="tsk_ozelestiri_${t.id}" placeholder="Özeleştiri (opsiyonel) — bu işi daha iyi nasıl yapabilirdim?" style="min-height:60px;margin-top:8px"></textarea>
        <button class="btn" style="margin-top:6px" onclick="completeTask('${t.id}')">${icon('checkCircle', 14)} Tamamlandı Olarak İşaretle</button>
      </div>`;
        } else if ((t.status === "tamamlandı" || t.status === "kontrol") && (t.report || t.ozelestiri)) {
          const metinKutusu = (baslik, metin, renk) => `<div style="background:var(--panel-2);border:1px solid var(--line);border-left:3px solid ${renk};border-radius:8px;padding:10px 12px;font-size:13px;margin-top:8px">
        <div style="color:${renk};font-size:11px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px;font-weight:600">${baslik}</div>
        ${escapeHtml(metin)}
      </div>`;
          actionArea = `<div style="margin-top:2px">
        ${t.report ? metinKutusu("Rapor", t.report, "var(--muted)") : ""}
        ${t.ozelestiri ? metinKutusu("Özeleştiri", t.ozelestiri, "#f4b740") : ""}
      </div>`;
        }
        // Oylama kutusu: kontrol aşamasındaki görevde rapordan bağımsız görünür.
        if (t.status === "kontrol") actionArea += oylamaKutusu(t);
        // Değerlendirme kutusu rapor/özeleştiriden BAĞIMSIZ: ikisi de boş
        // bırakılmış bir görev de puanlanabilmeli.
        if (t.status === "tamamlandı") actionArea += degerlendirmeKutusu(t);

        // Erteleme geçmişi: bir görev havuzda dönüp duruyorsa sebepleri
        // görmek asıl bilgi. Son sebep açık, öncekiler sayı olarak.
        const gecmis = Array.isArray(t.ertelemeGecmisi) ? t.ertelemeGecmisi : [];
        const sonErteleme = gecmis[gecmis.length - 1];
        const ertelemeKutusu = sonErteleme
          ? `<div style="margin-top:8px;border-left:3px solid #a78bfa;padding:6px 0 6px 10px">
        <div style="font-size:11px;color:#a78bfa;font-weight:600">
          ${gecmis.length > 1 ? `${gecmis.length} kez ertelendi` : "Ertelendi"} • ${escapeHtml(staffName(sonErteleme.kisi) || (sonErteleme.kisi === "admin" ? "Sistem Yöneticisi" : "Personel"))}${sonErteleme.tarih ? " • " + fmtDate(sonErteleme.tarih) : ""}
        </div>
        <div style="font-size:12px;color:var(--txt);margin-top:2px">${escapeHtml(sonErteleme.sebep || "")}</div>
      </div>`
          : "";

        const yonetebilir = gorevuYonetebilir(t);
        const editBtn = (yonetebilir && t.status !== "tamamlandı") ? `<button class="btn ghost" style="padding:6px 8px" onclick="openTaskModal('${t.id}')" title="Düzenle">${icon('edit', 13)}</button>` : "";
        const deleteBtn = yonetebilir ? `<button class="btn ghost" style="padding:6px 8px;color:var(--red)" onclick="deleteTask('${t.id}')" title="Sil">${icon('trash', 13)}</button>` : "";
        // Ertele: sebebiyle birlikte havuza geri düşürür. Elindeki görevi
        // kişi kendisi erteleyebilir; havuzda öylece duran görevi yalnızca
        // yönetici (bkz. ertelenebilirMi).
        const erteleBtn = ertelenebilirMi(t)
          ? `<button class="btn ghost" style="padding:6px 8px;color:#a78bfa" onclick="openErteleModal('${t.id}')" title="Ertele (sebebiyle havuza bırak)">${icon('clock', 13)}</button>` : "";
        // Destekçi iste: görevi bırakmadan yardım çağırır (ertelemenin aksine
        // iş sende kalır). Talep açıkken düğme yerine geri çekme görünür.
        const destekBtn = destekIsteyebilir(t)
          ? `<button class="btn ghost" style="padding:6px 8px;color:#ec833c" onclick="openDestekModal('${t.id}')" title="Destekçi iste (görev sende kalır)">🙋</button>`
          : destekTalebiGeriCekebilir(t)
            ? `<button class="btn ghost" style="padding:6px 8px;color:var(--muted)" onclick="destekTalebiniGeriCek('${t.id}')" title="Destekçi talebini geri çek">✕🙋</button>`
            : "";

        // Talep kutusu: ne istendiği ve kimin istediği yazılı; başkaları
        // buradan doğrudan destek olur.
        const destekKutusu = destekAraniyor(t)
          ? `<div style="margin-top:8px;background:rgba(236,131,60,.08);border:1px solid rgba(236,131,60,.35);border-radius:8px;padding:10px 12px">
        <div style="font-size:11px;color:#ec833c;text-transform:uppercase;letter-spacing:.5px;font-weight:600">🙋 Destekçi aranıyor — ${escapeHtml(destekIsteyenAdi(t))} istedi${destekTalebi(t).tarih ? ' • ' + fmtDate(destekTalebi(t).tarih) : ''}</div>
        <div style="font-size:13px;color:var(--txt);margin-top:5px">${escapeHtml(destekTalebi(t).not || "")}</div>
        ${destekOlabilir(t)
            ? `<button class="btn" style="width:100%;margin-top:10px;background:rgba(236,131,60,.18);border-color:#ec833c;color:#ec833c" onclick="destekOl('${t.id}')">${icon('users', 14)} Destek Ol — göreve katıl</button>`
            : `<div style="font-size:12px;color:var(--muted);margin-top:6px">${myTaskId() ? "Bu görevde zaten yer alıyorsun; karşılık verecek kişiyi bekliyorsunuz." : "Göreve katılmak için ekip listesinde tanımlı bir personel hesabı gerekir."}</div>`}
      </div>`
          : "";

        // Destek geçmişi: göreve kimin, hangi talep üzerine katıldığı.
        const destekGecmisi = Array.isArray(t.destekGecmisi) ? t.destekGecmisi : [];
        const destekGecmisKutusu = destekGecmisi.length
          ? `<div style="margin-top:8px;border-left:3px solid #ec833c;padding:6px 0 6px 10px">
        ${destekGecmisi.map(d => `<div style="font-size:11px;color:#ec833c;font-weight:600">
          ${escapeHtml(d.kisi === "admin" ? "Sistem Yöneticisi" : (staffName(d.kisi) || "Personel"))} destekçi oldu${d.tarih ? " • " + fmtDate(d.tarih) : ""}
        </div>${d.not ? `<div style="font-size:12px;color:var(--muted);margin:2px 0 4px">${escapeHtml(d.not)}</div>` : ""}`).join("")}
      </div>`
          : "";

        return `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px">${escapeHtml(t.title)}</div>
          ${t.description ? `<div style="color:var(--muted);font-size:13px;margin-top:2px">${escapeHtml(t.description)}</div>` : ""}
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${oncelikRozeti(t)}
            ${statusBadge}
            ${sharedBadge}
            ${destekAraniyor(t) ? `<span class="badge" style="background:rgba(236,131,60,.18);color:#ec833c">🙋 Destekçi aranıyor</span>` : ""}
            ${(!havuzda && (isTaskAdmin || ortak)) ? `<span style="font-size:12px;color:var(--muted)">${icon('user', 12)} ${escapeHtml(assigneeName)}</span>` : ""}
            ${t.alanKisi && !havuzda ? `<span style="font-size:11px;color:#a78bfa">havuzdan aldı${t.alinmaTarihi ? ' • ' + fmtDate(t.alinmaTarihi) : ''}</span>` : ""}
            ${(isTaskAdmin && t.assignedBy && t.assignedBy !== "admin") ? `<span style="font-size:11px;color:var(--muted)">${escapeHtml(staffName(t.assignedBy) || "Personel")} ekledi</span>` : ""}
            ${dueBadge}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">${destekBtn}${erteleBtn}${editBtn}${deleteBtn}</div>
      </div>
      ${ertelemeKutusu}
      ${destekGecmisKutusu}
      ${destekKutusu}
      ${actionArea}
    </div>`;
      };

      // ---- Ekip kartları (sadece admin) — avatar + başarı yüzdesi halkası ----
      if (isTaskAdmin && (db.staff || []).length) {
        const ringCard = s => {
          // Ortak görev, atandığı HER personelin istatistiğine sayılır —
          // "bu işin içinde kimler vardı" sorusunun doğru cevabı bu.
          const st = taskStatsFor(relevantTasks.filter(t => isTaskFor(t, s.id)));
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
      ${st.puanOrt === null
          ? `<div style="font-size:10px;color:var(--muted);margin-top:2px" title="Tamamlanan görevlerine henüz kimse puan vermemiş">değerlendirme —</div>`
          : `<div style="font-size:11px;color:${puanRengi(st.puanOrt)};font-weight:700;margin-top:2px" title="Ekibin bu kişinin tamamladığı işlere verdiği puanların ortalaması (${st.puanlananSayi} görev)">${yildizIkon(true, 10, puanRengi(st.puanOrt))} ${st.puanOrt.toFixed(1).replace(".", ",")} / 5</div>`}
      ${hedefCubugu(s.id, true)}
    </div>`;
        };
        // Admin de görev alabildiği için rapor sistemine o da dahil: ekip
        // kartlarının başında Sistem Yöneticisi kartı durur, tıklayınca
        // yalnızca adminin görevleri filtrelenir (personel kartlarıyla aynı).
        const kisiler = [{ id: "admin", name: "Sistem Yöneticisi" }].concat(db.staff);
        html += `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px">${kisiler.map(ringCard).join("")}</div>`;
      }

      html += `<div class="toolbar" style="gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <span class="pill ${taskTab === 'aktif' ? 'active' : ''}" style="${taskTab === 'aktif' ? 'background:rgba(244,183,64,.15);border-color:#f4b740;color:#f4b740' : ''}" onclick="setTaskTab('aktif')">${icon('clock', 13)} Aktif (${pending.length})</span>
    <span class="pill ${taskTab === 'havuz' ? 'active' : ''}" style="${taskTab === 'havuz' ? 'background:rgba(167,139,250,.18);border-color:#a78bfa;color:#a78bfa' : (havuzGorevleri.length ? 'border-color:#a78bfa;color:#a78bfa' : '')}" onclick="setTaskTab('havuz')">${icon('users', 13)} Havuz (${havuzGorevleri.length})</span>
    <span class="pill ${taskTab === 'destek' ? 'active' : ''}" style="${taskTab === 'destek' ? 'background:rgba(236,131,60,.18);border-color:#ec833c;color:#ec833c' : (destekBekleyenler.length ? 'border-color:#ec833c;color:#ec833c' : '')}" onclick="setTaskTab('destek')">🙋 Destek (${destekBekleyenler.length})</span>
    <span class="pill ${taskTab === 'kontrol' ? 'active' : ''}" style="${taskTab === 'kontrol' ? 'background:rgba(45,212,191,.15);border-color:#2dd4bf;color:#2dd4bf' : (kontroldekiler.length ? 'border-color:#2dd4bf;color:#2dd4bf' : '')}" onclick="setTaskTab('kontrol')">🗳️ Oylamada (${kontroldekiler.length})</span>
    <span class="pill ${taskTab === 'tamamlanan' ? 'active' : ''}" style="${taskTab === 'tamamlanan' ? 'background:rgba(55,201,138,.15);border-color:#37c98a;color:#37c98a' : ''}" onclick="setTaskTab('tamamlanan')">${icon('checkCircle', 13)} Tamamlanan (${completed.length})</span>
    ${isTaskAdmin && selectedTaskStaffId ? `<span class="pill" style="border-color:var(--brand-2);color:var(--brand-2)" onclick="selectTaskStaff('${selectedTaskStaffId}')">${escapeHtml(selectedTaskStaffId === "admin" ? "Sistem Yöneticisi" : (staffName(selectedTaskStaffId) || ""))} ✕</span>` : ""}
  </div>`;

      const list = taskTab === "aktif" ? pending : taskTab === "havuz" ? havuzGorevleri : taskTab === "destek" ? destekBekleyenler : taskTab === "kontrol" ? kontroldekiler : completed;
      const emptyMsg = isTaskAdmin && selectedTaskStaffId
        ? (taskTab === "aktif" ? "Bu personelin aktif görevi yok." : taskTab === "havuz" ? "Havuzda görev yok." : taskTab === "destek" ? "Bu personelin destek beklediği görev yok." : taskTab === "kontrol" ? "Oylamada görev yok." : "Bu personelin tamamlanan görevi yok.")
        : (taskTab === "aktif" ? "Aktif görev yok." : taskTab === "havuz" ? "Havuzda alınmayı bekleyen görev yok." : taskTab === "destek" ? "Destekçi bekleyen görev yok. Bir görevde tıkanırsan kendi kartından destek isteyebilirsin." : taskTab === "kontrol" ? "Oylama bekleyen görev yok." : "Henüz tamamlanan görev yok.");
      // Admin Aktif sekmesinde YAPACAĞI görevlerle ATADIĞI görevleri ayrı
      // görür (personel filtresi seçiliyken bölmeye gerek yok — zaten tek
      // kişinin listesi).
      if (isTaskAdmin && taskTab === "aktif" && !selectedTaskStaffId) {
        const bolumBaslik = (metin, renk) => `<div style="display:flex;align-items:center;gap:10px;margin:18px 0 12px">
      <div style="flex:1;height:1px;background:var(--line)"></div>
      <span style="font-size:11px;color:${renk};text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;font-weight:600">${metin}</span>
      <div style="flex:1;height:1px;background:var(--line)"></div>
    </div>`;
        const benimGorevlerim = list.filter(t => isTaskFor(t, "admin"));
        const atadiklarim = list.filter(t => !isTaskFor(t, "admin"));
        html += bolumBaslik(`${icon('user', 12)} Yapacağım Görevler (${benimGorevlerim.length})`, "var(--brand-2)");
        html += benimGorevlerim.length ? benimGorevlerim.map(taskCard).join("") : `<div class="empty">Sana atanmış aktif görev yok.</div>`;
        html += bolumBaslik(`${icon('users', 12)} Ekibe Atananlar (${atadiklarim.length})`, "var(--amber)");
        html += atadiklarim.length ? atadiklarim.map(taskCard).join("") : `<div class="empty">Ekipte aktif görev yok.</div>`;
      } else {
        html += list.length ? list.map(taskCard).join("") : `<div class="empty">${emptyMsg}</div>`;
      }

      // Ertelenmiş görevler havuz sekmesinin altında ayrı bölümde: listeyi
      // meşgul etmesinler ama görünmez de olmasınlar (unutulan iş olmasın).
      if (taskTab === "havuz" && havuzBekleyenler.length) {
        html += `<div style="display:flex;align-items:center;gap:10px;margin:22px 0 12px">
      <div style="flex:1;height:1px;background:var(--line)"></div>
      <span style="font-size:11px;color:#a78bfa;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap">${icon('clock', 12)} Ertelendi — tarihi gelince havuza düşecek (${havuzBekleyenler.length})</span>
      <div style="flex:1;height:1px;background:var(--line)"></div>
    </div>` + havuzBekleyenler.map(taskCard).join("");
      }

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
      return visibleAuthors().filter(a => {
        if (a.status === "sozlesme" || a.status === "yayinda" || a.status === "arsiv") return false;
        return unreachedCallStatus(a.logs) === true;
      });
    }

    function viewFollowups() {
      const t = searchTerm();
      const matchSearch = a =>
        !t || searchKey(a.name + " " + (a.genres || []).join(" ") + " " + (a.work || "") + " " + (a.notes || "") + " " + (a.phone || "") + " " + (a.logs || []).map(l => l.text || "").join(" ")).includes(t);

      const list = visibleAuthors().filter(a => {
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
      <div class="tx"><span class="type">${escapeHtml(l.type)}</span>${vurgula(l.text, document.getElementById("search") ? document.getElementById("search").value : "")}</div>
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
        <button class="btn ghost" onclick="openTransferModal('${a.id}')" title="Başka danışmana devret">${icon('users', 15)}</button>
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
      const oldAuthor = id ? db.authors.find(x => x.id === id) : null;
      // Mükerrer numara kontrolü yalnızca yeni kayıtta veya numara
      // DEĞİŞTİRİLDİĞİNDE çalışır — mevcut kaydı başka bir alan için
      // düzenlerken (numara aynı kaldığı sürece) engel çıkarmaz.
      const phoneChanged = !oldAuthor || normalizePhone(oldAuthor.phone || "") !== normalizePhone(phone);
      if (phone && phoneChanged) {
        const normalizedPhone = normalizePhone(phone);
        const duplicate = db.authors.find(author =>
          author.id !== id &&
          author.phone &&
          normalizePhone(author.phone) === normalizedPhone
        );
        if (duplicate) {
          customAlert("Bu numara ile daha önce zaten görüşülmüş!",
            "\"" + duplicate.name + "\" adlı yazarda kayıtlı. Aynı numara ikinci kez kaydedilemez.");
          return;
        }
      }
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
        // Numaranın sadeleştirilmiş hali (son 10 hane). WhatsApp/arama
        // webhook'u gelen numarayı bu alanda TEK sorguyla arayabilsin diye
        // kaydediliyor; öncesinde webhook her arama/mesaj için yazarların
        // TAMAMINI (800+ doküman) tarıyordu ve günlük okuma kotasını
        // tek başına bitiriyordu.
        phoneNorm: normalizePhone(g("f_phone")),
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
      // seçilen paket buraya otomatik taşınır. Yönetim paneline de
      // "sözleşme alındı" haberi düşülür.
      if (payload.status === "sozlesme" && !wasContracted) {
        panelEventGonder("sozlesme_alindi", {
          yazarId: newId,
          yazarAdi: name,
          paket: payload.package || null,
          gorusmeci: currentStaffId ? (staffName(currentStaffId) || null) : "Sistem Yöneticisi"
        });
        openPayModal(newId);
      }
    }

    /* ---------- Yönetim paneli bildirimleri (CRM -> panel) ----------
     * Reklam kartının tersi yönde çalışan köprü: CRM'de önemli bir olay
     * olduğunda (örn. sözleşme alındı) panel_events koleksiyonuna bir olay
     * dokümanı yazılır. Yönetim paneli (app.mstyayincilik.com) bu
     * koleksiyonu servis hesabıyla dinler, işlediğini iletildi=true yapar.
     * Şema ve panel tarafı kodu: PANEL-CRM-BILDIRIM-ENTEGRASYONU.md */
    async function panelEventGonder(tur, veri) {
      const ev = Object.assign({
        id: uid(),
        tur,
        tarih: new Date().toISOString(),
        iletildi: false,
        kaynak: "crm"
      }, veri);
      try {
        await firestore.collection("panel_events").doc(ev.id).set(ev);
      } catch (e) {
        // Panel haberdar edilemese bile CRM akışı durmaz — sözleşme kaydı
        // zaten alınmıştır; olay yalnızca konsola düşer.
        console.error("Panel bildirimi yazılamadı:", e);
      }
    }
    function customAlert(title, message) {
      document.getElementById("customAlertTitle").textContent = title || "Uyarı";
      document.getElementById("customAlertMessage").textContent = message || "";
      document.getElementById("customAlertModal").classList.add("open");
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

    /* ---------- Görüşme devri (danışmanlar arası transfer) ---------- */
    function openTransferModal(authorId) {
      const a = db.authors.find(x => x.id === authorId); if (!a) return;
      // Liste "kendim hariç herkes"tir. Önceden kaydın SAHİBİ (addedBy)
      // çıkarılıyordu; sahiplik başka birindeyse devreden kişi listede
      // kendini görüyor, asıl devretmek istediği kişiyi göremiyordu.
      // Kaydın şu anki sahibi de listede kalır (etiketiyle) — ona devir,
      // günlük görünümde kartı onun sütununa taşımak için anlamlıdır.
      const candidates = (db.staff || []).filter(s => s.id !== currentStaffId);
      if (!candidates.length) { customAlert("Devredilecek danışman yok", "Ekipte bu kaydı devredebileceğiniz başka bir danışman bulunmuyor."); return; }
      let content = `
        <div class="box" style="max-width: 320px; padding: 20px;">
          <h2 style="margin-top:0; font-size:16px;">${icon('users', 15)} Görüşmeyi Devret</h2>
          <div style="color:var(--muted);font-size:12px;margin-bottom:12px">"${escapeHtml(a.name)}" kaydı seçtiğiniz danışmana devredilir; bundan sonra onun panelinde görünür ve onun istatistiklerine sayılır.</div>
          <div style="display:flex; flex-direction:column; gap:8px; max-height:320px; overflow-y:auto; padding-right:4px;">` +
        candidates.map(s => `<button class="btn ghost" style="justify-content:flex-start; width:100%;" onclick="transferAuthor('${a.id}','${s.id}')">
            <span class="avatar" style="background:${avatarColor(s.name)};width:22px;height:22px;font-size:10px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;margin-right:8px">${escapeHtml(initials(s.name))}</span>
            ${escapeHtml(s.name)}${s.role ? ' <span style="color:var(--muted);font-size:11px">(' + escapeHtml(s.role) + ')</span>' : ''}${s.id === a.addedBy ? ' <span style="color:#2dd4bf;font-size:11px">• şu anki sahibi</span>' : ''}
          </button>`).join("") +
        `</div>
          <div class="actions" style="margin-top:16px;">
            <button class="btn ghost" style="width:100%" onclick="closeTransferModal()">Vazgeç</button>
          </div>
        </div>`;
      let m = document.getElementById("transferModal");
      if (!m) {
        m = document.createElement("div");
        m.className = "modal";
        m.id = "transferModal";
        document.body.appendChild(m);
      }
      m.innerHTML = content;
      m.classList.add("open");
    }
    function closeTransferModal() {
      const m = document.getElementById("transferModal");
      if (m) m.classList.remove("open");
    }
    async function transferAuthor(authorId, newStaffId) {
      const a = db.authors.find(x => x.id === authorId); if (!a) return;
      // Not, devri YAPAN kişi üzerinden yazılır (eski sahip değil) — sahip
      // farklı biriyken devri başkası yapabildiği için doğru iz budur.
      const fromName = currentStaffId ? (staffName(currentStaffId) || "Personel") : "Sistem Yöneticisi";
      const toName = staffName(newStaffId) || "Personel";
      closeTransferModal();
      // Devir hem sahipliği (addedBy) taşır hem de geçmişe iz düşer: yeni
      // danışman adına bir devir notu eklenir — günlük görünümde kayıt o
      // günden itibaren yeni danışmanın sütununda görünür.
      await mutateAuthor(authorId, x => {
        x.addedBy = newStaffId;
        x.logs = x.logs || [];
        x.logs.push({ type: "Not", date: todayStr(), time: null, text: "Görüşme devri: " + fromName + " → " + toName, staffId: newStaffId });
      });
      render();
      openDrawer(authorId);
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
          visibleAuthors().map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
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
          visibleAuthors().map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
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
      const staff = db.staff.filter(s => !t || searchKey(s.name + " " + (s.role || "")).includes(t));
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
      ${hedefSatiri(s.id)}
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
      visibleAuthors().forEach(a => {
        (a.payments || []).forEach(p => {
          const addedByLabel = p.addedBy === "admin" ? "Sistem Yöneticisi" : (staffName(p.addedBy) || "");
          rows.push([a.name, p.date, p.serviceName || "", p.amount, vatPortion(p), p.status, p.notes || "", addedByLabel]);
        });
      });
      downloadBlob(rowsToCsvBlob(rows), "odemeler-" + todayStr() + ".csv");
    }
    // Tüm yazarları TÜM bilgileriyle, gerçek bir Excel (.xlsx) dosyası olarak
    // hazırlar: 4 sayfa — Yazarlar, Görüşmeler, Ödemeler, Eserler.
    // (Önceki sürüm noktalı virgüllü CSV üretiyordu; Excel'de çoğu zaman tek
    // sütuna yığılıyor ve yalnızca 12 alan içeriyordu.)
    function kisiAdi(id) {
      if (!id) return "";
      return id === "admin" ? "Sistem Yöneticisi" : (staffName(id) || "");
    }
    function buildAuthorsWorkbook() {
      const yazarlar = [[
        "Ad Soyad", "Telefon", "E-posta", "Durum", "Paket", "Türler", "Eser", "İlgi Düzeyi (1-5)", "Kaynak",
        "Kayıt Tarihi", "Görüşme Tarihi", "Görüşme Saati", "Takip Tarihi", "Sözleşme Tarihi", "Sözleşme Bitiş",
        "Ekleyen Görüşmeci", "Görüşme Sayısı", "Son Görüşme", "Son Görüşme Notu",
        "Toplam Tahsilat", "Bekleyen Tutar", "Ödeme Sayısı", "Son Ödeme Şekli", "Notlar"
      ]];
      const gorusmeler = [["Yazar", "Telefon", "Tarih", "Saat", "Tür", "Görüşmeci", "Not"]];
      const odemeler = [["Yazar", "Tarih", "Hizmet", "Tutar", "KDV", "Durum", "Ödeme Şekli", "Resmi", "Not", "Ekleyen"]];
      const eserler = [["Yazar", "Eser", "Yayın Tarihi", "Telif Oranı (%)", "Satış Kaydı Sayısı"]];

      const liste = visibleAuthors().slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));
      liste.forEach(a => {
        const payments = a.payments || [];
        const logs = (a.logs || []).filter(l => l.date).slice().sort((x, y) => x.date.localeCompare(y.date));
        const sonLog = logs.length ? logs[logs.length - 1] : null;
        const totalPaid = payments.filter(p => p.status === "Ödendi").reduce((s, p) => s + (p.amount || 0), 0);
        const totalPending = payments.filter(p => p.status === "Bekliyor").reduce((s, p) => s + (p.amount || 0), 0);
        const lastMethod = payments.length ? payments[payments.length - 1].method : null;
        const cDateStr = getContractDate(a);
        yazarlar.push([
          a.name || "", a.phone || "", a.email || "",
          STATUS[a.status] ? STATUS[a.status].label : (a.status || ""),
          a.package && PACKAGES[a.package] ? PACKAGES[a.package].label : "",
          (a.genres || []).join(", "), a.work || "", a.temp || "", a.source || "",
          a.created || "", a.interviewDate || "", a.interviewTime || "", a.followup || "",
          cDateStr || "", a.contractEndDate || "",
          kisiAdi(a.addedBy), logs.length, sonLog ? sonLog.date : "", sonLog ? (sonLog.text || "") : "",
          totalPaid, totalPending, payments.length,
          lastMethod && PAYMENT_METHODS[lastMethod] ? PAYMENT_METHODS[lastMethod].label : "",
          a.notes || ""
        ]);
        logs.forEach(l => gorusmeler.push([a.name || "", a.phone || "", l.date || "", l.time || "", l.type || "", kisiAdi(l.staffId), l.text || ""]));
        payments.forEach(p => odemeler.push([
          a.name || "", p.date || "", p.serviceName || "", p.amount || 0, vatPortion(p), p.status || "",
          p.method && PAYMENT_METHODS[p.method] ? PAYMENT_METHODS[p.method].label : (p.method || ""),
          p.resmi === false ? "Hayır" : "Evet", p.notes || "", kisiAdi(p.addedBy)
        ]));
        (a.books || []).forEach(b => eserler.push([a.name || "", b.title || "", b.publishDate || "", b.royaltyRate != null ? b.royaltyRate : "", (b.sales || []).length]));
      });

      const wb = XLSX.utils.book_new();
      const sayfaEkle = (ad, rows, genislikler) => {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = genislikler.map(w => ({ wch: w }));
        ws["!freeze"] = { xSplit: 0, ySplit: 1 }; // başlık satırı sabit
        XLSX.utils.book_append_sheet(wb, ws, ad);
      };
      sayfaEkle("Yazarlar", yazarlar, [24, 16, 26, 14, 30, 20, 24, 10, 18, 12, 12, 8, 12, 14, 14, 18, 10, 12, 40, 14, 14, 10, 16, 40]);
      sayfaEkle("Görüşmeler", gorusmeler, [24, 16, 12, 8, 12, 18, 60]);
      sayfaEkle("Ödemeler", odemeler, [24, 12, 24, 12, 10, 10, 16, 8, 30, 18]);
      sayfaEkle("Eserler", eserler, [24, 30, 12, 14, 16]);
      return { wb, sayilar: { yazar: yazarlar.length - 1, gorusme: gorusmeler.length - 1, odeme: odemeler.length - 1, eser: eserler.length - 1 } };
    }
    function exportFullBackupExcel() {
      if (typeof XLSX === "undefined") {
        alert("Excel kütüphanesi yüklenemedi (internet bağlantısını kontrol edin). Sayfayı yenileyip tekrar deneyin.");
        return;
      }
      const { wb, sayilar } = buildAuthorsWorkbook();
      XLSX.writeFile(wb, "mst-crm-yazarlar-" + todayStr() + ".xlsx");
      customAlert("Excel hazır 📊", `${sayilar.yazar} yazar, ${sayilar.gorusme} görüşme, ${sayilar.odeme} ödeme ve ${sayilar.eser} eser kaydı 4 ayrı sayfada indirildi.`);
    }
    /* ---------- Belgeden yazar yükleme (PDF / Word / Excel / metin) ----------
     * Her durum bölümü için toplu kayıt: belge seçilir, metin çıkarılır,
     * yazarlar ayrıştırılıp ÖNİZLEME gösterilir, onaylanınca seçilen durumla
     * CRM'e kaydedilir. Telefonu kayıtlı olanlar (mükerrer kuralı) ve
     * telefonu olmayanlar atlanır.
     *
     * Desteklenen biçimler:
     *  1) ETİKETLİ BLOK (PDF/Word/metin için en güvenilir):
     *       Ad: Ahmet Yılmaz
     *       Telefon: 0532 111 22 33
     *       E-posta: ahmet@...      Eser: Kırık Kanatlar     Tür: Roman
     *       Görüşme: 10.08.2026 - İlk görüşme olumlu    (tekrarlanabilir)
     *       Not: ...
     *     Her yeni "Ad:" satırı yeni yazar başlatır.
     *  2) SATIR BAŞINA BİR YAZAR: "Ahmet Yılmaz 0532 111 22 33 not..." —
     *     telefon bulunan her satır bir yazar sayılır (ad = telefondan önceki
     *     kısım, kalan = not).
     *  3) EXCEL/CSV: başlık satırındaki sütun adlarına göre (Ad, Telefon,
     *     E-posta, Eser, Tür, Kaynak, Not, Görüşme...). */
    const IMPORT_ETIKETLER = [
      [/^(ad soyad|ad|isim|i̇sim|yazar|ad-soyad)$/i, "name"],
      [/^(telefon|tel|gsm|numara|cep|telefon no|tel no)$/i, "phone"],
      [/^(e-?posta|eposta|email|e-?mail|mail)$/i, "email"],
      [/^(eser|kitap|eser adı|kitap adı|çalışma)$/i, "work"],
      [/^(tür|tur|türler|kategori|janr)$/i, "genres"],
      [/^(kaynak|nereden)$/i, "source"],
      [/^(ilgi|ilgi düzeyi|sıcaklık|puan)$/i, "temp"],
      [/^(takip|takip tarihi|geri dönüş)$/i, "followup"],
      [/^(randevu|görüşme tarihi|randevu tarihi)$/i, "interviewDate"],
      [/^(görüşme|gorusme|görüşme notu|arama|konuşma)$/i, "log"],
      [/^(not|notlar|açıklama|aciklama)$/i, "notes"]
    ];
    function importEtiketAnahtari(label) {
      const l = String(label || "").trim().toLocaleLowerCase("tr");
      for (const [re, key] of IMPORT_ETIKETLER) if (re.test(l)) return key;
      return null;
    }
    function importTarihCoz(s) {
      const t = String(s || "").trim();
      let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
      m = t.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
      if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
      return null;
    }
    const IMPORT_TEL_RE = /(\+?\s*9?0?\s*\(?5\d{2}\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2})|(\b0?\d{3}[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}\b)/;
    function importYeniYazar() {
      return { name: "", phone: "", email: "", work: "", genres: [], source: "", temp: 3, followup: "", interviewDate: "", notes: "", logs: [] };
    }
    function importGorusmeEkle(y, deger) {
      const v = String(deger || "").trim();
      if (!v) return;
      const tarih = importTarihCoz(v) || todayStr();
      const metin = v.replace(/^\s*[\d.\/-]+\s*[-:–]?\s*/, "").trim() || v;
      y.logs.push({ type: "Telefon", date: tarih, time: null, text: metin, staffId: currentStaffId || null });
    }
    function importAlanYaz(y, key, deger) {
      const v = String(deger || "").trim();
      if (!v) return;
      if (key === "genres") y.genres = v.split(/[,;\/]/).map(s => s.trim()).filter(Boolean);
      else if (key === "temp") { const n = parseInt(v, 10); if (n >= 1 && n <= 5) y.temp = n; }
      else if (key === "followup" || key === "interviewDate") { const d = importTarihCoz(v); if (d) y[key] = d; }
      else if (key === "log") importGorusmeEkle(y, v);
      else if (key === "notes") y.notes = y.notes ? y.notes + "\n" + v : v;
      else y[key] = v;
    }
    // Metinden yazar listesi çıkarır (etiketli blok ya da satır başına yazar).
    function parseImportText(text) {
      const lines = String(text || "").replace(/\r/g, "").split("\n").map(l => l.trim()).filter(Boolean);
      const etiketli = lines.some(l => { const m = l.match(/^([^:：]{2,20})[:：]/); return m && importEtiketAnahtari(m[1]) === "name"; });
      const sonuc = [];
      if (etiketli) {
        let y = null;
        lines.forEach(line => {
          // Bir satırda birden çok "Etiket: değer" olabilir (PDF tabloları böyle gelir)
          const parcalar = line.split(/\s{2,}|\t/).map(p => p.trim()).filter(Boolean);
          parcalar.forEach(p => {
            const m = p.match(/^([^:：]{2,20})[:：]\s*(.*)$/);
            const key = m ? importEtiketAnahtari(m[1]) : null;
            if (key === "name") { y = importYeniYazar(); sonuc.push(y); y.name = m[2].trim(); }
            else if (key && y) importAlanYaz(y, key, m[2]);
            else if (y && !m) importAlanYaz(y, "notes", p);
          });
        });
      } else {
        lines.forEach(line => {
          const m = line.match(IMPORT_TEL_RE);
          if (!m) return;
          const y = importYeniYazar();
          y.phone = m[0].trim();
          y.name = line.slice(0, m.index).replace(/[\s,;:\-–|]+$/, "").trim();
          const kalan = line.slice(m.index + m[0].length).replace(/^[\s,;:\-–|]+/, "").trim();
          if (kalan) y.notes = kalan;
          if (y.name) sonuc.push(y);
        });
      }
      return sonuc;
    }
    // Excel/CSV satırlarından (dizi dizisi) yazar listesi çıkarır.
    function parseImportRows(rows) {
      if (!rows || !rows.length) return [];
      const baslik = rows[0].map(c => importEtiketAnahtari(c));
      const basliklı = baslik.some(k => k === "name" || k === "phone");
      const kolonlar = basliklı ? baslik : ["name", "phone", "email", "work", "notes"];
      const veri = basliklı ? rows.slice(1) : rows;
      const sonuc = [];
      veri.forEach(r => {
        if (!r || !r.some(c => String(c || "").trim())) return;
        const y = importYeniYazar();
        kolonlar.forEach((key, i) => { if (key) importAlanYaz(y, key, r[i]); });
        if (y.name || y.phone) sonuc.push(y);
      });
      return sonuc;
    }
    async function importDosyadanMetin(file) {
      const ad = (file.name || "").toLowerCase();
      if (/\.(xlsx|xls|csv)$/.test(ad)) {
        if (typeof XLSX === "undefined") throw new Error("Excel kütüphanesi yüklenemedi.");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        return { rows: XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) };
      }
      if (/\.pdf$/.test(ad)) {
        if (typeof pdfjsLib === "undefined") throw new Error("PDF kütüphanesi yüklenemedi.");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let metin = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const sayfa = await pdf.getPage(i);
          const icerik = await sayfa.getTextContent();
          // Aynı y hizasındaki parçalar aynı satırdır; satırlar y'ye göre sıralanır
          const satirlar = [];
          icerik.items.forEach(it => {
            const y = Math.round(it.transform[5]);
            let s = satirlar.find(r => Math.abs(r.y - y) <= 2);
            if (!s) { s = { y, parcalar: [] }; satirlar.push(s); }
            s.parcalar.push({ x: it.transform[4], str: it.str });
          });
          satirlar.sort((a, b) => b.y - a.y);
          satirlar.forEach(s => { s.parcalar.sort((a, b) => a.x - b.x); metin += s.parcalar.map(p => p.str).join(" ") + "\n"; });
        }
        return { text: metin };
      }
      if (/\.docx$/.test(ad)) {
        if (typeof mammoth === "undefined") throw new Error("Word kütüphanesi yüklenemedi.");
        const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        return { text: r.value };
      }
      return { text: await file.text() };
    }
    let importOnizleme = [];
    function openImportModal() {
      const varsayilan = STATUS[filterStatus] ? filterStatus : "aday";
      const durumlar = Object.keys(STATUS).map(k => `<option value="${k}"${k === varsayilan ? " selected" : ""}>${STATUS[k].label}</option>`).join("");
      const content = `
        <div class="box" style="max-width:640px;padding:22px">
          <h2 style="margin:0 0 4px;font-size:17px">📄 Belgeden Yazar Yükle</h2>
          <div style="color:var(--muted);font-size:12px;margin-bottom:12px">PDF, Word (.docx), Excel/CSV veya metin dosyasındaki yazarlar seçtiğiniz duruma toplu kaydedilir. Önce önizleme gösterilir, onaylamadan hiçbir şey kaydedilmez.</div>
          <label>Hangi bölüme kaydedilsin?</label>
          <select id="imp_status">${durumlar}</select>
          <label style="margin-top:10px">Belge</label>
          <input type="file" id="imp_file" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt" onchange="importDosyaSecildi(this)">
          <div style="color:var(--muted);font-size:11px;margin-top:6px">…ya da listeyi buraya yapıştırın:</div>
          <textarea id="imp_text" rows="4" placeholder="Ad: Ahmet Yılmaz&#10;Telefon: 0532 111 22 33&#10;Eser: Kırık Kanatlar&#10;Görüşme: 10.08.2026 - İlk görüşme olumlu&#10;&#10;Ad: ..." style="width:100%;resize:vertical;font-family:monospace;font-size:12px"></textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn ghost" style="font-size:12px" onclick="importMetniIsle()">Metni Çözümle</button></div>
          <details style="margin-top:10px;font-size:12px;color:var(--muted)"><summary style="cursor:pointer;color:var(--txt)">Belge nasıl hazırlanmalı? (zorunlu alanlar)</summary>
            <div style="margin-top:8px;line-height:1.6">
              <b style="color:var(--txt)">Zorunlu:</b> <b>Ad Soyad</b> ve <b>Telefon</b> — telefon olmadan kayıt yapılmaz (mükerrer kontrolü ve WhatsApp/arama eşleşmesi telefona bağlıdır).<br>
              <b style="color:var(--txt)">İsteğe bağlı:</b> E-posta, Eser, Tür, Kaynak, İlgi (1-5), Takip tarihi, Randevu tarihi, Not, Görüşme (istediğiniz kadar; "Görüşme: 10.08.2026 - konuşulanlar" biçiminde, tarih verilmezse bugün yazılır).<br>
              <b style="color:var(--txt)">Biçim:</b> Her yazar "Ad:" satırıyla başlar, alanlar "Etiket: değer" şeklinde alt alta yazılır. Excel'de ise ilk satır başlık olur (Ad, Telefon, E-posta, Eser, Tür, Not, Görüşme…).<br>
              Etiketsiz düz listeler de okunur: telefon geçen her satır bir yazar sayılır (ad = telefondan önceki kısım).
            </div>
          </details>
          <div id="imp_onizleme" style="margin-top:12px"></div>
          <div class="actions" style="margin-top:16px;display:flex;gap:8px">
            <button class="btn ghost" style="flex:1" onclick="closeImportModal()">Vazgeç</button>
            <button class="btn" style="flex:1" id="imp_kaydet" onclick="importKaydet()" disabled>Kaydet</button>
          </div>
        </div>`;
      let m = document.getElementById("importModal");
      if (!m) { m = document.createElement("div"); m.className = "modal"; m.id = "importModal"; document.body.appendChild(m); }
      m.innerHTML = content;
      m.classList.add("open");
      importOnizleme = [];
    }
    function closeImportModal() { const m = document.getElementById("importModal"); if (m) m.classList.remove("open"); }
    async function importDosyaSecildi(inp) {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const alan = document.getElementById("imp_onizleme");
      alan.innerHTML = `<div class="empty">Belge okunuyor…</div>`;
      try {
        const r = await importDosyadanMetin(file);
        const liste = r.rows ? parseImportRows(r.rows) : parseImportText(r.text);
        if (r.text) document.getElementById("imp_text").value = r.text.slice(0, 20000);
        importOnizlemeGoster(liste);
      } catch (e) {
        console.error("Belge okunamadı:", e);
        alan.innerHTML = `<div class="empty" style="color:var(--red)">Belge okunamadı: ${escapeHtml(e.message)}</div>`;
      }
    }
    function importMetniIsle() {
      importOnizlemeGoster(parseImportText(document.getElementById("imp_text").value));
    }
    function importOnizlemeGoster(liste) {
      const alan = document.getElementById("imp_onizleme");
      const gorulen = new Set();
      importOnizleme = liste.map(y => {
        const np = normalizePhone(y.phone || "");
        let durum = "yeni", sebep = "";
        if (!y.name) { durum = "atla"; sebep = "ad yok"; }
        else if (!np || np.length < 10) { durum = "atla"; sebep = "telefon yok/geçersiz"; }
        else if (gorulen.has(np)) { durum = "atla"; sebep = "belgede tekrar ediyor"; }
        else {
          const mevcut = (db.authors || []).find(a => a.phone && normalizePhone(a.phone) === np);
          if (mevcut) { durum = "atla"; sebep = "zaten kayıtlı: " + mevcut.name; }
        }
        if (np) gorulen.add(np);
        return { y, durum, sebep, sec: durum === "yeni" };
      });
      const yeni = importOnizleme.filter(x => x.durum === "yeni").length;
      if (!importOnizleme.length) {
        alan.innerHTML = `<div class="empty">Belgede yazar bulunamadı. Biçimi kontrol edin (aşağıdaki "Belge nasıl hazırlanmalı?" bölümüne bakın).</div>`;
        document.getElementById("imp_kaydet").disabled = true;
        return;
      }
      alan.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:6px">${importOnizleme.length} kayıt bulundu — <b style="color:#37c98a">${yeni} yeni</b>, ${importOnizleme.length - yeni} atlanacak</div>
        <div style="max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px">
          ${importOnizleme.map((x, i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px dashed var(--line);font-size:12px;${x.durum === 'atla' ? 'opacity:.55' : ''}">
            <input type="checkbox" ${x.sec ? "checked" : ""} ${x.durum === 'atla' ? "disabled" : ""} onchange="importOnizleme[${i}].sec=this.checked">
            <div style="flex:1;min-width:0">
              <b>${escapeHtml(x.y.name || "—")}</b> <span style="color:var(--muted)">${escapeHtml(x.y.phone || "")}</span>
              ${x.y.work ? `<span style="color:var(--muted)"> • ${escapeHtml(x.y.work)}</span>` : ""}
              ${x.y.logs.length ? `<span style="color:#4aa8ff"> • ${x.y.logs.length} görüşme</span>` : ""}
              ${x.durum === 'atla' ? `<div style="color:var(--amber)">Atlanacak — ${escapeHtml(x.sebep)}</div>` : ""}
            </div>
          </div>`).join("")}
        </div>`;
      document.getElementById("imp_kaydet").disabled = yeni === 0;
      document.getElementById("imp_kaydet").textContent = yeni ? `${yeni} Yazarı Kaydet` : "Kaydet";
    }
    async function importKaydet() {
      const status = document.getElementById("imp_status").value;
      const secilenler = importOnizleme.filter(x => x.durum === "yeni" && x.sec);
      if (!secilenler.length) return;
      if (!(await customConfirm(`${secilenler.length} yazar "${STATUS[status].label}" durumuyla kaydedilsin mi?`, "Evet, Kaydet"))) return;
      const btn = document.getElementById("imp_kaydet");
      btn.disabled = true; btn.textContent = "Kaydediliyor…";
      const today = todayStr();
      let ok = 0;
      for (const x of secilenler) {
        const y = x.y;
        const payload = {
          id: uid(), name: y.name, status, email: y.email || "", phone: y.phone, phoneNorm: normalizePhone(y.phone),
          genres: y.genres || [], temp: y.temp || 3, work: y.work || "", interviewDate: y.interviewDate || "", interviewTime: null,
          followup: y.followup || "", source: y.source || "Belgeden yükleme", notes: y.notes || "", package: null,
          contractDate: status === "sozlesme" || status === "yayinda" ? today : null, contractEndDate: null,
          created: today, logs: y.logs || [], addedBy: currentStaffId || "admin",
          statusHistory: [{ status, date: today }]
        };
        try { await createAuthor(payload); ok++; } catch (e) { console.error("Yazar kaydedilemedi:", y.name, e); }
      }
      closeImportModal();
      render();
      customAlert("Yükleme tamamlandı 📄", `${ok} yazar "${STATUS[status].label}" bölümüne kaydedildi.`);
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
              // Damga şart: damgasız yazılan kayıtları açılıştaki fark
              // sorgusu göremez, yedekten dönen veri diğer kullanıcıların
              // ekranına hiç yansımazdı (bkz. stampUpdated).
              batch.set(firestore.collection("authors").doc(a.id), stampUpdated({ ...a }));
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
      // Balon artık kenara gizlenmiyor; her zaman arayüzün içinde, tam
      // görünür durur (önceden kapanınca sağ kenardan dışarı kayıyordu).
      dock.style.right = "36px";
      if (!isOpen) {
        document.getElementById("chatFabBubble").style.opacity = "0";
        // Sayfadan yazılan mesajlar balona da yansısın: açılışta geçmişten çiz.
        renderChatInto("chatMessages");
        document.getElementById("chatInput").focus();
      }
    }

    // Buton her zaman görünür; belirli aralıklarla yanında kısa bir mesaj
    // balonu belirip kayboluyor — kullanıcı Linda'yı unutmasın diye.
    let chatFabPeekInterval = null;
    function peekChatFab() {
      const bubble = document.getElementById("chatFabBubble");
      const panel = document.getElementById("chatPanel");
      if (panel.style.display === "flex") return; // sohbet zaten açıksa dokunma
      bubble.style.opacity = "1";
      bubble.style.transform = "translateX(0)";
      setTimeout(() => {
        if (panel.style.display === "flex") return;
        bubble.style.opacity = "0";
        bubble.style.transform = "translateX(8px)";
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
      const all = visibleAuthors();
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

    // Sohbet geçmişi hesaba özeldir (uid). İki yerde tutulur: tarayıcıda
    // (localStorage, anında) ve Firestore'da (chat_history/{uid}, cihazlar
    // arası). Köşedeki balon ile sol menüdeki Linda sayfası AYNI geçmişi
    // paylaşır — hangisinden yazılırsa yazılsın tek bir sohbet sürer.
    let chatHistoryData = [];
    const CHAT_HISTORY_MAX = 300;
    function chatHistoryKey() {
      return "chatHistory_" + (auth.currentUser ? auth.currentUser.uid : "anon");
    }
    function persistChatHistory() {
      if (chatHistoryData.length > CHAT_HISTORY_MAX) chatHistoryData = chatHistoryData.slice(-CHAT_HISTORY_MAX);
      try { localStorage.setItem(chatHistoryKey(), JSON.stringify(chatHistoryData)); } catch (e) { /* depolama dolu/kapalı olabilir, sessizce geç */ }
      if (auth.currentUser) {
        firestore.collection("chat_history").doc(auth.currentUser.uid)
          .set({ messages: chatHistoryData, updatedAt: new Date().toISOString() })
          .catch(e => console.error("Sohbet geçmişi sunucuya yazılamadı:", e));
      }
    }
    let chatHistoryRestored = false;
    function restoreChatHistory() {
      if (chatHistoryRestored) return; // birden fazla çağrılırsa mesajlar tekrarlanmasın
      chatHistoryRestored = true;
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(chatHistoryKey()) || "[]"); } catch (e) { saved = []; }
      chatHistoryData = Array.isArray(saved) ? saved : [];
      renderChatInto("chatMessages");
      // Sunucudaki kopya daha uzunsa (başka cihazdan yazılmışsa) onu esas al.
      if (auth.currentUser) {
        firestore.collection("chat_history").doc(auth.currentUser.uid).get().then(doc => {
          const sunucu = doc.exists && Array.isArray(doc.data().messages) ? doc.data().messages : [];
          if (sunucu.length > chatHistoryData.length) {
            chatHistoryData = sunucu;
            try { localStorage.setItem(chatHistoryKey(), JSON.stringify(chatHistoryData)); } catch (e) { /* sessizce geç */ }
            renderChatInto("chatMessages");
            if (currentView === "linda") render();
          }
        }).catch(e => console.error("Sohbet geçmişi okunamadı:", e));
      }
    }
    // Verilen kapsayıcıyı geçmişten baştan çizer (balon ve sayfa ortak).
    function renderChatInto(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const suggestions = container.querySelector("#chatSuggestions, #lindaSuggestions");
      const intro = container.querySelector(".chat-intro");
      if (chatHistoryData.length) {
        if (suggestions) suggestions.remove();
        if (intro) intro.remove();
      }
      container.querySelectorAll(".chat-msg").forEach(el => el.remove());
      chatHistoryData.forEach(m => addChatMessage(m.role, m.text, false, containerId));
      container.scrollTop = container.scrollHeight;
    }

    function addChatMessage(role, text, save, containerId) {
      const container = document.getElementById(containerId || "chatMessages");
      const bubble = document.createElement("div");
      bubble.className = "chat-msg";
      bubble.style.cssText = role === "user"
        ? "align-self:flex-end;background:var(--brand);color:#fff;padding:8px 12px;border-radius:12px 12px 2px 12px;max-width:85%;font-size:13px;white-space:pre-wrap"
        : "align-self:flex-start;background:var(--panel-2);color:var(--txt);padding:8px 12px;border-radius:12px 12px 12px 2px;max-width:85%;font-size:13px;white-space:pre-wrap";
      bubble.textContent = text;
      if (container) { container.appendChild(bubble); container.scrollTop = container.scrollHeight; }
      if (save !== false) {
        chatHistoryData.push({ role, text });
        persistChatHistory();
      }
      return bubble;
    }

    function addLoadingCatBubble(containerId) {
      const container = document.getElementById(containerId || "chatMessages");
      const bubble = document.createElement("div");
      bubble.className = "chat-msg";
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
    function askLindaSuggestion(text) {
      document.getElementById("lindaInput").value = text;
      sendLindaPageMessage();
    }

    // Köşedeki balondan gönder
    function sendChatMessage() {
      return runChatQuestion({ inputId: "chatInput", containerId: "chatMessages", sendBtnId: "chatSendBtn", suggestionsId: "chatSuggestions" });
    }
    // Sol menüdeki Linda sayfasından gönder
    function sendLindaPageMessage() {
      return runChatQuestion({ inputId: "lindaInput", containerId: "lindaMessages", sendBtnId: "lindaSendBtn", suggestionsId: "lindaSuggestions" });
    }

    // Ortak sohbet motoru: soruyu geçmişe yazar, Linda'ya (worker /chat)
    // son 10 mesajlık bağlamla birlikte gönderir, cevabı geçmişe ekler.
    // Balon ve sayfa aynı geçmişi paylaştığından diğer arayüz bir sonraki
    // açılışında/çiziminde güncel halini gösterir.
    async function runChatQuestion(ui) {
      const input = document.getElementById(ui.inputId);
      if (!input) return;
      const question = input.value.trim();
      if (!question) return;
      input.value = "";
      const suggestions = document.getElementById(ui.suggestionsId);
      if (suggestions) suggestions.remove();
      const container = document.getElementById(ui.containerId);
      if (container) { const intro = container.querySelector(".chat-intro"); if (intro) intro.remove(); }
      // Sunucuya gidecek geçmiş, soru eklenmeden ÖNCEKİ son 10 mesaj
      const history = chatHistoryData.slice(-10).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.text || "").slice(0, 2000) }));
      addChatMessage("user", question, true, ui.containerId);
      const sendBtn = document.getElementById(ui.sendBtnId);
      if (sendBtn) sendBtn.disabled = true;
      const loadingBubble = addLoadingCatBubble(ui.containerId);
      const catLoader = loadingBubble.querySelector(".cat-loader");

      let finalText;
      try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch(CHAT_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
          body: JSON.stringify({ question, history, context: buildChatContext() })
        });
        const data = await resp.json();
        finalText = resp.ok ? data.answer : ("Hata: " + (data.error || "Bilinmeyen hata"));
      } catch (e) {
        finalText = "Bağlantı hatası: " + e.message;
      } finally {
        // Kedi bir anda yere yığılıp kaybolsun, sonra gerçek cevap belirsin.
        if (catLoader) catLoader.className = "cat-loader collapsing";
        await new Promise(r => setTimeout(r, 550));
        loadingBubble.textContent = finalText;
        chatHistoryData.push({ role: "assistant", text: finalText });
        persistChatHistory();
        if (sendBtn) sendBtn.disabled = false;
        const c = document.getElementById(ui.containerId);
        if (c) c.scrollTop = c.scrollHeight;
      }
    }

    /* ---------- Linda sayfası (sol menüdeki bölüm) ----------
     * Köşedeki balonla aynı sohbet geçmişini paylaşan, tam sayfa bir
     * sohbet arayüzü. Balon kısayol gibi kalır; asıl çalışma alanı burasıdır. */
    function viewLinda() {
      const oneriler = [
        "Bugün kimlerle ilgilenmem lazım?",
        "Hangi ödemeler gecikmiş?",
        "Bu ay kaç yeni aday eklendi?",
        "Sözleşmeye en sıcak bakan kim?",
        "Görev oylaması nasıl çalışıyor?",
        "Ortak havuz kuralı nedir?"
      ];
      const bos = !chatHistoryData.length;
      return `<div class="card" style="display:flex;flex-direction:column;height:calc(100vh - 150px);min-height:420px;padding:0;overflow:hidden">
    <div style="padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--brand),var(--brand-2));display:grid;place-items:center;font-size:20px">🐱</span>
        <div>
          <div style="font-weight:700;font-size:15px">Linda</div>
          <div style="font-size:11px;color:var(--muted)">CRM asistanın — veri soruları ve kullanım desteği</div>
        </div>
      </div>
      <button class="btn ghost" style="font-size:12px" onclick="clearLindaChat()" title="Geçmişi temizle, yeni sohbete başla">${icon('trash', 13)} Yeni Sohbet</button>
    </div>
    <div id="lindaMessages" style="flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:10px">
      ${bos ? `<div class="chat-intro" style="color:var(--muted);font-size:13px">Miyav! Ben Linda. 🐾 Yazarlar, ödemeler, görevler ve CRM'in kullanımı hakkında her şeyi sorabilirsin — sohbetimiz kayıtlı kalır, kaldığımız yerden devam ederiz.</div>
      <div id="lindaSuggestions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
        ${oneriler.map(o => `<button class="btn ghost" style="font-size:12px;padding:7px 12px" onclick="askLindaSuggestion('${o.replace(/'/g, "\\'")}')">${escapeHtml(o)}</button>`).join("")}
      </div>` : ""}
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--line);display:flex;gap:8px;flex-shrink:0">
      <input id="lindaInput" placeholder="Linda'ya bir şey sor..." style="flex:1;margin:0" onkeydown="if(event.key==='Enter')sendLindaPageMessage()">
      <button class="btn" id="lindaSendBtn" onclick="sendLindaPageMessage()" style="padding:8px 18px">Gönder</button>
    </div>
  </div>`;
    }
    async function clearLindaChat() {
      if (!chatHistoryData.length) return;
      if (!(await customConfirm("Sohbet geçmişi silinip yeni bir sohbet başlatılsın mı?", "Evet, Temizle"))) return;
      chatHistoryData = [];
      persistChatHistory();
      render();
      renderChatInto("chatMessages");
    }

    // --- TEMALAR (AÇIK / KOYU TEMA SİSTEMİ) ---
    // Her iki temada da AYNI dosya kullanılıyor: logo-dark.png, beyaz figür
    // + şeffaf zemin. Açık temada figür CSS ile koyulaştırılıyor
    // (bkz. styles.css, [data-theme="light"] ... filter: invert(1)).
    //
    // Önceden açık temada logo.jpeg'e geçiliyordu; JPEG şeffaflık
    // taşıyamadığı için logonun arkasında dolu beyaz bir kutu kalıyor ve
    // açık gri sayfa zemininde bembeyaz bir leke gibi duruyordu.
    function updateLogoSources() {
      document.querySelectorAll('.mark img, .topbar-mark img').forEach(img => {
        if (img.src && !img.src.includes('logo-dark.png')) img.src = 'logo-dark.png';
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
      
      const search = searchKey(filterText).trim();
      let html = "";

      window.bulkMessageTempList.forEach((a, i) => {
        const nameMatches = searchKey(a.name).includes(search);
        const workMatches = searchKey(a.work || "").includes(search);
        
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
